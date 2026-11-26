/** MIABIS specimen vocabulary used by the intake wizard and SampleModel mirror. */

export const SPECIMEN_TYPES = [
  { id: 'PLASMA', label: 'Plasma', matrices: ['fluid'] },
  { id: 'SERUM', label: 'Soro', matrices: ['fluid'] },
  { id: 'ERYTHROCYTES', label: 'Eritrócitos', matrices: ['fluid'] },
  { id: 'URINE', label: 'Urina', matrices: ['fluid'] },
  { id: 'DBS', label: 'Dried Blood Spot (DBS)', matrices: ['fluid'] },
  { id: 'PBMC', label: 'PBMCs (Células Mononucleares)', matrices: ['fluid'] },
  { id: 'SALIVA', label: 'Saliva / Swab Bucal', matrices: ['fluid'] },
  { id: 'FECES', label: 'Fezes (Microbiota)', matrices: ['fluid'] },
  { id: 'CSF', label: 'Líquido Cefalorraquidiano (LCR)', matrices: ['fluid'] },
  { id: 'TISSUE_FRESH', label: 'Tecido Sólido (Fresco/Congelado)', matrices: ['solid'] },
  { id: 'TISSUE_FFPE', label: 'Tecido Sólido (FFPE)', matrices: ['solid'] },
  { id: 'TISSUE_OTHER', label: 'Tecido Sólido (Outro)', matrices: ['solid'] },
];

export const SPECIMEN_TYPE_IDS = SPECIMEN_TYPES.map((specimenType) => specimenType.id);

export const SAMPLE_ORIGINS = [
  { id: 'VENOUS_BLOOD', label: 'Sangue Venoso Periférico', matrices: ['fluid'] },
  { id: 'CAPILLARY_BLOOD', label: 'Sangue Capilar', matrices: ['fluid'] },
  { id: 'ORAL_MUCOSA', label: 'Mucosa Oral (Swab)', matrices: ['fluid'] },
  { id: 'URINE_MIDSTREAM', label: 'Urina (Jato Médio)', matrices: ['fluid'] },
  { id: 'SURGICAL_EXCISION', label: 'Excisão Cirúrgica', matrices: ['solid'] },
  { id: 'BIOPSY', label: 'Biópsia', matrices: ['solid'] },
  { id: 'FINE_NEEDLE_ASPIRATION', label: 'Punção Aspirativa por Agulha Fina', matrices: ['solid'] },
  { id: 'AUTOPSY', label: 'Autópsia', matrices: ['solid'] },
  { id: 'SOLID_OTHER', label: 'Outra origem (tecido sólido)', matrices: ['solid'] },
];

export const SAMPLE_ORIGIN_IDS = SAMPLE_ORIGINS.map((origin) => origin.id);

export const EXTRACTION_PROTOCOLS = [
  { id: 'TUBE_EDTA', label: 'Tubo EDTA (Tampa Roxa)', matrices: ['fluid'] },
  { id: 'TUBE_HEPARIN', label: 'Tubo Heparina (Tampa Verde)', matrices: ['fluid'] },
  { id: 'TUBE_SERUM', label: 'Tubo Seco/Soro (Tampa Vermelha/Amarela)', matrices: ['fluid'] },
  { id: 'FILTER_PAPER', label: 'Papel Filtro / Cartão de Guthrie', matrices: ['fluid'] },
  { id: 'CRYOVIAL_SNAP_FREEZE', label: 'Criovial / Congelamento Rápido', matrices: ['solid'] },
  { id: 'FFPE_BLOCK', label: 'Bloco FFPE', matrices: ['solid'] },
  { id: 'OCT_EMBEDDED', label: 'Inclusão em OCT', matrices: ['solid'] },
  { id: 'RNA_LATER', label: 'Estabilização RNA later / equivalente', matrices: ['solid'] },
  { id: 'SOLID_OTHER', label: 'Outro protocolo (tecido sólido)', matrices: ['solid'] },
];

export const EXTRACTION_PROTOCOL_IDS = EXTRACTION_PROTOCOLS.map((protocol) => protocol.id);

export const MIABIS_QUALITY = [
  { id: 'GOOD', label: 'Adequada / Boa Qualidade' },
  { id: 'COMPROMISED', label: 'Comprometida (Hemólise/Lipemia)' },
  { id: 'UNKNOWN', label: 'Desconhecida / Não Avaliada' },
];

export const MIABIS_QUALITY_IDS = MIABIS_QUALITY.map((quality) => quality.id);

/**
 * @param {Array<{ matrices?: string[] }>} items
 * @param {'fluid'|'solid'|string} matrix
 */
export function filterSpecimenConstantsByMatrix(items, matrix) {
  const normalized = String(matrix || 'fluid').trim().toLowerCase() === 'solid' ? 'solid' : 'fluid';
  return (Array.isArray(items) ? items : []).filter((item) => {
    const matrices = Array.isArray(item?.matrices) && item.matrices.length > 0
      ? item.matrices
      : ['fluid', 'solid'];
    return matrices.includes(normalized);
  });
}
