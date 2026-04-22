const SPECIMEN_TYPES = Object.freeze([
  Object.freeze({ id: 'PLASMA', label: 'Plasma' }),
  Object.freeze({ id: 'SERUM', label: 'Soro' }),
  Object.freeze({ id: 'ERYTHROCYTES', label: 'Eritrócitos' }),
  Object.freeze({ id: 'URINE', label: 'Urina' }),
  Object.freeze({ id: 'DBS', label: 'Dried Blood Spot (DBS)' }),
  Object.freeze({ id: 'TISSUE_FRESH', label: 'Tecido Sólido (Fresco/Congelado)' }),
  Object.freeze({ id: 'TISSUE_FFPE', label: 'Tecido Sólido (FFPE)' }),
  Object.freeze({ id: 'PBMC', label: 'PBMCs (Células Mononucleares)' }),
  Object.freeze({ id: 'SALIVA', label: 'Saliva / Swab Bucal' }),
  Object.freeze({ id: 'FECES', label: 'Fezes (Microbiota)' }),
  Object.freeze({ id: 'CSF', label: 'Líquido Cefalorraquidiano (LCR)' }),
]);

const SPECIMEN_TYPE_IDS = Object.freeze(SPECIMEN_TYPES.map((specimenType) => specimenType.id));

const SAMPLE_ORIGINS = Object.freeze([
  Object.freeze({ id: 'VENOUS_BLOOD', label: 'Sangue Venoso Periférico' }),
  Object.freeze({ id: 'CAPILLARY_BLOOD', label: 'Sangue Capilar' }),
  Object.freeze({ id: 'ORAL_MUCOSA', label: 'Mucosa Oral (Swab)' }),
  Object.freeze({ id: 'URINE_MIDSTREAM', label: 'Urina (Jato Médio)' }),
]);

const SAMPLE_ORIGIN_IDS = Object.freeze(SAMPLE_ORIGINS.map((origin) => origin.id));

const EXTRACTION_PROTOCOLS = Object.freeze([
  Object.freeze({ id: 'TUBE_EDTA', label: 'Tubo EDTA (Tampa Roxa)' }),
  Object.freeze({ id: 'TUBE_HEPARIN', label: 'Tubo Heparina (Tampa Verde)' }),
  Object.freeze({ id: 'TUBE_SERUM', label: 'Tubo Seco/Soro (Tampa Vermelha/Amarela)' }),
  Object.freeze({ id: 'FILTER_PAPER', label: 'Papel Filtro / Cartão de Guthrie' }),
]);

const EXTRACTION_PROTOCOL_IDS = Object.freeze(EXTRACTION_PROTOCOLS.map((protocol) => protocol.id));

const MIABIS_QUALITY = Object.freeze([
  Object.freeze({ id: 'GOOD', label: 'Adequada / Boa Qualidade' }),
  Object.freeze({ id: 'COMPROMISED', label: 'Comprometida (Hemólise/Lipemia)' }),
  Object.freeze({ id: 'UNKNOWN', label: 'Desconhecida / Não Avaliada' }),
]);

const MIABIS_QUALITY_IDS = Object.freeze(MIABIS_QUALITY.map((quality) => quality.id));

module.exports = {
  SPECIMEN_TYPES,
  SPECIMEN_TYPE_IDS,
  SAMPLE_ORIGINS,
  SAMPLE_ORIGIN_IDS,
  EXTRACTION_PROTOCOLS,
  EXTRACTION_PROTOCOL_IDS,
  MIABIS_QUALITY,
  MIABIS_QUALITY_IDS,
};
