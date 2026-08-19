# HANDOFF

**Written:** 2026-08-19, fresh sitting (thirty-first update). **Still
inside the rabbit hole**, tracker **#618** ("organization-scope
enforcement + RBAC gaps"). This sitting is resolving the off-shoot
issues filed last sitting, in readiness order **#630 -> #631 -> #628 ->
#629**. #630, #631, and #628 are all done; **#629 is the last item in
the requested order and has not been started yet** — this sitting is
well over its own pacing budget (three "large" items landed back to
back: #630/#631/#628 each ran 5 points against a ~10-point-per-sitting
guideline) and #629 is itself flagged as likely spanning beyond one
sitting on its own, so the next pickup should check in with Dennis
before diving in rather than assuming "keep going" still applies
unprompted.

## Rabbit hole state

- **Tracker:** #618, open.
- **Landed this sitting:** #630, #631, #628 — all fully resolved.
- **Filed this sitting:** #632 (unenforced manageBackup/manageSystem/
  resetMFA permission codes, found during #630), #633 (reports.routes.js
  reads a nonexistent Sample.sampleID field, found during #628). Both
  added to tracker #618's thread on filing. Also filed
  **dyeallpies-skills-pack#339** (not part of this tracker — a
  skills-pack hook finding: `edit-branch-guard.cjs` let one Edit through
  on a protected branch without blocking, found between #630 and #631;
  see that issue for detail, no action needed from a BioAvanceD-v2
  session).
- **Still queued, this sitting's own order:** #629 only. Dennis's design
  call is already gathered below — don't re-ask.
- **#632/#633 not yet in the requested order** — filed mid-sitting,
  lower priority than the four originally queued; recompute against the
  tracker before picking either up.

## Design decision Dennis already gave this sitting (don't re-ask)

- **#629 (Sensor/Equipment/Temperature/Report org-scope boundary):**
  Dennis chose "wire in real org references" (schema change) over "stop
  here for now." Matches the **F3-G09** gate (2026-07-31 doc refresh,
  `docs/docs-7-31-2026/CHANGELOG-2026-07-31.md` +
  `3-Plano_Integrado_Foundation_Data_Pipeline.md`): "reports/exports must
  derive organizational scope from active assignments and prevent
  cross-org/collection/study leakage" — an explicit CI-gate requirement,
  not just this rabbit hole's own initiative. The issue's own body
  already flags this will likely need its own `divide-and-conquer` split
  once started — treat that as confirmed, not a fresh judgment call.

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
`feature/docker-e2e-backend-integration`) fired correctly for #630's and
#628's first edit attempts, but failed to fire once for #631's (same
session, same protected branch, no intervening branch change — filed as
dyeallpies-skills-pack#339, plausible fail-open bug in the hook's git-
command error handling). Recovered cleanly both times it mattered; no
work was lost. Keep running `git branch --show-current` before the first
product-file Edit of each issue as a manual backstop until that's
resolved upstream.

## Issue closed this sitting (most recent)

- **#628**: `Result.sampleID` renamed to `specimenId` across every write
  path (`Result.js`, `result.routes.js`'s `POST /upload`/`POST /`/
  `PUT /:id/link-sample`, all now resolving via a real Sample lookup
  instead of trusting the caller directly — `POST /` previously did no
  lookup at all), every read/join (`reports.routes.js`'s two report
  types, `result-worker.js`'s CSV import, which already used
  `specimenId` — a third pre-existing shape the original issue didn't
  know about), and the frontend (`types/models.ts`,
  `SampleDetailsPage.tsx`, `ResultsPage.tsx`, `AnalysisUploadModal.tsx`,
  `api.ts`, `useResults.ts`; `sampleHelpers.ts`'s two dead sampleID-based
  functions removed). `PUT /:id`'s generic `$set` now strips
  `specimenId`/`sampleID`/`sampleId` so a caller can't overwrite the
  reference outside `link-sample`'s own validated path — a latent
  hardening gap found while auditing, fixed inline (same write-path-
  integrity class as the issue itself). New idempotent backfill
  (`result-specimenid-backfill.service.js` +
  `src/scripts/backfillResultSpecimenIds.js`) migrates existing Result
  documents (Dennis confirmed: migrate, not fix-forward-only) — **not
  yet run against any real environment**, run it as part of deploying
  this change. Merged `07009bce`, pushed. Targeted suite green
  (backend 444/444, frontend `tsc --noEmit` clean + targeted tests).

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through
  `07009bce`. Working tree clean except the gitignored/junctioned
  `.claude/skills/`. No stale local branches — all three fix branches
  this sitting (`fix/630-...`, `fix/631-...`, `fix/628-...`) merged and
  deleted immediately after landing.
- No Docker stack brought up this sitting — all three landed fixes are
  backend-internal/frontend-typecheck, native proof bar only. The #628
  backfill script specifically needs a real (or at least Docker-compose)
  MongoDB to actually run against — flagged above, not exercised yet.

## Recommended next steps

**Check in with Dennis before starting #629** — this sitting is already
over its own pacing budget and #629 is independently flagged as likely
spanning beyond one sitting (a real schema change across
Sensor/Equipment/Temperature + Report, explicitly recommended to need
its own `divide-and-conquer` split). His design call ("wire in real org
references") is already gathered above, so the check-in is about
sequencing/continuing, not re-litigating scope.

#632/#633 (both new, both smaller than #629) are candidates if Dennis
wants a smaller item to close out the sitting instead of starting #629's
larger scope.
