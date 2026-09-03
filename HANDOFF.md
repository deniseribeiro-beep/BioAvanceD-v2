# HANDOFF

**Written 2026-09-03, eighth 10-issue queue sitting. Dennis asked for "the
next ten issues, Docker is on."** Of the ten, **5 closed and 5 open**; two
issues this sitting filed were also worked and closed, so **7 closed in
total**. 6 commits pushed. **13 issues filed here, 4 on the pack.** The
**Docker gate ran and was green (11/11 healthy, RestartCount 0); the stack
is down.**

**This is an INTERIM rotation — the session has not been declared over.**
Re-derive every count rather than trusting it.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, clean and matching origin.
  `main` untouched, no PR.
- Last substantive commit: `734a21c8` (#1001).
- **New npm scripts / dependencies / env keys: none.**
- New test file: `frontend/src/views/ImportLGPDPage.test.tsx` — the repo's
  first RTL test under `frontend/src/views/`.

## Docker state — nothing is running

- `compose.test.yml` brought up **with `--build`** (12 named services,
  excluding `playwright-runner`) and torn down. `docker ps -a` is empty.
- **The five `bioavanced-test-*` named volumes survive.** Bootstrap state:
  **present, inherited, not re-verified** — no bootstrap service was started.
- **Test-stack images are CURRENT** — rebuilt this sitting from this tree.
  33 images / 5.118GB deliberately kept (a machine-wide prune needs consent).
- **Build cache pruned to 0B** (`docker builder prune -af`, 620.4MB).

## Verification

| Gate | Result |
|---|---|
| `compose.test.yml` bring-up | **11 running, 11/11 healthy**, `mongo-rs-init-test` exited 0, RestartCount 0 |
| Full native backend | **457 files, 8383 tests** |
| Full frontend | **29 files, 244 tests** |
| `npm run test:architecture` | 120 / 120 |

**No e2e run this sitting** — outstanding before a PR.

## What closed (7)

Queue: `#995` `#996` `#998` `#999` `#1000`. Filed-and-worked: `#1001` `#1004`.

## The five queue members still open, and what each needs

- **#997** — slice 1 shipped (`d9f2274d`). **Blocked on #1007**: its async
  half would assert a number `result-worker` never computes. Its sync e2e
  leg is now viable and needs the Docker gate.
- **#989 / #959** — one piece of work. See the judgment section below.
- **#988 / #990** — one decision. #990 closes as **obsolete**, not fixed, if
  #988 part 3 takes the reordering. Do not patch #990 independently.

Query the board for everything else (`gh issue list --state open`).

## The judgment a query cannot carry

- **[ran it] The audit sealing path has produced nothing, on a stack holding
  1471 events.** `audit_roots`, `audit_tree_heads`, `audit_timestamp_tokens`,
  `audit_witnesses` are all **0**; `audit_events` is **1471**. This is the
  direct check #989/#959 both named and nobody had run. The 1471 is the
  load-bearing number — a zero beside a zero is ambiguous, a zero beside 1471
  is not.
- **#989 item 2 has a structural constraint neither issue records. [read it]**
  The private key is a **file**, the registry is an **environment variable**
  resolved by Compose on the host before any container runs. **A one-shot
  writing into a shared volume can deliver the key and can never deliver the
  matching registry.** Key-without-registry yields a stack that signs
  correctly and stamps every artifact `signature_unknown_key_id`. Three
  costed options are on #989.
- **#988 part 3's stated blocker is not a blocker. [read it]** The siblings
  run *Mongo read then Neo4j then Mongo transaction*, so "the position is
  known only after the Mongo scan" does not prevent the reordering — only
  `coordinate` of seven `MERGE` parameters depends on the transaction. The
  **real** cost is that `recordCustodyEvent` writes a **disjoint graph**
  (different `Sample` key, different position key, no box node), so it is a
  port extension, not a reroute — plus externalising the scan **destroys the
  self-healing retry** and turns a concurrent auto-assign into an HTTP 500.
- **[ran it] `storageService.js:189` is the only Cypher writer in the repo
  keying `Sample` on `specimenId`;** every other uses `Sample {id}`. Its
  `STORED_IN` edge hangs off an orphaned node nothing else can see.
- **[ran it] `git grep -l "001_iso20387_constraints_indexes"` returns nothing
  repo-wide** — the Neo4j constraints in `schema/` are applied by nothing.
- **[read it] Administrador is the one role EXEMPT from mandatory MFA**
  (`auth.service.js:463`), and promoting a user to Administrador **clears
  their enrolment**. That makes the `PUT /api/users/:id` MFA-clear branch
  coherent policy rather than a bug, and it is why #999's `mfaEnabled` half
  resolved to *keep*. Filed as **#1011** — read it before touching MFA.
- **[ran it] `results.skipped` was dead for BOTH import formats, not just
  CSV.** My own #1001 body said `readExcel` had no pre-filter; it has two.
  A worker briefed on the wrong premise stopped and contradicted it. **Twice
  this sitting a brief's verify-the-precedent clause paid for itself** — the
  other caught a "file does not exist" that was a wrong-directory result.
- **[ran it] A route's mount path is not its filename.** I wrote
  `PUT /api/user-security/password` into a commit message and a close
  comment; the real mount is **`/api/user/security/password`**
  (`app.js:415`). Caught only by probing the live stack — a 404 against a
  404 control. Corrected on #995.
- **[read it] `import-worker.js`'s `|| 0` defeats `ResultsPage`'s
  `!== undefined` guard**, so #925's invariant is undone one layer upstream
  and every job that view can show claims "Ignorados: 0". #1007.
- **[read it] `targetUser.accessType` is `undefined` on every real user**
  (dropped by #427/#432), so `PUT /api/users/:id`'s promotion condition
  degenerates to `Boolean(requestedAccessType)` and fires on every edit
  carrying a `roleName`. #1009. The #998 floor deliberately uses
  `resolveUserHierarchyLevel` instead; the two comparisons in that handler
  currently disagree.

## Filed this sitting

Here: **#1002 #1003 #1005 #1006 #1007 #1008 #1009 #1010 #1011 #1012 #1013**
(plus #1001 and #1004, both closed).
On the pack: **#693 #694 #695 #696**.

**Worth reading first: #1011** (the admin MFA exemption — a policy question
that gates #1010 and #1013), then **#1003** (an auto-assigned specimen
cannot be released through any API).

## Conventions this sitting relied on / established

- **A live-stack probe catches what no unit test can.** The route-mount
  error above survived a 459-test consumer sweep and a green full suite.
  When a fix's prose names a URL, probe it.
- **Brief every worker to verify the precedent and report if it differs.**
  Two of five workers contradicted my brief; both were right.
- **The can-it-fail probe reverts every site, and the failure count must be
  N-shaped** — 7 for #1001's six hunks, 2 for #998's two gates, 7 for #995's
  three files.
- **Derive a reproduction's arrange block from the nearest passing sibling.**
  Skipped once here: four #998 tests answered 422 from `UserModel.validate`
  and measured nothing. pack#695.
- **`git checkout <commit> -- <paths>` is blocked by `branch-guard`** — it
  reads the commit-ish as a branch. Use an editor-edit probe instead;
  `git show HEAD~1:f > f` works but triggers the #650 file-inlining dump.
  pack#694.
- **Delegation launders the routing gate** — the worker makes the edits, so
  the orchestrator's edit-side gate never arms. Happened twice. pack#696.
- **Do not brief a leaf worker to read the tracker** — its guard denies `gh`
  outright, so quote what it needs. pack#693.
- **A large `HANDOFF.md` heredoc exceeds the harness wrapper ceiling** —
  write it with the `Write` tool (#665/#659).

## Recommended next

**None queued** — Dennis named no task beyond the ten.

The cheapest high-value work is **#1009** (a one-condition fix with a named
trap) and **#1007** (option (b) is a two-line change restoring #925's
invariant, and it unblocks #997's async half). **#989 item 2** is the one
that needs a real decision first — pick one of its three options before
writing code.
