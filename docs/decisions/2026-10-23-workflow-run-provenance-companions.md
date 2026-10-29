# 2026-10-23: WorkflowRun carries its v2 provenance companions, with the dataset snapshot optional until DatasetSnapshot is activated

Requirement RF027 AC1, RNF030 C1. Dictionary V2E-0477 `hardwareProfile`, V2E-0478 `randomSeed`, V2E-0479 `datasetSnapshotId`, V2E-0480 `environmentManifestUri`. Issue #1322.

## The question

The v2 dictionary gives WorkflowRun four provenance companions: `hardwareProfile` (object, 1..1, Core), `randomSeed` (integer, 0..1, Conditional: "Obrigatório se houver aleatoriedade"), `datasetSnapshotId` (Reference(DatasetSnapshot), 1..1, Core) and `environmentManifestUri` (uri, 1..1, Core). Neither `WorkflowRun.js` nor `canonical.v1.workflow` had any of them: the model dropped them and the schema refused each as an additional property, so no write path could record the hardware, seed, snapshot or environment of a run. Which of the four does a write require now, and how is each checked, while DatasetSnapshot is written by no flow?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1322, on 2026-10-23. The pattern: `WorkflowRun.js`'s own header keeps a dictionary-required field optional exactly when nothing in the system can yet satisfy it (`inputFileIds`/`outputFileIds` before the file-link route, as `Dataset.js` does for `distributionFiles`), and `2026-10-13-specimen-role.md` enforces a live entity's 1..1 Core field on every create path.

1. **`hardwareProfile` and `environmentManifestUri` are required on every write path.** A client can always supply both, so `WorkflowRunModel.validate` and `canonical.v1.workflow` require them on the `/api/workflow-runs` route and on the ingestion route alike. `hardwareProfile` is a plain object with at least one key (not null, not an array); its keys stay open. `environmentManifestUri` is an absolute URI: a scheme, a colon and no whitespace (`^[A-Za-z][A-Za-z0-9+.-]+:\S+$`), so the dictionary example `object://synthetic/environment.json` passes. The scheme has two or more characters (#1398): a one-letter scheme is read as a drive-letter path such as `C:\manifests\env.json` or `C:/manifests/env.json`, not a URI (RFC 3986 allows one, but no registered URI scheme has one letter, and WHATWG URL parsing treats `C:` as a drive), so V2E-0480's `uri` refuses it. Because the model and the schema check the same rule, the schema's `datasetSnapshotId`, when present, also needs a non-whitespace character, as the model's `trim()` check does.
2. **`randomSeed` is an optional integer, and a seed of 0 is kept.** A present seed is a safe integer (`Number.isSafeInteger`; the schema carries the same bounds), so a numeric string, a fraction, a boolean and `2 ** 60` are refused, while 0 and negatives are valid. `create` stores 0 as 0, never as null. The server makes no "had randomness" test: whether a run was random is the client's knowledge, so the Conditional obligation is the client's to meet.
3. **`datasetSnapshotId` is accepted but optional and unresolved, a recorded departure from 1..1.** DatasetSnapshot is written by no flow (`2026-10-22-inactive-analytical-preparation-structures.md` item 1), so requiring a reference to it would force every client to invent an id that can never resolve. A present value is a non-empty string, never looked up: no backend file requires the DatasetSnapshot model or names its collection. The flow that activates DatasetSnapshot makes the field required and resolves it.
4. **The two optional companions are missingness fields.** WorkflowRun's `missingnessFields` gain `randomSeed` and `datasetSnapshotId`, so an absent one gets a MissingDataReason (RF029 AC7), and a seed of 0 is not missing. The two required ones join the schema's `required`, so a WorkflowRun's completeness is now over seven fields.

## Not decided here

- **The DatasetSnapshot activation**, and with it a required, resolved `datasetSnapshotId`.
- **Input and output manifests** (RF027 AC2), **lineage** (AC4), and **resume and derivation** (AC6).
- **A separate executor field**: the header's reuse of BaseRecord's `createdBy` stands.
- **Registering WorkflowRun in `canonical-catalog-conformance.arch.test.js`.**
- **Stored WorkflowRuns written before this change**: they carry none of the four, and PUT does not re-validate them.
