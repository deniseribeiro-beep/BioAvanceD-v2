const path = require('path');

/**
 * RF028 third importer (docs-7-31-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md
 * §7.4 "Ordem recomendada da Fase 2", step 4 — ORPHA leads the
 * "ORPHA, CID-11, CID-10 e OMIM" group right after MONDO). Like HPO (#367)
 * and MONDO (#548), this imports a small bundled sample rather than a live
 * Orphanet Nomenclature Pack download: this repo's architecture keeps import
 * scripts free of live network calls (seed-boundary.arch.test.js), and live
 * download/license verification is separate follow-up scope (#550) alongside
 * the remaining Fase 2 sources (#549). The fixture's ORPHAcodes/labels/
 * hierarchy are a small illustrative sample (a "rare disease" root plus two
 * branches), standing in for a real release the same way hpo-sample.jsonl/
 * mondo-sample.jsonl do — not asserted here as a verified snapshot of any
 * specific official Orphanet Nomenclature Pack release.
 *
 * sourceFormat is 'XML' per dict-01_FONTES.md's SRC_ORPHA row (the pack's
 * real distribution format has no JSON option, unlike HPO/MONDO's OBO/OWL/
 * JSON/TSV — so this field can't borrow their "JSON" justification for
 * JSONL). The bundled fixture itself is still JSONL: pipeline.js's Parse
 * stage (parseJsonLines.js) is the only parser this repo has, and extending
 * it to a real XML parser is out of this slice's scope (reusing pipeline.js
 * as-is, per #549).
 *
 * Like MONDO, dict-01_FONTES.md's SRC_ORPHA row already gives a fixed
 * license (CC BY 4.0 para o pack), so this source doesn't carry a
 * pending-verification note the way HPO does.
 */
const fixturePath = path.join(__dirname, '..', 'fixtures', 'orpha-sample.jsonl');

module.exports = {
  sourceId: 'SRC_ORPHA',
  datasetCode: 'ORPHA',
  datasetName: 'Orphanet Nomenclature Pack',
  systemUri: 'http://www.orpha.net',
  datasetVersion: 'sample-2026-08-12',
  retrievalUri: `file://${fixturePath.replace(/\\/g, '/')}`,
  fixturePath,
  accessMethod: 'manual_upload',
  sourceFormat: ['XML'],
  license: 'CC BY 4.0',
  licenseUri: 'https://creativecommons.org/licenses/by/4.0/',
  parserVersion: '1.0.0',
  mappingVersion: '1.0.0',
  // Integrity gate (AC 10): computed once from this repo's own bundled
  // fixture and pinned here, standing in for a checksum an authority would
  // publish for a real release. Any drift between this and the live-computed
  // checksum fails the Integrity stage and blocks promotion.
  expectedChecksum: 'ebe4e30d76fde57fc5566a22755c0887ca52c180671dcd5d408cbb8142113359',
};
