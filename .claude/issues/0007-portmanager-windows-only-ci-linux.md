---
status: open
priority: P1
github: none
opened: 2026-07-02
---

# portManager.js uses Windows-only shell commands but CI runs on ubuntu-latest

## Problem

`api/backend/src/utils/portManager.js` shells out to Windows-specific commands:

- `netstat -ano | findstr :${port}` (line 53, in `getProcessUsingPort`)
- `taskkill /PID ${process.pid} /F` (line 87, in `killProcessOnPort`)

`findstr` and `taskkill` do not exist on Linux. `.github/workflows/ci-pipeline.yml`
runs all three jobs (`backend-tests`, `e2e-mocked`, `e2e-docker`) on `runs-on:
ubuntu-latest`.

Found while writing `api/backend/tests/unit/portManager.test.js` (2026-07-02
parallel-test-agent slice) — the new tests pass locally on Windows by exercising
real OS processes/commands, but will very likely fail once this branch runs
through CI on Linux, since the underlying functions themselves don't work there.
Not introduced by the new test — the test just makes an existing latent
cross-platform gap concrete and CI-visible for the first time.

## Plan / checklist

- [ ] Confirm whether `portManager.js` is actually invoked in any Linux-run path
      (dev-only tooling vs. something CI/production would hit)
- [ ] If it needs to work cross-platform, replace the shell-outs with a
      Node-native or cross-platform approach (e.g. `net.createServer` probing for
      availability, `find-process`/`ps`+`kill` or similar for the kill path) or
      branch on `process.platform`
- [ ] Decide whether `portManager.test.js`'s real-process tests should be
      skipped/adjusted on non-Windows runners once the above is resolved

## Resolution (fill in when closing)

What actually shipped, on what branch/commit.
