const path = require('path');

/**
 * RF028 fourth importer (docs-7-31-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md
 * §7.4 "Ordem recomendada da Fase 2", step 4 — ICD-11 (CID-11 in the plan's
 * Portuguese text) is the second member of the "ORPHA, CID-11, CID-10 e
 * OMIM" group, right after ORPHA. Like HPO (#367)/MONDO (#548)/ORPHA (#549
 * first slice), this imports a small bundled sample rather than a live WHO
 * ICD-11 API download: this repo's architecture keeps import scripts free
 * of live network calls (seed-boundary.arch.test.js), and live download/
 * license verification is separate follow-up scope (#550) alongside the
 * remaining Fase 2 sources (#549). The fixture's MMS codes/labels/hierarchy
 * are a small illustrative sample (an "unspecified disease" root plus two
 * chapter-level branches), standing in for a real release the same way
 * hpo-sample.jsonl/mondo-sample.jsonl/orpha-sample.jsonl do — not asserted
 * here as a verified snapshot of any specific official ICD-11 release.
 *
 * sourceFormat is 'JSONL' per dict-01_FONTES.md's SRC_ICD11 row listing
 * "REST/JSON/Browser" as the real distribution formats/interface — JSON is
 * a genuine option there (unlike ORPHA's XML-only pack), so this follows
 * HPO/MONDO's precedent rather than ORPHA's XML special-case.
 *
 * systemUri is the WHO ICD-11 MMS linearization URI used as the CodeSystem
 * system in HL7 FHIR terminology bindings (http://id.who.int/icd/release/11/mms).
 *
 * license is 'Termos WHO' — dict-01_FONTES.md's SRC_ICD11 row states this
 * literally (not a placeholder pending verification the way HPO's row
 * does); no fixed license URL is given in the row, unlike MONDO/ORPHA's
 * named CC BY 4.0 license, so licenseUri stays null pending the real
 * download/license-verification follow-up (#550) — check
 * https://icd.who.int/en (the row's "URL oficial") for the WHO ICD API
 * terms of use at that time.
 */
const fixturePath = path.join(__dirname, '..', 'fixtures', 'icd11-sample.jsonl');

module.exports = {
  sourceId: 'SRC_ICD11',
  datasetCode: 'ICD11',
  datasetName: 'ICD-11 (International Classification of Diseases, 11th Revision)',
  systemUri: 'http://id.who.int/icd/release/11/mms',
  datasetVersion: 'sample-2026-08-12',
  retrievalUri: `file://${fixturePath.replace(/\\/g, '/')}`,
  fixturePath,
  accessMethod: 'manual_upload',
  sourceFormat: ['JSONL'],
  license: 'Termos WHO',
  licenseUri: null,
  parserVersion: '1.0.0',
  mappingVersion: '1.0.0',
  // Integrity gate (AC 10): computed once from this repo's own bundled
  // fixture and pinned here, standing in for a checksum an authority would
  // publish for a real release. Any drift between this and the live-computed
  // checksum fails the Integrity stage and blocks promotion.
  expectedChecksum: '7100b8f56fe0e0c9ccb8c2cd31fe0bf81287d9be79f3e6930ceec419ea90ff09',
};
