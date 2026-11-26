# Manual verify — v2.1 identity (G8 + G9)

| ID | Area | Steps | Expected |
|---|---|---|---|
| G9-INVITE-CREATE | Tenant invite | Admin login → `/users/new` → check “Convidar usuário” → fill name/email/username/role → submit | `201` from `POST /api/users/invites`; link shown (lab) or delivered out-of-band |
| G9-INVITE-ACCEPT | Activation | Open `/invite/accept?token=…` (incognito) → set password → submit | `201` `POST /api/auth/invites/accept`; redirect to login; user can sign in |
| G9-INVITE-RBAC | Scope | Non-global admin invites only within own `organizationId` | `403` when targeting foreign org |
| G9-NO-GOOGLE | Product login | `/login` | Username/password (+ MFA); **no** Google OAuth button |
| G9-IAP-OPS | Ops edge | Commercial install docs | No requirement for IAP; optional note in `bioadvanced-iap-access.md` banner only |
| G8-MOCK-OFF | gov.br mock | Acceptance env: `GOVBR_OIDC_MOCK` unset; `GET /api/e-consent/govbr/status` | `mock: false` |
| G8-GOVBR-REAL | TCLE OIDC | Participant link → gov.br (staging/prod) → callback | JSON `identityProof.provider: govbr`, `mock: false`; accept posts proof to evidence |
| G8-ICP | ICP path | Existing instrumented remote TCLE + ICP upload | Unchanged; evidence retains `identityProof` normalization |
| G8-BOOTSTRAP | First admin | Empty DB + `BOOTSTRAP_ADMIN_*` + `createFirstAdmin` | One admin; subsequent users via invite only |
| G8-MONGO | Acceptance DB | Fresh acceptance Mongo | FONTES/RF028 only; no runtime mock users |

## Residual (requires staging credentials)

- End-to-end gov.br **non-mock** login on a public participant URL (human browser).
- Manual inspection of stored consent evidence JSON for `identityProof` after real OIDC.