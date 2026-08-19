# HANDOFF

**Written:** 2026-08-19, fresh sitting (thirtieth update). **Still inside
the rabbit hole**, tracker **#618** ("organization-scope enforcement +
RBAC gaps"). This sitting is resolving the off-shoot issues filed last
sitting, in readiness order **#630 -> #631 -> #628 -> #629**. #630 and
#631 are both done; #628 and #629 remain queued for this same sitting
(not yet started as of this write).

## Rabbit hole state

- **Tracker:** #618, open.
- **Landed this sitting:** #630 (fully resolved), #631 (fully resolved,
  depended on #630).
- **Filed this sitting:** #632 (enhancement — `manageBackup`/
  `manageSystem`/`resetMFA` permission codes are seeded/granted but never
  checked by `requirePermission()` anywhere; routes hardcode
  `requireRole(4)`/`isAdministrator` instead). Added to tracker #618's
  thread on filing. Also filed **dyeallpies-skills-pack#339** (not part
  of this tracker — a skills-pack hook finding, see "Process note" below)
  for the record; no action needed on it from a BioAvanceD-v2 session.
- **Still queued, this sitting's own order:** #628, #629 — Dennis's
  design-call answers on both are below, gathered before #630 started so
  the next pickup doesn't need to re-ask.
- **#632 not yet in the requested order** — filed mid-sitting, lower
  priority than the four originally queued; recompute against the
  tracker before picking it up, per the rabbit-hole skill's own
  guidance.

## Design decisions Dennis already gave this sitting (don't re-ask)

- **#628 (`Result.sampleID` canonical shape):** Dennis said to check
  docs. `docs/architecture/canonical-data-contract-v1.md`'s "Legacy
  Fields Prohibited" list explicitly bans `sampleID`/`sampleId` as a
  field name anywhere in the canonical model (global naming convention,
  not scoped to one entity) — pointing at renaming the field to
  `specimenId` (storing `Specimen.specimenId`, the business identifier)
  rather than just normalizing the *value* under the existing
  `sampleID` name as the issue's own body originally suggested. Note:
  `Result` itself has no entry in dict-02 (grepped, no match) — it's
  outside the canonical dictionary's own entity list, so this is the
  naming-convention section applying, not an entity-specific dict-02
  rule. This makes #628 bigger than originally scoped (a field rename +
  every read/write site, not just the write-path value fix) —
  reconfirm with `divide-and-conquer` when picked up.
- **#628 (backfill existing Result documents?):** Dennis said to check
  docs; none found that answer this specific operational question
  (fix-forward vs. migrate) — still an open call to make when #628 is
  actually picked up, probably worth a quick confirm with Dennis at
  that point rather than assuming either way given it touches
  production-shaped data.
- **#629 (Sensor/Equipment/Temperature/Report org-scope boundary):**
  Dennis chose "wire in real org references" (schema change) over
  "stop here for now." Matches the newly-found **F3-G09** gate (from
  the 2026-07-31 doc refresh, `docs/docs-7-31-2026/CHANGELOG-2026-07-31.md`
  + `3-Plano_Integrado_Foundation_Data_Pipeline.md`): "reports/exports
  must derive organizational scope from active assignments and prevent
  cross-org/collection/study leakage" — this is now an explicit CI-gate
  requirement, not just this rabbit hole's own initiative. The issue's
  own body already flags this will likely need its own
  `divide-and-conquer` split once started.

## Docs note for future pickups

`docs/docs-7-31-2026/` is the latest dated doc batch (confirmed by
Dennis this sitting), not `docs/docs-7-27-2026/` — read 7-27 first (per
7-31's own changelog, it's a delta, not a replacement) but treat 7-31's
`CHANGELOG-2026-07-31.md` as authoritative for what changed, including
the 3 new gates (F2-G09, F3-G09, F3-G10) and the confirmation that
`dict-02`'s dictionary itself is unchanged (byte-identical) between
batches.

## Process note: verify branch protection before every product-file edit

`edit-branch-guard.cjs` (blocks direct Edit/Write on `main`/
`feature/docker-e2e-backend-integration`) fired correctly for #630's
first edit attempt, then failed to fire for #631's first edit attempt —
same session, same protected branch, no intervening branch change,
confirmed via `git branch --show-current` immediately after that the
edit had landed directly on the protected branch. Recovered cleanly
(`git checkout -b fix/631-...` after the fact, diff carried over, no
work lost), but don't rely on the hook alone next time — **run
`git branch --show-current` before the first product-file Edit of each
issue this sitting**, as a manual backstop, until
dyeallpies-skills-pack#339 (filed this sitting, plausible fail-open bug
in the hook's git-command error handling) is resolved upstream.

## Issue closed this sitting (most recent)

- **#631**: `requirePermission(code, explicitAction?)` now checks the
  caller's action — derived from `req.method` by default (GET->READ,
  POST->CREATE, PUT/PATCH->UPDATE, DELETE->DELETE), or the explicit
  second arg when a route passes one — against
  `PERMISSION_CATALOG[code].allowedActions` (#630's now-corrected
  catalog), not just whether the caller holds the permission code at
  all. Verified programmatically (small script cross-referencing every
  `requirePermission()` call site's HTTP verb against its code's
  corrected allowedActions) that the default derivation matches all 107
  call sites except 4: `sample.routes.js`'s `POST /:id/withdraw` and
  `POST /:id/return`, `user.routes.js`'s `POST /record-withdrawal` (all
  three `withdrawSample`, explicit override `'UPDATE'`, not the naive
  `CREATE`), and `patient.routes.js`'s `POST /:id/reidentify`
  (`reidentifyParticipant`, override `'READ'`). Without these overrides
  the naive default would have 403'd real working traffic on those 4
  routes. New tests in `rbac.test.js` cover default-derived-action-pass,
  an unoverridden narrow-action code correctly denying, and an explicit
  override passing despite the method not matching; existing cases
  updated to set `req.method` (bare test req objects had none before).
  Merged `19a95a7f`, pushed. Targeted suite green (rbac,
  rbac-catalog-seed, sample.routes, participantIdentity.reidentify:
  181/181) — full native suite not re-run this sitting yet; run before
  the sitting's own close-out or at the next Docker/CI gate.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through
  `19a95a7f`. Working tree clean except the gitignored/junctioned
  `.claude/skills/`. No stale local branches — `fix/630-...` and
  `fix/631-...` both merged and deleted immediately after landing.
- No Docker stack brought up this sitting — #630/#631 are
  backend-internal, native/mocked-Mongo proof bar only.

## Recommended next steps

Continue this same sitting's queue: **#628 -> #629**, in that order, per
Dennis's request to resolve all four off-shoot issues. Design decisions
for both are already gathered above — don't re-ask, but do confirm the
#628 backfill question with Dennis before writing any migration script
(docs didn't answer that specific sub-question). Recompute the sitting's
budget fresh before each pickup per the rabbit-hole skill's own pacing
guidance — #628 turned out bigger than originally scoped once
cross-checked against docs (a field rename, not just a value fix), and
#629 is explicitly flagged as likely spanning beyond one sitting
(schema change across Sensor/Equipment/Temperature + Report). If the
running total is at or over budget after #628, surface to Dennis before
continuing into #629 rather than pushing through silently.

#632 (new, unenforced `manageBackup`/`manageSystem`/`resetMFA`) is not
part of the requested order — pick it up only after the four originally
queued, or if Dennis re-prioritizes.
