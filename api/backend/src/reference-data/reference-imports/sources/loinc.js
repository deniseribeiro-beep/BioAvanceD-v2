const path = require('path');

/**
 * RF028 eighth importer (docs-7-31-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md
 * §7.4 "Ordem recomendada da Fase 2", step 6 — "Importar LOINC e UCUM",
 * right after HGNC (#549 prior slice) closes out step 5. LOINC leads the
 * pair (UCUM follows as its own separate slice, same as every other
 * multi-source §7.4 step in this loop). Like the prior sources, this
 * imports a small bundled sample rather than a live LOINC release
 * download: this repo's architecture keeps import scripts free of live
 * network calls (seed-boundary.arch.test.js), and live download/license
 * verification is separate follow-up scope (#550) alongside the remaining
 * Fase 2 sources (#549). The fixture's LOINC codes/hierarchy are a small
 * illustrative sample (an "observation, unspecified" root plus two
 * illustrative class branches — chemistry, vital signs — with real,
 * publicly-known LOINC codes as leaves: Creatinine 2160-0, Glucose 2345-7,
 * Hemoglobin 718-7, Systolic BP 8480-6, Diastolic BP 8462-4). LOINC itself
 * has no true is_a class hierarchy the way HPO/MONDO do (its real
 * organization is the flat code list plus Part/MULTI-AXIAL mappings, out of
 * this small fixture's scope) — the class branches here are illustrative
 * groupings for pipeline mechanics only, not asserted as LOINC's own
 * hierarchy model or as a verified snapshot of any specific official
 * release.
 *
 * sourceFormat is 'CSV' per dict-01_FONTES.md's SRC_LOINC row, which
 * literally lists "CSV/RELMA/API/FHIR" — CSV is a genuine, directly-listed
 * distribution format (the official LOINC release ships as
 * LoincTableCore.csv), the first source in this loop to use CSV rather than
 * JSON/XML. The bundled fixture itself is still JSONL: pipeline.js's Parse
 * stage (parseJsonLines.js) is the only parser this repo has, and extending
 * it to a real CSV parser is out of this slice's scope (reusing pipeline.js
 * as-is, per #549).
 *
 * systemUri is 'http://loinc.org' — the well-established, HL7-FHIR-standard
 * CodeSystem URI for LOINC (used in every FHIR Observation.code.coding.system
 * that carries a LOINC code), not something requiring a judgment call the
 * way OMIM/HGNC's domain-based URIs did.
 *
 * license is 'Licença LOINC' — dict-01_FONTES.md's SRC_LOINC row states this
 * literally; no fixed license URL is given in the row, so licenseUri stays
 * null pending the real download/license-verification follow-up (#550).
 *
 * semanticType on the normalized concepts is 'observation' — LOINC catalogs
 * exams/measurements/observations (dict-01's own "Identificação padronizada
 * de exames, medições, observações e documentos"), distinct from every
 * semanticType used by a prior source in this loop.
 */
const fixturePath = path.join(__dirname, '..', 'fixtures', 'loinc-sample.jsonl');

module.exports = {
  sourceId: 'SRC_LOINC',
  datasetCode: 'LOINC',
  datasetName: 'LOINC (Logical Observation Identifiers Names and Codes)',
  systemUri: 'http://loinc.org',
  datasetVersion: 'sample-2026-08-12',
  retrievalUri: `file://${fixturePath.replace(/\\/g, '/')}`,
  fixturePath,
  accessMethod: 'manual_upload',
  sourceFormat: ['CSV'],
  license: 'Licença LOINC',
  licenseUri: null,
  parserVersion: '1.0.0',
  mappingVersion: '1.0.0',
  // Integrity gate (AC 10): computed once from this repo's own bundled
  // fixture and pinned here, standing in for a checksum an authority would
  // publish for a real release. Any drift between this and the live-computed
  // checksum fails the Integrity stage and blocks promotion.
  expectedChecksum: '5d34c76f7abb0874a54757ce9633e78e6a2ed1a3bad832a5eb2690811d2581c2',
};
