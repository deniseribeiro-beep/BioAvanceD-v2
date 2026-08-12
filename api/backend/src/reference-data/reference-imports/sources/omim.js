const path = require('path');

/**
 * RF028 sixth importer (docs-7-31-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md
 * §7.4 "Ordem recomendada da Fase 2", step 4 — OMIM closes out the "ORPHA,
 * CID-11, CID-10 e OMIM" group, right after ICD-10. Like HPO (#367)/MONDO
 * (#548)/ORPHA/ICD-11/ICD-10 (#549 prior slices), this imports a small
 * bundled sample rather than a live OMIM API download: this repo's
 * architecture keeps import scripts free of live network calls
 * (seed-boundary.arch.test.js), and live download/license verification is
 * separate follow-up scope (#550) alongside the remaining Fase 2 sources
 * (#549). The fixture's MIM numbers/titles/hierarchy are a small
 * illustrative sample (a Phenotypic Series root plus real, publicly-known
 * MIM entries as branches/leaves — cystic fibrosis 219700, familial
 * hypercholesterolemia 143890, Marfan syndrome 154700, Huntington disease
 * 143100 — with three fabricated "modifier locus"-style leaf entries under
 * them for hierarchy depth), standing in for a real release the same way
 * hpo-sample.jsonl/mondo-sample.jsonl/orpha-sample.jsonl/icd11-sample.jsonl/
 * icd10-sample.jsonl do — not asserted here as a verified snapshot of any
 * specific official OMIM release, and the fabricated leaf entries are not
 * real OMIM entries at all.
 *
 * sourceFormat is 'JSON' per dict-01_FONTES.md's SRC_OMIM row: the row's
 * Formato column ("API/arquivos autorizados") doesn't literally spell out
 * "JSON" the way HPO/MONDO/ICD-11's rows do, but OMIM's own REST API
 * (https://omim.org/api) is documented to serve entries in JSON when
 * requested with format=json — a real, genuine JSON distribution option,
 * unlike ORPHA/ICD-10's XML-only cases. This follows HPO/MONDO/ICD-11's
 * "JSON is a real listed/documented format" precedent rather than ORPHA/
 * ICD-10's XML special-case.
 *
 * systemUri follows ORPHA's precedent of using the terminology's own
 * well-established domain as its canonical system identifier (rather than
 * an HL7 FHIR sid, which doesn't have an OMIM entry) — 'https://www.omim.org',
 * the URI HL7's own genomics-reporting FHIR IGs cite as OMIM's CodeSystem.
 *
 * license is 'Termos OMIM; conteúdo narrativo restrito' — dict-01_FONTES.md's
 * SRC_OMIM row states this literally; no fixed license URL is given in the
 * row, so licenseUri stays null pending the real download/license-
 * verification follow-up (#550) — check https://www.omim.org/ (the row's
 * "URL oficial") for the applicable terms at that time.
 *
 * Judgment call carried from the prior handoff: SRC_OMIM's row is the first
 * of the six sources built so far whose Autenticação column reads "Chave/
 * API/licença" (a key/license is required for real API access) rather than
 * an open-access "Não". This doesn't change accessMethod or the bundled-
 * fixture pattern here — every source in this loop stays a bundled-fixture,
 * manual_upload import regardless of what its real access method would be,
 * since the architecture boundary test (seed-boundary.arch.test.js) keeps
 * every import script free of live network calls. The auth requirement is
 * purely a note for #550's future live-download work: unlike the five
 * open-access sources already done, a real OMIM download will need an API
 * key/license step that #550's scope doesn't yet have to design for the
 * other sources.
 */
const fixturePath = path.join(__dirname, '..', 'fixtures', 'omim-sample.jsonl');

module.exports = {
  sourceId: 'SRC_OMIM',
  datasetCode: 'OMIM',
  datasetName: 'OMIM (Online Mendelian Inheritance in Man)',
  systemUri: 'https://www.omim.org',
  datasetVersion: 'sample-2026-08-12',
  retrievalUri: `file://${fixturePath.replace(/\\/g, '/')}`,
  fixturePath,
  accessMethod: 'manual_upload',
  sourceFormat: ['JSON'],
  license: 'Termos OMIM; conteúdo narrativo restrito',
  licenseUri: null,
  parserVersion: '1.0.0',
  mappingVersion: '1.0.0',
  // Integrity gate (AC 10): computed once from this repo's own bundled
  // fixture and pinned here, standing in for a checksum an authority would
  // publish for a real release. Any drift between this and the live-computed
  // checksum fails the Integrity stage and blocks promotion.
  expectedChecksum: '875a6770850dfc1c149cf05e2684fc2be6f95fd41d86f7ff4c4dfcf80127a7fe',
};
