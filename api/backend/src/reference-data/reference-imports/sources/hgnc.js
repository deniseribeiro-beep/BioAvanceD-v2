const path = require('path');

/**
 * RF028 seventh importer (docs-7-31-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md
 * §7.4 "Ordem recomendada da Fase 2", step 5 — "Importar HGNC e relações
 * gene-fenótipo/doença", right after the §7.4 step 4 group (ORPHA/CID-11/
 * CID-10/OMIM, #549 prior slices) finishes. Like those, this imports a
 * small bundled sample rather than a live HGNC REST download: this repo's
 * architecture keeps import scripts free of live network calls
 * (seed-boundary.arch.test.js), and live download/license verification is
 * separate follow-up scope (#550) alongside the remaining Fase 2 sources
 * (#549). The fixture's HGNC IDs/symbols/hierarchy are a small illustrative
 * sample (a "gene, unspecified" root plus two illustrative gene-family
 * branches) mixing real, publicly-known HGNC ID/symbol pairs (BRCA1
 * HGNC:1100, TP53 HGNC:11998, CFTR HGNC:1884, APOE HGNC:613) with one
 * fabricated "modifier gene" leaf for hierarchy depth — not asserted here
 * as a verified snapshot of any specific official HGNC release, and the
 * fabricated leaf entry is not a real HGNC entry at all.
 *
 * sourceFormat is 'JSON' per dict-01_FONTES.md's SRC_HGNC row, which
 * literally lists "TSV/JSON/REST" as the distribution formats/interface —
 * JSON is a genuine, directly-listed option here (unlike ORPHA/ICD-10's
 * XML-only rows), so this follows HPO/MONDO/ICD-11's precedent directly,
 * no special-case reasoning needed the way OMIM's ambiguous "API/arquivos
 * autorizados" row required.
 *
 * systemUri follows ORPHA/OMIM's precedent of using the terminology's own
 * well-established domain as its canonical system identifier —
 * 'https://www.genenames.org', the row's own "URL oficial".
 *
 * license is 'Termos HGNC; confirmar redistribuição' — dict-01_FONTES.md's
 * SRC_HGNC row states this literally; no fixed license URL is given in the
 * row, so licenseUri stays null pending the real download/license-
 * verification follow-up (#550).
 *
 * semanticType on the normalized concepts is 'gene', not 'disease'/
 * 'phenotype' — the first source in this loop cataloging genes rather than
 * diseases/phenotypes, matching dict-01's own "Fonte primária de símbolos e
 * identificadores de genes humanos" role description.
 */
const fixturePath = path.join(__dirname, '..', 'fixtures', 'hgnc-sample.jsonl');

module.exports = {
  sourceId: 'SRC_HGNC',
  datasetCode: 'HGNC',
  datasetName: 'HGNC (HUGO Gene Nomenclature Committee)',
  systemUri: 'https://www.genenames.org',
  datasetVersion: 'sample-2026-08-12',
  retrievalUri: `file://${fixturePath.replace(/\\/g, '/')}`,
  fixturePath,
  accessMethod: 'manual_upload',
  sourceFormat: ['JSON'],
  license: 'Termos HGNC; confirmar redistribuição',
  licenseUri: null,
  parserVersion: '1.0.0',
  mappingVersion: '1.0.0',
  // Integrity gate (AC 10): computed once from this repo's own bundled
  // fixture and pinned here, standing in for a checksum an authority would
  // publish for a real release. Any drift between this and the live-computed
  // checksum fails the Integrity stage and blocks promotion.
  expectedChecksum: '289af6ac69f4840ac58c65c9175c492fce66b899899e8bc025b353046c130f18',
};
