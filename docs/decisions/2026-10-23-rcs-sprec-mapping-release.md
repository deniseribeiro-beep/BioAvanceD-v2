# 2026-10-23: the SPREC codes, severities and weights are a versioned mapping release, which the input snapshot and each resolved axis name

Requirement RF018 AC1 and AC6. Dictionary V2E-0236..0243 (SPRECMappingRelease), V2E-0506 (RCSInputSnapshot.sprecMappingReleaseId), V2E-0520 (RCSPreanalyticalAxisInput.severityMappingReleaseId). Issue #1320. Sequel to `2026-10-23-rcs-versioned-matrix-mapping.md`, whose "Not decided here" list named the snapshot's `sprecMappingReleaseId`, and to `2026-10-23-rcs-axis-results-and-route-reasons.md`, whose list named the severity mapping release id.

## The question

RF018 AC1 asks that SPREC 2.0 be the RCS baseline with a versioned mapping and a checksum, SPREC 4.0 being roadmap only, and AC6 that each axis preserve its mapping release. No release covered the SPREC codes, severities and weights the score reads: `RcsInputSnapshot.capture` forced `sprecMappingReleaseId` (V2E-0506) to null and `evaluateAxisResults` wrote a null `severityMappingReleaseId` (V2E-0520) on every axis. Which release is it, how is it checksummed, and when is it named, without changing a score, grade, penalty, route, `certify` result key or `calculation_trace` (which `MerkleService.js` hashes)?

## Decided

`[inference]`, from the specification and the repo's pattern (the matrix mapping release, and a reference no release backs being null, never fabricated), by the coordinator for #1320, on 2026-10-23:

1. **The seed is the release.** `reference-data/rcs-sprec-mapping.RCS-GOV-1.0.json` holds the release's identity (`sprec_mapping_release_id`, SPREC version `SPREC-2.0`, mapping version `1.0.0`, compatibility status `current_baseline`, status `active`), its migration note that SPREC 4.0 is roadmap only, and the names of the four tables it covers: the fluid and solid SPREC catalogs, the severity mapping and the axis weights. `rcs-reference-data` exposes it frozen as `sprecMapping`, beside `matrixMapping`.
2. **The checksum is over the tables (V2E-0239).** `sprecMappingRelease()` returns the release's identity fields and `sha256:` plus the SHA-256 of `canonicalJson` over the release with the catalogs, severity mappings and weights it names. The grade thresholds are not codes, severities or weights and stay out. With no release in the data it is null. `governanceRuleSet()` and `matrixMappingRelease()` are unchanged, and their checksums stay `sha256:0aa3cb01efdf45f4e1d08809ba30ffad1386f56c982a5cf07088d1f26c2b52d5` and `sha256:d5749ff8cc4a834c7042b6d283b3634bbb3c1a856c4a15a278d786a7391d904e`.
3. **Only a resolved axis names the release.** `evaluateAxisResults` writes the release id as `severityMappingReleaseId` on a `resolved` axis, whose severity and weight the release's tables gave, and null on an absent, unknown, not_scored, invalid or incompatible axis, and on every axis when the data holds no release.
4. **The snapshot keeps the release id it is given.** `RcsInputSnapshot.capture` keeps `sprecMappingReleaseId` when it is a non-empty string, else null, inside the hash. It has no matrix condition, since the release covers both matrices.
5. **The release is named only on positive evidence that it gave the stored result.** `recordAssessment` passes the release id to `capture` only when `certify` over the captured `rcs_input` reproduces the stored result on `model_version`, `matrix_type`, `governance_status`, `p_bio`, `rcs_score`, `final_grade`, `grade_route` and `axis_penalties`, compared as canonical JSON with an absent key read as null. These are the keys the FHIR staging preview keeps, so a preview-shaped result qualifies. Otherwise, and with no `rcs_input` or no release, the snapshot's id is null and every `rcsAxisResults` entry's `severityMappingReleaseId` is null, so no axis names a release the snapshot does not. The assessment's other fields, `calculation_trace` included, are unchanged.

## Not decided here

- **A SPRECMappingRelease model, collection or API**: the release is resolvable only in `rcs-reference-data`.
- **effectivePeriod (V2E-0242) for this release or the matrix mapping release**: no source gives a start date, and none is fabricated.
- **The RCSRulePackage**, which would version the grade thresholds.
- **Writing `preanalyticalAxes` into the input snapshot** as RCSPreanalyticalAxisInput documents.
