/**
 * Lab-only registry for REFERENCE_IMPORT_PROFILE=full-lab.
 * Kept out of sources/*.js so the default e2e/CI path stays fixture-only
 * (reference-import-boundary.arch.test.js).
 *
 * strategy:
 *   - preplaced: dump must exist under REFERENCE_FULL_ASSET_DIR/<CODE>/
 *   - convert: raw file is converted to JSONL in REFERENCE_FULL_CACHE_DIR
 *
 * ATC (and other WHOCC/ANVISA/OMIM/LOINC/ICD sources) are preplaced-only —
 * the operator SCPs the licensed dump; this lab never scrapes gated portals.
 */
module.exports = {
  HPO: {
    datasetCode: 'HPO',
    strategy: 'convert',
    rawCandidates: ['hp.json', 'data.json', 'hp.owl'],
    jsonlCandidates: ['data.jsonl', 'hpo.jsonl'],
    convert: 'hpo-json',
  },
  MONDO: {
    datasetCode: 'MONDO',
    strategy: 'convert',
    rawCandidates: ['mondo.json', 'data.json', 'mondo.owl'],
    jsonlCandidates: ['data.jsonl', 'mondo.jsonl'],
    convert: 'mondo-json', // not implemented yet — resolve fails with clear message
  },
  ORPHA: {
    datasetCode: 'ORPHA',
    strategy: 'convert',
    rawCandidates: ['Orphanet_Nomenclature_Pack_EN.zip', 'data.xml'],
    jsonlCandidates: ['data.jsonl', 'orpha.jsonl'],
    convert: 'orpha-pack',
    note: 'Orphadata nomenclature pack also yields intake-records.jsonl with ORPHA↔OMIM↔ICD-10 relacoes for wizard autofill.',
  },
  HGNC: {
    datasetCode: 'HGNC',
    strategy: 'convert',
    rawCandidates: ['hgnc_complete_set.json'],
    jsonlCandidates: ['data.jsonl', 'hgnc.jsonl'],
    convert: 'hgnc-json',
  },
  DUO: {
    datasetCode: 'DUO',
    strategy: 'convert',
    rawCandidates: ['duo.owl'],
    jsonlCandidates: ['data.jsonl', 'duo.jsonl'],
    convert: 'obo-owl',
  },
  UBERON: {
    datasetCode: 'UBERON',
    strategy: 'convert',
    rawCandidates: ['uberon.owl'],
    jsonlCandidates: ['data.jsonl', 'uberon.jsonl'],
    convert: 'obo-owl',
  },
  CL: {
    datasetCode: 'CL',
    strategy: 'convert',
    rawCandidates: ['cl.owl'],
    jsonlCandidates: ['data.jsonl', 'cl.jsonl'],
    convert: 'obo-owl',
  },
  EDAM: {
    datasetCode: 'EDAM',
    strategy: 'convert',
    rawCandidates: ['EDAM.owl', 'EDAM_1.25.owl'],
    jsonlCandidates: ['data.jsonl', 'edam.jsonl'],
    convert: 'obo-owl',
  },
  NCBITAX: {
    datasetCode: 'NCBITAX',
    strategy: 'convert',
    rawCandidates: ['taxdump.tar.gz'],
    jsonlCandidates: ['data.jsonl', 'ncbitax.jsonl'],
    convert: 'ncbitax-dump',
  },
  UCUM: {
    datasetCode: 'UCUM',
    strategy: 'convert',
    rawCandidates: ['ucum-essence.xml'],
    jsonlCandidates: ['data.jsonl', 'ucum.jsonl'],
    convert: 'ucum-xml',
  },
  // Gated / operator-supplied — never open-download in this lab cycle.
  ATC: {
    datasetCode: 'ATC',
    strategy: 'convert',
    // Official: Orders ATC/DDD Excel/XML (~€200). Lab test proxy: fabkury scrape CSV.
    rawCandidates: [
      'WHO ATC-DDD 2026-04-25.csv',
      'who_atc_ddd.csv',
      'atc.xml',
      'atc.xlsx',
      'ATC.xml',
      'ATC.xlsx',
    ],
    jsonlCandidates: ['data.jsonl', 'atc.jsonl'],
    convert: 'atc-csv',
    note: 'Lab test: fabkury/atcd WHO ATC-DDD 2026-04-25.csv (scrape; not production authority). Official: Orders ATC/DDD Excel/XML (~€200).',
  },
  DCB: {
    datasetCode: 'DCB',
    strategy: 'convert',
    rawCandidates: [
      'dcb.xlsx',
      'dcb.csv',
      'DCB.csv',
      'Lista_DCB_consolidada_out_2026.xlsx',
    ],
    jsonlCandidates: ['data.jsonl', 'dcb.jsonl'],
    convert: 'dcb-xlsx',
  },
  OMIM: {
    datasetCode: 'OMIM',
    strategy: 'preplaced',
    rawCandidates: ['omim.txt', 'mimTitles.txt', 'data.txt'],
    jsonlCandidates: ['data.jsonl', 'omim.jsonl'],
    convert: null,
    // Intake autofill of diagnosisOmimCode uses Orphadata ORPHA_OMIM_mapping
    // (via ORPHA intake-records.jsonl). A full OMIM mimTitles dump is only
    // needed if you want an independent OMIM TerminologyConcept release.
    note: 'Optional for intake: OMIM codes come from Orphadata ORPHA↔OMIM crosswalk (~63% coverage).',
  },
  LOINC: {
    datasetCode: 'LOINC',
    strategy: 'convert',
    rawCandidates: ['Loinc.csv', 'LoincTableCore.csv'],
    jsonlCandidates: ['data.jsonl', 'loinc.jsonl'],
    convert: 'loinc-csv',
  },
  ICD10: {
    datasetCode: 'ICD10',
    strategy: 'convert',
    // Lab proxy: CMS ICD-10-CM order file (dotted codes). WHO full dump preferred later.
    rawCandidates: [
      'icd10cm-order-2027.txt',
      'icd10.xml',
      'icd10.json',
      'data.xml',
    ],
    jsonlCandidates: ['data.jsonl', 'icd10.jsonl'],
    convert: 'icd10-cm-order',
    note: 'Lab: ICD-10-CM order → dotted codes under sid/icd-10 (proxy). Prefer WHO/CID-10 full dump for production.',
  },
  ICD11: {
    datasetCode: 'ICD11',
    strategy: 'preplaced',
    rawCandidates: [
      'icd11.json',
      'icd11.xml',
      'data.json',
      'SimpleTabulation-ICD-11-MMS-en.zip',
    ],
    jsonlCandidates: ['data.jsonl', 'icd11.jsonl'],
    convert: null,
    note: 'Place data.jsonl from SimpleTabulation (converter pending) or official MMS JSON.',
  },
};
