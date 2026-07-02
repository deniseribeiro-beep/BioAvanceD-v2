---
status: open
priority: P2
github: "#5"
opened: 2026-06-30
---

# fix(e2e): mocked UI specs have wrong selectors and broken auth — make all e2e specs pass on real stack

Mirror of https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/5. Keep this
file's checklist in sync with the GitHub issue if either changes.

## Problem

The three pre-existing e2e specs (`cadastro-amostra`, `intake-wizard`,
`tcle-dinamico`) have multiple bugs that prevent them from passing against a real
backend+frontend docker stack:

1. **Auth breaks with a real backend**: specs inject a mock JWT via
   cookie/localStorage, but the frontend's `AuthContext` calls `/api/auth/verify` on
   mount. With a real backend, that endpoint rejects the unsigned mock JWT (401) and
   redirects to `/login`. The specs were designed assuming no real backend would be
   present.
2. **UI selectors don't match the actual frontend**: specs look for elements like
   `getByLabel('Nome completo do paciente')`,
   `getByRole('button', { name: /Nova Amostra|Cadastrar Amostra/i })`,
   `getByLabel('Nome do Modelo')` — these time out because the actual frontend
   components use different labels or structures.
3. **Hardcoded localhost:3000 port** (fixed on
   `feature/docker-e2e-backend-integration` — was navigating to the backend port
   instead of the frontend).

## Why this matters

CI's `e2e-docker` job was scoped to `--grep "Real backend integration"` as a
workaround to avoid these failures. That means the 3 UI specs were never exercised
in CI against a real stack — the pipeline was technically green but not truthfully
testing the application.

## Fix (tracked on `feature/docker-e2e-backend-integration`)

- [x] Investigate actual frontend component structure for `/samples`, `/v2/intake`,
      `/admin/tcle/new`
- [x] Fix selectors to match real rendered UI (5a4a49d0 — rewrote all three UI specs)
- [x] Add `/api/auth/verify` mock in each spec (or use `PLAYWRIGHT_USE_REAL_LOGIN=1`
      flow) so auth works against a real backend
- [ ] Remove the `--grep` workaround from CI `e2e-docker` job once specs pass —
      verify this is actually done; not confirmed as of 2026-07-02

## Resolution (fill in when closing)

Specs were rewritten in 5a4a49d0 ("fix(e2e): rewrite all three UI specs to pass
against a real backend stack"). Close once the CI `--grep` workaround is confirmed
removed and the full e2e-docker job passes green in CI (via `ship-to-main`).
