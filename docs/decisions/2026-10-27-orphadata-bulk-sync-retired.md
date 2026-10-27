# 2026-10-27: the Orphadata bulk sync is retired, not rerouted into the reference-release path

Requirements RF028 AC2, AC6, AC7; dictionary P1X-0476, P1X-0490. Issue #115.

## The question

`syncFromOrphadata` in `terminologySync.service.js`, served at `POST /api/terminologies/sync`, upserted ORPHA records from the first of three Orphadata API endpoints that answered non-empty (`/rd-cross-referencing/orphacodes`, `/rd-phenotypes/orphacodes`, `/rd-classification/orphacodes`), straight into the legacy `terminologies` and `orphanet_diseases` collections. It registered no release and wrote no coverage manifest, so a partial import was invisible. Denise deferred it on 2026-07-10 "to the canonical data modeling phase". That phase has delivered: v2.0.0 was approved on 2026-09-12, and the reference-release path carries ORPHA. Is the bulk sync rebuilt on that path, or retired?

## Decided

Proposed for #115 and approved by Dennis on 2026-10-27:

**The bulk sync is retired, not rebuilt.** `syncFromOrphadata`, its helpers `extractRecords` and `fetchJsonWithTimeout`, and its constants `DEFAULT_TIMEOUT_MS` and `ORPHADATA_BASE_URL` are removed from `terminologySync.service.js`, and `POST /api/terminologies/sync` is no longer served. The approved v2.0.0 release (`docs/RELEASE_MANIFEST.json`, `releaseStatus: approved`, read through `docs/extracted-v2.0.0/`) answers each question the deferral left open:

- **Which source is canonical, and where ORPHA lives:** RF028 (`docs/extracted-v2.0.0/requisitos.md`) lists the entities ReferenceDatasetRelease, ReferenceImportRun, ReferenceImportIssue, ReferenceCoverageManifest, TerminologyConcept and TerminologyRelation. Its requirement reads "importar, validar, versionar e promover dados de referência aprovados na Fase 2 por releases explícitas, preservando origem, licença, cobertura, qualidade e rollback". AC2 is "Adquirir somente fontes aprovadas e preservar o asset no Object Storage quando aplicável." AC6 is "Gerar ReferenceCoverageManifest com assets/endpoints, expectedCount, obtainedCount e exclusões justificadas." In the dictionary, TerminologyConcept P1X-0476 is `systemUri | uri | 1..1 | Core` and P1X-0490 is `referenceDatasetReleaseId | Reference | 1..1 | Core`: every concept belongs to a release.
- **The plan's Fase 2** (`docs/extracted-v2.0.0/plano.md`) gives step 2 as "Adquirir somente assets/endpoints aprovados e registrar o manifesto esperado.", and its Cobertura gate reads "Contagem completa ou exclusão justificada | Bloquear promoção".
- **Whether `orphanet_diseases` is a projection:** none of the extracted v2.0.0 files names `terminologies` or `orphanet_diseases`. A grep for `orphanet` and `terminologies` over `dict-MIGRACAO_V1_3_PARA_V2.md`, `persistencia-poliglota.md`, `relatorio-consistencia.md` and `dict-ENTIDADES.md` has no hits. Neither collection is a canonical store.
- **Cross-references, phenotypes and classifications:** these are TerminologyRelation and DiseaseConcept `mappings` (ELM-0266). They are not separate import endpoints.
- **The code already has the canonical path.** `api/backend/src/reference-data/reference-imports/sources/orpha.js` is `SRC_ORPHA` / `http://www.orpha.net`, the Orphanet Nomenclature Pack, imported through `pipeline.js`. `api/backend/scripts/reference-imports/live-verify/liveVerifySources.js` verifies the live ORPHA pack. Each full run writes a ReferenceCoverageManifest, and `promoteRelease` refuses `coverage_incomplete` (`2026-10-23-reference-release-coverage-manifest.md`). That decision already enforces gate F2-G09 for ORPHA.
- **Rerouting the Orphadata API into the release path is ruled out:** `api/backend/tests/architecture/reference-live-verify-boundary.arch.test.js` forbids any `fetch(` under `src/reference-data/reference-imports/`, and SRC_ORPHA is the pack, not the API.

`[inference]` The release model makes the bulk sync redundant: Denise's "Keep external Orphadata sync outside the current operational contract" becomes removing it. The inference rests on the repo's consistent choice to retire a legacy writer once its release-backed store exists. `2026-10-23-biomarker-knowledge-off-disease-dictionary.md` retired `disease_dictionary`'s readers and seed once BiomarkerAssociation existed. `2026-10-23-essential-reference-releases.md` moved the essential loader onto releases. Dennis approved the retirement in the sitting that wrote this record.

## Not decided here

- **The per-term live lookups** in `routes/orphanet.js` and `GET /api/terminologies`, which still call Orphadata when `ALLOW_EXTERNAL_TERMINOLOGY_SYNC` and `ORPHADATA_BASE_URL` are set.
- **Retiring the `terminologies` and `orphanet_diseases` collections themselves.**
- **The env keys** `ALLOW_EXTERNAL_TERMINOLOGY_SYNC` and `ORPHADATA_BASE_URL`, which stay because those lookups read them.
