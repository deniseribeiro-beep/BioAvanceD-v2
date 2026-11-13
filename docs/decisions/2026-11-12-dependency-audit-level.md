# 2026-11-12: the severity at which CI's dependency audit fails

Issue #1539.

## The question

CI runs `npm audit` in `frontend` and in `api/backend` (`.github/workflows/ci-pipeline.yml`, "Audit frontend dependencies" and "Audit backend dependencies"), and both steps failed only on a critical advisory. Issue #1539 asks that the audit fail on high, or that a decision record why a step stays at critical.

## Decided

1. **The backend audit step fails on high: `npm --prefix api/backend audit --audit-level=high`.** After the in-range upgrades and the nodemailer 9 -> 10 upgrade (nodemailer 10.x requires Node.js 20 or newer; the repo runs Node 22), `npm audit` in `api/backend` reports 0 critical and 0 high. The two moderates left (exceljs, through its bundled uuid) do not fail the step.
2. **The frontend audit step stays at critical: `npm --prefix frontend audit --audit-level=critical`.** `npm audit` in `frontend` reports 0 critical, 8 high, 7 moderate and 2 low (measured with `npm audit --json` on a copy of `frontend`'s `package.json` and `package-lock.json`, 2026-11-12). The highs are in axios, follow-redirects, form-data, socket.io-parser, vite and ws (a fix available), zod (a fix only in a major) and xlsx (no fix available). Raising the step now would turn CI red on every run. Upgrading those packages is its own issue, and the frontend step is raised to high when that lands.

## Not decided here

- **How to handle xlsx**, whose high advisory has no fixed version on npm: replacing it, pinning a vendor build, or accepting it with a documented exception is left open.
