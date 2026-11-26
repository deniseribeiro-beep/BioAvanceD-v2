export type SpecimenMatrix = 'fluid' | 'solid';

export type SpecimenConstant = {
  id: string;
  label: string;
  matrices?: SpecimenMatrix[];
};

export const EXTRACTION_PROTOCOLS: SpecimenConstant[];
export const EXTRACTION_PROTOCOL_IDS: string[];
export const MIABIS_QUALITY: SpecimenConstant[];
export const MIABIS_QUALITY_IDS: string[];
export const SAMPLE_ORIGINS: SpecimenConstant[];
export const SAMPLE_ORIGIN_IDS: string[];
export const SPECIMEN_TYPES: SpecimenConstant[];
export const SPECIMEN_TYPE_IDS: string[];

export function filterSpecimenConstantsByMatrix<T extends SpecimenConstant>(
  items: T[],
  matrix: SpecimenMatrix | string,
): T[];
