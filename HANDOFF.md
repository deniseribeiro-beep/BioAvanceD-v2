# HANDOFF

**Written 2026-09-02, fifth 10-issue queue sitting of the day.** Dennis asked
for "the next ten issues, Docker is on." **All 10 addressed — 5 closed, 5
shipped-in-part and left open with their remainders named — 11 commits pushed,
9 issues filed here and 8 on the pack. The Docker gate ran and was green.**

**The session was not declared over by the user.** Re-derive every count rather
than trusting it.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, clean and matching origin.
  `main` untouched, no PR.
- Last substantive commit: `e6cb811a` (#933's guard tests).
- **`.env.production` (gitignored, real secrets) was edited locally** — its
  TSA/witness URLs were missing the `/tsa` and `/witness` suffixes, because it
  was generated from the old template. Fixed on this machine only; anyone
  else's copy still has the defect. The tracked template is fixed in
  `67ac5405`.
- **New npm scripts:** none. **New dependencies:** none.
- **New env key:** `WORKER_CONCURRENCY=1` in both `.env.docker.example` and
  `.env.production.example`.

## Docker state — nothing is running

- **`compose.test.yml` was brought up and torn down this sitting.** `docker ps
  -a` is empty; build cache pruned to 0B (620MB reclaimed).
- **The five `bioavanced-test-*` named volumes survive** (`down` without
  `--volumes`), so the admin + 17-service reference-data bootstrap does **not**
  need re-running. `compose:test` up and it is already there.
- **The 24 test-stack images are kept and are CURRENT** — built from this
  sitting's tree, unlike the prior sitting's, which predated its commits.
- `bioavanced-prodverify` was not touched this sitting.

## Verification state

| Gate | Result |
|---|---|
| **Full native suite** | **457 files, 8335 tests, 0 failures** |
| `npm run test:architecture` | 120 / 120 |
| `npm run lint` | 466 backend files, clean |
| **`compose.test.yml` bring-up** | **10 services, all healthy, `RestartCount=0`** |

**No e2e run this sitting** — the bring-up deliberately named 10 services to
avoid auto-starting `playwright-runner`.

## What closed (5)

`#977` `#971` `#958` `#649` `#952`.

## What shipped in part, and what each still needs

- **#959** — items 1, 3, 4 done and gate-verified. Open on **item 2**: no
  signing key reaches any stack, which needs a key-generation one-shot writing
  into a shared volume (adjacent to #962), not a wiring fix.
- **#914** — `session.timeoutMinutes` wired. Open on **`authentication.requireMFA`**
  (making it real means deciding what happens to a user who has not enrolled)
  and the other 41 keys.
- **#941** — dead declaration deleted, survivors marked inert. Open on
  **BUILD**, whose prerequisites are #984 and whose shape is not what the issue
  assumed (see its latest comment).
- **#933** — the three MFA-recovery guards are now pinned. Open on
  **direction 2**, which is a decision, laid out as A/B/C in its latest comment.
- **#923** — the fork is unanswered; two defects wrong under *either* direction
  split to #987/#988.

Query the board for everything else (`gh issue list --state open`).

## The judgment a query cannot carry

- **Two of #914's and #649's decisions are one decision.** #914 snapshots
  `inactiveTimeout` onto the session rather than reading policy live —
  **[read it]** dict-02 P1X-0262 calls it the *efetivo* limit — and that is
  *why* #649 has work to do. Under a live read a tightened timeout applies on
  the next request and RF014 AC#8 would be vacuous. Choosing live would have
  silently deleted a Crítica requirement. Do not "simplify" one without the
  other.
- **#649's revocation list has one entry on purpose.** `session.timeoutMinutes`
  is the only SecurityConfiguration key anything enforces. `requireMFA` is
  excluded *because* it is inert — revoking on a `false→true` flip would log
  everyone out and readmit them without MFA. **It joins the list when #914
  finishes it, and not before.**
- **#952 shipped an undeclared field.** `accountLockedUntil` is not in dict-02;
  RF001 AC#2's *temporariamente* is unimplementable without it. **[ran it]** No
  gate blocks that — the conformance arch test covers 18 entities and
  structurally excludes `User.js`, and 14 undeclared keys already ship in
  `UserModel.create`. Amendment request is **#985**.
- **Three premises were run and inverted this sitting**, all `[ran it]`:
  - **#977's own trace was wrong twice.** The swallow is in `server.js`, not
    `queue.js` (whose catch rethrows), and the worker's throw is not uncaught —
    it is an explicit `process.exit(1)`. And the split covers **three** Redis
    checks, not one, so the worker dies on a Redis that is merely *down*. → #979.
  - **A `create-db.js` IndexOptionsConflict I had already written a full issue
    body about does not exist.** **[ran it]** `docker run --rm mongo:7`: both
    indexes build. MongoDB permits several indexes over one key pattern when
    the *names* differ; naming avoids the conflict rather than causing it. The
    issue was rewritten around what survives → #983.
  - **#933's premise that `resetMFA` is Administrador-only is false since
    #632** — a role with `permissionIds: ['perm-resetMFA']` and
    `hierarchyLevel: null` gets 200. Direction 2 is therefore wider than the
    issue frames it.
- **#923's body still carries a claim its own second comment retracted** (that
  F3-G10 drops RF006 item 7's replica-set conditional — it does not). I fed the
  uncorrected version into a research brief and had it refuted back. Read that
  issue's comments before its body.
- **The `--wait` exit code is still not the gate.** `worker-test` declares no
  healthcheck, so it is invisible to `--wait` by construction. `docker compose
  ps` plus `docker inspect --format {{.RestartCount}}` is what proved it up.

## Filed this sitting (17)

Here: **#979 #980 #981 #982 #983 #984 #985 #986 #987 #988**.
On the pack: **#670 #671 #672 #673 #674 #675 #676 #677**.

**Worth reading first: #982** — `PUT /api/users/:id` lets an admin set another
user's password, rewrite their `passwordHistory` and zero `failedLoginAttempts`
in one request, revoking nothing, while the same file hard-deletes the MFA
counters as "load-bearing".

## Conventions this sitting relied on / established

- **Run the premise before writing the issue body, not after.** It paid three
  times; the third cost a full rewrite because the order was reversed.
- **Single-line anchors only in patch scripts.** `core.autocrlf=true` makes
  every working copy CRLF, so a heredoc's multi-line needle can never match —
  and the miss reads as a wrong-text error. Files in this repo are **mixed**
  LF/CRLF, so detect the file's own EOL rather than hardcoding. Pack #670.
- **Anchor greps that decide a verdict.** `FAIL` matches this repo's own
  `AUDIT_TRAIL_WRITE_FAILURE` log lines; `'http://tsa'.includes('/tsa')` is
  true. Both produced confident wrong answers acted on. Pack #677.
- **Redirect any vitest run over ~3 files** — the auth suites are loud
  regardless of how targeted the run is.
- **Never chain a fix to its own verification with `&& … || echo`** — a failed
  edit prints a confident claim about a check that never ran. Pack #675.
- **A red reproduction can be red for the wrong reason.** One test here failed
  on a missing `jwt.verify` stub, not its assertion; only the post-commit
  can-it-fail probe established it. Pack #676.
- **`COVERAGE_NOTES.md` owes an update in the same commit** — missed for three
  iterations, and the stale entry was actively discouraging the exact work
  #977 needed (`3a27d59d`).

## Recommended next

**None queued** — Dennis named no task beyond the ten.

Two decisions are waiting on him and block nothing else: **#933**'s A/B/C and
**#923**'s fork. The cheapest unblocked work is **#959 item 2** (the signing
key), which is what stops the audit chain being verifiable end-to-end.
