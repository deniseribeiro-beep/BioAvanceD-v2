export const ROLE_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  BLOCKED: 'blocked',
  SUSPENDED: 'suspended',
};

export const USER_STATUS_OPTIONS = [
  { value: ROLE_STATUS.ACTIVE, label: 'Ativo' },
  { value: ROLE_STATUS.INACTIVE, label: 'Inativo' },
  { value: ROLE_STATUS.BLOCKED, label: 'Bloqueado' },
  { value: ROLE_STATUS.SUSPENDED, label: 'Suspenso' },
];

export const SAMPLE_LIFECYCLE_STATUS = {
  AVAILABLE: 'AVAILABLE',
  PARTIAL: 'PARTIAL',
  DEPLETED: 'DEPLETED',
  UNAVAILABLE: 'UNAVAILABLE',
};

export const SAMPLE_LEGACY_STATUS = {
  AVAILABLE: 'Available',
  PARTIALLY_WITHDRAWN: 'PartiallyWithdrawn',
  TOTALLY_WITHDRAWN: 'TotallyWithdrawn',
  WITHDRAWN: 'Withdrawn',
  EXPIRED: 'Expired',
  DESTROYED: 'Destroyed',
  UNUSABLE: 'Unusable',
};

export const SAMPLE_STATUS_OPTIONS = [
  { value: SAMPLE_LIFECYCLE_STATUS.AVAILABLE, label: 'Disponível' },
  { value: SAMPLE_LIFECYCLE_STATUS.PARTIAL, label: 'Parcialmente retirada' },
  { value: SAMPLE_LIFECYCLE_STATUS.DEPLETED, label: 'Esgotada' },
  { value: SAMPLE_LIFECYCLE_STATUS.UNAVAILABLE, label: 'Indisponível' },
];

export const STORAGE_CONTAINER_TYPE = {
  FREEZER: 'FREEZER',
  SHELF: 'SHELF',
  RACK: 'RACK',
};

export const STORAGE_BOX_STATUS = {
  ACTIVE: 'ACTIVE',
  FULL: 'FULL',
  RETIRED: 'RETIRED',
};

export const CONSENT_SCOPE_CATEGORY = {
  RESEARCH: 'research',
  COMMERCIAL: 'commercial',
  SHARING: 'sharing',
  GENETIC: 'genetic',
  CLINICAL: 'clinical',
  CONTACT: 'contact',
  EDUCATION: 'education',
};

export const CONSENT_SCOPE_RISK = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
};
