const path = require('path');

/**
 * RF028 thirteenth importer (docs-7-31-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md
 * §7.4 "Ordem recomendada da Fase 2", step 8 — "Importar DUO, Uberon, NCBI
 * Taxonomy, Cell Ontology e EDAM", second of the final five right after DUO
 * (#549 prior slice). Like the prior sources, this imports a small bundled
 * sample rather than a live OBO Foundry Uberon download: this repo's
 * architecture keeps import scripts free of live network calls
 * (seed-boundary.arch.test.js), and live download/license verification is
 * separate follow-up scope (#550) alongside the remaining Fase 2 sources
 * (#549). The fixture's Uberon codes/hierarchy are a small illustrative
 * sample built from real, publicly-known Uberon terms — the real
 * ontology's own root (UBERON:0001062 "anatomical entity") plus four
 * genuine organ-level terms as its direct children (UBERON:0000948
 * "heart", UBERON:0002107 "liver", UBERON:0002048 "lung", UBERON:0000955
 * "brain") and one genuine narrower child of UBERON:0000948
 * (UBERON:0002082 "cardiac ventricle") — plus two fabricated placeholder
 * leaves (UBERON:9001 "accessory anatomical structure", UBERON:9002
 * "regional anatomical subdivision") standing in for further real
 * subdivisions without asserting specific IDs this repo hasn't verified,
 * same disclosed-fabrication pattern DCB/ATC/DUO's slices used for their
 * own placeholder codes. Like DUO, Uberon's real ontology already has a
 * single true root, so no fabricated root ID was needed here.
 *
 * sourceFormat is 'OWL' per dict-01_FONTES.md's SRC_UBERON row, which
 * lists "OWL/OBO" — same format as DUO, the fourth source in this loop to
 * use a format outside JSON/XML (after LOINC's CSV, DCB's XLSX, and DUO's
 * OWL). The bundled fixture itself is still JSONL: pipeline.js's Parse
 * stage (parseJsonLines.js) is the only parser this repo has, and
 * extending it to a real OWL parser is out of this slice's scope (reusing
 * pipeline.js as-is, per #549).
 *
 * systemUri is 'http://purl.obolibrary.org/obo/uberon.owl' — taken
 * directly from dict-01_FONTES.md's SRC_UBERON row "URL de download"
 * column, which (unlike DUO's row) already points at Uberon's genuine OBO
 * Foundry PURL rather than a GitHub source repository, so no HPO/MONDO-
 * style convention judgment call was needed here.
 *
 * license is 'Licença indicada no OBO Foundry' — dict-01_FONTES.md's
 * SRC_UBERON row states this literally (verify the OBO Foundry's own
 * license terms for Uberon at real-download time, not a fixed value known
 * ahead of time); no fixed license URL is given in the row, so licenseUri
 * stays null pending the real download/license-verification follow-up
 * (#550).
 *
 * semanticType on the normalized concepts is 'anatomy' — the first source
 * in this loop cataloging anatomical structures/body sites rather than
 * diseases/genes/observations/units/medications/consent, matching
 * dict-01's own "Anatomia" category column for SRC_UBERON and its "Não
 * usar para: Tipo celular ou diagnóstico" note (cell-type coverage is
 * reserved for Cell Ontology, the next source in this group).
 */
const fixturePath = path.join(__dirname, '..', 'fixtures', 'uberon-sample.jsonl');

module.exports = {
  sourceId: 'SRC_UBERON',
  datasetCode: 'UBERON',
  datasetName: 'Uberon Multi-species Anatomy Ontology',
  systemUri: 'http://purl.obolibrary.org/obo/uberon.owl',
  datasetVersion: 'sample-2026-08-12',
  retrievalUri: `file://${fixturePath.replace(/\\/g, '/')}`,
  fixturePath,
  accessMethod: 'manual_upload',
  sourceFormat: ['OWL'],
  license: 'Licença indicada no OBO Foundry',
  licenseUri: null,
  parserVersion: '1.0.0',
  mappingVersion: '1.0.0',
  // Integrity gate (AC 10): computed once from this repo's own bundled
  // fixture and pinned here, standing in for a checksum an authority would
  // publish for a real release. Any drift between this and the live-computed
  // checksum fails the Integrity stage and blocks promotion.
  expectedChecksum: 'f6d4a0f5c1a1e09682543cd657c37f3fcf3dff5b01fcdb9655b743b27ce20d08',
};
