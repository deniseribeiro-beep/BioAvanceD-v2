const path = require('path');

/**
 * RF028 second importer (docs-7-31-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md
 * §7.4 "Ordem recomendada da Fase 2", step 3 — MONDO right after HPO). Like
 * HPO (#367), this imports a small bundled sample rather than a live MONDO
 * release download: this repo's architecture keeps import scripts free of
 * live network calls (seed-boundary.arch.test.js), and live download/license
 * verification is separate follow-up scope (#550) alongside the remaining 12
 * Fase 2 sources (#549). The fixture's disease codes/labels/hierarchy are a
 * small illustrative sample (root "disease or disorder" plus two disease
 * branches), standing in for a real release the same way hpo-sample.jsonl
 * stands in for a live HPO download — not asserted here as a verified
 * snapshot of any specific official MONDO release.
 *
 * Unlike HPO's "verify at ingestion" placeholder, dict-01_FONTES.md's
 * SRC_MONDO row already gives a fixed license (CC BY 4.0), so this source
 * doesn't carry a pending-verification note.
 */
const fixturePath = path.join(__dirname, '..', 'fixtures', 'mondo-sample.jsonl');

module.exports = {
  sourceId: 'SRC_MONDO',
  datasetCode: 'MONDO',
  datasetName: 'Mondo Disease Ontology',
  systemUri: 'http://purl.obolibrary.org/obo/mondo.owl',
  datasetVersion: 'sample-2026-08-12',
  retrievalUri: `file://${fixturePath.replace(/\\/g, '/')}`,
  fixturePath,
  accessMethod: 'manual_upload',
  sourceFormat: ['JSONL'],
  license: 'CC BY 4.0',
  licenseUri: 'https://creativecommons.org/licenses/by/4.0/',
  parserVersion: '1.0.0',
  mappingVersion: '1.0.0',
  // Integrity gate (AC 10): computed once from this repo's own bundled
  // fixture and pinned here, standing in for a checksum an authority would
  // publish for a real release. Any drift between this and the live-computed
  // checksum fails the Integrity stage and blocks promotion.
  expectedChecksum: '85a646d6fb9a83524960f26a7a301aabf8ab75f2b3e9ed46815ddfc43ba59167',
};
