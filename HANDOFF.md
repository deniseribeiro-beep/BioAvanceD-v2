# HANDOFF

**Written 2026-10-02, seventy-ninth queue sitting. INTERIM: the sitting ran
its end sequence (audit, suite, push, issues, clean-up), but Dennis has not
said it is over.**

The instruction was: "pick next group of issues to resolve and begin". The
group picked was **#1263**, **#1227** and **#1234**, which share the e2e
stack, then **#909**. #1229 was checked and stays deferred: Denise's Axis E
log still reads "Verb split (dir 2) deferred", and her branch has nothing
newer than 2026-09-26.

## Repo state

The branch is `feature/docker-e2e-backend-integration`, pushed. The last
code commit is `25daab7f`.

## What shipped

- **#1263, closed** (`2e52b32b`, `25daab7f`): a spec now gets its own
  source address.
  - `trusted-hop-test` runs the loopback forwarder inside
    `backend-app-test`'s network namespace. `backend-app-test` runs with
    `TRUST_PROXY: loopback`, so `X-Forwarded-For` is honoured from the hop
    only. The hop's host port is bound to `127.0.0.1`.
  - Two tests in `auth-access-security.spec.ts` drive the source-address
    block and the unusual-activity block live.
- **#1278, filed and closed:** the security review of that trust change.
  Every question held, including a negative control: with `TRUST_PROXY=true`,
  the spoof step fails.
- **#909, closed** (`7680860f`): item 2. `validateConfig` now checks every
  key of the eight groups against `getDefaultConfig()`'s keys and types.
  An unchanged echo of the stored value passes. Item 1 is split into
  **#1277**.
- **#1227, open** (`d2ed1960`): instrumented. The seed client gives up
  after 10 s, and `cleanupStorageBoxLocation` logs `[e2e-cleanup]` with the
  stalled step. It still needs a recurrence; the count is 1 in 8 full runs.
- **#1234, open** (`2e52b32b`): instrumented. The forwarder logs connects
  still pending at 1 s, upstream errors, and a summary at exit. First
  reading: 493 connections, max 101 ms, 0 slow, 0 errors. It still needs a
  recurrence.

## Test runs this sitting

| run | scope | result | commit | time |
|---|---|---|---|---|
| `npm run typecheck:e2e` (root) | full | clean | `2e52b32b` | seconds |
| forwarder probe, scratch script | `loopback-forward.cjs` | hop, refused, pending and command-mode rows as expected | `2e52b32b` | ~5 s |
| `tsx` probe of `cleanupStorageBoxLocation` against a closed port | #1227 | rejected at 10,018 ms, logged `failed at connect` | `d2ed1960` | 10 s |
| vitest, every file naming `security.service` | 10 files | 319/319; mutation probes failed 7 and 2 | `7680860f` | seconds |
| compose build, 21 `api/backend`-context services and `playwright-runner` | full | built | `25daab7f` | 90 s |
| in-container targeted run, `auth-access-security.spec.ts -g "#1263\|#1255"` | #1263 | 3 passed; the trust-all control failed as designed | `25daab7f` | ~6 s |
| in-container full e2e (`playwright-runner`, `run -d --name pw-gate`, `docker wait`) | full | **274 passed, 1 failed** (#1279) | `25daab7f` | 212 s |
| backend `npm run test:architecture` | full | 162/162 | `25daab7f` | <1 min |
| backend `npx vitest run tests/unit tests/integration tests/compliance --maxWorkers=5`, JSON reporter, under `resources.cjs run` | full | **9538/9538** | `25daab7f` | 631.5 s |

Skipped: the frontend vitest suite and `typecheck`. The diff touched no
`frontend/` path (`git diff --stat 6ef692c1 HEAD`, 9 files).

## Filed this sitting

- **#1279** (`suite-red`): the organizations create+list spec cannot find
  its own fixture. `GET /api/organizations` caps at 100 rows sorted by name,
  the volume holds 116 organizations, and the fixtures are never deleted.
  `[ran it]` The remedy is on the issue. **The next group takes it first.**
- **#1277**: #909 item 1, `updatePatient`'s field-type map.
- **#1278**: filed and closed this sitting (above).

## Touched, not closed

- **#1227** and **#1234**: open, each waiting on a recurrence. Their
  comments say what to grep.
- **#1229**: deferred by Denise's Axis E decision (above). Its revisit
  triggers have not fired.

## For Dennis

- Waiting on the question in each title: #1254, #1257 and #1271.
- Unchanged: #284's milestone line, #1222, #1225, #1228, #1220 step 5, the
  #941 re-close, #1218, #956, #979, whether `0d87f73b` (#1124) stands,
  Denise's `docs/` deletions and #1231, and the go for a PR into `main`.

## Docker and the machine

- **Nothing is running.** The engine was off at the start, and this sitting
  started it. Then `compose down` ran, the build cache was pruned
  (1.777 GB), `docker desktop stop` ran, and `wsl --shutdown`. The named
  volumes and the images built from `25daab7f`'s sources are kept. The
  frontend image is from `18f6c13e`'s sources, unchanged since.
- **The test stack's bring-up now names `trusted-hop-test`** in its first
  `up`, beside the twelve services. `playwright-runner` waits on its health.

## Things a next session must not undo

Earlier notes' items still hold. Plus:

- **`TRUST_PROXY: loopback` belongs to `compose.test.yml` only.** The hop
  lets its caller choose `req.ip`. Production and the example env files stay
  at `0`, and the hop's host port stays on `127.0.0.1`.
- **`validateConfig` refuses unknown keys and wrong types inside the eight
  groups, but passes an unchanged echo.** `SecurityPage` sends the whole
  document back on every save, so dropping the echo rule would refuse saves.

## Standing context: re-measure, don't copy

- Denise's newest live branch, 2026-10-02: `stabilize/v2.0.0-prototype`,
  last commit 2026-09-26
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-10-02: 936 commits on hers only and 273 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`),
  measured before this rotation's commit.
- Her tip's CI, runs of 2026-09-26 14:05 (none newer): release manifest
  integrity, Full Vitest diagnostic, Coverage diagnostic and current-state
  validation all passed (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).
- Her `docs/stabilization/AXIS_E_DECISION_LOG.md` is still read only for
  MFA and password rows, and for #1229's verb-split row.

## Recommended next

None queued by Dennis. #1279 comes first (`gh issue list --label
suite-red`). #1277 is the workable follow-on to this sitting's #909 work.
