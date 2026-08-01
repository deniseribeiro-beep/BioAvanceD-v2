# HANDOFF

**Written:** 2026-08-01, after closing #391 (`.gitattributes` line-ending
fix for generated reference-data JSON, `resolve-issue`) on
`feature/docker-e2e-backend-integration`.

## What happened this session

Continuation of the same day's prior sessions (which closed #393, #369,
#392, and #396). Dennis said "#391" directly, picking it from the
handoff's own candidate list (smallest/most mechanical of the open
items).

**#391's ask:** `api/backend/src/reference-data/canonical-dictionary/
catalog.1.3.0.json` showed as `modified` in `git status` every session
with no real content diff — `.gitattributes` had no line-ending rule for
`.json`, so Windows `core.autocrlf` kept flagging the LF-generated file
for conversion.

**Fix** (`fix/391-gitattributes-json-eol`, merged into
`feature/docker-e2e-backend-integration` at `cfac5f41`, fast-forward):
added `api/backend/src/reference-data/**/*.json text eol=lf` to
`.gitattributes` — scoped to the reference-data directory rather than
`*.json` repo-wide, since all 10 JSON files there (confirmed via `file`)
were already LF on disk and the issue's other suggested scopes
(repo-wide) would have renormalized unrelated JSON (package.json,
lockfiles) outside the actual complaint. Checked for other tracked
generated JSON elsewhere in the repo that might have the same latent
problem (`generate-dictionary-catalog.js`'s only output is
`catalog.1.3.0.json`; `generate-compliance-evidence.js`'s
`COMPLIANCE_EVIDENCE.json` output is gitignored, not tracked) — nothing
else needed the rule.

**Verified:** `git add --renormalize api/backend/src/reference-data`
once, then `git check-attr`/`git diff` confirmed no diff and no
LF/CRLF-conversion warning on `catalog.1.3.0.json`, both on the fix
branch and after merging into the integration branch. `git status
--porcelain` repo-wide came back clean post-merge — no other phantom
diffs anywhere. No product code touched, so no test run beyond this
git-attribute verification.

**Issue #391 closed** (comment noting merge commit `cfac5f41`, scoping
rationale, and verification). Fix branch deleted both locally and on
origin — **this time the remote delete succeeded**, unlike the
documented denial from the #392/#396 sessions.

**New data point on the standing remote-delete denial** (pack#183,
`dyeallpies-skills-pack`, still open): while cleaning up, also tried
deleting the still-dangling `test/392-specimen-preanalytics-canonical-
fields` branch (merged, closed, left over from a *prior* session) —
that one **was** denied by the classifier, same message as before. So
this session's own branch (created, pushed, and deleted within the same
transcript) went through fine, but a merged branch from an earlier
session did not. Posted this distinction as a comment on pack#183
(`https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/183#issuecomment-5153494199`)
since it narrows the likely trigger (session-provenance of the branch,
not "any remote delete"). **`test/392-specimen-preanalytics-canonical-
fields` is still on origin**, still needs manual cleanup or a
permission grant — unchanged from prior handoffs.

**No new product-code follow-on issues filed** — #391 was a pure
git-config fix with no deferred sub-points.

**No other workflow friction this session** (`wrap-up` core audit) —
the one notable thing was the branch-delete asymmetry above, already
captured on pack#183 rather than repeated here.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `cfac5f41`, **in sync
  with origin** (nothing outstanding to push). Working tree fully clean
  — the long-standing `catalog.1.3.0.json` phantom line-ending diff
  (#391) is now fixed for good, not just untouched.
- Issues: **#391 closed** (`cfac5f41` noted in the close comment). No
  new issues opened.
- `fix/391-gitattributes-json-eol` (merged): deleted both locally and on
  origin — fully cleaned up.
- `test/392-specimen-preanalytics-canonical-fields` (merged, from a
  prior session): **still on origin**, remote delete denied again this
  session (see pack#183 discussion above) — needs manual cleanup or a
  permission grant.
- `test/396-sprec-fluid-axis-canonical-names`: checked this session —
  **no longer exists on origin** (`git ls-remote` came back empty for
  it), contrary to the prior handoff's expectation that it was still
  pending manual cleanup. Either it was cleaned up outside this
  transcript or the prior handoff's assumption was wrong; either way,
  nothing left to do for it.
- Untouched from before: **#389** (storage/custody separation, open,
  needs `divide-and-conquer` scoping first), **#390** (multi-consumer
  migration, open, depends on #383+#388+#389), **#394** (audit_events
  historical gap, open, owner-judgment question), **#395**
  (intake-wizard mocked-auth flakiness, open, root cause unknown). Local
  branch hygiene unchanged otherwise: everything merged except
  `test/377-docs-on-main`, tracked by still-open **#379**.

## Blocking next step

None. Nothing queued as blocking.

No next issue queued explicitly by Dennis. Candidates, roughly by
size/readiness:
- **#395** (intake-wizard mocked-auth flakiness): needs investigation
  first — root cause genuinely unknown, no pinned test.
- **#394** (audit_events historical gap): an owner-judgment question
  more than a code fix — read it and decide whether backfill/monitoring
  work is wanted before treating it as a coding task.
- **#389**/**#390**: unchanged from prior handoffs, see below.

## Which skills to use

- **#395** (intake-wizard flakiness): `fix-bugs`, budget time for
  investigation — likely a mocked-auth/`page.route` or client-side
  session-timing issue, not yet reproduced.
- **#394** (audit_events historical gap): not a `fix-bugs` candidate as
  filed — it's asking for an owner decision (backfill? louder failure
  mode?) before any code change. Surface it to Dennis rather than
  picking an implementation approach unprompted.
- **#389** (storage/custody entity): scope with `divide-and-conquer`
  first — don't attempt as one slice (28 files, already half-separated
  via `storageBoxes`). Check dict-02's "Entidade" column for the
  canonical name before naming anything (dyeallpies-skills-pack#179).
- **#390**: blocked on #389.
- Backlog unchanged otherwise from prior handoffs: **#384–#387** (four
  architecture-gap issues), older backlog (`#371`/`#373`/`#374`/`#378`/
  `#379`) — untouched this session.
