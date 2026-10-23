# 2026-10-23: the RCS matrix is resolved by a versioned mapping release, and the input snapshot records its material and release

Requirement RF018 AC4. Dictionary V2E-0500..0502 (RCSInputSnapshot matrix, materialTypeCode, matrixMappingReleaseId), V2E-0236..0243 (SPRECMappingRelease). Issue #1320. Sequel to `2026-10-23-rcs-input-snapshot-write.md`, whose "Not decided here" list named the `detectMatrixType` inference.

## The question

RF018 AC4 asks that the matrix be recorded explicitly as fluid or solid, with materialTypeCode and matrixMappingReleaseId, and that the matrix never be inferred by an unversioned rule. `detectMatrixType` inferred fluid or solid from hard-coded substrings of `sampleType`/`sampleOrigin` and from the presence of solid SPREC axes, a rule with no version or checksum, and `RcsInputSnapshot.capture` forced both fields to null. How is that rule versioned, and what does the snapshot record, without changing a score, grade, penalty, route, result key or `calculation_trace` (which `MerkleService.js` hashes)?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1320, on 2026-10-23:

1. **The release reproduces the base rule unchanged.** `reference-data/rcs-matrix-mapping.RCS-GOV-1.0.json` holds the base rule as data, in its order: the fluid sample-text terms, the solid sample-text terms, then the solid SPREC axes. `resolveMatrix` walks those rules and the first match wins; `detectMatrixType` returns its matrix. An explicit `matrix_type`/`matrixType` is read exactly as before. So no input that was classified changes matrix, and none changes score; a test holds the service equal to a verbatim copy of the base rule over every seeded catalog description, and `certify`'s result gains no key.
2. **An explicit matrix carries a null release id.** A matrix the payload states is resolved by no release, so its `matrixMappingReleaseId` is null, never fabricated, the pattern of item 2 of the snapshot-write decision. The release id is written only for a matrix the release resolved, and `capture` keeps it only beside a fluid or solid matrix.
3. **materialTypeCode is the SPREC 2.0 type-of-sample code.** It is kept only when the normalized `sprec.sampleType` is a `sampleType` entry of the resolved matrix's seeded catalog, as the Coding `{ systemUri, code, version, display }` the snapshot model already uses, under the minted system URI `urn:bioavanced:sprec-2.0:type-of-sample` (the repo mints `urn:bioavanced:` URIs, as the snapshot URI does). `recordAssessment` writes the material and the release id only when the resolution's matrix is the result's own `matrix_type`; otherwise both are null.
4. **The release checksum is canonical JSON over the seed.** `matrixMappingRelease()` returns the release id, SPREC version, mapping version (SemVer), compatibility status, status and `sha256:` plus the SHA-256 of `canonicalJson` over the seeded release, as `governanceRuleSet()` checksums the gate's rules. The mapping is not added to the governance rule set, whose checksum stays `sha256:0aa3cb01efdf45f4e1d08809ba30ffad1386f56c982a5cf07088d1f26c2b52d5`.
5. **The seed is the release.** The seed's `sprec_mapping_release_id` is the release's identity, resolvable in `rcs-reference-data` as `matrixMapping`, so a snapshot's `matrixMappingReleaseId` names a release the code carries.

## Not decided here

- **A SPRECMappingRelease model, collection or API**, and the snapshot's `sprecMappingReleaseId` (AC1), which stays null.
- **A check that an explicit matrix agrees with its material**: an explicit matrix with a material outside its catalog keeps a null materialTypeCode and is not refused.
- **Replacing text matching by a code-based mapping** from the SPREC type of sample to the matrix, which would change what some inputs score.
