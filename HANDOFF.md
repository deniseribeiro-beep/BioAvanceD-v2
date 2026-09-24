# HANDOFF

**Written 2026-09-24, fifty-eighth queue sitting. INTERIM: the sitting may
continue. It has not been told it is over.**

The instruction was "Pick next group of issues. Docker is on." The group
was the **account-lockout cluster** (#986 item 2, #985, #761, #1002), and
it grew by #1203, which was found and filed mid-group. All five are
closed. Mid-sitting, Dennis pointed out that "for Denise" and "not
something I can close" were hand-offs made before the outward ladder
(law, then standards, then literature, then precedent) had been walked.
Once it was walked, every issue in the group closed without the owner.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive
commit is `67a51f4d` (#1203, second instance).

## What shipped

- **#1002**, `c0a6ce12`: a completed forgotten-password reset clears
  `failedLoginAttempts`/`accountLockedUntil`, per the OWASP Authentication
  Cheat Sheet ("Account Lockout"). The gate on the authenticated
  password-change routes stays.
- **#1203**, `c5d8b54a` and `67a51f4d`: neither reset path ever emailed
  its link.
  - The unauthenticated path now sends without awaiting, so the send cannot
    expose account existence through timing.
  - The in-app path awaits the send, and a failure surfaces as a 400.
  - The expiry text now follows the token, and the dead
    `sendRecoveryEmail` is deleted.
- **#985**, `77289f9c`: `accountLockedUntil` is recorded as a UserAccount
  local extension, following the v2.0.0 dictionary's own "Extensão local"
  class (P1X-0188, P1X-0191).
- **#761**, closed with no code: NIST SP 800-63B-4 §3.2.2 treats an
  exhausted authenticator as disabled until it is rebound, so the
  admin-cleared MFA lock is kept.
- **#986** item 2, closed with no code: OWASP says to count failures per
  account, not per IP, and a per-IP block is a denial-of-service risk
  behind a lab's NAT. The inert `loginAttempts.*` UI is #914's.

Verification:
- **Native:** the 7 test files touching `requestPasswordReset`, plus
  `NotificationService.test.js`, pass 363/363, and the architecture tests
  pass 151/151. Every fix got a pin probe.
- **Live,** on `compose.test.yml` (`backend-app-test` and its dependencies,
  built from HEAD): the full lock, email, reset and login run passed
  against Mailpit. The step table is on #1002.

## Touched, not closed

- **#914**: #986's close sends the editable-but-inert `loginAttempts.*`
  controls here. #914's own sweep comment already records all 43
  `security_config` keys as inert, so there was nothing new to post on it.

## Not yet laddered, so not yet the owner's

Before these go to Dennis or Denise, walk the outward rungs (law, then
standards, then literature, then precedent) and come back with a
recommended default:
- **#1197** and **#1200**, from the previous note. Unverified: they were
  not re-read this sitting.
- **#1196**: its alert-delay default is a domain question with published
  cold-chain guidance to check.
- **#1108**: the edit is still pending (trim `validations.ts` to
  `validateThresholds`, fix the import at `FacilityManagementPage.tsx:18`,
  delete `utils/logMethods.ts`, run `npm run typecheck`). It is not an
  owner question.
- **Still genuinely Dennis's:** whether to mirror Denise's `docs/mestrado/`
  and `docs/planning/bioavanced-v3/` deletions (a change on her branch
  would need his go), and the go for a PR into `main`.

For the rest of the question backlog, run `gh issue list --state open
--label question`, redirect it to a file, and grep it.

## Docker and the machine

- **Gate:** Dennis, 2026-09-24: "Docker is on." It closes at the next
  `/clear`.
- **The test stack is down.** Its `mongodb-test-data` volume persists, and
  the bootstrap admin was restored to `Admin@123` with the lock cleared
  (verified with a 200 login). A probe that changes that credential has to
  restore it by direct document write, because the reset policy refuses
  the 9-character bootstrap password.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **A password reset ends the account lockout**
  (`auth.service.processLogin.unit.test.js`, `#1002`).
- **The unauthenticated reset email is fire-and-forget, and its response
  never differs by delivery outcome** (`#1203` block, same file).

## Standing context: re-measure, don't copy

- Denise's newest live branch, 2026-09-24: `stabilize/v2.0.0-prototype`
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-09-24: 914 commits on hers only, 143 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`).
- Her tip's CI, 2026-09-24 22:52: current-state validation, Full Vitest
  diagnostic and Coverage diagnostic passed. Release manifest integrity
  failed (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).

## Recommended next

None queued by Dennis. The branch has not passed the full gate since
`5fc5c843`.
