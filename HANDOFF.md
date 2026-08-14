# HANDOFF

**Written:** 2026-08-14, mid-`rabbit-hole` sitting on tracker `#587`
(RF021 protocol/consent/study linkage, seed `#578`), resumed on Dennis's
explicit instruction ("pick the rabbit hole again"). **Still inside the
hole** — this is not an exit handoff.

## What landed this session (so far)

- **`#591`** — `sample.service.js`'s `createSample` had existence-only
  checks for `studyId`/`protocolId` (resolves to a real document, no
  status check). Extended to also reject when `study.studyStatus !==
  'active'` or `protocol.approvalStatus !== 'approved'` (RF021 AC#5).
  Added 4 unit cases to `sample.service.test.js` (accept active+approved,
  reject inactive study, reject draft protocol, reject retired protocol);
  full file 97/97 passing on the merged tree. Merged
  `fix/591-inactive-protocol-enforcement` → `feature/docker-e2e-backend-integration`
  at `dcb04e6f`, pushed. Closed.
- **`#596`** — filed this session, **new tracker member**. `wrap-up`'s
  audit caught that `#591`'s own close comment listed the consent-side
  status check as "out of scope, tracked separately" with no issue
  actually existing yet for it. `consent.service.js` (`createPatientConsent`,
  landed via `#593`) and `patient.service.js` (landed via `#594`) each
  mirror the *same pre-`#591`* existence-only `studyId` check — no
  `studyStatus` gate. Scope: extend both to reject on
  `studyStatus !== 'active'`, same message/statusCode pattern as `#591`,
  plus matching unit coverage. Not started.

## Tracker `#587` current membership (re-derived, not from memory)

- `#588`, `#589`, `#590` (with its own split children `#593`/`#594`),
  `#591` — **closed**.
- `#596` — **open, not started**. Independent (consent/patient linkage
  already landed via `#593`/`#594`; this just adds the status gate).
- `#592` — **open, not started**. Real-backend e2e coverage for the full
  enforcement path. Originally depended on `#588`/`#590`/`#591`; now also
  effectively depends on `#596` for the consent/patient half of the
  enforcement path to have something real to assert against.

**Queue for next iteration: `#596` → `#592`.** Re-derive via
`gh issue view 587` before resuming regardless — this file is a snapshot,
not the source of truth, and the rabbit-hole skill's membership rule
(re-derive before every pick) applies even mid-sitting.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed at `dcb04e6f`,
  working tree clean. `fix/591-inactive-protocol-enforcement` merged
  `--no-ff`, deleted locally (never pushed to remote, so no remote
  deletion needed).
- Docker is **on** this session (user confirmed) — available for `#592`'s
  e2e work when the queue reaches it. Not yet exercised this session
  (`#591`/`#596` are both native-provable per `build-loop`'s
  BioAvanceD-v2 overlay: no live-Mongo tier in this repo, mocked-collection
  unit tests are the "real backend" proof bar for backend-internal slices;
  literal Docker is reserved for `#592`'s own e2e Playwright spec).

## Recommended next steps

Continue the `rabbit-hole` sitting: pick up `#596` next (independent,
no blockers), then `#592` (needs `#596` landed first for full coverage,
plus Docker for the live-backend Playwright spec). Once both close,
re-run the tracker's upward-cascade check — `#587` closes only when
`#588`/`#589`/`#590`/`#591`/`#592`/`#596` (and anything they still spin
off) are all resolved and no further split is pending; `#578` (the seed)
closes separately, per its own comment, once `#587`'s full membership
lands.

No other work queued outside this rabbit hole this session — Dennis's
instruction was specifically to resume `#587` and work it without
stopping for questions, filing follow-ups instead. Carried-forward
items from the prior handoff (`#336`, `#579`/`#331`, `#585`, `#586`,
skills-pack backlog) are unchanged and not re-derived here; see the
previous `HANDOFF.md` revision (git history) if needed.
