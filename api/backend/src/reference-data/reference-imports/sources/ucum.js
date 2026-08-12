const path = require('path');

/**
 * RF028 ninth importer (docs-7-31-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md
 * §7.4 "Ordem recomendada da Fase 2", step 6 — "Importar LOINC e UCUM",
 * closing out the pair right after LOINC (#549 prior slice). Like the prior
 * sources, this imports a small bundled sample rather than a live UCUM
 * specification download: this repo's architecture keeps import scripts
 * free of live network calls (seed-boundary.arch.test.js), and live
 * download/license verification is separate follow-up scope (#550)
 * alongside the remaining Fase 2 sources (#549). The fixture's UCUM codes/
 * hierarchy are a small illustrative sample (a "unit, unspecified" root
 * plus two illustrative branches — mass units, concentration units — with
 * real, well-known UCUM codes as leaves: mg, kg, mg/dL, mmol/L, mm[Hg]).
 * UCUM itself has no true is_a hierarchy the way HPO/MONDO do (its real
 * organization is a dimensional-analysis grammar over base/derived units,
 * out of this small fixture's scope) — the branches here are illustrative
 * groupings for pipeline mechanics only, not asserted as UCUM's own model
 * or as a verified snapshot of any specific official release.
 *
 * sourceFormat is 'XML' per dict-01_FONTES.md's SRC_UCUM row, which
 * literally lists "XML/especificação" — no JSON option, so this follows
 * ORPHA/ICD-10's XML special-case precedent rather than HPO/MONDO/ICD-11/
 * HGNC's JSON precedent. The bundled fixture itself is still JSONL:
 * pipeline.js's Parse stage (parseJsonLines.js) is the only parser this
 * repo has, and extending it to a real XML parser is out of this slice's
 * scope (reusing pipeline.js as-is, per #549).
 *
 * systemUri is 'http://unitsofmeasure.org' — the well-established,
 * HL7-FHIR-standard CodeSystem URI for UCUM (used in every FHIR
 * Quantity.system that carries a UCUM unit), same no-judgment-call shape
 * as LOINC's systemUri.
 *
 * license is 'Licença UCUM' — dict-01_FONTES.md's SRC_UCUM row states this
 * literally; no fixed license URL is given in the row, so licenseUri stays
 * null pending the real download/license-verification follow-up (#550).
 *
 * semanticType on the normalized concepts is 'unit' — UCUM catalogs units
 * of measure (dict-01's own "Representação computável e não ambígua de
 * unidades"), distinct from every semanticType used by a prior source in
 * this loop.
 */
const fixturePath = path.join(__dirname, '..', 'fixtures', 'ucum-sample.jsonl');

module.exports = {
  sourceId: 'SRC_UCUM',
  datasetCode: 'UCUM',
  datasetName: 'UCUM (Unified Code for Units of Measure)',
  systemUri: 'http://unitsofmeasure.org',
  datasetVersion: 'sample-2026-08-12',
  retrievalUri: `file://${fixturePath.replace(/\\/g, '/')}`,
  fixturePath,
  accessMethod: 'manual_upload',
  sourceFormat: ['XML'],
  license: 'Licença UCUM',
  licenseUri: null,
  parserVersion: '1.0.0',
  mappingVersion: '1.0.0',
  // Integrity gate (AC 10): computed once from this repo's own bundled
  // fixture and pinned here, standing in for a checksum an authority would
  // publish for a real release. Any drift between this and the live-computed
  // checksum fails the Integrity stage and blocks promotion.
  expectedChecksum: 'b1b47459f69eb85475454d48f122bf63a6cf0ed91f3e3bffab49be10185e40a8',
};
