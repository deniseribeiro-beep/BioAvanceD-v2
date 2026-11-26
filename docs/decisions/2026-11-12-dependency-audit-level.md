# 2026-11-12: the severity at which CI's dependency audit fails

Issues #1539 and #1541.

## The question

CI runs `npm audit` in `frontend` and in `api/backend` (`.github/workflows/ci-pipeline.yml`, "Audit frontend dependencies" and "Audit backend dependencies"), and both steps failed only on a critical advisory. Issue #1539 asks that the audit fail on high, or that a decision record why a step stays at critical.

## Decided

1. **The backend audit step fails on high: `npm --prefix api/backend audit --audit-level=high`.** After the in-range upgrades and the nodemailer 9 -> 10 upgrade (nodemailer 10.x requires Node.js 20 or newer; the repo runs Node 22), `npm audit` in `api/backend` reports 0 critical and 0 high. The two moderates left (exceljs, through its bundled uuid) do not fail the step.
2. **The frontend audit step fails on high: `npm --prefix frontend audit --audit-level=high`** (#1541). It stayed at critical while `npm audit` in `frontend` reported 0 critical, 8 high, 7 moderate and 2 low. What cleared the eight highs:
   - In-range upgrades (`npm audit fix --package-lock-only`, `package.json` unchanged): axios 1.16.1 -> 1.21.1, follow-redirects 1.16.0 -> 1.16.3, form-data 4.0.5 -> 4.0.6, socket.io-parser 4.2.6 -> 4.2.7, vite 7.3.2 -> 7.3.8, ws 8.18.3 -> 8.21.3.
   - zod ^3.25.76 -> ^4.6.7 (GHSA-mrhx-c7xc-m3w5, with no fix in 3.x). The call sites in ImportForm, ClinicalIntakeWizard and intake.schemas use APIs zod 4 keeps, except the one-argument `z.record` (it throws on zod 4.3.6; 4.6.7 accepts it again), now given its key schema, and `ZodError.errors`, now read as `.issues`.
   - xlsx 0.18.5 -> 0.20.3 from the library's own CDN tarball, `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9). npm's registry stops at 0.18.5; `npm audit` still checks the package by its name and version.

   `npm audit` in `frontend` now reports 0 critical, 0 high and 5 moderate (measured with `npm audit --json` on a copy of `frontend`'s `package.json` and `package-lock.json`, 2026-11-12). The moderates (vitest, @vitest/coverage-v8, @vitest/mocker, react-router, react-router-dom) do not fail the step.

## Not decided here

- **Later xlsx fixes** must be taken by hand from the library's CDN, since `npm audit fix` and Dependabot do not track a package installed from a tarball URL.
