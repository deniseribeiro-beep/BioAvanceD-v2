# 2026-10-22: an absent field on the ingestion path gets a MissingDataReason, declared beside the payload or `unknown`

Requirement RF029 AC7, RNF011 C4, C5, C6, QLT-002. Dictionary V2E-0280..0286. Issue #1318.

## The question

RNF011 C4 asks that an absence be represented by a MissingDataReason (`unknown`, `not_collected`, `not_applicable`, `withheld` or `error`), C5 that an absence never be converted to zero, and RF029 AC7 that ingestion preserve missingness by reasonCode. `POST /api/ingestion/records` persisted an accepted Dataset or WorkflowRun with its absent fields as null or [], and no code wrote a MissingDataReason. Where does a client declare why a field is absent, what is recorded when it declares nothing, and which fields can be absent at all?

## Decided

`[inference]`, from the specification and the repo's code, by the coordinator for #1318, on 2026-10-22:

1. **The declaration travels as a top-level body field** `missingDataReasons: [{ fieldPath, reasonCode }]` beside `payload`. The canonical contracts (`api/backend/src/contracts/canonical/v1/index.js` datasetSchema and workflowSchema) are `additionalProperties: false`, so a reason inside the payload would itself be a contract violation. A malformed entry, a field that takes no reason, a code outside RNF011 C4, a field declared twice, or a declared field that holds a value (0 included) quarantines through the gateway as any other violation (QLT-002: a controlled reasonCode with conditional validation).
2. **An absent field with no declaration is recorded as `unknown`.** The dictionary's vocabulary column for V2E-0284 reads `unknown`, and it is the only code that claims nothing about the absence.
3. **A required field is not a missingness field.** Its absence stays a quarantine, as before (RNF011 C6, no silent correction). Missingness applies to the fields the model stores as null or [] when absent, listed as each target's `missingnessFields` in `api/backend/src/ingestion/ingestionTargets.js`:
   - Dataset: `doi`, `distributionFiles`, `roCrateManifest`.
   - WorkflowRun: `containerImageDigest`, `softwareDependencies`, `parameters`, `inputFileIds`, `outputFileIds`, `completedAt`.

   These are the fields outside each schema's `required`, less the id field.

The rows (`api/backend/src/ingestion/missingness.js`) go to the `missingDataReasons` collection in the document's transaction, with the outbox event's id as `sourceEventId`, and the releases in force. Only undefined, null, '' and [] count as absent: 0 and false are values, and an absence is never written as 0.

## Not decided here

- **The quarantine record does not store the declaration.** The gateway stores the `payload` only, so a quarantined record's `missingDataReasons` is not kept for its review.
- **A Neo4j projection of MissingDataReason.** The dictionary routes it to Neo4j via the outbox only; no event or projection carries it yet.
- **How a DataQualityAssessment's completeness reads a reasoned absence**: whether a field with a reasonCode other than `unknown` counts as complete is that slice's decision.
