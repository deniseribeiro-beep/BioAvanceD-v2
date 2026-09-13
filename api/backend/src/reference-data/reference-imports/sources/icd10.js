const path = require('path');

/**
 * RF028 fifth importer (docs-7-31-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md
 * §7.4 "Ordem recomendada da Fase 2", step 4 — ICD-10 (CID-10 in the plan's
 * Portuguese text) is the third member of the "ORPHA, CID-11, CID-10 e
 * OMIM" group, right after ICD-11. Like HPO (#367)/MONDO (#548)/ORPHA
 * (#549 first slice)/ICD-11 (#549 fourth slice), this imports a small
 * bundled sample rather than a live WHO ICD-10 download: this repo's
 * architecture keeps import scripts free of live network calls
 * (seed-boundary.arch.test.js), and live download/license verification is
 * separate follow-up scope (#550) alongside the remaining Fase 2 sources
 * (#549). The fixture's codes/labels/hierarchy are a small illustrative
 * sample (an "illness, unspecified" root plus two chapter-range branches),
 * standing in for a real release the same way hpo-sample.jsonl/
 * mondo-sample.jsonl/orpha-sample.jsonl/icd11-sample.jsonl do — not
 * asserted here as a verified snapshot of any specific official ICD-10
 * edition.
 *
 * sourceFormat is 'XML' per dict-01_FONTES.md's SRC_ICD10 row: unlike
 * SRC_ICD11 ("REST/JSON/Browser"), the row's Formato column for SRC_ICD10
 * is "Browser/arquivos licenciados" — no JSON option is listed, so this
 * can't borrow ICD-11/HPO/MONDO's "JSON is a real listed distribution
 * format" justification for JSONL. This follows ORPHA's XML special-case
 * precedent instead: WHO's own ICD-10 distribution outside the browser UI
 * is ClaML, an XML-based format, the closest real serialization implied
 * by the row. The bundled fixture itself is still JSONL: pipeline.js's
 * Parse stage (parseJsonLines.js) is the only parser this repo has, and
 * extending it to a real XML/ClaML parser is out of this slice's scope
 * (reusing pipeline.js as-is, per #549).
 *
 * systemUri is the HL7 FHIR standard system URI for the WHO ICD-10 code
 * system (http://hl7.org/fhir/sid/icd-10) — the FHIR-terminology-binding
 * counterpart to ICD-11's MMS linearization URI, distinct from the
 * national-edition/ICD-10-CM URIs FHIR also defines.
 *
 * license is 'Termos WHO/edição nacional' — dict-01_FONTES.md's SRC_ICD10
 * row states this literally (its own value, not simply reused from
 * SRC_ICD11's row, since ICD-10 legacy compatibility folds in
 * national-edition terms per the row's "Mantenedor" column, "WHO/autoridade
 * nacional"); no fixed license URL is given in the row, so licenseUri
 * stays null pending the real download/license-verification follow-up
 * (#550) — check https://icd.who.int/browse10/2019/en (the row's "URL
 * oficial") for the applicable terms at that time.
 */
const fixturePath = path.join(__dirname, '..', 'fixtures', 'icd10-sample.jsonl');

module.exports = {
  sourceId: 'SRC_ICD10',
  datasetCode: 'ICD10',
  datasetName: 'ICD-10 (International Statistical Classification of Diseases and Related Health Problems, 10th Revision)',
  systemUri: 'http://hl7.org/fhir/sid/icd-10',
  datasetVersion: 'sample-2026-08-12',
  retrievalUri: `file://${fixturePath.replace(/\\/g, '/')}`,
  fixturePath,
  accessMethod: 'manual_upload',
  sourceFormat: ['XML'],
  license: 'Termos WHO/edição nacional',
  licenseUri: null,
  parserVersion: '1.0.0',
  mappingVersion: '1.0.0',
  // Integrity gate (AC 10): computed once from this repo's own bundled
  // fixture and pinned here, standing in for a checksum an authority would
  // publish for a real release. Any drift between this and the live-computed
  // checksum fails the Integrity stage and blocks promotion.
  expectedChecksum: '4e3a3d224275295de8fa170950458d92b0f412a6fabcb20877282fb4a6ad3c49',
};
