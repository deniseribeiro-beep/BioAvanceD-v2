# HANDOFF

**Written 2026-10-01, seventy-sixth queue sitting. INTERIM: the sitting ran
its end sequence (audit, suite, push, issues, clean-up), but Dennis has not
said it is over.** It stopped picking new work at about 310K context in use.

The instruction was: "Read handoff. Docker is on. There might be leftover
processes from other sessions. Pick next group of issues to resolve and
begin. No parallel sessions." The group picked was **#1255**, **#1256**,
**#1258** and **#1248**.

## Repo state

The branch is `feature/docker-e2e-backend-integration`, pushed. The last
code commit is `0aeaf6ed`.

## What shipped (all closed with comments)

- **#1255** and **#1256** (`9c381b66`):
  - `api/backend/src/services/ipAttempt.service.js` is a new store, collection
    `login_ip_attempts`. It keeps HMACs of the source address and of the
    typed account identifiers, with a TTL index.
  - `blockIPAfterAttempts` blocks a source for `lockoutDurationMinutes`. It is
    read only while `trackIP` is on, and 0 means track without blocking.
  - `blockUnusualActivity` is now defined: one source failing against at
    least `maxLoginAttempts` distinct accounts. It is read only while
    `enhancedSecurity.enabled` is on.
  - Login and both first-login endpoints ask the gate first and count every
    failure kind.
  - e2e housekeeping: `global-setup` clears the store, and the #650
    brute-force spec clears its own failures.
- **#1258** (`fbcf5e06`): the review found a real gap.
  `enable-first-login` gave a session to an inactive, suspended or blocked
  account that had not enrolled MFA, and skipped #1251's password expiry.
  Now `assertAccountActive()` runs at all three password sites, and an
  expired password withholds the session. The other items hold, with
  evidence in the close comment.
- **#1259**, filed and fixed this sitting (`d315e4a0`): the retention sweep
  deleted `logs` rows under every `postRetentionAction`. Now `archive` moves
  them to `logs_archive`, and `review`/`anonymize` remove nothing.
- **#1248** (`0aeaf6ed`, labelled `premise-corrected`):
  - `logging.retentionDays`, `privacy.autoPurge` and `privacy.purgeAfterDays`
    are derived from the active RetentionPolicy, read-only on the page, and
    a write to them is dropped.
  - Only these three keys duplicated a policy. The unread rest were split
    into #1260 (logging), #1261 (privacy) and #1262 (lgpd).

## Test runs this sitting

| run | scope | result | commit | time |
|---|---|---|---|---|
| per-fix targeted vitest and pin probes with `src/` stashed (files named in each commit message) | touched files | all green; every pin probe failed its gap cases, and the controls passed | per commit | seconds |
| throwaway `mongo:7` probe of `ipAttempt.service` | store semantics | 10th failure blocks, 5th distinct account blocks, no address stored, stale window resets, TTL index built | `9c381b66` sources | ~30 s |
| backend vitest `tests/unit tests/integration tests/compliance --maxWorkers=4`, JSON reporter | full | **9470/9471, 1 red, filed as #1265** | `0aeaf6ed` | 624 s (date stamps) |
| frontend `npx vitest run src/components src/config src/contexts src/foundation src/hooks src/pages src/utils src/views` | full | 40 files, 349/349 | `0aeaf6ed` | 20 s |
| backend `node --test "tests/architecture/**/*.arch.test.js"` | full | 162/162 | `0aeaf6ed` | 41 s |
| frontend `typecheck`, root `typecheck:e2e` | full | clean | `0aeaf6ed` | 13 s |
| `compose build` of backend, frontend, worker and runner; stack up; admin bootstrap and the 17-service chain, both `--no-deps`; in-container `playwright-runner` (detached, `docker wait`) | full | **268 passed, 1 flaky, 0 failed** (269 = 267 + 2 new specs) | `0aeaf6ed` | build 55 s, up 49 s, e2e 185 s |

No suite was skipped, because the diff touched backend, frontend and e2e.
The flaky case is `specimen-quality-inventory.spec.ts:1458`. Its fixture's
sample create got a 202 from #1225's lineage consent gate, and that is
commented on #1225.

## Filed this sitting, carried open

- **#1265 (`suite-red`), take it first.** `tests/unit/controllers/auth.controller.test.js`
  pins `setupMFAFirstLogin`'s old two-argument call. The fix is in the issue:
  the expectation becomes the three-argument call, with `req`.
- **#1263**: e2e cannot exercise the live IP block or the unusual-activity
  block, because the test stack gives every spec one source address
  (`TRUST_PROXY=0`).
- **#1264**: a security review of this sitting's surfaces, filed by rule.
  Item 2 (one shared NAT address locks everyone out) is the one most likely
  to need a change.
- **#1260**, **#1261**, **#1262**: the unread `logging`, `privacy` and
  `lgpd` keys. Each needs its surface found, then the key wired or shown
  read-only.
- Two workflow findings are tracked outside this repo.

## For Dennis

- Still waiting on the question in each title: #1254 and #1257.
- Unchanged: #284's milestone line, #1222, #1225, #1228, #1220 step 5, the
  #941 re-close, #1218, #956, #979, whether `0d87f73b` (#1124) stands,
  Denise's `docs/` deletions and #1231, and the go for a PR into `main`.

## Docker and the machine

- **Gate:** Dennis, 2026-10-01: "Docker is on." It closes at the next `/clear`.
- **Nothing is running.** `compose down` ran, and no containers remain. The
  named volumes and the images built from `0aeaf6ed`'s sources are kept.
  The build cache was pruned (2.204 GB).
- The one leftover process found at the start was a Playwright
  `test-server` (the IDE extension), left alone.

## Things a next session must not undo

Earlier notes' items still hold. Plus:

- **The source-address store keys on `req.ip` and stores only HMACs.**
  Never read `X-Forwarded-For` by hand. A successful login does not clear
  a source's count.
- **Every first-login password site calls `assertAccountActive()` after the
  password check**, never before it.
- **The three retention keys are derived, not stored inputs.**
  `updateConfig` drops writes to them.
- **The e2e store clears** (global-setup, and the #650 and #1255 specs) keep
  the suite's deliberate failures under `blockIPAfterAttempts`.

## Standing context: re-measure, don't copy

- Denise's newest live branch, 2026-10-01: `stabilize/v2.0.0-prototype`,
  last commit 2026-09-26
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-10-01: 936 commits on hers only and 250 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`),
  measured before this rotation's commit.
- Her tip's CI, runs of 2026-09-26 14:05 (none newer): release manifest
  integrity, Full Vitest diagnostic, Coverage diagnostic and current-state
  validation all passed (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).
- Her `docs/stabilization/AXIS_E_DECISION_LOG.md` is still read only for
  MFA and password rows.

## Recommended next

None queued by Dennis. **#1265 comes first** (`suite-red`). After it, the
workable ones are #1263, #1264, #1260, #1261 and #1262. #1254 and #1257
wait on Dennis's answer to the question in each title.
