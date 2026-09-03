# HANDOFF

**Written 2026-09-03, sixth 10-issue queue sitting.** Dennis asked for "the
next ten issues, Docker is on." **All 10 addressed — 5 closed, 5 open with
their remainders named. 8 commits pushed. 6 issues filed here and 2 on the
pack. The Docker gate ran and was green; the stack is down.**

**The session was not declared over by the user.** Re-derive every count
rather than trusting it.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, clean and matching origin.
  `main` untouched, no PR.
- Last substantive commit: `4df10c3b` (fixes for defects found in this
  sitting's own commits — see below).
- **New npm scripts:** none. **New dependencies:** none. **New env keys:**
  none. One env key was *removed*: the dead `TSA_URL` from
  `compose.test.yml`.
- `.env.docker.example` gained an explanatory block on
  `AUDIT_MERKLE_SIGN_PRIVATE_KEY_PEM` — no value changed.

## Docker state — nothing is running

- `compose.test.yml` was brought up **with `--build`** and torn down this
  sitting. `docker ps -a` is empty.
- **The five `bioavanced-test-*` named volumes survive** (`down` without
  `--volumes`), so the admin + reference-data bootstrap does **not** need
  re-running. Bootstrap state: **present, inherited from a prior sitting and
  not re-verified this one** — no bootstrap service was started, because the
  gate only needed the 12 core services.
- **The test-stack images are CURRENT** — rebuilt this sitting from this
  tree, including `tsa-test` and `witness-test`, whose source changed.
- **Build cache pruned to 0B** at session end (`docker builder prune -af`,
  1.047GB reclaimed). The 24 test images and the 5 named volumes were
  deliberately kept, so the next gate needs no rebuild and no re-bootstrap.

## Verification

| Gate | Result |
|---|---|
| **Full native backend** (`tests/unit` + `integration` + `compliance`) | **457 files, 8352 tests, 0 failures** |
| **Frontend** (7 `src/` dirs) | **28 files, 241 tests, 0 failures** |
| `npm run test:architecture` | 120 / 120 |
| **`compose.test.yml` bring-up** | **12 services, all running, `RestartCount` 0 on every one** |

No e2e run — the bring-up named 12 services deliberately, so
`playwright-runner` never auto-started.

## What closed (5)

`#987` `#984` `#980` `#970` `#981`.

## What is open, and what each still needs

- **#988** — parts 1 and 2 shipped. Part 3 (the rollback's second
  transaction) is open **and moot until #994**, because the endpoint never
  executes.
- **#974** — the document half is done across **8** write sites, not the 5
  the issue lists. Open on the audit-row half only.
- **#986** — open and **escalated**: `enableMFAFirstLogin` is not an oracle,
  it is a second unauthenticated login path. The proposed fix is necessary
  but not sufficient.
- **#982** — open, `premise-corrected`. Its central section was stale;
  direction 1 is now essentially the whole issue.
- **#979** — open, genuinely the owner's call (ladder walked, see below).
  Its healthcheck half is split to **#992** and is fixable independently.

Query the board for everything else (`gh issue list --state open`).

## The judgment a query cannot carry

- **#994 is the most consequential thing filed this sitting.**
  `storageService` calls `this.db.getMongo()`, a **mongosh** method the
  native driver `Db` does not have. **[ran it]** `typeof db.getMongo` is
  `undefined` on a real `MongoClient.db()`. So `POST
  /api/storage/allocate/auto` throws a `TypeError` on every stack, #988's
  premise ("a raw `MongoServerError` code 20") is wrong, and `e47219c6`'s
  audit row is unreachable in production. 41 green tests coexist with it
  because `storageService.test.js`'s `makeDb()` **fabricates the method**.
- **#993: `createUser` is a Coordenador permission in the seed**, not
  admin-only — **[read it]** `rbac-catalog-seed.service.js:46`, and `rbac.js`
  has no admin bypass. That route's allowlist still carries `password` **and**
  `mfaSecret`, so one `PUT` is an account takeover. Wider than #632's
  `resetMFA` finding, which needed a role that does not exist in the seed.
- **#979's docs are genuinely silent, and that was established rather than
  assumed.** 78 doc files enumerated, ~20 Portuguese concept-terms searched,
  3 milestones read. RNF003/004/014/015/019 constrain but do not decide.
  **Do not re-run this search** — and note `docs/planning/bioavanced-v3/` has
  the richest material and is excluded by its own README.
- **Two of this sitting's own commits shipped defects, caught by a post-hoc
  adversarial review, fixed in `4df10c3b`.** #987's status fix reached three
  of four storage controllers; the `skipped` can-it-fail probe covered one of
  three literals, so the same unpinned-hunk defect shipped in the third. **A
  probe on one of N parallel sites certifies nothing about the other N−1** —
  pack #682.
- **`$` in a compose healthcheck is interpolated by Compose at parse time
  against the HOST env, not by the container shell.** **[ran it]** A single
  `$` rendered to the literal `8095` and the change accomplished nothing;
  `$$` defers it. Verified on the running container — its
  `Config.Healthcheck.Test` holds `${TSA_PORT:-8095}`, unexpanded.
- **`sed` and `grep` on this machine do not see `\r`.** **[ran it]** `grep -c
  $'\r'` returns **0** on a file `file(1)` and `cat -A` both confirm is CRLF.
  So the recorded "detect the file's own EOL" rule has no working detection
  recipe via those tools — use `file`/`cat -A`, or just use the `Edit` tool,
  which is EOL-safe. Pack #681.
- **`worker-test` and `neo4j-projection-worker-test` show no `(healthy)` in
  `docker compose ps`** — they declare no healthcheck, in any of the four
  compose files. Confirmed live this sitting. That is #992, and it is why
  `--wait` exits 0 on a dead worker.

## Filed this sitting (8)

Here: **#989 #990 #991 #992 #993 #994**. On the pack: **#681 #682**.

**Worth reading first: #994**, then **#993**.

**None of the six here was worked** — that was a choice, not a blocker, and
it is recorded as such on each. **#991** (render `metrics.skippedRecords`)
and the `mfaSecret` half of **#993** are the two cheap ones.

## Conventions this sitting relied on / established

- **Probe every site a change touched, not one representative.** Cost two
  defects here, one caught only by review.
- **A leaf worker's "this is now pinned" is a claim, not a result.** One
  reported an assertion pinned that pinned nothing (`toEqual` treats an
  explicit `undefined` and an absent key as equal). Briefs asking for a pin
  should ask for the failing count too — pack #682.
- **The two-hop consumer sweep paid again.** It surfaced
  `auth.routes.test.js`'s exact-arity `toHaveBeenCalledWith(anything(),
  's1')`, which the named file set left green and unexamined.
- **Run the premise before writing the issue body.** #981's headline claim
  was refuted this way, and the real defect underneath (#989) is larger.
- **Redirect any vitest run over ~3 files** — and note `grep FAIL` matches
  this repo's own `AUDIT_TRAIL_WRITE_FAILURE` log lines. Anchor on
  `^ *Tests ` instead.
- **The full-suite hook's sanctioned pre-handoff form** is
  `npx vitest run tests/unit tests/integration tests/compliance
  --reporter=dot`; the bare `npm run test:ci` is blocked.

## Recommended next

**None queued** — Dennis named no task beyond the ten.

The cheapest high-value work is **#994**, because it is the one finding that
makes an already-shipped fix inert, and because fixing `makeDb()` alongside it
closes a whole class of blind spot. **#993**'s `mfaSecret` half is three lines
and is security-relevant.
