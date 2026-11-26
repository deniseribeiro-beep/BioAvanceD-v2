# 2026-11-26: Access — tenant-only product auth (G10)

## The question

What is the gold-standard access model for BioAvanceD **product** authentication in v2.1, given IAP Google exists on homolog and gov.br/ICP exist for remote TCLE?

## Decided

`[decision]`, coordinator, 2026-11-26 (plano v2.1 / PENDING §8):

1. **Product auth = tenant invite / activation only.** Operators join via tenant provisioning → invite → activate account (password + optional TOTP MFA). No social Google OAuth in the product login path.
2. **IAP Google is not product auth.** It may remain as an **ops-internal** edge for lab/homolog networking. Commercial install docs and customer onboarding **must not** require IAP. Mark runbook accordingly.
3. **gov.br Login Único** is only the **participant TCLE remote** identity channel (see ADR `2026-11-26-tcle-govbr-icp-identity.md`). Operators do **not** log into the app via gov.br in 2.1.
4. **ICP-Brasil** in 2.1 = verification already instrumented on the remote TCLE evidence path. No new ITI pipeline this release.
5. **Terms of use + Privacy policy** acceptance (versioned, per user/tenant) is distinct from research **TCLE** (see ADR runbook-terms). Gate after product login if pending.
6. **MFA TOTP** may remain as a generic authenticator app (not “Google login”).
7. Bootstrap `createFirstAdmin` remains the allowlisted first-admin path for empty installs; subsequent users use invite.

## Consequences

- Implement invite/activation APIs + UI before removing IAP from commercial docs path.
- `GOVBR_OIDC_MOCK` must be **off** on acceptance/commercial runtime; CI may keep doubles.
- Update `docs/runbooks/bioadvanced-iap-access.md` banner: ops-only.
- Acceptance Mongo: FONTES/RF028 pipeline only; document allowlist (admin bootstrap).

## Status

Approved for tip 2.1. Blocks W4 (G8/G9) until this ADR is on tip.
