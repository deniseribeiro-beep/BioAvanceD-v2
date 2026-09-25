# Axis E — Human decision log

Branch reference: `stabilize/v2.0.0-prototype`.  
Plan: open-issues axis plan (Phase 1).  
Recorded: 2026-09-25.  
Authority: product-owner session executing Axis E (CONFIRM / REJECT / AMEND).

**Close policy:** GitHub close must be applied by the owner on each CONFIRM/AMEND (decision half). This log is the normative record; comments are mirrored on each issue.

---

## Session E1 — Security / auth / MFA

| # | Decision | Follow-up |
| --- | --- | --- |
| 1180 | **CONFIRM** — Unauthenticated `consent-tokens/accept` widening (manifestation + 422 + evidence file) stands. 422 is not an enumeration oracle. | Retention of evidence files → already tracked by #812/#793. |
| 831 | **CONFIRM** — `TOKEN_OPTIONAL_ROUTES` for participant e-consent endpoints stands (UX gate only; backend already public). | Prefer anchored matching later as tech-debt (optional D). Rate limit family covered by consentLimiter. |
| 832 | **AMEND** — Keep unauthenticated write path (feature). Manifestation links remain **replayable within JWT lifetime** (participant may change mind). Rate limiting already shipped. | `CONSENT_SECRET` production strength → #682/#978. No separate reopen required if those stay open. |
| 1049 | **AMEND** — Hash `consentToken` at rest. On resend: **always mint a fresh token** (invalidate prior link). Update `reusedToken` contract/tests deliberately. | Keep **#1049** open as implementation issue (retagged from pure decision). |
| 1030 | **CONFIRM** — Admin-target `reset-mfa` = unlock-only (no secret clear, no session revoke) stands. | Optional later: dedicated `unlock-mfa` if audit clarity needed. |
| 1011 | **CONFIRM** — Administrador MFA remains optional; promotion clear of enrolment stands for bootstrap/ops until `security_config` is live. | When **#914** makes `requireMFA` / `requireMFAForAll` readable, revisit mandatory Admin MFA via config (not a silent code flip now). Promotion MFA clear should gain `MFA_CHANGE` audit when implemented under #914 follow-up. |
| 1051 | **CONFIRM** — Keep account-lockout gate timing-distinguishable (do not burn bcrypt on lockout). Unknown-user bcrypt cost acceptable under current `authLimiter`. | none |
| 1162 | **AMEND** — `TRUST_PROXY=0` already correct. Fresh generate must **not** inherit `AUTH_RATE_LIMIT_RELAXED` / `CONSENT_RATE_LIMIT_RELAXED` as `true`; write blank/unset so opt-in stays explicit. Compose/e2e files that need relaxation set the flags themselves. | Keep **#1162** open for generator implementation (direction 2). |
| 1159 | **CONFIRM** — Audit-signing boot gate stays **warning-only** in production (integrity vs encryption confidentiality). Document asymmetry next to the two gates when convenient. | none (optional doc comment = D hygiene) |
| 1106 | **AMEND** — Machine ingest stays **fail-open** when audit cannot be written (availability of cold-chain readings). Separately: **split failure kinds** in the alert (validation vs insert). | Keep **#1106** open for failure-kind split only; fail-open is decided. |
| 686 | **CONFIRM** — (a) `force-password-reset` may target Administrador (asymmetry vs old reset-mfa refusal is intentional). (b) `BOOTSTRAP_ADMIN_FORCE_RESET=false` only in test compose is acceptable. | none |

---

## Session E2 — RBAC / roles

| # | Decision | Follow-up |
| --- | --- | --- |
| 1144 | **CONFIRM** — UsuarioExterno does **not** get `viewEquipment`. No external inventory workflow. | Reverse = one catalogue line if a real workflow appears. |
| 1141 | **CONFIRM** — Técnico **may** `manageTemperaturePolicy` (keep pre-split population). | none |
| 1008 | **AMEND** — Pursue RF003 shape: distinct **Administrador-only** role-assignment permission (dir 1) **and** remove Coordenador `createUser` grant for role assignment (dir 3). Verb split (dir 2) deferred. | Keep **#1008** open as implementation. |
| 1057 | **AMEND** — **Delete** `POST /api/auth/register` (no in-repo consumers). Also move hierarchy floor into `registerUser` (durable fix). | Keep **#1057** open as implementation. |
| 662 | **AMEND** — Until a real committee workflow exists, `manageAccessRequests` is **Administrador-only** (align with `reidentifyParticipant` sensitivity). | Keep **#662** open for one-line seed + re-seed. |

---

## Session E3 — Product / import / consent / quality

| # | Decision | Follow-up |
| --- | --- | --- |
| 1193 | **CONFIRM** — Keep **both** sync `/api/import-lgpd` and async `/api/import/batch` for now (postures converged; dual entry is intentional until a deprecation plan). | Optional later deprecation epic = D. |
| 1143 | **CONFIRM** — Operator may keep being notified on **every** breaching reading (both notification channels). | none |
| 1014 | **CONFIRM** — Absence of Ignorados/Duplicados tiles for results/temperature import is the **end state** (do not invent skip counters). | none |
| 883 | **AMEND** — Routine Maintenance/Inactive must **not** silently bulk-quarantine every sample. Quarantine cascade only for explicit quarantine-trigger statuses already named by product. | Keep **#883** open as implementation. |
| 840 | **AMEND** — Normalize import error bodies to **one reason-token shape** across the four endpoints. | Keep **#840** open as implementation. |
| 830 | **AMEND** — Prefer **native driver** for StagingImport (match import path); retire Mongoose model when safe. | Keep **#830** open as implementation. |
| 714 | **AMEND** — Allergy/med/procedure codings **must** pass the same active terminology gate as RF005 AC#4 systems once listed; expand validator allow-list to include allergen coding system(s) used in production. | Keep **#714** open as implementation. |
| 687 | **CONFIRM** — Sign-off accepted for #661 dataset/file consent-scope resolution as shipped. | none |
| 1112 | **CONFIRM** — Digits-only `identityDocument` at rest for all writers stands. | none |
| 1120 | **AMEND** — Machine-ingest audit trail **should** carry a reason discriminator (empty sensorId vs non-finite temp, etc.). | Keep **#1120** open as implementation. |
| 1117 | **CONFIRM** — Pre-`a84eaa63` `resourceType: 'Sistema'` rows are an immutable **footnote** (hash chain); no rewrite. Document in ops notes if needed. | none |

---

## Session E4 — Ops / deploy

| # | Decision | Follow-up |
| --- | --- | --- |
| 962 | **CONFIRM** — TSA/witness keys in Docker **named volumes** (not tmpfs) stands for this repo. External TSA for production = future deploy decision, not blocking. | none |
| 961 | **AMEND** — Remove tracked personal CV from the tree with `git rm --cached` (no history rewrite unless legal requires it). | Keep **#961** open for the rm + ignore. |
| 751 | **CONFIRM** — `mongodb-tools` in Dockerfile.prod runtime stands (backup/restore need). | none |
| 1055 | **AMEND** — **Retire** `create-db.js` as design authority (docs already supersede shape); delete or move to `docs/historical/` with banner. | Keep **#1055** open for cleanup. |
| 682 | **CONFIRM** — Pre-deploy checklist item stands: first real deploy must set `NODE_ENV=production` and leave `ENABLE_TEST_SUPPORT_ROUTES` unset. Keep issue open as **checklist**, not code. | Keep **#682** open until first deploy sign-off. |

---

## Counts

| Outcome | Count |
| --- | ---: |
| CONFIRM (decision recorded; close when owner applies) | 20 |
| AMEND (decision recorded; implementation remains on same or follow-up issue) | 12 |
| REJECT | 0 |

## Next axis

Phase 2 (C): #695 → #660 → #663 → #1206 → #721.  
Do **not** start until CONFIRM issues above are closed on GitHub by the owner.
