# 2026-10-08: one audit event chain, its v4 fields, and how an event is verified

Requirements: RF012 AC1-AC6, RNF009 C2, C4 and C5, Requisitos v4.0.0; dictionary AuditEvent V2E-0492..0496 (`purpose`, `policyVersion`, `canonicalModelReleaseId`, `previousEventHash`, `canonicalEventHash`) and P1X-0328 (`actorAnonId`). Issue #1307.

## Decided

1. **The application's audit events form one append-only chain, `logId: 'audit-events'`.** Each event names the previous event's hash in `previousEventHash`, and `sequenceNumber` runs 1, 2, 3... with no gap. Before this, `ingestLogRecord` keyed each event's chain on its own log record's id, so every chain was one event long and `previousEventHash` was always null.
2. **Two concurrent appends can read the same last event.** The unique `{logId, sequenceNumber}` index refuses the second insert, which re-reads the chain and tries again, up to eight times.
3. **An event is hashed over the fields it was written with** (`EVENT_FIELDS` in `audit-v2.service.js`). Verification recomputes the hash from the stored document and from its `canonicalLeaf`, and both must equal `eventHash`. `canonicalEventHash` carries the same value under the v4 name. `eventHash` stays the stored key, since the indexes, the proofs and the readers already use it.
4. **Defaults for the v4 fields a log record does not carry:**
   - `purpose` is `operations`. A caller that knows the purpose passes it on the log record or in its `details`.
   - `policyVersion` is `governance-invariants-<INVARIANT_CATALOG_VERSION>`, the governance invariant catalog in force (`src/governance/invariants.js`). A caller acting under a specific versioned policy, such as the retention sweep, passes that policy's version in `details.policyVersion`, and it wins.
   - `canonicalModelReleaseId` is the build's `CANONICAL_MODEL_RELEASE_ID` (`src/foundation/readiness.js`).
5. **The actor is always a pseudonym.** A log record's `userName` is already the `USR-` pseudonym the audit logger writes. A record carrying only a raw `userID` is pseudonymised with `generateAnonId`, never copied.
6. **The chain is sealed as its own signed tree head**, at its current size, by the nightly Merkle job and by `POST /api/audit/anchor`. Each head names the root of the head before it. The daily heads over `logs` (`logId: audit-<date>`) are unchanged.
7. **`POST /api/audit/verify` computes the proof at verify time.** No proof is stored per event any more; the old one was built over two leaves, whatever the chain's length. The route takes the first head sealed at or after the event, rebuilds that head's tree from the chain as stored now, and reports each of these:
   - the event's own hash (`eventIntegrity`);
   - its inclusion in the head (`inclusionValid`);
   - the chain up to the head (`chainValid`, `chainBrokenAt`);
   - the head extending the one sealed before it (`consistencyValid`);
   - the head's signature, timestamp and witness.

   A rewritten, removed or inserted event fails at least one of them.
8. **Archived events stay part of the chain.** The retention sweep moves expired `audit_events` to `audit_events_archive` and never destroys them, so loading a chain, continuing it and verifying it all read both collections.

## Why the `logs` trail may be deleted and `audit_events` may not

RF012 AC5 and RNF009 C6 forbid the application to alter or delete audit events. `audit_events` is never deleted: the sweep refuses `destroy` for it and only archives. The `logs` collection is the operational log the events are mirrored from, and the sweep deletes its expired rows only under an approved RetentionPolicy with a basis and a period (RF026 AC1). LGPD art. 16 is binding law, which a project requirement cannot override. `retentionSweep.service.js` records this beside the code.

## Why an ingest failure does not fail the request

If the mirror into `audit_events` fails, `log.service.js` raises a critical `AUDIT_TRAIL_WRITE_FAILURE` security alert, and the request goes on. Failing every business write while the audit store is down would turn an audit outage into a full outage. No requirement asks for that. The failure is recorded as an alert, so it does not pass in silence.

## Events written before this change stay where they are

Each event written before this change sits in its own one-event chain, keyed by its log record's id, and is left there. Moving those events into the new chain would mean rewriting stored audit events, which RF012 AC5 forbids. They were never verifiable, because no head was ever sealed under those ids, so leaving them takes nothing away.

`tests/e2e/audit-chain-integrity.spec.ts` proves this decision against the real stack. It seals the chain, verifies a real event, and reads INVALID after one event is rewritten in Mongo.
