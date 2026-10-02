# HANDOFF

**Written 2026-10-02, seventy-eighth queue sitting. INTERIM: the sitting ran
its end sequence (audit, suite, push, issues, clean-up), but Dennis has not
said it is over.** It stopped picking new work at about 298K context in use.

The instruction was: "read handoff. pick next group of issues and begin
resolving them. docker is on." The group picked was **#1273**, **#1268**,
**#1270** and **#1274**. It grew through **#1275** and **#1276**, both filed
and closed this sitting.

## Repo state

The branch is `feature/docker-e2e-backend-integration`, pushed. The last
code commit is `b3ee87f6`.

## What shipped (all closed with comments)

- **#1273** (`f11daba7`, labelled `premise-corrected`): the premise did not
  hold. `retentionPolicy.service.js`'s `ALLOWED_ENTITY_TYPES` has refused
  every type except `AuditEvent` and `Log` on create and update since #440.
  A test now pins this.
- **#1268** (`2432891f`): the review held.
  - A blocked source gets the lockout's exact status and body on all
    three unauthenticated password endpoints.
  - The block is fast (0.008 ms blocked, 0.023 ms locked, 63.7 ms for a
    wrong password), for #952's reason, and the reasoning is now
    written at the login gate.
- **#1270** (`0029afba`, e2e `e94af4ce`): item 2 found a gap.
  - The bypass: `processLogin`'s setup tempToken let `GET /two-factor/qr`
    plus `POST /two-factor/enable` (`enableMFA`) issue a full session past
    forceReset, an expired password or a non-active status.
  - The fix: `enableMFA` now applies enable-first-login's gates.
  - Item 1 held.
- **#1274** (`64ef2f1a`):
  - `logger.warn` prints `[SECURITY]`-prefixed lines at every
    `logging.level` (OWASP Logging Cheat Sheet, ASVS V7).
  - The #1255 and #1256 lines are now tagged `[SECURITY]`.
  - The export gate's comment now says that the per-sample scope check
    runs after it.
  - Items 2, 4 and 5 held.
- **#1275** (`302b9872`, follow-up `b3ee87f6`):
  - `getUserAnonId` looked up the stored `anonId` by a string `_id` and
    never matched. It now uses an ObjectId.
  - Because a stored `anonId` is now read, `anonId` was removed from
    `PUT /api/users/:id`'s allowlist and from `UserModel.create`'s
    inputs. Either could have relabelled one user's log rows as
    another's.
- **#1276** (by-rule security review of the above): every item held, with
  evidence on the issue.

## Test runs this sitting

| run | scope | result | commit | time |
|---|---|---|---|---|
| per-fix targeted vitest, with mutation probes (files named in each commit message) | touched files | all green; every probe failed its gap cases and passed its controls | per commit | seconds |
| timing probe of `authService.login`, scratch script, cost 10, 25 runs per case | #1268 | blocked 0.008 ms, locked 0.023 ms, wrong password 63.7 ms (medians) | `2432891f` | seconds |
| root `npm run typecheck:e2e` | full | clean | `e94af4ce` | seconds |
| backend `npm run test:architecture` | full | 162/162 | `b3ee87f6` | 45 s |
| backend `npx vitest run tests/unit tests/integration tests/compliance --maxWorkers=6`, JSON reporter, under `resources.cjs run` | full | **9523/9523** | `b3ee87f6` | 645.2 s |
| `compose build` of the 21 `api/backend`-context services and `playwright-runner`; 12-service stack up; admin bootstrap and the 17-service chain, both `--no-deps`; in-container `playwright-runner` (`run -d --name pw-gate`, `docker wait`) | full | **273 passed, 0 failed, 0 flaky** (272 + #1270's) | `b3ee87f6` | build 117.7 s, e2e 176 s |

Skipped: the frontend vitest suite and `typecheck`. The diff touched no
`frontend/` path (`git diff --stat 6cd84580 HEAD`). No case was red, so
nothing was filed as `suite-red`.

## Filed this sitting

- **#1275** and **#1276**: both closed this sitting (above).
- **DyeAllPies/dyeallpies-skills-pack#1501**, a harness finding: a
  multi-line `perl -0pi` mutation probe matched nothing on a CRLF file, so
  the test's pass looked like a probe result. It hit twice this sitting.
  In this repo, use `\r?\n` in a multi-line pattern, or the `Edit` tool, and
  check that `git diff --stat` is non-empty before trusting a probe.

## For Dennis

- Waiting on the question in each title: #1254, #1257 and #1271.
- Unchanged: #284's milestone line, #1222, #1225, #1228, #1220 step 5, the
  #941 re-close, #1218, #956, #979, whether `0d87f73b` (#1124) stands,
  Denise's `docs/` deletions and #1231, and the go for a PR into `main`.

## Docker and the machine

- **Gate:** Dennis, 2026-10-02: "docker is on." It closes at the next
  `/clear`.
- **Nothing is running.** `compose down` ran, and no containers remain.
  The named volumes and the images built from `b3ee87f6`'s sources are
  kept. The build cache was pruned (1.777 GB).
- The frontend image was not rebuilt. It is from `18f6c13e`'s sources, and
  `frontend/` has not changed since then.

## Things a next session must not undo

Earlier notes' items still hold. Plus:

- **`anonId` is never an input.** Log reads now honour the stored value,
  so only `generateAnonId` may write it (`createFirstAdmin`,
  `migrateUserAnonIds`).
- **`enableMFA` gates a first login like `enableMFAFirstLogin`.** The setup
  tempToken reaches both enable routes.
- **The `[SECURITY]` prefix is a logging contract.** A warning that starts
  with it prints at every level, so never let request text lead a warning.

## Standing context: re-measure, don't copy

- Denise's newest live branch, 2026-10-02: `stabilize/v2.0.0-prototype`,
  last commit 2026-09-26
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-10-02: 936 commits on hers only and 268 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`),
  measured before this rotation's commit.
- Her tip's CI, runs of 2026-09-26 14:05 (none newer): release manifest
  integrity, Full Vitest diagnostic, Coverage diagnostic and current-state
  validation all passed (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).
- Her `docs/stabilization/AXIS_E_DECISION_LOG.md` is still read only for
  MFA and password rows.

## Recommended next

None queued by Dennis. The workable unblocked issues in the open list are
older (`gh issue list --state open`), for example #1263 (e2e coverage of the
source-address blocks) and #1229. #1271, #1254 and #1257 wait on Dennis's
answer to the question in each title.
