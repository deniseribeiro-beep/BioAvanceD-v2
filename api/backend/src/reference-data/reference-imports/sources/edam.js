const path = require('path');

/**
 * RF028 sixteenth and final importer (docs-7-31-2026/3-Plano_Integrado_
 * Foundation_Data_Pipeline.md §7.4 "Ordem recomendada da Fase 2", step 8 —
 * "Importar DUO, Uberon, NCBI Taxonomy, Cell Ontology e EDAM", closing out
 * the final five right after Cell Ontology (#549 prior slice) and the
 * entire 16-source Fase 2 group. Like the prior sources, this imports a
 * small bundled sample rather than a live EDAM download: this repo's
 * architecture keeps import scripts free of live network calls
 * (seed-boundary.arch.test.js), and live download/license verification is
 * separate follow-up scope (#550). The fixture's codes are a small
 * illustrative sample built from real, publicly-known EDAM terms (verified
 * directly against EBI OLS's `edam` ontology API, not assumed from
 * memory), rather than the single-root shape every prior OBO/OWL source in
 * this loop (DUO, Uberon, Cell Ontology) used: EDAM is genuinely organized
 * into four independent branches, not one hierarchy — Data, Format,
 * Operation and Topic each have their own root with no shared parent —
 * matching dict-01_FONTES.md's own SRC_EDAM "Campos usados" column ("Tipo
 * de dado, formato de arquivo, operação e tópico de análise"). The fixture
 * carries all four genuine roots (data_0006 "Data", format_1915 "Format",
 * operation_0004 "Operation", topic_0003 "Topic") plus one genuine direct
 * child of each (data_2044 "Sequence", format_3464 "JSON", operation_2945
 * "Data analysis", topic_0605 "Informatics") and one genuine narrower
 * child of data_2044 (data_2977 "Nucleic acid sequence", a real is_a
 * relationship in the ontology) — plus two fabricated placeholder leaves
 * under the Format and Topic branches (format_9001 "specialized format
 * subtype", topic_9002 "regional discipline subdivision") standing in for
 * further real subtypes without asserting specific IDs this repo hasn't
 * verified, same disclosed-fabrication pattern DCB/ATC/DUO/Uberon/NCBI
 * Taxonomy/Cell Ontology's slices used for their own placeholder codes.
 * Unlike every prior single-root source in this loop, EDAM genuinely needs
 * four real roots rather than one fabricated or single genuine root.
 *
 * sourceFormat is 'OWL' per dict-01_FONTES.md's SRC_EDAM row, which lists
 * "OWL" directly (not "OWL/OBO" like DUO/Uberon/Cell Ontology's rows) —
 * no HPO/MONDO-style interpretation judgment call was needed here, the
 * row's literal value already matches the stored array as-is. The bundled
 * fixture itself is still JSONL: pipeline.js's Parse stage
 * (parseJsonLines.js) is the only parser this repo has, and extending it
 * to a real OWL parser is out of this slice's scope (reusing pipeline.js
 * as-is, per #549).
 *
 * systemUri is 'http://edamontology.org/EDAM.owl' — taken directly from
 * dict-01_FONTES.md's SRC_EDAM row "URL de download" column, which (like
 * Uberon's and Cell Ontology's rows, unlike DUO's) already points at
 * EDAM's genuine ontology PURL directly, so no HPO/MONDO-style convention
 * judgment call was needed here.
 *
 * license is 'Licença do projeto' — dict-01_FONTES.md's SRC_EDAM row
 * states this literally, distinct wording from Uberon/Cell Ontology's
 * "Licença indicada no OBO Foundry" (EDAM's row points at
 * edamontology.org directly, not an obofoundry.org listing page — verify
 * the project's own license terms at real-download time, not a fixed
 * value known ahead of time); no fixed license URL is given in the row,
 * so licenseUri stays null pending the real download/license-verification
 * follow-up (#550).
 *
 * semanticType on the normalized concepts is 'bioinformatics' — dict-01's
 * own "Bioinformática" domain column for SRC_EDAM, translated the same way
 * every prior source's domain column became its semanticType (e.g.
 * "Tipos celulares" → 'cell-type', "Consentimento e uso" → 'consent'), and
 * distinct from every semanticType used by a prior source in this loop.
 * Kept as one fixed value across all four EDAM branches (data/format/
 * operation/topic) rather than deriving a different semanticType per
 * branch — every normalizer in this loop returns one constant
 * semanticType regardless of the record's own shape, and this slice
 * follows that same established pattern rather than introducing a new
 * per-record derivation.
 */
const fixturePath = path.join(__dirname, '..', 'fixtures', 'edam-sample.jsonl');

module.exports = {
  sourceId: 'SRC_EDAM',
  datasetCode: 'EDAM',
  datasetName: 'EDAM Ontology',
  systemUri: 'http://edamontology.org/EDAM.owl',
  datasetVersion: 'sample-2026-08-12',
  retrievalUri: `file://${fixturePath.replace(/\\/g, '/')}`,
  fixturePath,
  accessMethod: 'manual_upload',
  sourceFormat: ['OWL'],
  license: 'Licença do projeto',
  licenseUri: null,
  parserVersion: '1.0.0',
  mappingVersion: '1.0.0',
  // Integrity gate (AC 10): computed once from this repo's own bundled
  // fixture and pinned here, standing in for a checksum an authority would
  // publish for a real release. Any drift between this and the live-computed
  // checksum fails the Integrity stage and blocks promotion.
  expectedChecksum: '2d3da71dda5d7b9318bed6238de47d1159a93112c9ae7e77055ca46e5ca56500',
};
