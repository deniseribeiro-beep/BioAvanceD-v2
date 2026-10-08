# 2026-10-08: a consent's state derived from its decision events and revocations

Requirements: RF010 AC4-AC6, Requisitos v4.0.0; dictionary v2.0.0 ConsentDecisionEvent V2E-0121..0131, ConsentRevocation V2E-0132..0139, Consent ELM-0108/0109/0111 and V2E-0435/0436. Issue #1309.

## Decided

1. **Two append-only collections, `consentDecisionEvents` and `consentRevocations`.** Every manifestation about a consent is one decision event: `accepted` when the consent is recorded, `revoked` with each revocation, `superseded` when a newer consent of the same participant replaces it. A revocation is one ConsentRevocation row naming the decision event that materializes it (V2E-0139). Neither row is ever updated.
2. **The consent document keeps the state as a projection of those rows.** `currentStateDerived` (V2E-0436) is `active`, `partially_revoked`, `revoked` or `superseded`; `effectivePermissions` is the responses less every permission a revocation in effect blocks; `withdrawalDateTime` and `withdrawalScope` (ELM-0108/0109) and `revokedAt` follow. `consentHistory.service.js`'s `recomputeConsentState` is their one writer, and it derives them from the rows each time, so the same rows always give the same state. `responses` stays the manifestation as given.
3. **`status` stays, derived.** Some twenty readers query `status: 'ACTIVE'`. It reads `ACTIVE` while any use is still permitted (`active`, `partially_revoked`) and `REVOKED` once none is (`revoked`, `superseded`), which is what those readers meant by it. Enforcement that checks a permission (`authConsent`, `consent.validator`) reads `effectivePermissions` through `effectivePermissionsOf`.
4. **Supersession is history, not an overwrite.** A new consent no longer sets every earlier consent of the participant to `REVOKED`. Each consent still in force gets a `superseded` event, with the new consent's evidence, and the pointer pair `supersededByConsentId` / `supersedesConsentId` (ELM-0111, V2E-0435).
5. **Revocation scope** is `all` or permission keys of the revoked consent's own responses; anything else is refused with a 422. A scope covering every granted permission revokes the consent. Revocation takes effect from the server's time when recorded (RF010 AC6, "efeito prospectivo"); a caller cannot date it. A request that blocks nothing the consent still permits appends nothing.
6. **Vocabularies.** The dictionary marks each as internal governed and gives one example. `channel`: `paper`, `electronic_link`, `staff_portal`, `fhir_import`. `signerRole`: `participant`, `legal_representative`, `staff_on_behalf`. `authenticationLevel`: `basic`, `token` (a signed consent link), `session` (an authenticated staff session). `decision`: `accepted`, `revoked`, `superseded`. `priorUseDisposition`: `retain_history`, or `retain_legal_obligation` when the revocation names retention obligations (V2E-0138).
7. **Who decided.** The participant's consent link records `electronic_link`, `participant`, `token`. The staff portal records a participant's signature as `staff_portal`, `participant`, `session`, and a revocation it records as `staff_on_behalf` with the staff user's id as `signerId`.
8. **A revocation's evidence** is its own encrypted JSON document beside the acceptance's (`objstore://consents/<consentId>/revocation-<id>.json`), binding scope, effect, disposition and signer; the revocation row keeps what decrypts it.
9. **A consent written before this history** has no rows. It is read as accepted, and one already `REVOKED` stays revoked.

## Read

`GET /api/e-consent/consents/:id/history` (roles 3 and 4, as revoke) returns the derived state with the events and revocations it derives from.
