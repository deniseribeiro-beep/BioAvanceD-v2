import {
  BLOCKED_SPECIMEN_STATUSES,
  resolveQuantityStatus,
  resolveSpecimenStatus,
  type SpecimenStatusLike,
} from '../utils/sampleHelpers';

export type RoleName = 'Administrador' | 'Coordenador' | 'Técnico' | 'Usuário Externo';

export type UserStatus = 'active' | 'inactive' | 'blocked' | 'suspended';

export type SampleLifecycleStatus = 'AVAILABLE' | 'PARTIAL' | 'DEPLETED' | 'UNAVAILABLE' | 'CLOSED' | 'UNKNOWN';

export type LegacySampleStatus =
  | 'Available'
  | 'PartiallyWithdrawn'
  | 'TotallyWithdrawn'
  | 'Withdrawn'
  | 'Destroyed'
  | 'Unusable'
  | 'Closed'
  | 'Unknown';

export type StorageBoxStatus = 'ACTIVE' | 'FULL' | 'RETIRED';

export type StorageContainerType = 'FREEZER' | 'SHELF' | 'RACK';

export type ConsentScopeCategory = 'research' | 'commercial' | 'sharing' | 'genetic' | 'clinical' | 'contact' | 'education';

export interface ContractOption<T extends string = string> {
  value: T;
  label: string;
}

export interface ConsentScopeDefinition {
  key: string;
  label: string;
  description: string;
  category: ConsentScopeCategory;
  riskLevel: 'low' | 'medium' | 'high';
  retention: number | null;
  requiredFor: string[];
}

export const LEGACY_SAMPLE_STATUS_LABELS: Record<SampleLifecycleStatus, LegacySampleStatus> = {
  AVAILABLE: 'Available',
  PARTIAL: 'PartiallyWithdrawn',
  DEPLETED: 'TotallyWithdrawn',
  UNAVAILABLE: 'Unusable',
  CLOSED: 'Closed',
  UNKNOWN: 'Unknown',
};

// #539: buckets a specimen down to this file's narrower SampleLifecycleStatus,
// so LEGACY_SAMPLE_STATUS_LABELS can produce a value shaped like the legacy
// `Sample.currentStatus` field for readers that still need that vocabulary.
// RF006 AC2/AC3: the operational state comes from specimenStatus (closed ->
// CLOSED; quarantined/unavailable -> UNAVAILABLE; reserved/checked_out fold
// into AVAILABLE), and PARTIAL/DEPLETED come from quantityStatus, derived
// from the quantities when a record carries none. specimenStatus no longer
// carries partial or depleted.
export function resolveSampleLifecycleStatus(sample: SpecimenStatusLike | null | undefined): SampleLifecycleStatus {
  const status = resolveSpecimenStatus(sample);
  if (status === 'closed') return 'CLOSED';
  if (BLOCKED_SPECIMEN_STATUSES.includes(status)) return 'UNAVAILABLE';
  const quantityStatus = resolveQuantityStatus(sample);
  if (quantityStatus === 'depleted') return 'DEPLETED';
  if (quantityStatus === 'partial') return 'PARTIAL';
  // #1436: missing quantities are unknown — do not fold into AVAILABLE / "Disponível".
  if (quantityStatus === 'unknown') return 'UNKNOWN';
  return 'AVAILABLE';
}

export function resolveLegacySampleStatus(sample: SpecimenStatusLike | null | undefined): LegacySampleStatus {
  return LEGACY_SAMPLE_STATUS_LABELS[resolveSampleLifecycleStatus(sample)];
}

export const ROLE_DEFINITIONS: Array<ContractOption<RoleName> & { accessType: number; description: string }> = [
  {
    value: 'Administrador',
    label: 'Administrador',
    accessType: 4,
    description: 'Acesso completo ao sistema, com administração, auditoria e backup.',
  },
  {
    value: 'Coordenador',
    label: 'Coordenador',
    accessType: 3,
    description: 'Operação avançada, relatórios e acompanhamento de fluxo assistencial.',
  },
  {
    value: 'Técnico',
    label: 'Técnico',
    accessType: 2,
    description: 'Operação clínica e administrativa do dia a dia.',
  },
  {
    value: 'Usuário Externo',
    label: 'Usuário Externo',
    accessType: 1,
    description: 'Acesso controlado a recursos públicos e colaborativos.',
  },
];

export const USER_STATUSES: Array<ContractOption<UserStatus>> = [
  { value: 'active', label: 'Ativo' },
  { value: 'inactive', label: 'Inativo' },
  { value: 'blocked', label: 'Bloqueado' },
  { value: 'suspended', label: 'Suspenso' },
];

export const SAMPLE_LIFECYCLE_STATUSES: Array<ContractOption<SampleLifecycleStatus>> = [
  { value: 'AVAILABLE', label: 'Disponível' },
  { value: 'PARTIAL', label: 'Parcialmente retirada' },
  { value: 'DEPLETED', label: 'Esgotada' },
  { value: 'UNAVAILABLE', label: 'Indisponível' },
  { value: 'CLOSED', label: 'Encerrada' },
  { value: 'UNKNOWN', label: 'Não registrada' },
];

export const STORAGE_BOX_STATUSES: Array<ContractOption<StorageBoxStatus>> = [
  { value: 'ACTIVE', label: 'Ativa' },
  { value: 'FULL', label: 'Cheia' },
  { value: 'RETIRED', label: 'Desativada' },
];

export const STORAGE_CONTAINER_TYPES: Array<ContractOption<StorageContainerType>> = [
  { value: 'FREEZER', label: 'Freezer' },
  { value: 'SHELF', label: 'Prateleira' },
  { value: 'RACK', label: 'Rack' },
];

export const CONSENT_SCOPES: ConsentScopeDefinition[] = [
  {
    key: 'uso_pesquisa',
    label: 'Pesquisa Científica',
    description: 'Uso de dados e amostras em pesquisa científica.',
    category: 'research',
    riskLevel: 'low',
    retention: 365 * 5,
    requiredFor: ['analise', 'extraction', 'sequenciamento'],
  },
  {
    key: 'uso_comercial',
    label: 'Uso Comercial',
    description: 'Uso de amostras para fins comerciais e desenvolvimento de produtos.',
    category: 'commercial',
    riskLevel: 'high',
    retention: 365 * 7,
    requiredFor: ['comercializacao', 'patente', 'desenvolvimento_produto'],
  },
  {
    key: 'compartilhamento_pesquisadores',
    label: 'Compartilhamento com Pesquisadores',
    description: 'Compartilhamento com pesquisadores externos.',
    category: 'sharing',
    riskLevel: 'medium',
    retention: 365 * 3,
    requiredFor: ['compartilhar_externo', 'colaboracao'],
  },
  {
    key: 'compartilhamento_internacional',
    label: 'Compartilhamento Internacional',
    description: 'Compartilhamento com instituições internacionais.',
    category: 'sharing',
    riskLevel: 'high',
    retention: 365 * 7,
    requiredFor: ['exportar_dados', 'colaboracao_internacional'],
  },
  {
    key: 'analise_genetica',
    label: 'Análise Genética',
    description: 'Análises genéticas e determinação de variantes.',
    category: 'genetic',
    riskLevel: 'high',
    retention: null,
    requiredFor: ['sequenciamento', 'genotipagem', 'analise_cromossomica'],
  },
  {
    key: 'dados_geneticos_familia',
    label: 'Implicação Genética Familiar',
    description: 'Compartilhamento de achados genéticos com a família.',
    category: 'genetic',
    riskLevel: 'high',
    retention: null,
    requiredFor: ['relatorio_familiar'],
  },
  {
    key: 'achados_incidentais',
    label: 'Achados Incidentais',
    description: 'Comunicação de achados incidentais de relevância clínica.',
    category: 'clinical',
    riskLevel: 'medium',
    retention: null,
    requiredFor: ['resultado_incidental'],
  },
  {
    key: 'recontato_paciente',
    label: 'Recontato do Paciente',
    description: 'Contato do paciente para seguimento clínico.',
    category: 'contact',
    riskLevel: 'low',
    retention: 365 * 5,
    requiredFor: ['contato_paciente', 'seguimento_clinico'],
  },
  {
    key: 'uso_secundario_dados',
    label: 'Uso Secundário de Dados',
    description: 'Análises secundárias não planejadas com dados estruturados.',
    category: 'research',
    riskLevel: 'low',
    retention: 365 * 5,
    requiredFor: ['mineracao_dados', 'analise_historica'],
  },
  {
    key: 'material_educacional',
    label: 'Material Educacional',
    description: 'Uso de dados anonimizados em materiais educacionais.',
    category: 'education',
    riskLevel: 'low',
    retention: 365 * 10,
    requiredFor: ['aula', 'seminario', 'publicacao_educacional'],
  },
  {
    key: 'amostra_controle',
    label: 'Uso como Controle',
    description: 'Uso da amostra como controle em laboratório.',
    category: 'research',
    riskLevel: 'low',
    retention: 365 * 2,
    requiredFor: ['controle_laboratorio', 'validacao'],
  },
];

export const FOUNDATION_CONTRACT_SUMMARY = {
  roles: ROLE_DEFINITIONS.length,
  userStatuses: USER_STATUSES.length,
  sampleStatuses: SAMPLE_LIFECYCLE_STATUSES.length,
  consentScopes: CONSENT_SCOPES.length,
  storageTypes: STORAGE_CONTAINER_TYPES.length,
};
