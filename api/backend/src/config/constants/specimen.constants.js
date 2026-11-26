const SPECIMEN_TYPES = Object.freeze([
  Object.freeze({ id: 'PLASMA', label: 'Plasma', matrices: Object.freeze(['fluid']) }),
  Object.freeze({ id: 'SERUM', label: 'Soro', matrices: Object.freeze(['fluid']) }),
  Object.freeze({ id: 'ERYTHROCYTES', label: 'Eritrócitos', matrices: Object.freeze(['fluid']) }),
  Object.freeze({ id: 'URINE', label: 'Urina', matrices: Object.freeze(['fluid']) }),
  Object.freeze({ id: 'DBS', label: 'Dried Blood Spot (DBS)', matrices: Object.freeze(['fluid']) }),
  Object.freeze({ id: 'PBMC', label: 'PBMCs (Células Mononucleares)', matrices: Object.freeze(['fluid']) }),
  Object.freeze({ id: 'SALIVA', label: 'Saliva / Swab Bucal', matrices: Object.freeze(['fluid']) }),
  Object.freeze({ id: 'FECES', label: 'Fezes (Microbiota)', matrices: Object.freeze(['fluid']) }),
  Object.freeze({ id: 'CSF', label: 'Líquido Cefalorraquidiano (LCR)', matrices: Object.freeze(['fluid']) }),
  Object.freeze({ id: 'TISSUE_FRESH', label: 'Tecido Sólido (Fresco/Congelado)', matrices: Object.freeze(['solid']) }),
  Object.freeze({ id: 'TISSUE_FFPE', label: 'Tecido Sólido (FFPE)', matrices: Object.freeze(['solid']) }),
  Object.freeze({ id: 'TISSUE_OTHER', label: 'Tecido Sólido (Outro)', matrices: Object.freeze(['solid']) }),
]);

const SPECIMEN_TYPE_IDS = Object.freeze(SPECIMEN_TYPES.map((specimenType) => specimenType.id));

const SAMPLE_ORIGINS = Object.freeze([
  Object.freeze({ id: 'VENOUS_BLOOD', label: 'Sangue Venoso Periférico', matrices: Object.freeze(['fluid']) }),
  Object.freeze({ id: 'CAPILLARY_BLOOD', label: 'Sangue Capilar', matrices: Object.freeze(['fluid']) }),
  Object.freeze({ id: 'ORAL_MUCOSA', label: 'Mucosa Oral (Swab)', matrices: Object.freeze(['fluid']) }),
  Object.freeze({ id: 'URINE_MIDSTREAM', label: 'Urina (Jato Médio)', matrices: Object.freeze(['fluid']) }),
  Object.freeze({ id: 'SURGICAL_EXCISION', label: 'Excisão Cirúrgica', matrices: Object.freeze(['solid']) }),
  Object.freeze({ id: 'BIOPSY', label: 'Biópsia', matrices: Object.freeze(['solid']) }),
  Object.freeze({ id: 'FINE_NEEDLE_ASPIRATION', label: 'Punção Aspirativa por Agulha Fina', matrices: Object.freeze(['solid']) }),
  Object.freeze({ id: 'AUTOPSY', label: 'Autópsia', matrices: Object.freeze(['solid']) }),
  Object.freeze({ id: 'SOLID_OTHER', label: 'Outra origem (tecido sólido)', matrices: Object.freeze(['solid']) }),
]);

const SAMPLE_ORIGIN_IDS = Object.freeze(SAMPLE_ORIGINS.map((origin) => origin.id));

const EXTRACTION_PROTOCOLS = Object.freeze([
  Object.freeze({ id: 'TUBE_EDTA', label: 'Tubo EDTA (Tampa Roxa)', matrices: Object.freeze(['fluid']) }),
  Object.freeze({ id: 'TUBE_HEPARIN', label: 'Tubo Heparina (Tampa Verde)', matrices: Object.freeze(['fluid']) }),
  Object.freeze({ id: 'TUBE_SERUM', label: 'Tubo Seco/Soro (Tampa Vermelha/Amarela)', matrices: Object.freeze(['fluid']) }),
  Object.freeze({ id: 'FILTER_PAPER', label: 'Papel Filtro / Cartão de Guthrie', matrices: Object.freeze(['fluid']) }),
  Object.freeze({ id: 'CRYOVIAL_SNAP_FREEZE', label: 'Criovial / Congelamento Rápido', matrices: Object.freeze(['solid']) }),
  Object.freeze({ id: 'FFPE_BLOCK', label: 'Bloco FFPE', matrices: Object.freeze(['solid']) }),
  Object.freeze({ id: 'OCT_EMBEDDED', label: 'Inclusão em OCT', matrices: Object.freeze(['solid']) }),
  Object.freeze({ id: 'RNA_LATER', label: 'Estabilização RNA later / equivalente', matrices: Object.freeze(['solid']) }),
  Object.freeze({ id: 'SOLID_OTHER', label: 'Outro protocolo (tecido sólido)', matrices: Object.freeze(['solid']) }),
]);

const EXTRACTION_PROTOCOL_IDS = Object.freeze(EXTRACTION_PROTOCOLS.map((protocol) => protocol.id));

const MIABIS_QUALITY = Object.freeze([
  Object.freeze({ id: 'GOOD', label: 'Adequada / Boa Qualidade' }),
  Object.freeze({ id: 'COMPROMISED', label: 'Comprometida (Hemólise/Lipemia)' }),
  Object.freeze({ id: 'UNKNOWN', label: 'Desconhecida / Não Avaliada' }),
]);

const MIABIS_QUALITY_IDS = Object.freeze(MIABIS_QUALITY.map((quality) => quality.id));

function filterSpecimenConstantsByMatrix(items, matrix) {
  const normalized = String(matrix || 'fluid').trim().toLowerCase() === 'solid' ? 'solid' : 'fluid';
  return (Array.isArray(items) ? items : []).filter((item) => {
    const matrices = Array.isArray(item?.matrices) && item.matrices.length > 0
      ? item.matrices
      : ['fluid', 'solid'];
    return matrices.includes(normalized);
  });
}

module.exports = {
  SPECIMEN_TYPES,
  SPECIMEN_TYPE_IDS,
  SAMPLE_ORIGINS,
  SAMPLE_ORIGIN_IDS,
  EXTRACTION_PROTOCOLS,
  EXTRACTION_PROTOCOL_IDS,
  MIABIS_QUALITY,
  MIABIS_QUALITY_IDS,
  filterSpecimenConstantsByMatrix,
};
