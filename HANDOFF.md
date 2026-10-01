# HANDOFF

**Written 2026-10-01, seventy-fourth queue sitting. INTERIM: the sitting ran
its end sequence (audit, suite, push, issues, clean-up), but Dennis has not
said it is over.** It stopped picking new work at about 340K context in use.

The instruction was: "Read handoff. Pick next group of issues to resolve and
begin. Docker is on." The group picked was **#1244**, **#914** and
**#1245**. #914 was split, and the sitting worked its own filings
**#1246**, **#1250** and **#1251**.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive
commit is `bf7b760a` (a docs line); the last code commit is `aee23f31`.

## What shipped (all closed with comments)

- **#1244** (`9b7b418b`): the reuse depth is `passwordRules.maxReuseHistory`
  and `preventReuse`, at all six password writers. The sixth, the emailed
  token reset, had no reuse check at all.
- **#1245** (`83a06594`): the review is done.
  - Item 1, an admin target for set-password, is kept on Denise's Axis E
    row 686.
  - Item 4: a promotion sent as `accessType: '4'` now clears MFA.
- **#1250** (`f62fa929`): `enableMFAFirstLogin` issued a session on an
  administrator-set password, bypassing `forceReset`. Now no token is issued
  until the password is replaced. `resetPassword` and `updatePassword` clear
  the flag.
- **#1246** (`f065c6d7`): one strength check driven by `passwordRules`.
  - The 12-character `utils/passwordValidator.js` is deleted.
  - The public `GET /api/auth/password-policy` route feeds the three
    password forms.
- **#1251** (`aee23f31`): `expirationDays` is enforced at login, as a forced
  change after MFA. All writers use the canonical `passwordChangedAt`, and an
  undatable account is never expired.
- **#914** was split, not built. It closed as `completed` with
  remainders #1246 to #1249.

## Test runs this sitting

| run | scope | result | commit | time |
|---|---|---|---|---|
| per-fix targeted vitest (named files in each commit message) and pin probes with `src/` stashed | touched files | all green; each pin probe failed the new cases | per commit | seconds |
| frontend `typecheck`, root `typecheck:e2e` | full | clean | `aee23f31` sources | under 1 min |
| backend vitest `tests/unit tests/integration tests/compliance`, `--maxWorkers=4`, JSON reporter | full | 9396/9396, 0 skipped | `bf7b760a` | 665 s |
| frontend vitest over the eight `src/` dirs from `git ls-files` | full | 39 files, 344/344 | `bf7b760a` | 44 s |
| backend `node --test "tests/architecture/**/*.arch.test.js"` | full | 162/162 | `bf7b760a` | 48 s |
| `compose build` of backend, frontend and runner; stack, admin bootstrap and 17-service chain, all `--no-deps`; full in-container `playwright-runner` | full | **264/264**, 0 skipped, 0 flaky | `bf7b760a` | build 61 s, e2e 155 s |

No suite was skipped, because the diff touched backend, frontend and e2e.
The e2e ran without the `resources.cjs` wrapper, because the junction guard
misfired on it (pack#1480), so its time is from `date` stamps.

## Filed this sitting, carried open

- **#1247**: the `enhancedSecurity` group. It recommends gating
  `requireMFAForAll` on `enhancedSecurity.enabled`, which is `false` by
  default, so wiring it flips nothing. #1011's revisit trigger has fired.
- **#1248**: the `logging`, `privacy` and `lgpd` keys duplicate
  RetentionPolicy and ConsentPolicy. Removing them is a model change, so
  walk the docs rung first.
- **#1249**: the other unread keys. `allowMultipleSessions: false` states
  the opposite of the system's behaviour.
- **#1252**: LoginPage drops the accepted TOTP when a password change is
  required, so an enrolled user types a second code. It is a one-line fix in
  `LoginPage.tsx`, but it needs a UI e2e case with an MFA-enrolled fixture.
  `[not established]` in a browser.
- **#1253**: a security review of this sitting's surfaces, filed by rule.
- Two pack-side findings are tracked outside this repo.

None of these was started; the context budget ended the sitting.

## For Dennis

Unchanged from the previous note:

- Milestone #3's stale runner line (#284).
- Whether #1222 merits an upstream report.
- #1225's option call, #1228's default, #1220's step 5, the #941 re-close,
  #1218, #956 and #979.
- Whether `0d87f73b` (#1124) stands.
- Whether to mirror Denise's `docs/` deletions, and #1231.
- The go for a PR into `main`.

New:

- #1251's deployment effect. Every existing account older than 90 days with
  no recorded change is asked for a new password at its next login. That is
  the policy's intent, and is #1253 item 2.

## Docker and the machine

- **Gate:** Dennis, 2026-10-01: "Docker is on." It closes at the next `/clear`.
- **Nothing is running.** `compose down` ran. The named volumes (Mongo's
  created 2026-09-30) and the images built from `bf7b760a`'s sources are
  kept. The build cache was pruned (434.6 MB). `clean-up` ran by hand, not
  through its skill.

## Things a next session must not undo

Earlier notes' items still hold. Plus:

- **Every password write goes through `password.service`.** It reads the
  policy with `resolvePasswordPolicy(db)`, then calls
  `validateStrength(pw, policy)`, `validateReuse(pw, user, policy)` and
  `nextPasswordHistory(user, policy)`. Do not reintroduce a fixed regex or
  depth.
- **`passwordChangedAt` is the canonical timestamp (dict-02 P1X-0204).**
  `lastPasswordChange` is read only as a fallback for old documents.
- **`enableMFAFirstLogin` must not issue tokens while `forceReset` is set**
  (#1250).

## Standing context: re-measure, don't copy

- Denise's newest live branch, 2026-10-01: `stabilize/v2.0.0-prototype`,
  last commit 2026-09-26
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-10-01: 936 commits on hers only, 240 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`),
  measured before this rotation's commit.
- Her tip's CI, runs of 2026-09-26 14:05 (none newer): release manifest
  integrity, Full Vitest diagnostic, Coverage diagnostic and current-state
  validation all passed (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).
- Her `docs/stabilization/AXIS_E_DECISION_LOG.md` (7.6 KB) was read this
  sitting for MFA and password rows only, and settled #1245 item 1 through
  row 686. The rest is still unread against the issue comments.

## Recommended next

None queued by Dennis. No `suite-red` issue is open. This sitting's own
filings, #1247 to #1249, #1252 and #1253, are workable, and nothing blocks
them.
