# HANDOFF

**Written 2026-10-01, seventy-fifth queue sitting. INTERIM: the sitting ran
its end sequence (audit, suite, push, issues, clean-up), but Dennis has not
said it is over.** It stopped picking new work at about 300K context in use.

The instruction was: "Read handoff. Pick next group of issues to resolve and
begin. Docker is on." The group picked was **#1252**, **#1249**, **#1247**
and **#1253**.

## Repo state

The branch is `feature/docker-e2e-backend-integration`, pushed. The last
code commit is `bf76bc22`.

## What shipped (all closed with comments)

- **#1252** (`0e0c26f7`): LoginPage carries the accepted TOTP into the
  password-change submit, so an enrolled user types one code.
- **#1249** (`761ad4e1`): these keys now act. All default to true, so
  nothing changes until an administrator turns one off.
  - `allowPasswordReset`: 403 `PASSWORD_RESET_DISABLED`. The login link and
    the security page's reset button hide.
  - `requireStrongPassword`: the master switch over the composition flags.
  - `autoRenewal`: `/refresh` refuses and the session ends as an expiry.
  - `logExpiration`: an expiry writes a Session audit row, which reverses
    #1020's skip per dict-02 P1X-0296.
  - `mfaMethod` is constrained to TOTP. `loginAttempts`' duplicate pair
    follows the enforced `authentication` pair.
  - Also fixed: `registerUser` now checks strength against the stored
    policy, a writer #1246 missed.
- **#1247** (`739cb5a5`): `enhancedSecurity` acts only while `enabled`
  (default `false`).
  - `requireMFAForAll` enrols every unenrolled user, Administrador and
    returning accounts included.
  - `sessionTimeoutMinutes` replaces the ordinary timeout.
  - `strictPasswordPolicy` holds the composition flags on.
- **#1253** (`bf76bc22`), the review:
  - The current password always counts as reuse, even with
    `preventReuse: false`. This closed a hole where a "change" to the same
    password cleared `forceReset`.
  - The `minLength` floor is 8 (NIST SP 800-63B).
  - `GET /api/auth/password-policy` is exempt from `authLimiter`
    (`authLimiterSkip.js`).
  - Items 2 and 3 needed no change, with the reasoning in the code.

## Test runs this sitting

| run | scope | result | commit | time |
|---|---|---|---|---|
| per-fix targeted vitest and pin probes with `src/` stashed (files named in each commit message) | touched files | all green; every pin probe failed the new cases, and the controls passed | per commit | seconds |
| backend session/auth/security/password set (29 files) | targeted | 813/813 | `761ad4e1` sources | ~60 s |
| backend vitest `tests/unit tests/integration tests/compliance --maxWorkers=4`, JSON reporter | full | 9423/9423, 0 skipped | `bf76bc22` | ~620 s (date stamps) |
| frontend `npx vitest run src/components src/config src/contexts src/foundation src/hooks src/pages src/utils src/views` | full | 40 files, 349/349 | `bf76bc22` | 18 s |
| backend `node --test "tests/architecture/**/*.arch.test.js"` | full | 162/162 | `bf76bc22` | 42 s |
| frontend `typecheck`, root `typecheck:e2e` | full | clean | `bf76bc22` | under 1 min |
| `compose build` of backend, frontend, worker and runner; stack up; admin bootstrap and the 17-service chain, both `--no-deps`; in-container `playwright-runner` | full | **267/267**, 0 failed, 0 flaky | `bf76bc22` | build 61 s, up 52 s, e2e 175 s |

No suite was skipped, because the diff touched backend, frontend and e2e.
Times come from `date` stamps, not the `resources.cjs` wrapper, whose
junction guard misfires (tracked outside this repo).

## Filed this sitting, carried open

- **#1254**, a question for Dennis: should `allowMultipleSessions` default to
  true before it is wired? Recommended: yes. Wiring the stored `false` makes
  every deployment single-session.
- **#1255**: `trackIP`/`blockIPAfterAttempts` need an IP-attempt store. The
  Security page also shows both keys twice.
- **#1256**: `blockUnusualActivity` has no definition, detector or block.
- **#1257**, a question for Dennis: should the password defaults move to
  NIST SP 800-63B-4? That means 15 characters without MFA, no composition
  rules and no periodic expiry. Recommended: yes, for new deployments only.
- **#1258**: a security review of this sitting's surfaces, filed by rule.
  Item 3 (no refresh loop) is already settled in a comment.
- Three workflow findings are tracked outside this repo.

Still open from earlier: #1248 (the `logging`/`privacy`/`lgpd` duplicates)
and #1011's thread, now superseded by #1247 for config-driven Admin MFA.

## For Dennis

- New: #1254 and #1257, both titled as questions with a recommended option.
- Unchanged: #284's milestone line, #1222, #1225, #1228, #1220 step 5, the
  #941 re-close, #1218, #956, #979, whether `0d87f73b` (#1124) stands,
  Denise's `docs/` deletions and #1231, and the go for a PR into `main`.
- #1251's deployment effect still stands. #1257 asks whether the 90-day
  default should go entirely.

## Docker and the machine

- **Gate:** Dennis, 2026-10-01: "Docker is on." It closes at the next `/clear`.
- **Nothing is running.** `compose down` ran, and no containers remain. The
  named volumes and the images built from `bf76bc22`'s sources are kept.
  The build cache was pruned (2.985 GB).

## Things a next session must not undo

Earlier notes' items still hold. Plus:

- **`validateReuse` always refuses the current password.** `preventReuse`
  governs only the history (#1253).
- **The `enhancedSecurity` keys are read only while `enabled === true`**
  (#1247, #1011's "via config").
- **`authLimiter` skips exactly `GET /password-policy`.** Any other public
  `/api/auth` route stays inside the brute-force budget.
- **`minLength` floor 8** in `validateConfig` and `strengthMinLength`.

## Standing context: re-measure, don't copy

- Denise's newest live branch, 2026-10-01: `stabilize/v2.0.0-prototype`,
  last commit 2026-09-26
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-10-01: 936 commits on hers only and 245 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`),
  measured before this rotation's commit.
- Her tip's CI, runs of 2026-09-26 14:05 (none newer): release manifest
  integrity, Full Vitest diagnostic, Coverage diagnostic and current-state
  validation all passed (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).
- Her `docs/stabilization/AXIS_E_DECISION_LOG.md` is still read only for
  MFA and password rows.

## Recommended next

None queued by Dennis. No `suite-red` issue is open. Of this sitting's
filings, #1255, #1256 and #1258 are workable, and so is #1248. #1254 and
#1257 wait on Dennis's answer to the question in each title.
