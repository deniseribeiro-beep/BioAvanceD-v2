# 2026-11-09: an AccessPolicy scopes by study, protocol and collection through its conditions

Requirement RNF008 AC3. Dictionary V2E-0482..0484 (AccessPolicy `organizationScopeIds`, `resourceScopes`, `conditions`). Issue #1496.

## The question

RNF008 AC3 asks access control to consider the organization, biobank, collection, study, protocol and resource. An AccessPolicy scoped an access request by organization (`organizationScopeIds`) and resource (`resourceScopes`) only. How does it scope by collection, study and protocol, when the v2.0.0 dictionary gives AccessPolicy no field for any of them?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1496, on 2026-11-09:

1. **The scope is a condition, not a new field.** The dictionary's extension point is `conditions` (V2E-0484, "Condições executáveis", fact -> required value), and `AccessPolicy.js` already admits the free-string facts `organizationId`, `studyId` and `protocolId` in `CONDITION_FACTS`. The study and protocol facts already existed, though they read only the request's declared values; collection scope is added as one more fact, `collectionId`. No top-level field is added, so `fieldsOf` and the catalog conformance test are unchanged. This follows the 2026-10-25 decision (`2026-10-25-study-and-workflow-run-organization-scope.md`): the repo adds no field the dictionary does not give.
2. **Study, protocol and collection are item facts.** A specimen item resolves to its specimen's `studyId`, `protocolId` and `collectionId` (Sample stores all three), and a file item to its specimen's. Each `consentCompatibility` entry records the three, and the policy evaluation reads them off those entries together with the study and protocol the requester declares, as item 3 sets out per effect.
3. **An item fact is read by the policy's effect, so neither effect fails open.**
   - A `permit` reads the one value every requested item resolves to. Items of two values, a dataset item, or an item that resolves to none give `null`, and a permit conditioned on that fact does not apply: the request falls to `review_required`, never to `permit`. For `studyId` and `protocolId`, that one value must also be the request's declared one, so a permit never applies to a specimen of another study or protocol.
   - A `deny` or `review_required` applies when ANY requested item matches: one item whose study, protocol and collection are the values the condition names (an item's study and protocol also match the request's declared ones). Adding an item of another collection, study or protocol, or a dataset item, never switches such a policy off.
   - The other facts (`consent`, `duo`, `study`, `organizationId`, `requestedPurpose`, `duoCode`) are the request's, whatever the effect.
4. **The facts are single-valued.** A condition names one value per fact, so a scope over several studies, protocols or collections is several conditions under `ruleExpression: any-condition`, each carrying its other keys (for example `consent: compatible`) again.

## Not decided here

- **The biobank scope** is decided in `2026-11-11-access-policy-biobank-scope.md`.
- **A multi-valued scope field** on AccessPolicy, which waits for a release that gives one.
