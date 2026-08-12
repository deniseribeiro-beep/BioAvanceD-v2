// #555/#556 (RF028/#550): live-source registry for the workflow_dispatch-only
// verify job. Deliberately separate from src/reference-data/reference-imports
// /sources/*.js — those stay pointed at the bundled fixture only, per
// reference-import-boundary.arch.test.js. Only HPO is populated this slice
// (#556, the pilot); the other 15 sources are #557's scope, added here one
// entry at a time following the same shape.
//
// releaseApiUrl/licenseUrl/expectedAssetName confirmed live against GitHub
// on 2026-08-12 (gh api repos/obophenotype/human-phenotype-ontology and
// .../releases/latest) rather than assumed from training-data recall — same
// verification discipline EDAM's #549 slice established.
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
};
