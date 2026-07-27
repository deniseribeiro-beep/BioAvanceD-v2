# HANDOFF

**Written:** 2026-07-27, end of a `work-issue` -> `fix-bugs` iteration.
**Branch:** `feature/docker-e2e-backend-integration` (commit `ce7a7dd2`,
pushed, working tree clean — this session made no new commit).

## What happened this session

Dennis asked to read the prior handoff and resolve an issue. Routed to
**#269** (`.claude/hooks/branch-guard.cjs`: bare `git push` with same-line
redirection/pipe misparsed as pushing to a branch named after the
redirect target).

- Per `fix-bugs`' Rule 0 check, confirmed `.claude/hooks/branch-guard.cjs`
  is pack-deployed, not local product source: `git check-ignore -v`
  showed it's covered by `.claude/.gitignore` (line 21, `hooks/`), sourced
  from `dyeallpies_skills_pack`'s `install-assets.ps1`/junction.
- Checked the pack repo
  (`C:\Users\Dennis\Desktop\usf\projects\dyeallpies_skills_pack`) instead
  of editing the local copy. Found the fix was **already applied
  upstream**: commit `ef8d43b` ("bioavanced-v2 branch-guard.cjs: fix bare
  push+redirect/pipe misparse (BioAvanceD-v2#269)"), already excluding
  shell metacharacters (`|><&;`) from both the "remote" and "branch"
  token classes in the push-matching regex.
- `diff`'d the locally deployed
  `.claude/hooks/branch-guard.cjs` against the pack's fixed version —
  byte-identical, so no sync/redeploy was needed either.
- Verified the fix actually works before closing: ran the hook directly
  with the issue's exact repro (`git push 2>&1 | tail -10`) — no block
  (previously misparsed `|` as the branch name). Ran a regression check
  (`git push origin main`) — still correctly blocks. Both via direct
  `node .claude/hooks/branch-guard.cjs < payload.json` invocation.
- Commented the trace and verification on #269, closed it referencing
  `dyeallpies_skills_pack@ef8d43b`.
- `wrap-up` core audit ran clean: no scope creep (only `gh` commands, no
  file edits), no lazy fix, no permission denials, nothing left ambiguous
  on the closed issue, nothing security-relevant (a dev-tooling hook, not
  app code). Shipping addendum: issue closed cleanly, no deferred
  sub-points, no undocumented gaps in the close comment.

## Repo state

- `feature/docker-e2e-backend-integration`, pushed at `ce7a7dd2`,
  working tree clean. No new commit this session (nothing to commit —
  the fix already existed upstream and locally).

## Milestone (set 2026-07-22 by Dennis, still current)

**Target: 90% across all four coverage dimensions.** Last full reconcile
(2026-07-24, session 16, pre-session commit `a636b37a`): Statements
94.01%, Branches 88.2%, Functions 92.33%, Lines 94.29%. Unaffected this
session (hook-tooling fix, not product coverage).

## Recommended next steps

No specific issue named for next round — **none queued**; re-scan fresh
via `work-issue` next session. Open backlog as of this session's scan
(`gh issue list --state open`, largest-numbered first, before this
session's work, #269 now closed): #278 (real orphanet.js gaps, routes to
test-loop), #277, #275 (coverage-tooling nondeterminism, different
shape), #274 (genuine untestable-branch case, needs malformed-CSV
research), #267, #266, #265, #264, #263, #262, #261, #258, #257, #256,
#254, #251, #228, #224, #222, #115. Re-verify state, don't trust this
list — several of the dead-code-shaped ones may resolve the same way
#255, #260, #261-#271 family did (dead per call-site tracing) once
traced, and #264 is a plain reachability case (Android branch pre-empted
by a Linux check) worth a quick trace too.

## Which skills to use

`work-issue` to pick/route, `fix-bugs` for issue resolution. **New
precedent this session**: before planning any edit to a file under
`.claude/hooks/`, `.claude/agents/`, `.claude/skills/`, etc., run `git
check-ignore -v <path>` first — if it's pack-deployed, check the pack
repo's git log for that file before assuming a fix is needed; it may
already be fixed upstream and just need verification, not a new patch.
`merge-from-main` first if main has moved since last checked (`git fetch
origin && git log --oneline <branch>..origin/main` was 0 this session).
`wrap-up` every iteration.

## Dependency notes

None blocking. `dyeallpies-skills-pack#124` (fold docs+main investigation
into the owner's-call dead-code flow) and `#122`/`#123` are pack-repo
process issues, not BioAvanceD-v2 blockers — not touched this session.

## Session note

No new session note this time — the `daily-merkle.job.js` note from an
earlier handoff (re-check `scheduleNextRun`'s outer catch if `runOnce`'s
error handling is ever touched) still stands and isn't repeated here to
avoid an accumulating log; see that file's own git history if needed.
