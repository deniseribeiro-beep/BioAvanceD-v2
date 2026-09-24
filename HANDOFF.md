# HANDOFF

**Written 2026-09-24, fiftieth queue sitting. INTERIM: Dennis gave no end
signal, so treat the session as CONTINUING.**

The instruction was "read handoff, pick next group of issues, Docker is
on". Every bug-labelled issue left open was waiting on Dennis. So the
sitting took the previous note's recommended gap instead: the org-scope
class (#1053, #1182, #1183, #1185 to #1189) had never been through the
Docker gate. It ran the full local ship pre-flight on HEAD.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive commit
is `5b5860d7`.

## Gate results, all `[ran it]` on this tree

| Gate | Result |
|---|---|
| Backend `test:architecture` (native) | 148/148 |
| Backend vitest, `tests/unit tests/integration tests/compliance` | 476 files, 9093 tests, 0 failures |
| Frontend `typecheck:full` and root `typecheck:e2e` | clean |
| Frontend vitest (the seven `src/` dirs) | 33 files, 289 tests |
| Mocked Playwright | 11 passed, 227 skipped (the real-backend specs) |
| **Real-backend Playwright, host-side, `--workers=1`, HEAD-built images, full bootstrap chain** | **238/238 passed, 0 skipped** |
| CI's `backend-unit-runner` (`current-state:ci`), in-container | red before #1190, **green after**: arch 0 fail / 23 skip, seed OK, dictionary 929/929 v1.3.0, compliance evidence written |

The org-scope narrowings broke no e2e spec. Most specs run as the global
admin, and those narrowings don't apply to a global-scope caller.

## What shipped

- **#1190**, filed and closed this sitting, `5b5860d7`. Three arch test
  files read repo-root scripts that `backend-unit-runner`'s image lacks
  (build context `./api/backend`, `node:22-alpine`, with no bash, openssl or
  python3). As a result, CI's only job failed 9 tests and never reached the
  seed, dictionary or compliance steps. They now skip when the repo tree is
  absent, keyed on `REPO_ROOT/api/backend/package.json`, not on the script
  under test.

## Not shipped, and why

- **No PR.** The local gates are green, and a PR into `main` is Dennis's
  call.
- Still waiting on Dennis: #1184 (the recorded-site vs owning-org split)
  and #1174 (a) or (b). Unchanged: #1181, #1180, #1123. For the rest, query
  `gh issue list --state open --label bug` and `--label question`.

## Docker and the machine

The test stack is **down** (`compose down`, volumes and images kept). The
images are built from `5b5860d7`'s tree. `mongodb-test-data` holds this
sitting's e2e fixtures and the full reference-data bootstrap.

- **Bringing the reference-data chain up after the main stack recreated
  mongo, neo4j, redis, influx and audit-keygen, and killed
  `neo4j-projection-worker-test`** (`Replication is being shut down`).
  `[ran it]` Recovery was `docker restart` on backend-app-test, worker-test
  and neo4j-projection-worker-test, then checking all healthy. After that
  came the 238/238 above. After the chain, check `docker ps -a` for the
  projection worker being Up before trusting any projection spec.
- Port 8086 was **not** reserved on this boot. There was no need for
  `INFLUXDB_HOST_PORT`.

## Things a next session must not undo

Earlier notes' items still hold: scoped creates stamp and scoped updates
refuse; scoped handler unit tests pass `req.organizationScope`;
`org-scope-routes.arch.test.js` gates new routes and allowlists;
`RETIRED_KEY_EXEMPT` is line-keyed; `core.autocrlf` per-file endings.
Plus:
- **An arch test that reads a repo-root file needs the in-image skip
  guard.** `[ran it]` CI runs `test:architecture` inside
  `backend-unit-runner`, where `REPO_ROOT` is `/`. A native green does not
  show a new arch test is CI-safe. Only
  `docker compose ... run --build --rm --no-deps backend-unit-runner` does.

## Recommended next

**None queued by name.** The branch is gate-green locally. The next step
toward shipping is Dennis's go on a PR into `main`.
