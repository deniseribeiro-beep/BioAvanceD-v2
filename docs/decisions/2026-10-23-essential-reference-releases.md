# 2026-10-23: the essential-reference loader registers a ReferenceDatasetRelease per entry before its load, writes its coverage manifest and assessment, and promotes it through promoteRelease

Requirements RF028 AC1, AC6, AC7, AC8 and RNF032 C7, C8; dictionary V2E-0489, V2E-0490. Issue #1319.

## The question

`api/backend/scripts/load-essential-references.js` loads the essential reference set (MIABIS minimal, SPREC minimal, RCS-GOV 1.0) before the API, one ReferenceImportRun per entry, and wrote each run with `referenceDatasetReleaseId: null`. Nothing registered a release for these datasets, and `api/backend/src/reference-data/essential/manifest.js` carried none of the license, retrieval URI and version fields `ReferenceDatasetReleaseModel.validate` requires. The full imports already register before the load, write a coverage manifest and an assessment, and leave the release `approved` for `promoteRelease` (`2026-10-23-reference-release-explicit-promotion.md`, `2026-10-23-reference-release-coverage-manifest.md`). How does the essential set get its releases, in what order, from which values, and when does the job fail?

## Decided

By the coordinator for #1319, on 2026-10-23:

1. **Each manifest entry carries its release fields:** `sourceId`, `datasetName`, `systemUri`, `retrievalUri`, `license`, `licenseUri`, `accessMethod`, `sourceFormat`, `parserVersion` and `mappingVersion`, beside its existing fields, which are unchanged. `retrievalUri` is `file://` and the entry's `source` path with forward slashes, as the import sources build theirs.

   | field | miabis-minimal | sprec-minimal | rcs-gov-1.0 |
   |---|---|---|---|
   | sourceId | `SRC-MIABIS` | `SRC-SPREC2` | `SRC-RCS` |
   | datasetName | `MIABIS minimal reference set` | `SPREC minimal reference set` | `RCS-GOV reference package` |
   | systemUri | `https://github.com/BBMRI-ERIC/miabis` | `https://pmc.ncbi.nlm.nih.gov/articles/PMC6463986/` | `urn:bioavanced:rcs-gov` |
   | license | `Conferir licença do repositório` | `Artigo aberto; reprodução de tabelas deve ser confirmada` | `Propriedade intelectual do projeto` |
   | licenseUri | null | null | null |
   | accessMethod | `manual_upload` | `manual_upload` | `manual_upload` |
   | sourceFormat | `Markdown` | `HTML`, `PDF` | `JSON` |
   | parserVersion, mappingVersion | `1.0.0` | `1.0.0` | `1.0.0` |

   `sourceId` and the two URLs are the Source ID and File/URL columns of the v2.0.0 `matriz-FONTES.md` rows SRC-MIABIS, SRC-SPREC2 and SRC-RCS. `datasetCode` is the entry's `key`, `datasetVersion` its `version`, and `sourceChecksum` the SHA-256 the run already computes of the entry's loaded docs and payload.
2. **A full-mode entry runs in this order:** register its release in `downloaded` status, validated by `ReferenceDatasetReleaseModel.validate`; load its docs as before; write its coverage manifest and its release DataQualityAssessment; set the release `approved` (run not failed) or `rejected` (run failed) in one write that also names `coverageManifestId` and `dataQualityAssessmentId`; insert its run, carrying the release id; and promote an approved release with a `completed` run through `promoteRelease`, which keeps the claim, the coverage gate, the supersede and the AuditEvent in one place. An invalid registration loads nothing, registers nothing and writes a `failed` run with `referenceDatasetReleaseId: null` and `validationSummary.registrationErrors`.
3. **The reuse rule:** the dataset's `active` release is reused only when its `systemUri`, `datasetVersion` and `sourceChecksum` equal the registration's (a re-run of the same content). Otherwise a new release is registered. A `superseded`, `rolled_back`, `rejected` or `approved` release is never reused. A reused active release keeps its own manifest, assessment and status, and is not promoted again.
4. **The manifest** names the release, the run (`referenceImportRunId`), the entry's `key` as `datasetCode`, the entry's `retrievalUri` as its only asset, and no exclusion. Its counts:
   - an entry with docs (MIABIS, SPREC): `expectedCount` is the docs read; `obtainedCount` is the docs read less those missing on read-back, or 0 when any doc lacks its unique keys and nothing was loaded;
   - an entry with only a payload (RCS-GOV, which writes no document): `expectedCount` and `obtainedCount` are both the payload's record count, the sum of the lengths of every array that is a top-level value of the payload or a value of a top-level plain object. Anything else counts 0, so an empty payload is `incomplete`.
5. **`promoteRelease` keeps a run's record counts when it staged nothing.** The run's `recordsInserted`, `recordsUpdated`, `recordsSkipped` and `recordsRejected` are rewritten only when the promoted run staged at least one document. The essential loader's runs stage nothing, since their own job wrote their records. A pipeline run cannot reach promotion with nothing staged: an approved run with 0 rows read is `incomplete` and refused at the coverage gate, and one whose every row was rejected is not approved.
6. **`runLoad` returns `{ blocked, runs, releases }`.** `releases` has one row per full-mode entry, `{ datasetCode, referenceDatasetReleaseId, releaseStatus, promoted, promotionReason }`, with the release's status read back after promotion. `promoted` and `promotionReason` are null when no promotion was attempted. `releases` is empty for a blocked or dry run. A dry run registers no release and its runs keep `referenceDatasetReleaseId: null`.
7. **The job exits 1** when the Foundation is not ready, when any run failed, or when any entry with a `completed` run has a release that is not `active`.

`[inference]` The license strings are copied literally from the "Licença/termos" column of the v1.3.0 `dict-01_FONTES.md` rows SRC_MIABIS3, SRC_SPREC2 and SRC_RCS, as the 16 import sources did. The v2.0.0 FONTES has no license column. No row gives a license URL, so `licenseUri` is null.

`[inference]` `urn:bioavanced:rcs-gov` names RCS-GOV, an internal artefact with no URL, in the `urn:bioavanced:` namespace that `models/ReadinessReport.js` and `models/RcsInputSnapshot.js` use.

`[inference]` `accessMethod: 'manual_upload'` and `parserVersion`/`mappingVersion` `1.0.0` are read off the 16 `sources/*.js`, every one of which bundles its data with `manual_upload` and starts at `1.0.0`.

`[inference]` `sourceFormat` follows those sources' rule: the first formats of the dict-01 "Formatos/Interface" column (`Markdown/Git`, `HTML/PDF/tabelas`, `JSON/regras/tabelas`). The bundled files themselves are JSON (MIABIS, SPREC) and a JS module (RCS-GOV), as `ucum.js` says of its JSONL fixture.

`[inference]` The RCS-GOV payload is the in-process module the RCS services read, so nothing read can be lost by a write, and its obtained count equals its expected count.

`[inference]` `maxRejectionRate` is 0 in the essential set's assessment: it accepts no rejected record, since a single keyless doc already fails its run.

`[inference]` The job promotes as its own system actor, `system:essential-reference-load`, as the 16 import scripts promote with `system:reference-data-bootstrap` (explicit-promotion decision, item 6).

`[inference]` A run that staged nothing keeps its own counts at promotion (item 5): the counts its own job wrote are the records it loaded, and a promotion that writes none must not zero them.

`[inference]` The exit code: unlike the 16 import scripts, where a refused promotion is not an error (explicit-promotion decision, item 6), this job exits 1 when a completed entry's release is not `active`, because it gates the API on the essential set.

## Not decided here

- **Preserving the bundled files as assets** (RF028 AC2, "quando aplicável"): the essential data ships in the repository, and the manifest names its `file://` URI.
- **Linking the essential documents themselves to their release** (RF028 AC5 names concepts and relations, which the essential set does not write).
