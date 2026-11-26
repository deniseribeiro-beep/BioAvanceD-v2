# 2026-11-12: The production ingestion route takes an optional provenance.accessPolicyId, accepted only when every named AccessPolicy is in force and applicable to the entityType, and stamped on the document

Requirement RF029 AC2, AC10. Dictionary ELM-0022. Issue #1523.

## The question

RF029 AC2 asks ingestion to "Exigir origem, sourceRecordId, temporalidade, ator, finalidade, política, consentimento e proveniência conforme aplicabilidade" (`docs/extracted-v2.0.0/requisitos.md` line 939). `POST /api/ingestion/records` carried no policy: its provenance envelope (`ingestion/provenanceEnvelope.js`) held `sourceSystem`, `createdBy`, `retrievedAt`, `purpose` and `sourceRecordId` only. Which field carries the policy, is it required, and what does the route do with a policy it cannot verify?

## Decided

`[inference]`, from the specification and the repo's pattern, for #1523, on 2026-11-12. dict-02 ELM-0022 is `BaseRecord.accessPolicyId`, "Política computável aplicável ao registro", a `Reference` to `AccessPolicy/uuid` with cardinality `0..*` (`docs/extracted-v2.0.0/dict-DICIONARIO.md` line 26); RF029 AC2 requires each element "conforme aplicabilidade", and the `0..*` cardinality makes the policy optional. The pattern, read off the route's targets (#1318): a value the client names is accepted only on positive evidence, and otherwise quarantined, never corrected.

1. **The field and its shape.** `provenance.accessPolicyId` is an optional array of non-empty strings. `buildProvenanceEnvelope` normalizes it to its trimmed ids, duplicates removed in first-seen order; absent or `null` gives `[]`. Any other present value (a bare string, a non-string item, a blank item) is a `PROVENANCE_FIELD_INVALID` violation on `provenance.accessPolicyId`, and the record quarantines.
2. **The positive-evidence check.** `productionIngestion.js` `checkAccessPolicies` reads the named ids from `accessPolicies`, keeps the highest version of each in force now (`AccessPolicy.policiesInForce`), and accepts an id only when that version's `applicableEntityTypes` names the exact `entityType`. An unknown id, a policy out of force, or one not applicable each give one `ACCESS_POLICY_NOT_APPLICABLE` violation, and the record quarantines through the gateway like any other violation. A read error is a failure, not a verdict: it throws and the route answers 500. The check runs after the replay check, so a replay learns nothing new.
3. **The stamp.** An accepted document carries `accessPolicyId`, ELM-0022's canonical name, as the verified ids. A record naming no policy stores no `accessPolicyId` key, as before.
4. **The quarantine keeps it.** A quarantined record keeps the ids in its stored provenance envelope, with no extra code.
5. **The provenance score is unchanged.** `accessPolicyId` is not in `REQUIRED_FIELDS`, which the data quality assessment scores provenance completeness over, because the policy is optional.

## Not decided here

- **Requiring a policy whenever an AccessPolicy in force names the entityType.** AccessPolicy governs access requests (RF024); making it a precondition of ingestion would refuse every record of a type once any policy names it, a reversal no requirement states.
- **`retentionPolicyId` (ELM-0021).**
- **Evaluating the policy's `conditions` at ingestion.**
