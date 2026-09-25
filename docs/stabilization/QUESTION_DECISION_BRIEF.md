# Question-label decision brief — 12 open decisions

Branch reference: `stabilize/v2.0.0-prototype` @ `d8afbf1f`.  
Plan: question decision brief (post–Axis E).  
Recorded: 2026-09-25.  
Authority: product-owner session accepting the brief recommendations as recorded decisions (CONFIRM / REJECT / AMEND).

**Scope:** the 12 still-undecided `question` issues from the open set of 20.  
**Out of scope:** the 8 already AMEND in [AXIS_E_DECISION_LOG.md](./AXIS_E_DECISION_LOG.md) (#1162, #1106, #1057, #1055, #961, #883, #830, #662).

**GitHub policy for this session:** this log is the normative record only. **No** comments, closes, retags, or other mutations were applied to issues. The owner applies GitHub close/retag in a later session.

**Vocabulary:** same as Axis E — CONFIRM (decision stands; close when owner applies), REJECT (do not pursue), AMEND (direction fixed; implementation remains).

---

## Block A — Confidentiality / retention

### #793 + #812 (+ blocker #667)

| # | Decision | Follow-up |
| --- | --- | --- |
| 793 | **AMEND** — Quarantined import rows and retained source files must share one retention rule. Not indefinite by default. | Implementation: allow-list (or dedicated job outside RF014-only sweep) covering `import_batches` / `import_staging_records`; default **90 days** from quarantine/`createdAt`; disposal deletes documents **and** `sourceFile.storedPath` when present. Applies to LGPD, FHIR, and `ASYNC_BATCH_IMPORT` writers. |
| 812 | **AMEND** — `notification_compliance_logs` must not keep participant emails forever. | Same policy family as #793: extend entity allow-list (or dedicated job); retain metadata (`notificationType`, status, `participantId`); **do not** keep plaintext `to`/`originalTo` beyond a short window (hash/redact, or **30-day** TTL). #796 failure rows included. |
| 667 | **AMEND** (prerequisite) — `ALLOWED_ENTITY_TYPES` limited to `AuditEvent`/`Log` is the reason neither policy can be created today. | Widen allow-list **or** add a non-RF014 disposal path before #793/#812 can ship. Keep #667 open as the gate. |

Evidence: [retentionPolicy.service.js](../../api/backend/src/services/retentionPolicy.service.js) (`ALLOWED_ENTITY_TYPES`); Axis E #1180 already pointed at #812/#793; #807 sealed *new* staging rows — plaintext legacy only leaves via retention; no production deployment yet (#682).

---

### #957 — Restore decrypted scratch on backups volume

| # | Decision | Follow-up |
| --- | --- | --- |
| 957 | **AMEND** — Accept disk-backed decrypt scratch (availability over RAM tmpfs on cron). Mitigate orphan plaintext. | On backend startup: sweep `<BACKUP_DIR>/.restore-scratch/*` (and `RESTORE_SCRATCH_DIR` if set). Dedicated scratch volume only if deploy snapshots `backups_data`. Do not revert to uncapped `/tmp` tmpfs. |

Evidence: [backup.service.js](../../api/backend/src/services/backup.service.js) `prepareDecryptedRestoreCopy` / `cleanupDecryptedRestoreCopy` / `getRestoreScratchBaseDir`.

---

### #800 — Import quarantine readers: permission without ownership

| # | Decision | Follow-up |
| --- | --- | --- |
| 800 | **AMEND** — Organization-scoped access going forward; pre-stamp batches Administrador/`global` only. **Reject** creator-only. | Stamp `organizationId` on all three writers (LGPD, FHIR, async); `requireOrganizationScope` + list/get filters on LGPD and FHIR readers together. Legacy batches without org: Administrador-only (same fail-closed posture as other scope fields). Creator-only is impossible for null-`createdBy` legacy and breaks steward review. Aligns with Axis E #662 tighten and RNF008 org consideration. |

Evidence: readers filter by type + permission only; #911 fixed `createdBy` forward-only; no org field on writers today.

---

## Block B — Product / import / consent

### #950 — ASYNC_BATCH_IMPORT on ImportQuarantinePage

| # | Decision | Follow-up |
| --- | --- | --- |
| 950 | **REJECT** — Do not merge ASYNC batches into ImportQuarantinePage listing for now. | Keep by-id reader (#939). Revisit UI only after #800 lands. If later unified: separate tab + explicit `BATCH_KIND_LABELS` entry (deliberately invert the “unrecognised / should not reach listing” test comment). |

Evidence: RNF011/RF029 are write-side only; formatter test pins design intent that ASYNC should not reach the LGPD list.

---

### #836 — Republish invalidates outstanding consent links

| # | Decision | Follow-up |
| --- | --- | --- |
| 836 | **CONFIRM** invalidation on republish (participant must not consent to a superseded term; RF010 AC#3). **AMEND** UX and failure ordering. | (1) Distinct participant message when link was replaced. (2) On send failure: do not leave participant worse off (revert prior token, or delay overwrite until delivery known). (3) Implement in the **same** token PR as Axis E #1049: always mint fresh on resend/republication + hash at rest — current `resendConsentNotification` still reuses a valid token (`reusedToken: true`), which contradicts #1049. |

Evidence: [consent-v2.service.js](../../api/backend/src/services/consent-v2.service.js) `notifyPendingParticipants`; Axis E #1049 AMEND.

---

### #1092 — Samples without `collectionSite` unwritable for non-Admin

| # | Decision | Follow-up |
| --- | --- | --- |
| 1092 | **AMEND** — Make `collectionSite` required on create and on import writers that create samples. | Model/service validation: org must resolve. Stamp on LGPD/FHIR/async sample creates. Ops one-off `countDocuments({ collectionSite: null })` at first deploy. Do not rely on “confirm production has none” — the hole regenerates on every create/import today. |

Evidence: [Sample.js](../../api/backend/src/models/Sample.js) `default: null`; `validateCreateSamplePayload` does not require the field; import paths do not stamp it; #1082 fail-closed is correct.

---

## Block C — Dead surface / dictionary

### #1147 — Facility/room CRUD with no caller

| # | Decision | Follow-up |
| --- | --- | --- |
| 1147 | **CONFIRM** — API-only surface stands; null `facilityId`/`roomId` on assignments accepted for prototype. | Document dictionary deviation (ELM-0168/0169 1..1 Core vs RF017 topology starting at Freezer; fields inert — nothing reads them). Operational backfill via admin/curl on `POST /api/rooms` + PATCH freezer room. Facility/room UI = post-prototype epic only if RF017 is widened. |

---

### #870 — `hpo_terms` write-less legacy

| # | Decision | Follow-up |
| --- | --- | --- |
| 870 | **AMEND** — Retire `/api/hpo` and `hpo_terms`. | Delete routes/service/unit tests; drop from canonical-active-surface. Future HPO search = `terminologyConcepts` (RF028 path). Do not repoint the dead collection. |

---

### #879 — Back-fill terminology `version` pre-#866

| # | Decision | Follow-up |
| --- | --- | --- |
| 879 | **CONFIRM** — Leave pre-#866 coding `version` absent; document cutoff. | Same footnote posture as Axis E #1117. Optional accurate backfill later (join releases `createdAt` + rollback runs) only if audit demands — not blocking prototype. Window is not closing. |

---

## Block D — Ops / quality / export

### #976 — No linter in repo

| # | Decision | Follow-up |
| --- | --- | --- |
| 976 | **CONFIRM** — Prototype end state: backend `node --check` syntax floor + frontend `tsc --noEmit`. No ESLint adoption now. | ESLint (+ react-hooks / floating-promises) = post-stabilize milestone if desired. Not in current CI contract. |

---

### #1218 — Auditoria export columns + read-time actor pseudonym

| # | Decision | Follow-up |
| --- | --- | --- |
| 1218 | **CONFIRM** column allow-list from the issue (`eventId`, `sequenceNumber`, `occurredAt`, `recordedAt`, `actorPseudonym`, `action`, `entityType`, `result`, `source`; omit hashes/`entityId`). **AMEND** actor rule: if stored value is not already `USR-*`, export **`USR-SYSTEM`** (do not `generateAnonId` over a civil display name). | Gate Admin/auditor (#1056) unchanged. Note: commit `bde77f88` is **not** on this local branch; [reports.routes.js](../../api/backend/src/interface/routes/reports.routes.js) still exports `logs` via `AUDIT_LOG_EXPORT_COLUMNS` (`userName`, `ipSource`, …). Apply column+actor rules when/if the `audit_events` export lands. |

---

## Counts (the 12)

| Outcome | Issues | Count |
| --- | --- | ---: |
| CONFIRM | #1147, #879, #976 | 3 |
| CONFIRM + AMEND | #836, #1218 | 2 |
| AMEND | #793, #812, #957, #800, #1092, #870 | 6 |
| REJECT | #950 | 1 |

Prerequisite called out (not in the 12): **#667** AMEND — widen allow-list / dedicated disposal before #793/#812 can ship.

Close when owner applies on GitHub: pure CONFIRM (#1147, #879, #976) and REJECT (#950).  
Keep open for implementation: all AMEND + hybrid AMEND halves (#836 with #1049, #1218 when export lands).

---

## Suggested owner GitHub order (later session — not this log)

1. #793 + #812 (+ #667 gate comment)  
2. #800 → then close #950 as REJECT  
3. #836 together with #1049 impl notes  
4. #1092, #957  
5. #1147, #870, #879, #976, #1218  

## Explicitly not done in this session

- No GitHub issue comments, closes, or label changes.  
- No code implementation of AMEND follow-ups.  
- Axis E Phase 2 (C) remains blocked until Axis E CONFIRM closes are applied by the owner on GitHub.
