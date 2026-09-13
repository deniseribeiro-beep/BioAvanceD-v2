const path = require('path');

/**
 * RF028 fourteenth importer (docs-7-31-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md
 * §7.4 "Ordem recomendada da Fase 2", step 8 — "Importar DUO, Uberon, NCBI
 * Taxonomy, Cell Ontology e EDAM", third of the final five right after
 * Uberon (#549 prior slice). Like the prior sources, this imports a small
 * bundled sample rather than a live NCBI Taxonomy download: this repo's
 * architecture keeps import scripts free of live network calls
 * (seed-boundary.arch.test.js), and live download/license verification is
 * separate follow-up scope (#550) alongside the remaining Fase 2 sources
 * (#549). The fixture's TaxIDs/lineage are a small illustrative sample
 * built from real, publicly-known NCBI Taxonomy nodes — the real
 * taxonomy's own root (TaxID 1 "root") plus its four genuine top-level
 * children (131567 "cellular organisms", 10239 "Viruses", 28384 "other
 * sequences", 12908 "unclassified sequences") and one genuine narrower
 * child of "cellular organisms" (2759 "Eukaryota") — plus 2 disclosed
 * fabricated placeholder leaves (TaxID 9000001/9000002, chosen well above
 * any taxid NCBI has assigned to date), same disclosed-fabrication pattern
 * DCB/ATC/DUO/Uberon used. Like DUO/Uberon, NCBI Taxonomy's real hierarchy
 * already has a single true root, so no fabricated root ID was needed.
 *
 * sourceFormat is 'JSON' per dict-01_FONTES.md's SRC_NCBITAX row, which
 * literally lists "Taxdump/REST/JSON" as the distribution formats/
 * interface — JSON is a genuine, directly-listed option here, so this
 * follows HPO/MONDO/ICD-11/HGNC's precedent (pick JSON when the row lists
 * it as a real option) rather than DUO/Uberon's OWL special-case (their
 * rows had no JSON option at all). The bundled fixture itself is still
 * JSONL: pipeline.js's Parse stage (parseJsonLines.js) is the only parser
 * this repo has, and extending it to a real NCBI taxdump/REST parser is
 * out of this slice's scope (reusing pipeline.js as-is, per #549).
 *
 * systemUri is 'http://purl.obolibrary.org/obo/ncbitaxon.owl' — NCBI
 * Taxonomy is a registered OBO Foundry ontology (ncbitaxon) with its own
 * canonical PURL, same well-established real-world convention HPO/MONDO/
 * DUO/Uberon already used for their systemUri. dict-01_FONTES.md's
 * SRC_NCBITAX row lists `https://www.ncbi.nlm.nih.gov/taxonomy` (URL
 * oficial) and `https://www.ncbi.nlm.nih.gov/datasets/docs/v2/api/rest-
 * api/` (URL de download/API) — neither is a canonical systemUri in the
 * OBO-PURL sense (they're NCBI's own web/API-doc pages, not a system
 * identifier), so this needed the same HPO/MONDO-style convention
 * judgment call DUO's row required, not a DCB/ORPHA-style fallback to the
 * row's own listed URL.
 *
 * license is 'Termos NCBI' — dict-01_FONTES.md's SRC_NCBITAX row states
 * this literally (not a placeholder pending verification), same shape as
 * ICD-11's "Termos WHO"; no fixed license URL is given in the row, so
 * licenseUri stays null pending the real download/license-verification
 * follow-up (#550).
 *
 * semanticType on the normalized concepts is 'organism' — the first
 * source in this loop cataloging organism/taxonomic classification rather
 * than anatomy/diseases/genes/observations/units/medications/consent,
 * matching dict-01's own "Organismos" domain column for SRC_NCBITAX and
 * its "Não usar para: Anatomia ou tipo celular" note (those stay Uberon's
 * and Cell Ontology's, the next source in this group).
 */
const fixturePath = path.join(__dirname, '..', 'fixtures', 'ncbitax-sample.jsonl');

module.exports = {
  sourceId: 'SRC_NCBITAX',
  datasetCode: 'NCBITAX',
  datasetName: 'NCBI Taxonomy',
  systemUri: 'http://purl.obolibrary.org/obo/ncbitaxon.owl',
  datasetVersion: 'sample-2026-08-12',
  retrievalUri: `file://${fixturePath.replace(/\\/g, '/')}`,
  fixturePath,
  accessMethod: 'manual_upload',
  sourceFormat: ['JSON'],
  license: 'Termos NCBI',
  licenseUri: null,
  parserVersion: '1.0.0',
  mappingVersion: '1.0.0',
  // Integrity gate (AC 10): computed once from this repo's own bundled
  // fixture and pinned here, standing in for a checksum an authority would
  // publish for a real release. Any drift between this and the live-computed
  // checksum fails the Integrity stage and blocks promotion.
  expectedChecksum: '26151d82187d68f1c9388d61f7171a2c7739e3395a101e711daf3804df1668b4',
};
