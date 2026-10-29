# 2026-10-22: the analytical-preparation entities are modelled as inactive structures, written by no flow

Requirement RF029 AC8, RNF030 C2-C5. Dictionary V2E-0287..0345 (DatasetSnapshot V2E-0287..0295, LabelDefinition V2E-0296..0303, FeatureDefinition V2E-0304..0313, CohortDefinition V2E-0314..0321, DatasetPartition V2E-0322..0329, DatasetRepresentativenessAssessment V2E-0330..0337, DeidentificationProcess V2E-0338..0345). Issue #1318.

## The question

RF029 AC8 permits DatasetSnapshot, LabelDefinition, FeatureDefinition, CohortDefinition and DatasetPartition "somente em uso científico autorizado e versionado", and RNF030 C2-C5 names what DatasetSnapshot, FeatureDefinition, LabelDefinition, DatasetPartition, DeidentificationProcess and representativeness must record. Nothing in `api/backend/src` modelled any of them, and no authorized and versioned scientific-use flow exists. What does the backend build now, and what keeps it from being used before that flow exists?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1318, on 2026-10-22:

1. **"Inactive" means modelled, conformant and written by no flow.** The requisitos prepare entities, fields, contracts and enums in Phase 1 and populate them in Phase 3 (`docs/extracted-v2.0.0/requisitos.md` lines 54-56), and AC8 permits these entities only in authorized and versioned scientific use. So each one is a plain model under `api/backend/src/models/` with a pure `fieldsOf`, a `validate` and a `create`, registered in `canonical-catalog-conformance.arch.test.js` with zero drift. No flow, collection or route writes it. `inactive-analytical-structures.arch.test.js` pins that: it fails when a backend file requires one of the models or names its collection. The flow that activates an entity brings its gate and removes the entity from that test's `INACTIVE` in the same change. The pattern is the repo's plain-model template (`TelemetryIngestionEvent.js`) and its retirement guard (`temperatures-copy-retired.arch.test.js`).
2. **Seven entities, not five.** AC8 names five. CohortDefinition is among them, and RNF030 C5 adds DeidentificationProcess and "representatividade", which is the catalog entity DatasetRepresentativenessAssessment.
3. **The vocabularies.** `partitionType` is `train|validation|test` (the cell reads `train`, the example `test`). `leakageCheckResult` is `pass|fail` (the cell reads `pass`). `leakageRisk` is `none|low|medium|high` (the cell reads `none`, the example `low`). The pattern is the repo extending a one-value vocabulary cell to the set it names, as in `2026-10-08-consent-history.md` item 6 and `2026-10-08-collection-governance.md` item 4. `strategy`, `groupingUnit`, `dataType` and the `authorizedStrata` entries stay open codes, checked only as non-empty strings.
4. **A CodeableConcept is stored as the Coding shape.** LabelDefinition `concept` takes the `{ systemUri, code, version, display }` shape `ClinicalObservation.js` uses, because the repo has no CodeableConcept shape. A Period (`timeWindow`) is `{ start, end }` with a null end meaning open-ended, as in `Encounter.js`.
5. **No collection is registered.** The activating flow adds its `collections.js` and `env.js` keys. The architecture test names the collection a flow would use for each entity, so that a collection call on one fails it today.

## Not decided here

- **The authorized-scientific-use gate itself**: which approval, purpose or access decision a flow must hold before it writes one of these entities.
- **The DataQualityAssessment scope `dataset_snapshot`**: how a quality assessment refers to a DatasetSnapshot.
- **The inactive model entities of RF029 AC9 and RNF030 C6** (ModelArtifact, ModelCard, ModelEvaluationRun, AlgorithmicDecisionReview and ModelMonitoringEvent), which are not modelled here.
- **A Neo4j projection** of any of the seven.
