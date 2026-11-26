# Runtime mock hygiene (v2.1)

Guides acceptance/commercial stacks so identity and data match production behaviour. ADR: `docs/decisions/2026-11-26-access-tenant-only-identity.md`.

## Product auth (operators)

| Rule | Detail |
|---|---|
| Commercial path | Tenant **invite → activate** (`POST /api/users/invites`, `POST /api/auth/invites/accept`). UI: `/users/new` → “Convidar usuário”, `/invite/accept?token=…`. |
| Bootstrap allowlist | Empty install only: `createFirstAdmin.js` + `BOOTSTRAP_ADMIN_*` (install-runbook §5). |
| Not product auth | Google **IAP** on homolog edge — ops-only (`docs/runbooks/bioadvanced-iap-access.md`). No Google OAuth login in the app. |

## TCLE remote (participants)

| Variable | Acceptance/commercial | CI / `NODE_ENV=test` |
|---|---|---|
| `CONSENT_GOVBR_OIDC_ENABLED` | `true` with real gov.br client/issuer/redirect | `true` in `compose.test.yml` |
| `GOVBR_OIDC_MOCK` | **unset or `false`** (mock ignored unless test/CI) | `true` allowed — deterministic e2e |
| `GOVBR_OIDC_CLIENT_ID`, `GOVBR_OIDC_REDIRECT_URI`, … | Staging/production gov.br values | Test doubles in compose |

Implementation: `api/backend/src/services/govbrOidc.service.js` (`isGovbrOidcMockActive`). Callback JSON includes `identityProof` for the SPA consent accept path (`govbrConsent.js`).

## Mongo acceptance data

- **No** demo-user fixtures or ad-hoc seed scripts on acceptance Mongo.
- Populate reference data only through the documented **FONTES / RF028** pipeline.
- After bootstrap admin, provision operators via **invite**, not raw `users` inserts.

## Optional lab flags (never on commercial acceptance)

| Variable | Purpose |
|---|---|
| `ALLOW_TENANT_INVITE_LINK_IN_RESPONSE` | Return invite URL in API JSON (default on in non-production). |
| `TENANT_INVITE_TTL_DAYS` | Invite expiry (default 7, max 90). |
| `ENABLE_TEST_SUPPORT_ROUTES` | Forbidden in production `.env.production.example`. |

## Verification pointers

- Unit: `api/backend/tests/unit/tenantInvite.service.unit.test.js`, `govbrOidc.service.test.js`
- Manual checklist: `docs/qa/MANUAL_VERIFY_v2.1_identity.md`