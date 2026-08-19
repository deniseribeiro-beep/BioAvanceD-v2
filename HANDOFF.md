# HANDOFF

**Written:** 2026-08-19, fresh sitting (twenty-ninth update). **Still
inside the rabbit hole**, tracker **#618** ("organization-scope
enforcement + RBAC gaps"). This sitting is resolving the off-shoot
issues filed last sitting, in readiness order **#630 -> #631 -> #628 ->
#629**. #630 is done; #631/#628/#629 remain queued for this same
sitting (not yet started as of this write).

## Rabbit hole state

- **Tracker:** #618, open.
- **Landed this sitting:** #630 (fully resolved).
- **Filed this sitting:** #632 (enhancement — found while auditing #630:
  `manageBackup`/`manageSystem`/`resetMFA` permission codes are
  seeded/granted but never checked by `requirePermission()` anywhere;
  routes hardcode `requireRole(4)`/`isAdministrator` instead). Added to
  tracker #618's thread immediately on filing, per the rabbit-hole
  skill's own rule.
- **Still queued, this sitting's own order:** #631 (depends on #630,
  now unblocked), #628, #629 — Dennis's answers on all three are below,
  gathered before #630 started so the next pickup doesn't need to
  re-ask.
- **#632 not yet in the requested order** — filed mid-sitting, lower
  priority than the four originally queued; recompute against the
  tracker before picking it up, per the rabbit-hole skill's own
  guidance.

## Design decisions Dennis already gave this sitting (don't re-ask)

- **#631 (per-verb enforcement mechanism):** auto-derive the action from
  `req.method` (GET->READ, POST->CREATE, PUT/PATCH->UPDATE,
  DELETE->DELETE), explicit override param only where that mapping
  doesn't fit (EXPORT/APPROVE/RELEASE-flavored routes) — the
  issue's own recommended, lower-risk shape; Dennis said to check docs
  for a stronger signal, none found (dict-02/the 7-31 doc refresh don't
  dictate the *enforcement mechanism*, only that `allowedActions` is
  canonical Core data), so this is the confirmed direction.
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

## Issue closed this sitting (most recent)

- **#630**: audited all 107 `requirePermission()` call sites across the
  17 permission codes in `src/interface/routes/` against
  `PERMISSION_CATALOG.allowedActions` (`rbac-catalog-seed.service.js`).
  7 codes were stale — `viewReports`, `createSample`, `viewTemperature`,
  `uploadFiles`, `createUser`, `createPatient`, `manageOrganizations` —
  several (`viewTemperature`, `createPatient`, `createUser`) grant full
  CRUD in practice despite a single narrow-sounding claimed action. 10
  codes were already correct. Methodology: HTTP verb -> action by
  default (GET->READ/POST->CREATE/PUT->UPDATE/DELETE->DELETE), two
  overrides — an `/export*` path segment -> EXPORT, and a POST to
  `/:id/<verb>` (action on an existing resource) -> UPDATE unless the
  verb is itself generative of a new sub-resource (adding a
  note/observation/reading), which stays CREATE. No behavior change —
  `requirePermission()` still ignores `allowedActions`; #631 is the
  actual enforcement mechanism and was unblocked by this landing.
  Regression test added (`rbac-catalog-seed.service.test.js`, 17 new
  `it.each` cases asserting the corrected value per code). Merged
  `6ec47ff8`, pushed. Targeted suite green (rbac-catalog-seed, rbac,
  permission.model: 46/46) — full native suite not re-run this sitting
  yet (single small, low-risk data-only change; will run before the
  sitting's own close-out or at the next Docker/CI gate).

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through
  `6ec47ff8`. Working tree clean except the gitignored/junctioned
  `.claude/skills/`. No stale local branches — `fix/630-...` merged and
  deleted immediately after landing.
- No Docker stack brought up this sitting — #630 is backend-internal,
  native/mocked-Mongo proof bar only.

## Recommended next steps

Continue this same sitting's queue: **#631 -> #628 -> #629**, in that
order, per Dennis's request to resolve all four off-shoot issues. Design
decisions for all three are already gathered above — don't re-ask.
Recompute the sitting's budget fresh before each pickup per the
rabbit-hole skill's own pacing guidance; #630 alone ran large (mechanical
but wide blast radius, 107 call sites) — #631 depends on it and is
flagged in its own body as likely needing a `divide-and-conquer` split,
#628 turned out bigger than originally scoped once cross-checked against
docs, and #629 is explicitly flagged as likely spanning beyond one
sitting. If the running total is at or over budget after #631, surface
to Dennis before continuing into #628/#629 rather than pushing through
silently.

#632 (new, unenforced `manageBackup`/`manageSystem`/`resetMFA`) is not
part of the requested order — pick it up only after the four originally
queued, or if Dennis re-prioritizes.
