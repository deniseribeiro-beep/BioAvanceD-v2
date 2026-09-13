const path = require('path');

/**
 * RF028 eleventh importer (docs-7-31-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md
 * §7.4 "Ordem recomendada da Fase 2", step 7 — "Importar DCB e ATC/DDD,
 * mantendo curadoria de mappings", closing out the pair right after DCB
 * (#549 prior slice). Like the prior sources, this imports a small bundled
 * sample rather than a live WHOCC ATC/DDD Index download: this repo's
 * architecture keeps import scripts free of live network calls
 * (seed-boundary.arch.test.js), and live download/license verification is
 * separate follow-up scope (#550) alongside the remaining Fase 2 sources
 * (#549). The fixture's ATC codes/hierarchy are a small illustrative
 * sample built from real, publicly-known WHO ATC/DDD entries — two
 * genuine level-1 anatomical groups (C "cardiovascular system", N "nervous
 * system") under one fabricated common root (disclosed below), each with
 * one genuine intermediate subgroup (C09A "ACE inhibitors, plain", N02B
 * "other analgesics and antipyretics") and genuine chemical-substance
 * leaves (C09AA01 captopril, N02BE01 paracetamol, N02BA01 acetylsalicylic
 * acid). This is a shallow slice through the real 5-level ATC hierarchy
 * (intermediate levels — e.g. C09 "agents acting on the renin-angiotensin
 * system", C09AA "ACE inhibitors, plain" as the pharmacological subgroup —
 * are skipped for brevity), not a verified snapshot of the full official
 * index; the "ATC:0" root has no real-world ATC equivalent (WHO's real
 * top level is 14 independent anatomical groups with no common parent) and
 * is a pipeline-mechanics convenience only, same disclosed-fabrication
 * pattern DCB's slice used for its own root/IDs.
 *
 * sourceFormat is 'XML' per dict-01_FONTES.md's SRC_ATC row, which
 * literally lists "Portal/XML/XLSX conforme aquisição" — XML is a
 * genuine, directly-listed distribution option (alongside XLSX), following
 * ORPHA/ICD-10/UCUM's XML precedent. The bundled fixture itself is still
 * JSONL: pipeline.js's Parse stage (parseJsonLines.js) is the only parser
 * this repo has, and extending it to a real XML parser is out of this
 * slice's scope (reusing pipeline.js as-is, per #549).
 *
 * systemUri is 'http://www.whocc.no/atc' — the well-established
 * HL7-FHIR-standard CodeSystem URI for ATC, no judgment call needed, same
 * no-ambiguity shape as LOINC/UCUM's systemUri.
 *
 * license is 'Termos WHOCC' — dict-01_FONTES.md's SRC_ATC row states this
 * literally; no fixed license URL is given in the row, so licenseUri stays
 * null pending the real download/license-verification follow-up (#550).
 *
 * semanticType on the normalized concepts is 'medication', same as DCB —
 * ATC classifies pharmaceutical substances too, just internationally
 * rather than nationally (Brazil-specific).
 */
const fixturePath = path.join(__dirname, '..', 'fixtures', 'atc-sample.jsonl');

module.exports = {
  sourceId: 'SRC_ATC',
  datasetCode: 'ATC',
  datasetName: 'ATC/DDD (Anatomical Therapeutic Chemical Classification System)',
  systemUri: 'http://www.whocc.no/atc',
  datasetVersion: 'sample-2026-08-12',
  retrievalUri: `file://${fixturePath.replace(/\\/g, '/')}`,
  fixturePath,
  accessMethod: 'manual_upload',
  sourceFormat: ['XML'],
  license: 'Termos WHOCC',
  licenseUri: null,
  parserVersion: '1.0.0',
  mappingVersion: '1.0.0',
  // Integrity gate (AC 10): computed once from this repo's own bundled
  // fixture and pinned here, standing in for a checksum an authority would
  // publish for a real release. Any drift between this and the live-computed
  // checksum fails the Integrity stage and blocks promotion.
  expectedChecksum: '45563570fdbd282706c4be6e0b5082832d88edb722a27e75b016983c786b8235',
};
