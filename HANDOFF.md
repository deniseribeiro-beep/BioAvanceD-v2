# HANDOFF

**Written 2026-09-02, fourth 10-issue queue sitting of the day.** Dennis asked
for "the next 10 issues, Docker is on." **All 10 resolved, 12 commits pushed,
11 issues filed (9 here + 2 on the pack) — and `compose.prod.yml` came up
clean from tracked files for the first time: 10/10 services, `backend` and
`frontend` both healthy.**

The session was not declared over by the user. Re-derive every count rather
than trusting it.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, clean and matching origin.
  `main` untouched, no PR.
- Last substantive commit: `d972eac0` (#965's prod bring-up).
- **New npm scripts:** `compose:prod:{config,up,down,logs,ps,seed-admin}`.
  `compose:prod:down` deliberately omits `--volumes`, unlike `compose:down`.
- **Deleted npm scripts:** 14 dead entries (#964), `test:arch` (#968),
  `api/backend`'s `typecheck` and `frontend`'s `lint` (#960 — both were
  aliases that re-ran their neighbour's command).
- **New env keys:** `.env.production.example` went 29 → 57 keys (#965, #972).
- No new dependencies.

## Docker state — nothing is running

**Both stacks were torn down at session end. `docker ps -a` is empty, build
cache is 0B.**

- `compose.test.yml` — was inherited from the prior sitting, up 2 hours and
  bootstrapped there. **Stopped WITHOUT `--volumes`**: the five
  `bioavanced-test-*` named volumes survive, so the admin + 17-service
  reference-data chain does **not** need re-running — `compose:test` up and
  the bootstrap is already there. Its images are also kept.
  It was stopped rather than left up because its `backend` image predates
  this sitting's commits, so it was **running stale code** — notably without
  #972's `USER_ANON_SALT` boot requirement, which means the running container
  would not start under current code. Leaving it up was a trap, not a
  convenience.
- `bioavanced-prodverify` — the `compose.prod.yml` verification stack.
  **Fully removed**, `down --volumes`, and its six built images deleted.
  Ephemeral by design.
- `.env.production` **is kept** at the repo root, gitignored, holding real
  generated secrets. Its volumes are gone, but the file is what makes
  `npm run compose:prod:up` work again without regenerating anything — and
  regenerating is not currently possible from a tracked script (#978).

## Verification state

| Gate | Result |
|---|---|
| `npm run test:architecture` | 120 / 120 (was 116; +4 from #967's new guard) |
| `npm run lint` | 466 backend files, clean |
| targeted consumer sweeps, per issue | all green — largest 532 across 19 files |
| **`compose.prod.yml` bring-up** | **10/10 services, backend+frontend healthy** |

**No full native suite and no e2e run this sitting.** The pre-handoff
regression form is `npx vitest run tests/unit tests/integration
tests/compliance --reporter=dot` from `api/backend`.

## What closed (10 + 4 filed-and-closed)

`#942` `#948` `#960` `#963` `#964` `#965` `#884` `#941`(partial) `#956`(partial)
`#967`(partial) — plus `#968` `#969` `#972` `#973`, filed and closed here.

Query the board for the rest (`gh issue list --state open`); what a query
cannot carry is below.

## The judgment a query cannot carry

- **`compose.prod.yml` works now.** The last blocker was found only by
  running it: `redis` had **no password** while `validateEnv.js:44` requires
  one outside development — **fatal in `worker`** (`import-worker.js:39` →
  `worker.js:44`, uncaught → crashloop) and **merely logged in `backend`**
  (`queue.js:28` catches). Fixed with `--requirepass`. **The asymmetry is
  unfixed and filed as #977** — it will do the same to the next validator.
- **`docker compose up --wait` exited 0 with a service crashlooping.**
  `--wait` only waits on services that declare a healthcheck. **Always read
  `docker compose ps` after a bring-up; the exit code is not the gate.**
- **`mount` with no args prints NOTHING in alpine** — an empty result reads
  as "not mounted". Use `/proc/mounts` or `df`. Both are on pack #664.
- **Three issue premises inverted, all `[ran it]`:**
  - **#942 does not reproduce.** The import loops `await` each insert, so
    intra-file duplicates *are* caught — correctness is a consequence of
    loop ordering, not design. Recorded in the code at all three sites. The
    real hole is cross-**job** (`WORKER_CONCURRENCY` defaults to 2, set
    nowhere) → **#971**.
  - **#960's premise was half wrong**, and worse: the backend was in the
    *same* position, mirrored. CI ran **two** checks twice, not one.
  - **#973 was my own issue from earlier this sitting.** I claimed 17 terms
    were enforced by nothing; they are enforced in
    `filter-keys.arch.test.js:162-180` as `RETIRED_FILTER_KEYS`.
- **#884 was decided, not deferred**: 422 repo-wide for model-validation
  failures, **status only**. Bodies deliberately untouched — 9 of 13 return
  `message: <string>` where the 422 family returns `details: <array>`, and
  changing that is a real contract break. Remainder → **#975**.
- **#969 blocked #942 and nobody knew.** `duplicatesFound` had written a
  constant `0` since #931 — both importers incremented `results.duplicates`
  and omitted it from their return literal.
- **#963 nearly shipped a silent no-op.** `invalidateUserSessions` was the
  only one of five session helpers not coercing its id with `String()`;
  passing an `ObjectId` matches nothing, throws nothing, returns 200.

## Filed this sitting (11)

Here: **#968 #969 #970 #971 #972 #973 #974 #975 #976 #977 #978**
(#968/#969/#972/#973 already closed). On the pack: **#661 #662 #663 #664**.

**Security-relevant, worth reading first: #972** (fixed) — `generateAnonId`
fell back to a salt literal committed to this repo, making pseudonyms
reversible. Now fails closed and is required at boot.

## Conventions this sitting relied on / established

- **Run the premise. It paid on three of ten, and all three were
  inversions** — including one of my own issues, three hours old.
- **`git checkout --` destroys an uncommitted fix you are probing.** The
  can-it-fail probe (revert → confirm red → restore) has no safe-restore
  idiom in the pack; `checkout` restores from HEAD, not from your edit.
  **Commit first, then probe.** Pack #663.
- **Deleting the last entry of a JSON block leaves a dangling comma.**
  Follow every `sed`-based npm-script delete with `node -e "JSON.parse(...)"`.
- **The two-hop consumer sweep paid repeatedly** — it is how the 8-model
  index deletion got 23 files / 506 tests instead of the 7 the worker ran.
- **Name test files explicitly and count what the runner reports.** Vitest
  treats arguments as filters: 5 named, 3 ran, exit 0, silently.
- **A research brief must say the agent MAY read the tracker.** 4 of 4
  briefs wrote "do not run any gh command" and had to be corrected. Pack
  #656 has the tally and the wording that works.

## Recommended next

**None queued** — Dennis named no task beyond the 10.

If the session continues, the unworked issues this sitting filed are
**#970 #971 #974 #975 #976 #977 #978**, and the cheapest with real value is
**#977** (the validator asymmetry — one sentence at each of two call sites,
plus deciding which posture is right) or **#971**'s direction 1
(`WORKER_CONCURRENCY=1`, a one-line config with a throughput trade).
