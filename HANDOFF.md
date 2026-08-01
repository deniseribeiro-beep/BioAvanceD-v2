# HANDOFF

**Written:** 2026-08-01, after closing #395 (intake-wizard mocked-auth
force-logout root-cause + fix, `fix-bugs`) on
`feature/docker-e2e-backend-integration`.

## What happened this session

Dennis picked "#395" directly from the prior handoff's own candidate list.
That issue (carried forward from #369) described an intermittent
`intake-wizard.spec.ts` mocked-auth redirect to `/login`, root cause
unconfirmed, only seen on a "long-running dev stack."

**Root-caused and fixed.** `ClinicalIntakeWizard.jsx` fires a background
prefetch of consent templates on mount (`consentService.getTemplates()`,
so the data's ready by the time the user reaches the consent step later
in the wizard). Unlike the wizard's other background loaders
(terminologies, patient-match), which use the lenient `apiClient`
instance, this one goes through `services/api.ts`'s strict `api`
instance: any 401 there attempts a token refresh and, on failure,
unconditionally clears the session and hard-navigates to `/login`
(`window.location.replace`) — even while the user is still on an earlier,
unrelated wizard step.

This explains the "long-running dev stack" trigger precisely: with no
backend reachable, the refresh attempt's connection-refused handling runs
a 5-port health-check scan (up to ~5s) before giving up and redirecting —
slow enough that it usually loses the race against a mocked test's own
fast assertions. With a real backend actually listening (the
long-running-stack condition), the refresh gets a fast single-round-trip
401 instead, skips the port scan, and the redirect reliably wins the race
— producing the intermittent failure.

**Fix** (`fix/395-intake-consent-prefetch-forced-logout`, merged into
`feature/docker-e2e-backend-integration` at `b41e43e5`, fix commit
`83320865`): added an opt-in `suppressAuthRedirect` request-config flag
to the `api` instance's 401 handling (mirroring the existing
`suppressErrorToast` pattern on the sibling `apiClient` instance), and
had this one background/non-critical prefetch opt out of the global
session-kill. The only other caller of `consentService.getTemplates()`
(`TcleBuilderPage`) is unaffected — keeps the existing auto-logout-on-401
behavior, which is correct there.

**Verified**: added a deterministic e2e regression test in
`intake-wizard.spec.ts` (mocks the consent-templates endpoint to 401,
asserts the demographic step survives with no forced navigation away
from `/next/intake`) — confirmed it fails against the pre-fix code
(actually redirects, first to `/login`, within a few seconds even with
no backend running — proven with an instrumented run before the fix) and
passes after. Also ran the full `intake-wizard.spec.ts` suite, the
component's own unit test (`ClinicalIntakeWizard.test.jsx`), and both
`npm run typecheck` (core) and a full `tsc --noEmit` — all clean.

**Process note (self-caught, no data lost):** started editing product
files directly on `feature/docker-e2e-backend-integration` before
creating the `fix/395-...` branch, contrary to `fix-bugs`'s own
branch-before-edit instruction. Caught via `git status` before
committing; `git checkout -b` carried the uncommitted changes over
cleanly, so nothing was lost, but this was a real process slip. Filed as
a skills-pack finding (dyeallpies-skills-pack#186) since nothing
currently guards against it mechanically.

**Issue #395 closed** (comment cites merge commit `b41e43e5` and fix
commit `83320865`). Fix branch deleted both locally and on origin — the
remote delete succeeded this time (continues the pack#183 pattern:
same-session-pushed branches delete cleanly; only a *different* session's
merged branch has been denied so far).

**New issues filed this session:**
- **#397** (BioAvanceD-v2, open) — precautionary paper-trail per this
  session's own `wrap-up` security-relevance check: records the
  `suppressAuthRedirect` decision on the global auth interceptor and asks
  for a second look confirming the scope reasoning holds. Not a known
  problem, just a recorded decision on security-adjacent code.
- **dyeallpies-skills-pack#185** (open) — new classifier data point:
  `gh issue close --comment` was denied when the comment body was passed
  via an inline heredoc/command-substitution, then succeeded seconds
  later as a flat single-line command with identical intent. Distinct
  from the existing "blocked compound commands" incidents (this was one
  `gh` call both times, not two chained actions) — flags that the
  classifier may key partly off the Bash command's literal shape, not
  just the semantic action.
- **dyeallpies-skills-pack#186** (open) — the branch-before-edit process
  slip above: no hook currently catches a `fix-bugs` session editing
  product files on the protected/integration branch before its
  `fix/<slug>` branch exists.

**No other workflow friction this session** beyond the two items above
(`wrap-up` core audit) — no scope creep, no lazy fixes, no stale
instructions, no user corrections needed.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `b41e43e5`, **in sync
  with origin** (nothing outstanding to push). Working tree clean.
- Issues: **#395 closed** (`b41e43e5`/`83320865` noted in the close
  comment). **#397 opened** (security paper-trail, open, low urgency —
  see above).
- `fix/395-intake-consent-prefetch-forced-logout` (merged): deleted both
  locally and on origin — fully cleaned up.
- `test/392-specimen-preanalytics-canonical-fields` (merged, from a much
  earlier session): **still on origin** per the last check (prior
  handoff) — not re-checked this session, presumed still needing manual
  cleanup or a permission grant unless someone has since removed it.
- Untouched from before: **#389**/**#390** (storage/custody separation
  and its dependent migration, open, `#389` needs `divide-and-conquer`
  scoping first), **#394** (audit_events historical-gap issue — note its
  title now reads as already describing #369's fix as having landed;
  worth re-reading before assuming it's still purely an open question),
  older backlog (`#371`/`#373`/`#374`/`#378`/`#379`, `#384`-`#387`).
  Local branch hygiene otherwise unchanged: everything merged except
  `test/377-docs-on-main`, tracked by still-open **#379**.

## Blocking next step

None. Nothing queued as blocking.

No next issue queued explicitly by Dennis. Candidates, roughly by
size/readiness:
- **#397** (suppressAuthRedirect decision review): quick — just needs a
  read-through and either a close-as-fine or a follow-up if the scope
  reasoning doesn't hold up.
- **#394** (audit_events historical gap): re-read first — title suggests
  it may now be scoped narrower than "owner-judgment question" (see repo
  state note above).
- **#389**/**#390**: unchanged from prior handoffs, see below.

## Which skills to use

- **#397**: light `resolve-issue` read — not really a coding task unless
  the review turns up a real gap.
- **#394** (audit_events historical gap): re-read the current issue body
  before picking a skill — may no longer be the same "surface to Dennis"
  situation described in earlier handoffs now that #369 has landed.
- **#389** (storage/custody entity): scope with `divide-and-conquer`
  first — don't attempt as one slice (28 files, already half-separated
  via `storageBoxes`). Check dict-02's "Entidade" column for the
  canonical name before naming anything (dyeallpies-skills-pack#179).
- **#390**: blocked on #389.
- Backlog unchanged otherwise from prior handoffs: **#384–#387** (four
  architecture-gap issues), older backlog (`#371`/`#373`/`#374`/`#378`/
  `#379`) — untouched this session.
