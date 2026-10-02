# HANDOFF

**Written 2026-10-01, seventy-seventh queue sitting. INTERIM: the sitting ran
its end sequence (audit, suite, push, issues, clean-up), but Dennis has not
said it is over.** It stopped picking new work at about 303K context in use.

The instruction was: "Read handoff. Docker is on. Pick next group of issues
to resolve and begin." The group picked was **#1265**, **#1260**, **#1261**
and **#1262**. It grew through the issues it filed (#1266, #1267, #1272) and
the #1264 review.

## Repo state

The branch is `feature/docker-e2e-backend-integration`, pushed. The last
code commit is `18f6c13e`.

## What shipped (all closed with comments)

- **#1265** (`55c77ee3`): the controller test expects `setupMFAFirstLogin`'s
  three-argument call.
- **#1260 and #1261** (`0674aa4c`):
  - `logging.level` drives the server logger. The level lives in
    `utils/logLevel.js`, and `critical` keeps error lines. `server.js` and
    the import worker sync it at boot and on a 60 s poll.
  - `FIXED_PATHS` in `security.service.js` shows keys read-only and drops
    writes to them:
    - true: `logLoginAttempts`, `logAllActions` (both groups) and
      `anonymizeLogs`;
    - null: `privacy.dataRetentionDays` and `anonymizeAfterDays`.
- **#1262** (`77a6588f`, labelled `premise-corrected`):
  - `lgpd.allowDataDeletion` gates `DELETE /api/patients/:id`, with a 403.
  - `requireConsent` is fixed at true and `consentExpirationDays` at null.
- **#1267** (`e8fbd2e9`): `GET /api/security/logs/export` now anonymises its
  rows. It was the one export that skipped `anonymizeLogs`.
- **#1266** (`f681f815`):
  - `lgpd.allowDataExport` gates the report exports and the HL7/FHIR/CDA
    file exports (`middleware/lgpdExportGate.js`).
  - `anonymizeOnExport` is fixed at true.
- **#1272** (`18f6c13e`): the HL7/FHIR/CDA messages label a file
  `<id>.<ext>`, never the uploader's original name.
- **#1264**:
  - item 2 shipped as a help line under the IP-block threshold
    (`eec37583`);
  - items 3 and 6 hold, with item 6's reasoning written at the drop site
    (`30e8c02e`);
  - items 1, 4, 5 and 7 were split into #1268, #1269, #1270 and #1271.
- **#1269** (`1fe5aa4d`): `TRUST_PROXY=0` is right for every compose file in
  the repo. The env example comments now say to close the backend port if a
  proxy is ever trusted.

## Test runs this sitting

| run | scope | result | commit | time |
|---|---|---|---|---|
| per-fix targeted vitest, architecture and stash pin probes (files named in each commit message) | touched files | all green; every pin probe failed its gap cases and passed its controls | per commit | seconds to ~2 min |
| backend `npx vitest run tests/unit tests/integration tests/compliance --maxWorkers=3`, JSON reporter, under `resources.cjs run` | full | **9496/9496** | `18f6c13e` | 626.6 s |
| frontend `npx vitest run src/components src/config src/contexts src/foundation src/hooks src/pages src/utils src/views` | full | 40 files, 349/349 | `18f6c13e` | 18.1 s |
| backend `node --test "tests/architecture/**/*.arch.test.js"` | full | 162/162 | `18f6c13e` | 41.8 s |
| frontend `typecheck`, root `typecheck:e2e` | full | clean | `18f6c13e` | seconds |
| `compose build` of backend, worker, frontend and runner; stack up; admin bootstrap and the 17-service chain, both `--no-deps`; in-container `playwright-runner` (`run -d --name pw-gate`, `docker wait`) | full | **272 passed, 0 failed, 0 flaky** (269 + 3 new) | `18f6c13e` | build 55.6 s, e2e 183 s |

No suite was skipped: the diff touched backend, frontend and e2e. There
were no red cases, so nothing was filed as `suite-red`.

## Filed this sitting, carried open

- **#1273**: a RetentionPolicy may list any entity type, but the sweep acts
  only on `Log` and `AuditEvent`. The recommended fix (refuse unsupported
  types at activation) is small.
- **#1274**: a security review of this sitting's surfaces, filed by rule.
  Item 1 asks whether `[SECURITY]` warnings should bypass `logging.level`.
- **#1268**: does the IP block answer like the account lockout (timing), and
  does it cover every password/TOTP endpoint?
- **#1270**: the first-login status and expiry gates.
- **#1271**: a question for Dennis on `logs_archive` retention and access.
  The title carries the recommendation.
- **#1263** (from the previous sitting): untouched.
- Two harness findings are tracked outside this repo.

## For Dennis

- Waiting on the question in each title: #1254, #1257 and now #1271.
- Unchanged: #284's milestone line, #1222, #1225, #1228, #1220 step 5, the
  #941 re-close, #1218, #956, #979, whether `0d87f73b` (#1124) stands,
  Denise's `docs/` deletions and #1231, and the go for a PR into `main`.

## Docker and the machine

- **Gate:** Dennis, 2026-10-01: "Docker is on." It closes at the next `/clear`.
- **Nothing is running.** `compose down` ran, and no containers remain. The
  named volumes and the images built from `18f6c13e`'s sources are kept.
  The build cache was pruned (2.204 GB).

## Things a next session must not undo

Earlier notes' items still hold. Plus:

- **`FIXED_PATHS` keys are not inputs.** `updateConfig` drops writes to them
  rather than rejecting them, because the page sends the whole config on
  every save (#1264 item 6).
- **The lgpd gates read `security_config` directly and fail closed.** They
  run after the permission and scope checks, never before.
- **The export-gate require shifted three line-keyed exemptions** in
  `filter-keys.arch.test.js` (`sample.routes.js:697/774/867`). Any edit
  above them in that file moves them again.
- **Report test files stub `lgpdExportGate` open**, because their db mocks
  cannot answer the config read. The gate is tested in
  `lgpdExportGate.1266.test.js`.

## Standing context: re-measure, don't copy

- Denise's newest live branch, 2026-10-01: `stabilize/v2.0.0-prototype`,
  last commit 2026-09-26
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-10-01: 936 commits on hers only and 260 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`),
  measured before this rotation's commit.
- Her tip's CI, runs of 2026-09-26 14:05 (none newer): release manifest
  integrity, Full Vitest diagnostic, Coverage diagnostic and current-state
  validation all passed (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).
- Her `docs/stabilization/AXIS_E_DECISION_LOG.md` is still read only for
  MFA and password rows.

## Recommended next

None queued by Dennis. The workable ones are #1273, #1274, #1268 and #1270.
#1271, #1254 and #1257 wait on Dennis's answer to the question in each
title.
