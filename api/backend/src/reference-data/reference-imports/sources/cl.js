const path = require('path');

/**
 * RF028 fifteenth importer (docs-7-31-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md
 * §7.4 "Ordem recomendada da Fase 2", step 8 — "Importar DUO, Uberon, NCBI
 * Taxonomy, Cell Ontology e EDAM", fourth of the final five right after NCBI
 * Taxonomy (#549 prior slice). Like the prior sources, this imports a small
 * bundled sample rather than a live OBO Foundry Cell Ontology download: this
 * repo's architecture keeps import scripts free of live network calls
 * (seed-boundary.arch.test.js), and live download/license verification is
 * separate follow-up scope (#550) alongside the remaining Fase 2 source
 * (#549). The fixture's CL codes/hierarchy are a small illustrative sample
 * built from real, publicly-known Cell Ontology terms — the real ontology's
 * own root (CL:0000000 "cell") plus four genuine direct children (CL:0000255
 * "eukaryotic cell", CL:0000003 "native cell", CL:0000738 "leukocyte",
 * CL:0000842 "mononuclear cell") and one genuine narrower child of
 * CL:0000738 (CL:0000542 "lymphocyte", a real is_a relationship in the
 * ontology) — plus two fabricated placeholder leaves (CL:9001 "accessory
 * cell subtype", CL:9002 "regional cell subdivision") standing in for
 * further real subtypes without asserting specific IDs this repo hasn't
 * verified, same disclosed-fabrication pattern DCB/ATC/DUO/Uberon/NCBI
 * Taxonomy's slices used for their own placeholder codes. Like Uberon/NCBI
 * Taxonomy, Cell Ontology's real hierarchy already has a single true root,
 * so no fabricated root ID was needed here.
 *
 * sourceFormat is 'OWL' per dict-01_FONTES.md's SRC_CL row, which lists
 * "OWL/OBO" — same format as DUO/Uberon, the fifth source in this loop to
 * use a format outside JSON/XML (after LOINC's CSV, DCB's XLSX, DUO's OWL,
 * and Uberon's OWL). The bundled fixture itself is still JSONL: pipeline.js's
 * Parse stage (parseJsonLines.js) is the only parser this repo has, and
 * extending it to a real OWL parser is out of this slice's scope (reusing
 * pipeline.js as-is, per #549).
 *
 * systemUri is 'http://purl.obolibrary.org/obo/cl.owl' — taken directly
 * from dict-01_FONTES.md's SRC_CL row "URL de download" column, which
 * (like Uberon's row, unlike DUO's) already points at Cell Ontology's
 * genuine OBO Foundry PURL rather than a GitHub source repository, so no
 * HPO/MONDO-style convention judgment call was needed here.
 *
 * license is 'Licença indicada no OBO Foundry' — dict-01_FONTES.md's SRC_CL
 * row states this literally, the same literal text as Uberon's row (verify
 * the OBO Foundry's own license terms for Cell Ontology at real-download
 * time, not a fixed value known ahead of time); no fixed license URL is
 * given in the row, so licenseUri stays null pending the real download/
 * license-verification follow-up (#550).
 *
 * semanticType on the normalized concepts is 'cell-type' — the value
 * reserved for Cell Ontology back when Uberon shipped (Uberon's own
 * source-file comment), matching dict-01's own "Tipos celulares" domain
 * column for SRC_CL and its "Não usar para: Linhagem física da amostra ou
 * anatomia completa" note (those stay ISBER/Uberon's — full anatomy is
 * Uberon's, physical specimen lineage belongs to the sample/specimen
 * entities themselves, not a terminology source).
 */
const fixturePath = path.join(__dirname, '..', 'fixtures', 'cl-sample.jsonl');

module.exports = {
  sourceId: 'SRC_CL',
  datasetCode: 'CL',
  datasetName: 'Cell Ontology',
  systemUri: 'http://purl.obolibrary.org/obo/cl.owl',
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
  expectedChecksum: '63395eb49ad616fd7de8b36d0f4e1415546ba861ed5303f97274505aba452916',
};
