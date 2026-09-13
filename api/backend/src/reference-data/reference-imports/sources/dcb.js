const path = require('path');

/**
 * RF028 tenth importer (docs-7-31-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md
 * §7.4 "Ordem recomendada da Fase 2", step 7 — "Importar DCB e ATC/DDD,
 * mantendo curadoria de mappings", right after UCUM (#549 prior slice)
 * closes out step 6. DCB leads the pair per the plan's own wording order
 * ("DCB e ATC/DDD"); ATC follows as its own separate slice, same as every
 * other multi-source §7.4 step in this loop. Like the prior sources, this
 * imports a small bundled sample rather than a live ANVISA DCB portal
 * download: this repo's architecture keeps import scripts free of live
 * network calls (seed-boundary.arch.test.js), and live download/license
 * verification is separate follow-up scope (#550) alongside the remaining
 * Fase 2 sources (#549). The fixture's DCB entries/hierarchy are a small
 * illustrative sample (a "fármaco, não especificado" root plus two
 * illustrative therapeutic-class branches — analgésicos e antitérmicos,
 * anti-hipertensivos — with real, publicly-known Brazilian drug names as
 * leaves: paracetamol, dipirona sódica, ibuprofeno, captopril, losartana
 * potássica). The DCB:NNNN identifiers are fabricated placeholders, not
 * asserted as real official DCB registry numbers — this repo doesn't cite
 * ANVISA's actual numeric DCB codes without verifying the current edition,
 * per dict-01_FONTES.md's own SRC_DCB observação ("Não fixar número de IN
 * atualizadora sem verificar a edição vigente").
 *
 * sourceFormat is 'XLSX' per dict-01_FONTES.md's SRC_DCB row, which
 * literally lists "XLSX/PDF/portal" — XLSX is a genuine, directly-listed
 * distribution format (ANVISA's own DCB list ships as a spreadsheet), the
 * second source in this loop to use a format outside JSON/XML (after
 * LOINC's CSV), no XML/JSON special-case reasoning needed. The bundled
 * fixture itself is still JSONL: pipeline.js's Parse stage
 * (parseJsonLines.js) is the only parser this repo has, and extending it
 * to a real XLSX parser is out of this slice's scope (reusing pipeline.js
 * as-is, per #549).
 *
 * systemUri is dict-01's own "URL oficial" for SRC_DCB
 * (https://www.gov.br/anvisa/pt-br/assuntos/farmacopeia/dcb) — unlike
 * LOINC/UCUM, there's no HL7-FHIR-standard or identifiers.org-style
 * canonical system URI for a Brazil-specific national nomenclature like
 * DCB, so this follows ORPHA's precedent of using the row's own official
 * URL as the canonical system identifier when no other established
 * real-world convention exists.
 *
 * license is 'Termos do portal oficial' — dict-01_FONTES.md's SRC_DCB row
 * states this literally; no fixed license URL is given in the row, so
 * licenseUri stays null pending the real download/license-verification
 * follow-up (#550).
 *
 * semanticType on the normalized concepts is 'medication' — the first
 * source in this loop cataloging pharmaceutical substances rather than
 * diseases/genes/observations/units.
 */
const fixturePath = path.join(__dirname, '..', 'fixtures', 'dcb-sample.jsonl');

module.exports = {
  sourceId: 'SRC_DCB',
  datasetCode: 'DCB',
  datasetName: 'DCB (Denominação Comum Brasileira)',
  systemUri: 'https://www.gov.br/anvisa/pt-br/assuntos/farmacopeia/dcb',
  datasetVersion: 'sample-2026-08-12',
  retrievalUri: `file://${fixturePath.replace(/\\/g, '/')}`,
  fixturePath,
  accessMethod: 'manual_upload',
  sourceFormat: ['XLSX'],
  license: 'Termos do portal oficial',
  licenseUri: null,
  parserVersion: '1.0.0',
  mappingVersion: '1.0.0',
  // Integrity gate (AC 10): computed once from this repo's own bundled
  // fixture and pinned here, standing in for a checksum an authority would
  // publish for a real release. Any drift between this and the live-computed
  // checksum fails the Integrity stage and blocks promotion.
  expectedChecksum: '9f8e77fa4531060c72554c773830636f4bfd5c8e762298c441705bb4326d8bb8',
};
