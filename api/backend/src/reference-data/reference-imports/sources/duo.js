const path = require('path');

/**
 * RF028 twelfth importer (docs-7-31-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md
 * §7.4 "Ordem recomendada da Fase 2", step 8 — "Importar DUO, Uberon, NCBI
 * Taxonomy, Cell Ontology e EDAM", leading the final group of five right
 * after ATC closes out step 7 (#549 prior slice). Like the prior sources,
 * this imports a small bundled sample rather than a live GA4GH/EBISPOT DUO
 * repository download: this repo's architecture keeps import scripts free
 * of live network calls (seed-boundary.arch.test.js), and live
 * download/license verification is separate follow-up scope (#550)
 * alongside the remaining Fase 2 sources (#549). The fixture's DUO
 * codes/hierarchy are a small illustrative sample built from real,
 * publicly-known GA4GH DUO terms — the real ontology's own root (DUO:0000001
 * "data use permission") plus five genuine primary permission categories as
 * its direct children (DUO:0000004 "no restriction", DUO:0000006 "health or
 * medical or biomedical research use", DUO:0000042 "general research use",
 * DUO:0000011 "population origins or ancestry research prohibited") and one
 * genuine narrower child of DUO:0000006 (DUO:0000007 "disease specific
 * use") — plus two fabricated placeholder leaves (DUO:9001 "geographic
 * restriction", DUO:9002 "time-limited use") standing in for DUO's real
 * modifier terms without asserting specific IDs this repo hasn't verified,
 * same disclosed-fabrication pattern DCB/ATC's slices used for their own
 * placeholder codes. Unlike DCB/ATC, DUO's real ontology already has a
 * single true root, so no fabricated root ID was needed here.
 *
 * sourceFormat is 'OWL' per dict-01_FONTES.md's SRC_DUO row, which lists
 * "OWL/OBO/Git" — OWL is the genuine distribution file format (Git/OBO
 * Foundry is the repository/hosting convention, not a file format itself),
 * the third source in this loop to introduce a format outside JSON/XML
 * (after LOINC's CSV and DCB's XLSX). The bundled fixture itself is still
 * JSONL: pipeline.js's Parse stage (parseJsonLines.js) is the only parser
 * this repo has, and extending it to a real OWL parser is out of this
 * slice's scope (reusing pipeline.js as-is, per #549).
 *
 * systemUri is 'http://purl.obolibrary.org/obo/duo.owl' — DUO is a
 * registered OBO Foundry ontology with its own canonical PURL, same
 * well-established real-world convention HPO/MONDO already used for their
 * systemUri (regardless of the dict row's own "URL de download" column
 * pointing at the GitHub source repository instead), not a DCB/ORPHA-style
 * fallback to the row's own official URL.
 *
 * license is 'Licença do repositório' — dict-01_FONTES.md's SRC_DUO row
 * states this literally (verify the GA4GH/EBISPOT repository's own license
 * at real-download time, not a fixed value known ahead of time); no fixed
 * license URL is given in the row, so licenseUri stays null pending the
 * real download/license-verification follow-up (#550).
 *
 * semanticType on the normalized concepts is 'consent' — the first source
 * in this loop cataloging data-use/consent permission codes rather than
 * diseases/genes/observations/units/medications, matching dict-01's own
 * "Consentimento e uso" domain column for SRC_DUO.
 */
const fixturePath = path.join(__dirname, '..', 'fixtures', 'duo-sample.jsonl');

module.exports = {
  sourceId: 'SRC_DUO',
  datasetCode: 'DUO',
  datasetName: 'GA4GH Data Use Ontology (DUO)',
  systemUri: 'http://purl.obolibrary.org/obo/duo.owl',
  datasetVersion: 'sample-2026-08-12',
  retrievalUri: `file://${fixturePath.replace(/\\/g, '/')}`,
  fixturePath,
  accessMethod: 'manual_upload',
  sourceFormat: ['OWL'],
  license: 'Licença do repositório',
  licenseUri: null,
  parserVersion: '1.0.0',
  mappingVersion: '1.0.0',
  // Integrity gate (AC 10): computed once from this repo's own bundled
  // fixture and pinned here, standing in for a checksum an authority would
  // publish for a real release. Any drift between this and the live-computed
  // checksum fails the Integrity stage and blocks promotion.
  expectedChecksum: 'ca1a3c283b29dba7702ed8d07588f98ea4c3872b1a534df1f60f5eb19c93aa00',
};
