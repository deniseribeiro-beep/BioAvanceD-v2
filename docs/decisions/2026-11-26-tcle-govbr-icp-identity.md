# 2026-11-26: Remote TCLE identity via gov.br / ICP-Brasil

## The question

For remote (e-mail) consent acceptance, how should the participant prove identity in a simple but strong way, with geolocation captured at acceptance?

## Decided

`[decision]`, coordinator, 2026-11-26 (C4b=A+B3):

1. Remote acceptance uses **gov.br OpenID Connect** (Login Único) as the primary identity provider for the consent-token channel.
2. Where a qualified electronic signature is required, support **ICP-Brasil** certificate-based signature of the term hash (ITI patterns), stored beside existing consent evidence (RF010).
3. Capture **panel geolocation** (`readPanelLocation`) on accept and revoke for the remote channel (already done for revoke; extend to accept).
4. Keep in-person flow: canvas signature + collection place + GPS/Nominatim (already shipped).
5. Ship after MarkerDB/outbox/gate green (serial C10=A).

## Consequences

- Env: `GOVBR_OIDC_CLIENT_ID`, `GOVBR_OIDC_CLIENT_SECRET`, `GOVBR_OIDC_ISSUER`, `GOVBR_OIDC_REDIRECT_URI`
- Routes under `/api/e-consent/govbr/*` (start, callback) bind gov.br `sub` to the consent token session
- Evidence JSON gains `identityProvider: govbr|icp-brasil|panel` and optional `govbrSub` / certificate thumbprint
- Feature flag `CONSENT_GOVBR_OIDC_ENABLED` fails closed when unset

## Clarification (tag `v2.1.0`)

Human evidence of **real** gov.br OIDC (G4-09 / G8-GOVBR-REAL) is **out of the tag gate** per [`2026-11-26-g4-09-govbr-real-out-of-v2.1-tag.md`](2026-11-26-g4-09-govbr-real-out-of-v2.1-tag.md). Design above unchanged; pilot remote for go-live uses ICP/panel until that residual PASSes.
