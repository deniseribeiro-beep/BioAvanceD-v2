const path = require('path');

/**
 * RF028 first importer (docs-7-27-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md
 * §7.4 "Ordem recomendada da Fase 2", step 2 — HPO is the documented first
 * source, right after registering sources). This slice imports a small,
 * bundled sample rather than a live HPO release download: dict-01_FONTES.md's
 * SRC_HPO row lists the license as "Conferir termos do release" (verify at
 * ingestion time, not a fixed value known ahead of time), and this
 * repo's architecture keeps import scripts free of live network calls
 * (seed-boundary.arch.test.js). Wiring the real download/license-verification
 * step against the official HPO release repository (obophenotype/
 * human-phenotype-ontology on GitHub) is follow-up scope, together with the
 * remaining 13 Fase 2 sources.
 */
const fixturePath = path.join(__dirname, '..', 'fixtures', 'hpo-sample.jsonl');

module.exports = {
  sourceId: 'SRC_HPO',
  datasetCode: 'HPO',
  datasetName: 'Human Phenotype Ontology',
  systemUri: 'http://purl.obolibrary.org/obo/hp.owl',
  datasetVersion: 'sample-2026-07-31',
  retrievalUri: `file://${fixturePath.replace(/\\/g, '/')}`,
  fixturePath,
  accessMethod: 'manual_upload',
  sourceFormat: ['JSONL'],
  license: 'HPO release license — pending verification at real-download time (see dict-01_FONTES.md SRC_HPO)',
  licenseUri: null,
  parserVersion: '1.0.0',
  mappingVersion: '1.0.0',
  // Integrity gate (AC 10): computed once from this repo's own bundled
  // fixture and pinned here, standing in for a checksum an authority would
  // publish for a real release. Any drift between this and the live-computed
  // checksum fails the Integrity stage and blocks promotion.
  expectedChecksum: 'e22e73640af34fabd78467122399ac0908bc1508ba6a226cdb31bb24650a86b4',
};
