# 2026-10-09: governed purpose codes on a term's permissions, and a partial revocation judged on them

Requirements: RF010 AC3 and AC7, RF024 AC2, Requisitos v4.0.0; dictionary v2.0.0 ConsentPermission `purpose` (V2E-0116, CodeableConcept 1..1, "Internal governed vocabulary when coded"). Issue #1347. Supersedes items 11 (its `consent_partial_revocation` rule) and 16 of `2026-10-08-consent-history.md`.

## Decided

1. **The governed vocabulary of purposes is GA4GH DUO,** as the reference data imports it (SRC_DUO, system `http://purl.obolibrary.org/obo/duo.owl`). An access request's `duoCode` is already read against the same concepts, so a consent's purpose and a request's purpose share one vocabulary.
2. **A term's permission may name `purposeCode`, a DUO code,** on every term write path (builder and policy route). It must be a DUO concept the reference data holds as `active`; anything else is refused with a 422 naming the code. A permission that names none is stored as before.
3. **A ConsentPermission row's `purpose` is `{ system, code, display }` from the term's `purposeCode`,** and the term's label coded by its key where the term names none.
4. **Matching follows DUO:** a granted permission covers a requested purpose when its code is the request's code or an `is_a` ancestor of it, read from the imported TerminologyRelation rows.
5. **`consent_partial_revocation` judges the requested purpose where it is computable,** that is, the request names a `duoCode` that resolves and every permission the consent granted names a DUO code. Covered by a permission still in effect: no restriction from this rule. Covered only by revoked permissions: `deny`. Covered by none: `review_required`, since the consent never granted that purpose. Not computable: `review_required`, as before.
6. **The rule set's version is `rf010-consent-authorization/1.1.0`,** so a decision names the rules it stood on (V2E-0145).

## Not yet

The TCLE builder does not yet offer a purpose per permission (#1349), and no screen registers an access request, so none offers a `duoCode` (#1350): both are API-only until then.
