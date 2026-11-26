# 2026-11-11: an AccessPolicy scopes by biobank through a biobankId condition, read off the item's collection

Requirement RNF008 AC3. Dictionary V2E-0484 (AccessPolicy `conditions`), P1X-0142..0146 (ResearchResourceCollection) and P1X-0147..0151 (ResearchResourceBiobank). Issue #1496.

## The question

RNF008 AC3 asks an AccessPolicy to scope by biobank. The 2026-11-09 record (`2026-11-09-access-policy-scope-conditions.md`) scoped it by study, protocol and collection and left the biobank open, because nothing stored which biobank a collection belongs to. The 2026-11-10 record (`2026-11-10-research-resource-structures.md`) now stores that path, Collection <- ResearchResourceCollection -> ResearchResource <- ResearchResourceBiobank -> Biobank. How does a policy condition name a biobank, how is an item's biobank resolved, and how does a policy read an item that belongs to several biobanks or none?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1496, on 2026-11-11:

1. **`biobankId` is one more condition fact, no new field.** `CONDITION_FACTS` in `AccessPolicy.js` admits `biobankId` as a free string, as it admits `collectionId`. No top-level field is added, so `fieldsOf` and the catalog conformance test are unchanged, as in the 2026-11-09 record's item 1.
2. **An item's biobanks are read through its collection's links, each counted only while in force.** A specimen item, and a file item through its specimen, resolves to its collection; that collection's ResearchResourceCollection links name ResearchResources, whose ResearchResourceBiobank links name biobanks. Each link counts only while `associationInForce` holds (the half-open `[start, end)` of the 2026-11-10 record's item 5). Each `consentCompatibility` entry records the distinct biobanks as `biobankIds` (sorted; `[]` for a dataset item, an item of no collection or a collection of no link in force) and `biobankId`, the one biobank only when there is exactly one, else `null`.
3. **The biobank fact is read by the policy's effect, so neither effect fails open.** This extends the 2026-11-09 record's item 3 to the biobank, the pattern it is inferred from.
   - A `permit` reads the one biobank every requested item resolves to. An item of no biobank, of two biobanks, or of another biobank leaves the permit unapplied: the request falls to `review_required`, never to `permit`.
   - A `deny` or `review_required` applies when ANY requested item belongs to the biobank the condition names, an item of two biobanks included (its `biobankIds` holds it). Adding a second biobank link or a second item never switches such a policy off.
   - No request declares a biobank, so the biobank is only ever the item's.

## Not decided here

- **A link whose ResearchResource, Collection or Biobank was deleted** is still read as stored; the 2026-11-10 record leaves deletion open.
- **A request-level biobank scope**, where the requester declares a biobank as it declares a study or protocol.
- **A multi-valued scope field** on AccessPolicy, which waits for a release that gives one.
