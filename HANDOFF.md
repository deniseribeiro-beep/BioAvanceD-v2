# HANDOFF

**Written:** 2026-08-21. Docker is on (inherited stack, left running -- see "Repo state" below).

## What landed this sitting

Two separate pieces of work, both on `feature/docker-e2e-backend-integration`:

**1. Wave 3 human-paced e2e showcase video** (Refs #646), merged and
**pushed**: a new `test.describe` block in
`tests/e2e-showcase/human-showcase.spec.ts` demonstrating, through the
real UI against the real backend: admin login, RF014 security-policy
MFA toggle (versioned/audited, restored after), RF017 equipment
creation, and RF016 real symbology label generation
(Code128/DataMatrix/QR) plus a real print-job download. Converted to
`docs/e2e-showcase-2026-08-21.mp4`. RF015/RF024/RF025/RF026/RF029
stayed off-camera -- confirmed API-only, no frontend caller exists for
any of them (checked directly against their own e2e blocks, not just
recalled). RF017's storage-topology sub-flow (`InlineStorageMovementPanel`)
also skipped -- no `data-testid` coverage, though it does have Playwright
coverage already via role/label selectors (#488, closed). Bumped
`playwright.showcase.config.ts`'s timeout 60s -> 120s for the added test.
Merges: `a3784b22`/`b38094e8`.

**2. Wave 4 kickoff filed**: **#723** opened as the tracking issue for
RF008 (Relatórios) and RF013 (Backup e restauração) -- the two RFs
remaining in the original Wave 4 scope now that RF027 has already
landed via #716. Single-tracking-issue shape (like #646), not a
pre-split dependency chain (like #668/#707) -- confirmed with Dennis,
since both RFs already have substantial product code and this is
spec-writing-against-existing-code, not from-scratch build. The issue
body documents each RF's acceptance criteria (from
`docs/docs-7-27-2026/extracted/requisitos-index.md`) plus gaps verified
directly against source: RF008 has no audit log on report exports and
hardcoded (not user-defined) report templates; RF013 has no checksum
anywhere in `backup.service.js`, no persisted run-history, a
live-destructive (not test-mode) restore, and no backup-policy
entity/audit at all.

**3. Small doc fix** (not yet pushed, see below): `E2E_TRACEABILITY_PLAN.md`'s
RF029 row said "#664 ... stays open" -- #664 was actually closed
2026-08-20, before this session started. Fixed. Merge: `c36c2cb1`.

## Friction-audit findings filed this sitting (wrap-up)

- **BioAvanceD-v2#724** (open): the shared `mongodb-test-data` volume's
  `equipment` collection has 521+ accumulated fixture rows (mostly
  empty placeholders), no sort/search on the UI table -- makes
  row-visibility assertions unreliable for any future spec/reel. Worked
  around in the showcase video (asserted form-panel-close instead), but
  the underlying accumulation isn't fixed.
- **dyeallpies-skills-pack#381** (open): `e2e-showcase-video`'s
  bioavanced-v2 local-env overlay should document the #724 gotcha
  (exact suggested text is in the issue) -- not editable directly from
  this repo per Rule 0.
- **dyeallpies-skills-pack#382** (open): the issue-view-then-
  AskUserQuestion routing gate blocked a pure docker-teardown
  confirmation (`clean-up`'s own documented step) that had nothing to
  do with any issue -- a variant of #350 worth a look, not the same
  root cause.

## Repo state

- On `feature/docker-e2e-backend-integration`. **Wave 3 video is
  pushed** (`b38094e8`). **The #664 doc fix (`c36c2cb1`) is NOT yet
  pushed** -- 1 commit ahead of `origin` as of this writing; push on
  Dennis's say-so per this repo's convention.
- **Docker: UP**, inherited stack, still running (12/12 containers
  healthy as of this sitting's end, confirmed via the Wave 3 video's own
  passing test run against it). Confirm still healthy (`docker ps`)
  before trusting it in a future session.
- `test-results/` has fresh Wave-3-run artifacts (webm + traces) from
  this sitting -- session/build cleanup, not reviewed for deletion this
  sitting.
- Two untracked paths present all sitting, not touched: `.claude/skills/`
  and `api/backend/storage/assays/` -- pre-existing, not created by this
  session.

## Recommended next steps

Dennis didn't name a specific next issue. None queued. Options surfaced
this sitting, not picked:
- **#723** (Wave 4 kickoff, RF008/RF013) -- freshly filed, ready to pick
  up directly, no product-scope call needed first.
- **#724** (equipment-fixture-debris hygiene) -- self-contained, no
  product decision needed.
- **#697's own remaining chain has nothing left** -- confirmed this
  sitting's predecessor's "#646 stays open on #697" claim was already
  stale by the time it was written; #697/#707/#708-713 are all closed.
  **#646 itself** now has RF014-029 all DONE per the traceability plan;
  its own DoD only needs a confirmed green `test:e2e:docker` run, which
  is complicated by **#722** (pre-existing test-environment fragility,
  not a code regression) -- **#714** (needs Dennis's design call on
  AllergyIntolerance's active-code gating) and **#721** (imaging
  carve-out) are #646's other real remaining open items.
