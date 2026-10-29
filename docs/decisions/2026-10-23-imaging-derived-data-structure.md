# 2026-10-23: ImagingDerivedData is modelled and entered by an administrator

Requirement: none in v4.0.0. Dictionary ELM-0355/0356. Issue #721.

## The question

Dictionary v2.0.0, "Dados ômicos e imagens", defines ImagingDerivedData (ELM-0355 `segmentationFile`, Reference 0..1; ELM-0356 `featureSet`, BackboneElement[] 0..*, "Features, software, parâmetros e região de interesse"), prepared in Phase 1. `2026-10-23-imaging-study-structure.md` built ImagingStudy and left ImagingDerivedData open; `api/backend/src/models/` did not model it. No v4.0.0 requirement names imaging. Is ImagingDerivedData built, and how is it modelled, stored and checked?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #721, on 2026-10-23:

1. **It is built, on the Phase 1 preparation rule.** This is the pattern `2026-10-23-imaging-study-structure.md` and `2026-10-23-network-biobank-structures.md` read off: each entity the release prepares in Phase 1 is a plain catalog-conformant model stored through the master-data router, with no requirement of its own.
2. **A plain catalog-conformant model, stored through the master-data router.** `api/backend/src/models/ImagingDerivedData.js` has a pure `fieldsOf`, a `validate` that returns every error and a `create` that never throws, and is registered in `canonical-catalog-conformance.arch.test.js` with one declared extra, its `imagingDerivedDataId`, the router's id key. It is stored through `createMasterDataRouter` at `/api/imaging-derived-data`, collection `imagingDerivedData`, and written by roles 3 and 4, the factory's gate. No seed: Phase 1 allows no fictitious operational data; a real row is entered by an administrator.
3. **`segmentationFile` is an unresolved reference.** When given, it is a non-empty string naming the file id of the DICOM-SEG artifact, unresolved, as `OmicsRun` `fileLinks[].fileId` is. The dictionary's authoritative persistence "Object Storage" is read as: the row is in MongoDB, and `segmentationFile` only names the artifact, which is uploaded through the existing file flows.
4. **The `featureSet` sub-shape** follows the four parts ELM-0356's description names. Each entry is an object with `software` (a non-empty string) and `features` (a non-empty list of objects, each with a non-empty string `name`) required, and `parameters` (an object) and `regionOfInterest` (a non-empty string) optional.
5. **A row fills at least one field.** Both fields are optional, and a row with neither records nothing, so a row with no `segmentationFile` and no non-empty `featureSet` is refused with `ImagingDerivedData requer segmentationFile ou featureSet`: the "at least one filled value" choice `2026-10-23-network-biobank-structures.md` item 4 made.
6. **No link to ImagingStudy.** The dictionary gives ImagingDerivedData no reference to a study, so none is stored, on the ground `2026-10-23-imaging-study-structure.md` left the specimen link out.

## Not decided here

- **Resolving `segmentationFile`** to a stored DataFile, or refusing an id no file has.
- **A reference to ImagingStudy.**
- **A canonical contract schema** in `api/backend/src/contracts/canonical/v1`.
- **The frontend** screens that enter derived data.
