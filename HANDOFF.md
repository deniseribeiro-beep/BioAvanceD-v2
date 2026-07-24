# HANDOFF

**Written:** 2026-07-24, end of a `work-issue` -> `fix-bugs` iteration.
**Branch:** `feature/docker-e2e-backend-integration` (commit `46042b91`,
pushed, working tree clean — no product-source or test changes this
session).

## What happened this session

Dennis asked to work the stacked-up issue backlog over the next few
rounds. Routed via `work-issue`: backlog scan showed most open issues
carry the `test-branch` label (deferred until their originating branch
merges to main) — skipped those. Picked **#276**
(`full-suite-guard.cjs` false-positive: `ps aux | grep -i vitest |
grep -v grep` got blocked by the `bareVitest` regex even though it
never invokes vitest) as the first non-deferred, clearly-scoped bug.

- Routed to `fix-bugs`. Started reading `.claude/hooks/full-suite-guard.cjs`
  to plan the regex fix in-repo.
- Dennis caught mid-iteration that this was the wrong repo for the fix:
  `.claude/hooks/` is gitignored in BioAvanceD-v2 (see
  `.claude/.gitignore:21`, and commit `ec7f9914` which stopped tracking
  deployed hooks) — the file is a pack-deployed asset from
  `dyeallpies-skills-pack`'s `projects/bioavanced-v2/assets/hooks/`, not
  editable/reviewable from this repo. Confirmed via `git check-ignore -v`
  and finding the real source in the pack repo.
- Per skill-maintenance's Rule 0 pattern (already documented for skill
  files, now also applies to deployed hooks), cross-filed the exact fix
  against the pack repo instead: **dyeallpies-skills-pack#122** — a
  `cmdStart` regex change requiring `vitest` to appear at a shell
  statement boundary (optionally after `npx`/`yarn`/`pnpm`/`pnpx`)
  rather than matching the bare word anywhere. Verified by hand against
  both the repro and legitimate invocations before filing.
- Closed BioAvanceD-v2#276 with a comment pointing to the cross-filed
  issue — no BioAvanceD-v2-side change was possible or needed.
- Ran `wrap-up`'s core audit: filed **dyeallpies-skills-pack#123** — the
  `fix-bugs` skill has no step telling you to check whether a target
  file is gitignored/pack-deployed *before* branching to fix it; this
  session only caught it because Dennis flagged it mid-iteration, not
  because the skill prompted the check. No scope violations (no
  Edit/Write ever happened against the gitignored file), no lazy fixes,
  no context waste beyond the normal back-and-forth.

## Repo state

- `feature/docker-e2e-backend-integration`, pushed, working tree clean.
- **No files touched in BioAvanceD-v2 this session** — the only change
  was closing issue #276 with a comment. All actual fix content lives
  in the two pack-repo issues below.

## Milestone (set 2026-07-22 by Dennis, still current)

**Target: 90% across all four coverage dimensions.** Last full reconcile
(2026-07-24, session 16, pre-session commit `a636b37a`): Statements
94.01%, Branches 88.2%, Functions 92.33%, Lines 94.29%. Unchanged this
session (no test-loop work happened — this was a bug-backlog round).

## Recommended next steps

Dennis asked to keep working the issue backlog for the next couple of
rounds — next session should resume via `work-issue`, picking the next
non-`test-branch`-labeled issue. Candidates seen this session that are
open now (not exhaustive — re-scan the backlog fresh, don't trust this
list):

- **#260** (`orphanet.js`: two structurally-unreachable branches,
  `bug` label, no `test-branch` label) — read during triage but not
  worked; author's own writeup already leans "dead code, safe to
  simplify" rather than a real defect, so this likely routes to
  `resolve-issue` (simplification) rather than `fix-bugs`, but re-verify
  reachability yourself per `fix-bugs`' "verifying before deferring"
  section rather than trusting the issue body at face value.
- **#264** (`user-security.service.js` `extractOS`: dead Android
  branch), **#272** (`daily-merkle.job.js`: two unreachable defensive
  branches), **#258** (`NotificationService.js`: infra-mocking gap) —
  all open, no `test-branch` label, unworked.
- **#255**/**#251** carry the `bug` label but check each carefully —
  #251 also carries `test-branch` (deferred); #255 does not.

No specific issue was named by Dennis for next round — pick per
`work-issue`'s classify-and-route process, same as this session.

## Which skills to use

`work-issue` to pick and route the next issue, `fix-bugs` or
`resolve-issue` depending on classification. **New this session:** if
the picked issue's file lives under `.claude/hooks/`, `.claude/agents/`,
or `.claude/skills/`, run `git check-ignore -v <path>` *before*
branching — if it's gitignored, it's a pack-deployed asset and the fix
must be cross-filed against `dyeallpies-skills-pack` (Rule 0), not
edited locally. `wrap-up` every iteration.

## Dependency notes

None blocking. `dyeallpies-skills-pack#122` (full-suite-guard.cjs
regex fix, this session) and `#123` (fix-bugs skill gap, this session)
are pack-repo issues, not BioAvanceD-v2 blockers, but #123 is relevant
process guidance for the very next round if another hook/agent/skill
bug turns up in the backlog.

## Session note

`.claude/hooks/` (and presumably `.claude/agents/`, `.claude/skills/`)
are gitignored in this repo as of commit `ec7f9914` — they're deployed
copies from `dyeallpies-skills-pack`, not source. Any bug filed against
a file under those paths needs its fix cross-filed against the pack
repo, never edited here, even for a one-line regex change. Check
`git check-ignore -v` on the target file as the first step whenever an
issue's symptom lives in `.claude/`.
