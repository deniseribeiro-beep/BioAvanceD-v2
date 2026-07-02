---
status: open
priority: P2
github: none
opened: 2026-07-02
---

# sendConsentEmail.js requires nodemailer, which isn't installed and isn't used anywhere else

## Problem

`api/backend/src/utils/sendConsentEmail.js` does `require('nodemailer')` at module
load time, but `nodemailer` is not declared in `api/backend/package.json` and is not
present in `node_modules`. Any code path that actually `require`s this file would
crash immediately with `Cannot find module 'nodemailer'`.

It also hardcodes fallback Ethereal test SMTP credentials directly in source:

```js
auth: {
  user: process.env.ETHEREAL_USER || 'seu_usuario@ethereal.email',
  pass: process.env.ETHEREAL_PASS || 'sua_senha',
},
```

Every other email-sending file in the backend uses `resend` instead, not
`nodemailer` — confirmed via grep, `resend` appears in:
`src/services/sendIncidentAlertEmail.js`, `src/services/sendCriticalAlertEmail.js`,
`src/services/patient.service.js`, `src/services/NotificationService.js`,
`src/interface/routes/patient.routes.js`, `src/controllers/iot.controller.js`,
`src/controllers/paciente.controller.js`. `sendConsentEmail.js` is the only
outlier, and it lives in `src/utils/` rather than `src/services/` alongside the
others.

Found while writing a unit test for this file during the 2026-07-02
parallel-test-agent slice (`api/backend/tests/unit/sendConsentEmail.test.js`).
The test file works around the missing dependency by hijacking
`Module._resolveFilename` and pre-populating `require.cache` with a fake
`nodemailer` module so the test can still verify documented behavior — that's a
test-only workaround, not a fix, and doesn't address the production-code bug.

## Plan / checklist

- [ ] Decide whether to migrate `sendConsentEmail.js` to `resend` (matching every
      other email sender in the codebase) or add `nodemailer` as a real dependency
      if there's a reason to keep it separate
- [ ] Remove the hardcoded Ethereal fallback credentials regardless of which path
      is chosen
- [ ] Confirm nothing in the codebase currently calls `sendConsentEmail` in a live
      path (if it is called, this is an active production bug, not just untested
      code)

## Resolution (fill in when closing)

What actually shipped, on what branch/commit.
