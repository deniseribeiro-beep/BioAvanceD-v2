export const SPECIMEN_TYPES = [
	{ id: 'PLASMA', label: 'Plasma' },
	{ id: 'SERUM', label: 'Soro' },
	{ id: 'ERYTHROCYTES', label: 'Eritrócitos' },
	{ id: 'URINE', label: 'Urina' },
	{ id: 'DBS', label: 'Dried Blood Spot (DBS)' },
	{ id: 'TISSUE_FRESH', label: 'Tecido Sólido (Fresco/Congelado)' },
	{ id: 'TISSUE_FFPE', label: 'Tecido Sólido (FFPE)' },
	{ id: 'PBMC', label: 'PBMCs (Células Mononucleares)' },
	{ id: 'SALIVA', label: 'Saliva / Swab Bucal' },
	{ id: 'FECES', label: 'Fezes (Microbiota)' },
	{ id: 'CSF', label: 'Líquido Cefalorraquidiano (LCR)' },
];

export const SPECIMEN_TYPE_IDS = SPECIMEN_TYPES.map((specimenType) => specimenType.id);

export const SAMPLE_ORIGINS = [
	{ id: 'VENOUS_BLOOD', label: 'Sangue Venoso Periférico' },
	{ id: 'CAPILLARY_BLOOD', label: 'Sangue Capilar' },
	{ id: 'ORAL_MUCOSA', label: 'Mucosa Oral (Swab)' },
	{ id: 'URINE_MIDSTREAM', label: 'Urina (Jato Médio)' },
];

export const SAMPLE_ORIGIN_IDS = SAMPLE_ORIGINS.map((origin) => origin.id);

export const EXTRACTION_PROTOCOLS = [
	{ id: 'TUBE_EDTA', label: 'Tubo EDTA (Tampa Roxa)' },
	{ id: 'TUBE_HEPARIN', label: 'Tubo Heparina (Tampa Verde)' },
	{ id: 'TUBE_SERUM', label: 'Tubo Seco/Soro (Tampa Vermelha/Amarela)' },
	{ id: 'FILTER_PAPER', label: 'Papel Filtro / Cartão de Guthrie' },
];

export const EXTRACTION_PROTOCOL_IDS = EXTRACTION_PROTOCOLS.map((protocol) => protocol.id);

export const MIABIS_QUALITY = [
	{ id: 'GOOD', label: 'Adequada / Boa Qualidade' },
	{ id: 'COMPROMISED', label: 'Comprometida (Hemólise/Lipemia)' },
	{ id: 'UNKNOWN', label: 'Desconhecida / Não Avaliada' },
];

export const MIABIS_QUALITY_IDS = MIABIS_QUALITY.map((quality) => quality.id);