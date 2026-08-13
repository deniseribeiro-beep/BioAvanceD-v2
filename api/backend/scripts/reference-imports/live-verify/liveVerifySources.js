// #555/#556 (RF028/#550): live-source registry for the workflow_dispatch-only
// verify job. Deliberately separate from src/reference-data/reference-imports
// /sources/*.js — those stay pointed at the bundled fixture only, per
// reference-import-boundary.arch.test.js. HPO (#556, the pilot), MONDO, and
// ORPHA (#557) are populated so far; the other 13 sources are #557's
// remaining scope, added here one entry at a time (per docs-7-31-2026/
// 3-Plano_Integrado_Foundation_Data_Pipeline.md §7.4 "Ordem recomendada da
// Fase 2" order: CID-11, CID-10, OMIM next).
//
// Each entry carries a `kind` deciding which verification shape
// verify-live-release.js runs: 'github-release' (default, omittable — HPO/
// MONDO's shape: GitHub releases API + a LICENSE file/page reachable by
// URL) or 'direct-download' (ORPHA's shape: a stable direct file URL with
// no releases API, license stated on the download's own landing page — see
// verifyDirectDownload's comment in verify-live-release.js). Not every
// remaining source will fit either shape as-is (e.g. WHO's ICD-11/ICD-10
// and OMIM are API-key-gated per dict-01_FONTES.md's SRC_ICD11/SRC_ICD10/
// SRC_OMIM rows) — confirm live shape before assuming one of these two
// covers it.
//
// releaseApiUrl/licenseUrl/expectedAssetName (or assetUrl for
// direct-download entries) confirmed live against the real upstream before
// being added — never assumed from training-data recall. HPO/MONDO:
// 2026-08-12/13 via `gh api repos/<org>/<repo>` + `.../releases/latest`.
// ORPHA: 2026-08-13 via curl against orphacode.org (no GitHub involved) —
// same verification discipline EDAM's #549 slice established.
module.exports = {
  HPO: {
    datasetCode: 'HPO',
    repo: 'obophenotype/human-phenotype-ontology',
    releaseApiUrl: 'https://api.github.com/repos/obophenotype/human-phenotype-ontology/releases/latest',
    licenseUrl: 'https://raw.githubusercontent.com/obophenotype/human-phenotype-ontology/master/LICENSE.md',
    // GitHub reports license.spdx_id "NOASSERTION" for this repo — LICENSE.md
    // itself points at https://hpo.jax.org/app/license for the real terms,
    // so verification here checks the pointer text is present, not an SPDX id.
    expectedLicensePointer: 'hpo.jax.org/app/license',
    expectedAssetName: 'hp.owl', // matches sources/hpo.js's systemUri basename
  },
  // #557: confirmed live against GitHub on 2026-08-13 (gh api
  // repos/monarch-initiative/mondo and .../releases/latest). Unlike HPO,
  // GitHub auto-detects this repo's license (spdx_id "CC-BY-4.0", matching
  // sources/mondo.js's 'CC BY 4.0' fixture license exactly), so the LICENSE
  // file's full legal text is the pointer target rather than a redirect page.
  MONDO: {
    datasetCode: 'MONDO',
    repo: 'monarch-initiative/mondo',
    releaseApiUrl: 'https://api.github.com/repos/monarch-initiative/mondo/releases/latest',
    licenseUrl: 'https://raw.githubusercontent.com/monarch-initiative/mondo/master/LICENSE',
    expectedLicensePointer: 'Attribution 4.0 International',
    expectedAssetName: 'mondo.owl', // matches sources/mondo.js's systemUri basename
  },
  // #557: confirmed live on 2026-08-13 against orphacode.org directly (curl
  // -I on the pack URL, curl on the pack-nomenclature landing page). No
  // GitHub involved and no version in the pack's filename (SRC_ORPHA in
  // dict-01_FONTES.md: "Download/API", pack updated annually in place) — the
  // HEAD request's Last-Modified header (currently 2026-07-02, this year's
  // pack) is the only release-date signal available, so this is the
  // 'direct-download' kind rather than 'github-release'.
  ORPHA: {
    datasetCode: 'ORPHA',
    kind: 'direct-download',
    assetUrl: 'https://www.orphacode.org/data/packs/Orphanet_Nomenclature_Pack_EN.zip',
    licenseUrl: 'https://www.orphacode.org/pack-nomenclature/',
    // The landing page links CC BY 4.0 as "CC BY 4.0 licence" pointing at
    // creativecommons.org/licenses/by/4.0 — matching sources/orpha.js's
    // 'CC BY 4.0' fixture license. Matching the URL fragment rather than the
    // surrounding marketing prose, same durability reasoning as HPO's
    // pointer choice.
    expectedLicensePointer: 'creativecommons.org/licenses/by/4.0',
  },
};
