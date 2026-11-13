# 2026-11-12: An ingested Specimen's named unit is a code of the active UCUM reference release, else the record quarantines INACTIVE_OR_UNKNOWN_CODE

Requirement RNF011 AC1, RF029 AC3. Dictionary ELM-0138, ELM-0139. Issue #1523.

## The question

RNF011 AC1 asks that ingestion validate "IDs, campos, tipos, cardinalidades, enums, unidades, referências e regras condicionais" (`docs/extracted-v2.0.0/requisitos.md` line 1269). No ingestion target validated a unit. The one target with a unit field, Specimen (`canonical.v1.specimen` `unit: { type: 'string' }`, `contracts/canonical/v1/index.js`), accepted any string and stored it on the sample. What does a valid unit mean, and where is it checked?

## Decided

`[inference]`, from the specification and the repo's pattern, for #1523, on 2026-11-12. dict-02 gives Specimen's quantities, ELM-0138 `initialQuantity` and ELM-0139 `currentQuantity` (type `Quantity`), the vocabulary UCUM (`docs/extracted-v2.0.0/dict-DICIONARIO.md` lines 142-143). The repo's pattern for a coded value at ingestion is RF029 AC3's "usar referências ativas", which `ingestion/activeCodeValidator.js` `checkActiveCode` implements against RF028's reference releases, and the repo imports UCUM as such a release (`reference-data/reference-imports/sources/ucum.js`, systemUri `http://unitsofmeasure.org`).

1. **A named unit is checked against the active UCUM release.** `ingestion/specimenTarget.js` `validateSpecimenReferences` gains a gate that runs `checkActiveCode(db, { systemUri: 'http://unitsofmeasure.org', code: payload.unit })`. A unit that is unknown, whose concept or release is inactive, or that resolves to more than one active release is refused.
2. **It is the last Specimen gate.** It runs after the participant, consent, collection site, parent, barcode and collection gates, so an earlier refusal keeps its own code.
3. **Its refusal quarantines.** It is a 409 with violationCode `INACTIVE_OR_UNKNOWN_CODE`, `activeCodeValidator`'s own code, so `productionIngestion.js` quarantines the record under it and writes no sample. The message names the unit and the lookup's status. A failed lookup rethrows, a failure, as the other gates' lookups do.
4. **The comparison is exact.** UCUM is case-sensitive (`mg` is not `MG`), so the code is neither trimmed nor case-folded.
5. **An absent or empty unit is not checked here.**

## Not decided here

- **Requiring a unit with a quantity.** An absent `unit` is still stored as the sample model's default `µL` (`models/Sample.js`), which is not a UCUM code (UCUM writes `uL`), and every e2e Specimen ingests `quantity: 5` with no unit. Requiring a unit, or a UCUM default, changes the sample mount's contract and is its own decision.
- **Volume units in the bundled UCUM fixture.** It holds only `mg`, `kg`, `mg/dL`, `mmol/L` and `mm[Hg]`, so a stack seeded from it refuses `uL` and `mL`.
- **Units on other targets.** None of the other seven ingestion targets has a unit field.
