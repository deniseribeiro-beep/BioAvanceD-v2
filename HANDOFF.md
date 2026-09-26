# HANDOFF

**Written 2026-09-26, seventy-first queue sitting. INTERIM: the sitting may
continue. It has not been told it is over.**

The instruction was "Read handoff. Pick next group of issues to resolve.
Docker is off, turn it on if needed." The group picked was the e2e
harness defects: **#1233** (in-container runner), then **#1222**, **#1234** and
**#1227** measured through it. Three product bugs the runner surfaced were
filed and fixed on the way (#1235, #1236, #1237).

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive
commit is `2fa62825`.

## What shipped (all closed with comments)

- **#1233** (`8c007f8d`, `36bbdfd5`): `playwright-runner` works.
  - `tests/e2e/docker/loopback-forward.cjs` forwards the container's
    `localhost:5173`/`:3000` to the compose services. The image CMD runs it
    in front of `npx playwright test`, so the in-container topology equals
    the host's.
  - Full suite in-container: **255 passed, 1 flaky, 0 failed, 0 skipped.**
  - Status posted on #284. Milestone #3's "Known starting gaps" line still
    calls the runner misconfigured. It is left for Dennis to edit.
- **#1235** (`8b51cb47`): daily-merkle's `runOnce` closed the worker's
  shared Mongo client every night. After that, every worker job failed
  while the container stayed healthy.
- **#1236** (`22e3af2c`): `audit_roots`' unique **sparse** `timestamp.token`
  index indexed explicit nulls. Only one unanchored root could ever exist.
  It is now a partial index on string tokens, and a drop-and-recreate
  migrates old stacks. Verified live.
- **#1237** (`2fa62825`): seven `auditLogger.log` callers passed severity
  `high`/`medium`. Withdrawals, returns, file replacements and exports wrote
  no audit row. A new architecture test guards the vocabulary.
- `1ed3ac34`: `seedActiveConsentTemplate` upserts one shared fixture. It
  used to insert per call, and the kept volume held 1314 active templates.

## Touched, left open (each issue's last comment has the detail)

- **#1222:** now labelled `premise-corrected`. It is a **Chromium engine
  stall, not Windows-only.**
  - Linux Chromium: 15 hangs in 1920 tests (both headless builds).
  - Firefox: 0 in 600.
  - Open because the fix is upstream. The next step is a minimal repro.
  - `[read it]` CI's `retries: 2` absorbs it.
- **#1234:** two in-container requests got no response for 30 s. Both passed
  on retry. Cause `[not established]`. The comment names the instrument
  (upstream connect latency logged in the forwarder).
- **#1227:** no recurrence. It stands at 1 in 7 full runs.

## Filed elsewhere

- **dyeallpies-skills-pack#1227:** a long `compose run --rm` lost its log
  when the Windows client's attach dropped. The durable pattern is
  `run -d --name` + `docker wait` + `docker logs` + `rm`. It needs a pack
  session (Rule 0).

## For Dennis

New:
- Milestone #3's stale runner line (see #284).
- Whether #1222 merits an upstream Chromium/Playwright report.

Unchanged from the previous note: #1225's option call, #1228's default,
#1220's step 5, the #941 re-close, #1218, #956, #979, whether `0d87f73b`
(#1124) stands, whether to mirror Denise's `docs/` deletions, #1231, and
the go for a PR into `main`.

## Docker and the machine

- **Gate:** Dennis, 2026-09-26: "Docker is off, turn it on if needed." It
  closes at the next `/clear`. It was used this sitting.
- **Nothing is running.** The `bioavanced-test` stack was torn down with
  `compose down`, and its 6 volumes were kept.
  - Images: `backend-app-test` is built from `2fa62825`, both workers from
    `22e3af2c`, and `playwright-runner` from `1ed3ac34`. No `src` has changed
    since, so the next bring-up needs no `--build`.
  - The kept volume has fixture accumulation, including 1924 old consent
    templates.
- `docker compose ... up -d` auto-starts `playwright-runner`, which **now
  runs the full suite for real**. Stop it before any host-side run.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **The runner's base URLs are `localhost`, on purpose.** The forwarder
  makes that resolve in-container. Do not point them at compose hostnames:
  the e-consent specs assert origin equality.
- **Never close the shared Mongo client from a job or a service method**
  that got it from `connectDB()`. The process owns it (#1235).
- **Don't paper over #1222 with a fixed wait before the first fill.**
- **On this branch a `Closes #N` commit does not close the issue.** Comment,
  then `gh issue close`.

## Standing context: re-measure, don't copy

- **Project phase (Dennis, 2026-09-25):** work down the issues the e2e plan
  surfaced (Wave 3 tracker #646). CI comes only after they are all resolved
  and the whole plan passes on Docker.
- Denise's newest live branch, 2026-09-26: `stabilize/v2.0.0-prototype`,
  last commit 2026-09-25
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-09-26: 928 commits on hers only, 218 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`),
  measured before this rotation's commit.
- Her tip's CI, runs of 2026-09-24 23:29 (none newer): current-state
  validation, Full Vitest diagnostic and Coverage diagnostic passed. Release
  manifest integrity failed
  (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).
- Her `docs/stabilization/AXIS_E_DECISION_LOG.md` is on her pushed branch
  (`git ls-tree -r --name-only origin/stabilize/v2.0.0-prototype docs/stabilization`).
  It is still unread against the issue comments.

## Recommended next

None queued by Dennis.
