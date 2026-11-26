# 2026-11-26: G4-09 / gov.br OIDC real — out of `v2.1.0` tag gate (Option B)

## The question

Does the human smoke **G4-09** (TCLE remoto via Login Único gov.br **real** → `identityProof` with `mock: false`) block tag `v2.1.0` and W7 promote when staging/prod `GOVBR_OIDC_*` credentials are not yet available on homolog tip?

## Decided

`[decision]`, coordinator, 2026-11-26 (Option B):

1. **G4-09 is out of the `v2.1.0` tag gate.** Tag and W7 entry may proceed with G4 marked **DONE with signed exception**.
2. **Pilot remote TCLE identity** for go-live uses paths already in ADR [`2026-11-26-tcle-govbr-icp-identity.md`](2026-11-26-tcle-govbr-icp-identity.md): **ICP-Brasil** and/or **panel** geolocation + evidence (`identityProvider: icp-brasil|panel`). gov.br remains the **primary** design target but is not a hard gate for this tag.
3. **Residual post-tag:** human evidence `G8-GOVBR-REAL` (Login Único staging/prod → callback → `identityProof.provider: govbr`, `mock: false`) stays open under G8 / MANUAL_VERIFY identity until credentials are injected and the smoke PASSes.
4. **Owner:** product/ops lead. **Target:** first maintenance window after `v2.1.0` once gov.br Login Único client (staging or prod) is registered and env is set on homolog/prod.
5. **Do not** claim G4-09 PASS, do not invent `GOVBR_OIDC_*` secrets, and do not leave `GOVBR_OIDC_MOCK=true` on runtime tip/prod.

## Preconditions already satisfied (not waived)

- Code path instrumented (`/api/e-consent/govbr/*`, `identityProof` on accept).
- `GOVBR_OIDC_MOCK` off on tip (`compose.acceptance-mock-off.yml`); mock only CI/e2e.
- G4-01..08, G4-10, G4-11 human PASS on tip `:8080` (2026-11-26).
- G8 tip mock hygiene + invite tenant path DONE.

## Consequences

- Scorecard **G4** = DONE with this ADR exception; **G8** tip DONE; residual line **G8-GOVBR-REAL** post-2.1.
- W7 / `MANUAL_VERIFY_v2.1_ex_ante_gate.md` no longer lists G4-09 real as entry blocker.
- Changelog / release notes for `v2.1.0` must state remote TCLE pilot paths = ICP/panel; gov.br real evidence follows this ADR.
- When G8-GOVBR-REAL PASSes: update identity + G4 tables; close residual; no need to re-tag solely for that smoke unless product policy requires.
