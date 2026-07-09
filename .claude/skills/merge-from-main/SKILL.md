---
name: merge-from-main
description: Workflow for pulling Denise's main-branch updates into feature/docker-e2e-backend-integration without losing our test-loop/fix-bugs work. Use when main has moved ahead and the feature branch needs to catch up, when asked to "merge main in", "pull from main", "sync with main", or "update our branch with Denise's changes".
---

# Merging main into our feature branch

We never push to `main` and never open a PR without Dennis's go
(`bioavanced-conventions`), but `main` is Denise's live branch and
moves independently. Periodically its changes need to land on
`feature/docker-e2e-backend-integration` so we're not diverging forever.
This is a bigger, higher-stakes operation than a normal `fix-bugs`
merge-back — main can carry dozens of commits and genuine architectural
changes, not just unrelated file edits.

## Before merging: survey, don't dive in

1. `git fetch origin`, then `git log --oneline
   feature/docker-e2e-backend-integration..origin/main` and the reverse
   direction — know the size of what's coming both ways before touching
   anything. The reverse direction (`origin/main..<ours>`) is routinely
   hundreds of commits on this branch (test-loop/fix-bugs history) and
   is never itself interesting — pipe it to a scratchpad file and use
   `wc -l` for the count; don't let the full list stream into the
   conversation (confirmed 2026-07-08, wrap-up context-waste finding).
2. **Dry-run first**: `git merge-tree $(git merge-base <ours> origin/main)
   <ours> origin/main > /tmp-or-scratchpad/mergetree.txt`, then `grep -c
   "^+<<<<<<< \.our"` for a conflict count and pull out the conflicting
   file list. This costs nothing (no working-tree changes) and tells you
   the real shape of the merge before you commit to an approach.
3. Report the scope back before merging: commit counts each direction,
   which files conflict, and whether any conflicts look architectural
   (see below) rather than textual. For a merge this size, **don't just
   run `git merge` and start resolving** — confirm the approach with the
   user first (confirmed 2026-07-07: the user stopped a same-turn `git
   merge --no-edit` specifically to review step by step first).

## Do the merge on a throwaway branch, not the feature branch directly

Branch-naming is enforced by a repo hook (only
`feature/docker-e2e-backend-integration`, or `fix/<slug>`/`test/<slug>`
are accepted — confirmed 2026-07-07, a `merge/...`-prefixed name was
rejected). Name the merge branch `fix/merge-main-<date>` off the current
feature branch tip, do the real `git merge origin/main --no-edit` there
(conflicts and all), resolve everything, verify, then fast-forward it
back: `git checkout feature/docker-e2e-backend-integration && git merge
--ff-only fix/merge-main-<date>`, then delete the throwaway branch. This
keeps the feature branch safe to abandon-and-retry if the merge goes
sideways, without violating the branch-naming hook.

**Never use `-X ours` / `-X theirs`** to blanket-resolve — it silently
discards one side everywhere, including files that never needed
resolving that way (rejected 2026-07-07 when proposed). Every conflict
gets looked at.

## Classify each conflict before resolving

Two different kinds of conflict show up in a main-merge, and they need
different handling:

- **Trivial** (version bumps, whitespace, obviously-additive config)
  — just resolve inline, no discussion needed.
- **Architectural** — main and our branch made *opposite structural
  decisions* about the same thing (e.g. 2026-07-07: main moved e2e
  specs/config to `frontend/`, deleting its old ones; we'd moved ours to
  repo root for the Docker e2e module-resolution requirement in
  `e2e-docker-workflow`; main also replaced our 3-job CI pipeline with
  its own single validation job). For these, **investigate before
  proposing anything**:
  - For a modify/delete conflict, check whether the deleting side
    replaced the functionality elsewhere (`git log --diff-filter=D
    origin/main -- <path>` to find the deleting commit, then `git show
    --stat <commit>` and grep the merged tree for remaining references
    to what was deleted). If nothing still references it, it's dead code
    — safe to drop, and drop its test with it.
  - For a genuine fork (both sides still-relevant, incompatible), lay
    out what each side did and why, then use `AskUserQuestion` — don't
    unilaterally pick a side. This is exactly the kind of judgment call
    that determines what the merged branch actually looks like going
    forward.

## Conflicts filed as issues still resolve inside the one merge commit

When a conflict is non-trivial enough to file as its own GitHub issue
(confirmed pattern, 2026-07-09, issues #120-#124: main's single
"canonicalize participant flow" commit silently dropped functionality
still needed elsewhere — an auth guard, a validation check, a bugfix
config value — while renaming fields), don't try to run the normal
`fix-bugs` one-issue-per-branch-per-commit loop on them. A `git merge`
can't be committed until *every* conflict is resolved, so there's no
way to land one issue's fix as its own commit while the others still
have `<<<<<<<` markers in the tree. Resolve all the filed conflicts in
the merge's working tree, land them together in the single merge
commit (list the issue numbers and what each resolution does in the
commit message), then `gh issue close <N> --comment "..."` each one
individually pointing at that merge commit's hash — same closing
discipline as `fix-bugs`, just not the same branching discipline.

## Lockfiles: regenerate, don't hand-merge

For `package-lock.json` conflicts (root, `api/backend/`, `frontend/`),
resolve the corresponding `package.json` first, then run `npm install
--package-lock-only` (or plain `npm install` if you're about to run
tests anyway) in that directory — don't try to reconcile the JSON by
hand. Verify after: `node -e "JSON.parse(require('fs').readFileSync('<path>','utf8'))"`
and confirm zero `<<<<<<<` markers remain.

## `git show rev:path` and colons

If pulling a whole file from `origin/main` for comparison or wholesale
adoption (`git show origin/main:path/to/file`), see `local-env` for the
MSYS path-mangling gotcha on Windows Git Bash — prefix with
`MSYS_NO_PATHCONV=1` if the command errors with a mangled revision
string.

## Verify before committing

Don't run the full test suite as a merge gate — same per-iteration
discipline as `test-loop`/`fix-bugs`: targeted vitest runs against every
file the merge actually touched or that depends on something the merge
changed, plus `npm run lint` and `npm --prefix api/backend run
typecheck` (or the root `lint`/`typecheck` scripts, which cover both),
plus a frontend `npm --prefix frontend run build` if frontend config or
deps moved. Full suite is a `ship-to-main` gate, not a merge gate.

## Findings along the way

A merge this size will surface real oddities in the product code (dead
imports, orphaned modules, dead test files) — file each one with `gh
issue create` the moment you notice it, same blanket-OK rule as
everywhere else in this repo. Don't fold a "drop this, main clearly
doesn't need it anymore" decision into the merge commit silently if
it's not obviously trivial — a one-line issue costs nothing and gives
Dennis a record.

If the merge decision leaves something deliberately incomplete (e.g.
"e2e specs deleted, to be rebuilt from scratch" — confirmed 2026-07-07),
that deferral needs its own tracking issue in the same session, not just
a sentence in the merge commit message. A commit message isn't
discoverable the way an open issue is.

## Committing and pushing

One merge commit (not squashed, not rebased — this is exactly the case
`git merge` exists for) with a message that lists the non-trivial
resolutions and why, not just "merge main". Push only when explicitly
asked — same as any other push in this repo (`bioavanced-conventions`).
After an end-of-task push, run `wrap-up` before the final summary, same
as any other task.

## Maintaining this skill

If a future main-merge stumbles on something this doesn't cover, update
this file directly. Incident narratives and any long war-stories belong
in `bioavanced-conventions/references/incidents.md`, cross-referenced
from here, not inlined.
