# 2026-10-23: the disease-specific biomarker knowledge moves off disease_dictionary onto BiomarkerAssociation

Dictionary ELM-0275..0285. Issue #1206, second slice; it follows `2026-10-23-biomarker-association-store.md`.

## The question

BiomarkerAssociation (ELM-0275..0285) is stored at `/api/biomarker-associations`, but the disease-specific biomarker knowledge was still read from the legacy `disease_dictionary`: `/suggest`'s local fallback offered its `validation_requirements.biomarkers` lists and `disease.biomarkers`, `/disease-profile` served those lists, `SampleGraphValidator` blocked a sample missing a listed biomarker, and `seedDiseaseValidationRules.js` wrote the lists. Which of these move to the new store, and which are retired?

## Decided

`[inference]`, from issue #1206 and the specification, by the coordinator for #1206, on 2026-10-23:

1. **`/suggest`'s local fallback reads its biomarkers from BiomarkerAssociation.** `findAssociationsForOrpha` in `biomarkerAssociation.service.js` queries the rows whose `associatedCondition` names the ORPHA code (bare or `ORPHA:`-prefixed) under `http://www.orpha.net`. The query only narrows: MongoDB matches a scalar against an array field, so a row whose evidence `system` or Coding `systemUri` is an array would come back too. A row is offered only when `BiomarkerAssociationModel.validate` passes and one of its conditions is that ORPHA code with string fields. Each offered row becomes its analyte's Coding, the display falling back to the code, deduplicated on system and code. The issue's scope: "Point `disease-profile` and `buildLocalSemanticSuggestions` at it if they are kept. Retire `disease_dictionary`'s readers and seed in the same change." `applyReleaseGate` is unchanged: biomarkers are annotated, never dropped.
2. **`/disease-profile` no longer serves biomarker requirements.** Its `validation_requirements` leaves out `biomarkers`; every other key passes through. The frontend reads only `disease_category` from it.
3. **`SampleGraphValidator` takes its required biomarkers from its defaults only**, an empty list, so the required-biomarker check never blocks. No RF/RNF requires disease-gated sample release, and the issue says: "The validator stays on its defaults until one does." `miabis`, `pharmacology` and `drug_classes` are still read from `disease_dictionary`.
4. **The seed is retired.** `seedDiseaseValidationRules.js`, its test and its `seed:disease-validation-rules` script are removed. Its per-disease biomarker lists carry no evidence, so they are not migrated into BiomarkerAssociation rows: that store requires `evidenceReferences` 1..*, and Phase 1 seeds no fictitious data.
5. **`Disease.js` drops `validation_requirements.biomarkers`** from its schema, so a sent `biomarkers` key is no longer stored.

## Not decided here

- **Retiring `disease_dictionary`'s other reads**: phenotypes, `name`, `disease_category` and `drug_classes`.
- **Whether `SampleGraphValidator` ever reads BiomarkerAssociation**: no RF requires it (#1206).
- **The frontend** screen that enters BiomarkerAssociation.
