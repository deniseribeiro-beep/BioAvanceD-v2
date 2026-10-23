# 2026-10-23: ImagingStudy is modelled and entered by an administrator

Requirement: none in v4.0.0. Dictionary ELM-0353/0354. Issue #721.

## The question

Dictionary v2.0.0, "Dados ômicos e imagens", defines ImagingStudy (ELM-0353 `dicomStudyUid`, ELM-0354 `series`) and ImagingDerivedData (ELM-0355/0356), all `maintained` and prepared in Phase 1, with ImagingStudy stored in MongoDB and no graph projection required. `api/backend/src/models/` modelled neither: `OmicsRun.js` covers ELM-0343..0352 only. Requisitos v4.0.0 RF027 (`docs/extracted-v2.0.0/requisitos.md` lines 859-885) no longer lists imaging, and no other v4.0.0 requirement names it. Is ImagingStudy built, and how is it modelled, stored and checked?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #721, on 2026-10-23:

1. **It is built, on the Phase 1 preparation rule.** The requisitos phase model has Fase 1 "Preparar integralmente entidades, campos, contratos, enums..." (`docs/extracted-v2.0.0/requisitos.md` lines 51-56), and the dictionary rows are prepared in Phase 1. This is the anchor `2026-10-22-inactive-analytical-preparation-structures.md` and `2026-10-23-network-biobank-structures.md` read off: each entity the release prepares in Phase 1 is modelled as a plain catalog-conformant model, with no requirement of its own.
2. **A plain catalog-conformant model, stored through the master-data router.** `api/backend/src/models/ImagingStudy.js` has a pure `fieldsOf`, a `validate` and a `create` that never throws, and is registered in `canonical-catalog-conformance.arch.test.js` with one declared extra, its `imagingStudyId`, the router's id key. It is stored through `createMasterDataRouter` at `/api/imaging-studies`, like `/api/omics-runs`, and written by roles 3 and 4, the factory's gate. No seed: Phase 1 allows no fictitious operational data (`docs/extracted-v2.0.0/requisitos.md` lines 51-58); a real row is entered by an administrator.
3. **The UID rule and the series sub-shape.** `dicomStudyUid` and every series and instance `uid` is a DICOM UID as DICOM PS3.5 section 9.1 defines it: dot-separated numeric components, no leading zero in a component, at most 64 characters. Each `series` entry follows the catalog's FHIR mapping `ImagingStudy.series` (FHIR R4): `uid` and `modality` required; `bodySite`, `numberOfInstances` (a non-negative integer), `instance` (entries with a `uid`) and `endpoint` (non-empty references) optional, with FHIR's singular names kept. `series` is 1..*, and two entries with one `uid` are refused.
4. **`modality` and `bodySite` are open codes.** `dict-ENUMS.md` has no set for either; a given one must be a non-empty string, and no set is checked.

## Not decided here

- **ImagingDerivedData** (ELM-0355/0356).
- **Uniqueness of `dicomStudyUid`.** v1.3.0 indexed it "Único" and catalog.2.0.0's `uniquenessRule` defers to that; no unique index or 409 check is built here.
- **A canonical contract schema** in `api/backend/src/contracts/canonical/v1`.
- **A link from a study to a specimen or participant**: the dictionary has none.
- **The frontend** screens that enter a study.
