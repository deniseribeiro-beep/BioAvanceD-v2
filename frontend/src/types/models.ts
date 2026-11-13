// Modelos baseados no diagrama UML

export interface Patient {
  _id?: string; // MongoDB ID
  // 1. ID - Numérico - Identificador único (gerado automaticamente)
  participantId: string; // ID canônico do participante
  
  // 2. NOME - Caractere - Nome completo do paciente
  // RF005/RNF007 (#575): civil identity — segregated to ParticipantIdentity,
  // never returned as a direct field on Patient. Optional here since it's
  // only ever present via an authorized re-identification response.
  patientName?: string;

  // #1166: the participant's contact (email/phone) is ParticipantIdentity
  // data (dict-02 P1X-0352/P1X-0353) and is never returned on Patient.

  // 3. DATA_NASCIMENTO - Caractere - Data de nascimento (formato DD/MM/YYYY)
  // RF005/RNF007 (#575): civil identity — segregated to ParticipantIdentity,
  // see patientName above.
  birthDate?: string; // Alterado para string no formato DD/MM/YYYY
  
  // 4. IDADE - Numérico - Idade em anos completos
  age?: number;
  
  // 5. MATRICULA - Caractere - Número do prontuário (obrigatório)
  recordNumber: string; // Alterado para string conforme especificação
  
  // 6. UNIDADE - Caractere - Unidade de tratamento
  clinicalUnitId?: string;
  clinicalUnit?: string;
  
  // 7. UNIDADE_SIGLA - Caractere - Sigla da unidade
  unitAcronym?: string;

  isDeceased?: boolean;
  // #1168: the legal representative is ParticipantIdentity data (dict-02
  // P1X-0357..0360) and is never returned on Patient.
  
  // 8. SEXO - Caractere - Sexo do paciente (Masculino/Feminino)
  sex: string; // 'Masculino' | 'Feminino'
  
  // 9. HD - Caractere - Hipótese diagnóstica principal
  diagnosticHypothesis?: string;
  
  // 10. CID - Caractere - Classificação Internacional de Doenças (CID-11)
  icdCode?: string; // Alterado para string conforme especificação
  orphaCode?: string;
  omimCode?: string;
  icdReference?: {
    cidId?: string;
    Codigo_Tabulacao?: string;
    Codigos_CID10?: string;
    Descricao?: string;
    ORPHA?: string;
    OMIM?: string;
  } | null;
  
  // 11. PESO - Numérico - Peso do paciente em quilos
  weight?: number;
  
  // 12. ALTURA - Numérico - Altura do paciente em centímetros
  heightCm?: number;
  
  // 13-23. Fatores - Caractere (Sim/Não)
  hypertension?: string; // 'Sim' | 'Não'
  obesity?: string; // 'Sim' | 'Não'
  diabetesType1?: string; // 'Sim' | 'Não'
  diabetesType2?: string; // 'Sim' | 'Não'
  copd?: string; // 'Sim' | 'Não'
  ckd?: string; // 'Sim' | 'Não'
  smoking?: string; // 'Sim' | 'Não'
  alcoholUse?: string; // 'Sim' | 'Não'
  asthma?: string; // 'Sim' | 'Não'
  antibioticUse?: string; // 'Sim' | 'Não'
  insulinUse?: string; // 'Sim' | 'Não'
  antiviralUse?: string; // 'Sim' | 'Não'
  
  // 25. VARIANTE_GENETICA - Caractere - Variante genética ou status (obrigatório)
  geneticVariant: string;
  
  // 26. ALFA-GAL - Numérico - Resultado do exame de alfa galactosidase
  alphaGal?: number; // Alterado de boolean para number
  
  // 27. LYSO-GB3 - Numérico - Resultado do exame de lyso-gb3
  lysoGb3?: number;
  
  // 28. OBSERVACAO - Caractere - Campo aberto para informações
  notes?: string;
  
  // Campos de sistema
  status?: 'PENDING_CONSENT' | 'ACTIVE' | 'INACTIVE';
  consentTemplateId?: string;
  consentToken?: string | null;
  consentTokenCreatedAt?: Date | string | null;
  consentTokenExpiresAt?: Date | string | null;
  consentNotifiedAt?: Date | string | null;
  consentAcceptedAt?: Date | string | null;
  linkedProject?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface CidEntry {
  _id?: string;
  Capitulo?: string | null;
  Codigo_Tabulacao: string;
  Descricao: string;
  Codigos_CID10: string;
  ORPHA?: string;
  OMIM?: string;
  icd_code?: string;
  icdCode?: string;
  aliases?: string[];
  synonyms?: string[];
  alternativeNames?: string[];
  namePt?: string;
  nameEn?: string;
  nameEs?: string;
  names?: Record<string, string> | null;
  translations?: Record<string, string> | null;
}

export interface PhoneCodeEntry {
  _id?: string;
  countryName: string;
  iso2?: string | null;
  dialCode: string;
  searchLabel?: string;
}

export interface RcsAxisPenalty {
  axis_code: string;
  sprec_code?: string | null;
  weight?: number | null;
  severity?: number | null;
  penalty?: number | null;
  [key: string]: any;
}

export interface RcsEvaluation {
  model_version: string;
  matrix_type: 'fluid' | 'solid' | string;
  governance_status: 0 | 1 | number | null;
  governance_failure_reasons: string[];
  governance_rule_codes?: string[];
  p_bio: number | null;
  rcs_score: number | null;
  score_based_grade: 'A' | 'B' | 'C' | 'D' | 'E' | string | null;
  final_grade: 'A' | 'B' | 'C' | 'D' | 'E' | string;
  grade_route: string;
  axis_penalties: RcsAxisPenalty[];
  calculation_trace: Record<string, any>;
}

// Campo embutido em Sample, gravado por AllocateSampleUseCase/MoveSampleUseCase/
// ReleaseSampleUseCase (só boxId/position são garantidos; boxName/locationID/readable
// dependem de qual caminho de escrita alocou a amostra). Não carrega freezer/shelf/rack
// nem path — para isso, use SampleStorageLocationDTO via GET /storage/sample/:sampleId.
export interface SampleEmbeddedStorageLocation {
  boxId?: string | null;
  boxName?: string | null;
  position?: string | null;
  locationID?: number | null;
  readable?: string | null;
  path?: string | null;
}

// The sample's current placement as the API resolves it (#1374): the physical
// chain (SpecimenContainerAssignment, ContainerPositionAssignment,
// RackLocationAssignment, #1314) first, the open legacy StorageAssignment row
// (ELM-0167..0178, historical reads only) as a fallback with the chain ids
// null. Sent under the key `storageAssignment` by the sample create responses.
// No boxName/readable/path: for those, use SampleStorageLocationDTO.
export interface SamplePlacement {
  boxId: string | null;
  positionCode: string | null;
  containerId: string | null;
  storagePositionId: string | null;
  storageRackId: string | null;
  storageLocationId: string | null;
  placedAt?: Date | string | null;
  source: 'physical_chain' | 'legacy_storage_assignment';
}

// Resposta de GET /storage/sample/:sampleId (GetSampleStorageLocationUseCase /
// MongoStorageRepository.getSampleStorageLocation). `path` é a hierarquia legível
// separada por "/" (ex: "FREEZER_01/SHELF_1/RACK_A/BOX_01"); fullHierarchy carrega
// apenas IDs, não nomes.
export interface SampleStorageLocationDTO {
  specimenId: string;
  barcode?: string | null;
  box: {
    boxId: string;
    boxName: string | null;
    position: string | null;
  };
  locationID?: number | null;
  readable?: string | null;
  path: string;
  fullHierarchy: {
    freezerId: string;
    shelfId: string;
    rackId: string;
    boxId: string;
  } | null;
}

// dict-02 SpecimenPreanalytics (ELM-0145+, #388): one versioned SPREC
// snapshot, as persisted by specimen-preanalytics.service.js and returned
// by GET /:id/sprec-profiles (newest first) — mirrors the generic axis
// slots (preCentrifugation/centrifugation/secondCentrifugation/
// postCentrifugationDelay, populated regardless of matrixType) plus their
// solid-matrix canonical aliases (warmIschemiaTime/coldIschemiaTime/
// fixationStabilizationType/fixationTime) used to build a display summary.
export interface SpecimenPreanalyticsProfile {
  _id?: string;
  specimenId: string;
  matrixType: 'fluid' | 'solid' | string | null;
  sampleType?: string | null;
  primaryContainer?: string | null;
  preCentrifugation?: string | null;
  centrifugation?: string | null;
  secondCentrifugation?: string | null;
  postCentrifugationDelay?: string | null;
  longTermStorage?: string | null;
  sprecCode?: string | null;
  sprecVersion?: string | null;
  warmIschemiaTime?: string | null;
  coldIschemiaTime?: string | null;
  fixationStabilizationType?: string | null;
  fixationTime?: string | null;
  profileStatus?: string;
  recordedAt?: Date | string;
  createdAt?: Date | string;
}

export interface Sample {
  _id?: string; // MongoDB ID
  participantId: string;
  // #1216: the canonical business id the API names every specimen by. The
  // legacy sampleID field is prohibited on the wire and no writer sets it.
  specimenId?: string;
  sampleType: string;
  sampleOrigin?: string;
  extractionProtocol?: string;
  barcode?: string; // Código de barras no formato BR-YYYY-NNN (gerado automaticamente)
  registrationDate?: Date | string;
  quantity?: number;
  quality?: string | number; // Id MIABIS canônico ou legado persistido
  rcs_evaluation?: RcsEvaluation | null;
  model_version?: string;
  matrix_type?: 'fluid' | 'solid' | string;
  governance_status?: 0 | 1 | number | null;
  governance_failure_reasons?: string[];
  governance_rule_codes?: string[];
  p_bio?: number | null;
  rcs_score?: number | null;
  score_based_grade?: 'A' | 'B' | 'C' | 'D' | 'E' | string | null;
  final_grade?: 'A' | 'B' | 'C' | 'D' | 'E' | string;
  grade_route?: string;
  axis_penalties?: RcsAxisPenalty[];
  calculation_trace?: Record<string, any>;
  // Deprecated: não usar como fonte de decisão; mantido somente para payloads legados.
  quality_score?: number | null;
  quality_category?: 'A' | 'B' | 'C' | 'D' | 'E' | '' | string;
  merkle_root?: string | null;
  consentStatus?: 'PENDING' | 'SIGNED' | 'EXTERNAL_ATTACHED' | 'WAIVED_TRANSFER' | 'NOT_REQUIRED' | string;
  // Canonical status (storage/custody split, #389/#409) — derive quarantine/availability
  // UI state from this. RF006 AC2: the operational state only; `closed` is
  // set by the close route or an executed destroy/transfer disposition.
  specimenStatus?: 'available' | 'reserved' | 'checked_out' | 'quarantined' | 'unavailable' | 'closed' | string;
  // RF006 AC3: derived by the API from initialQuantity/currentQuantity; never
  // sent on a write.
  quantityStatus?: 'full' | 'partial' | 'depleted' | null;
  // quarantineReason still carries the human-readable reason text — no
  // specimenStatus equivalent exists for that, so it stays legacy-sourced (#407/#415).
  quarantineReason?: 'CONSENT_PENDING' | 'EXTERNAL_DOCUMENT_REQUIRED' | 'TRANSFER_REVIEW_REQUIRED' | null | string;
  importBatchId?: string | null;
  importedAt?: Date | string | null;
  importedBy?: string | null;
  clinical_data?: {
    orphaCode?: string | null;
    omimCode?: string | null;
    cid?: string | null;
    phenotypes?: any[];
    charlsonComorbidities?: string[];
    biomarkers_values?: Record<string, string | number>;
  } | null;
  complianceGraph?: {
    isReleasable?: boolean;
    graphPath?: {
      ethics?: { valid?: boolean; reason?: string };
      quality?: { valid?: boolean; reason?: string };
      clinical?: { valid?: boolean; reason?: string };
      integrity?: { valid?: boolean; reason?: string };
    };
    suggestedStatus?: 'AVAILABLE' | 'BLOCKED' | 'QUARANTINE' | string;
  } | null;
  qualityID?: string | number; // Mantido para compatibilidade
  unit?: string; // Unidade de medida (µL, mL, etc.)
  unitID?: number; // Relacionamento Sample → SampleWithMeasurementUnit
  locationID?: number;
  linkedProject?: string;
  isRareDisease?: boolean;
  // Campos de movimentação
  movementType?: 'Armazenamento' | 'Transferência';
  // Controle de quantidade (novos campos)
  currentQuantity?: number; // Quantidade disponível após retiradas (dict-02 ELM-0139)
  initialQuantity?: number; // Quantidade original (nunca muda; dict-02 ELM-0138)
  totalWithdrawn?: number; // Total já retirado
  totalReturned?: number; // Total já devolvido
  lastWithdrawalID?: number; // ID da última retirada
  checked?: boolean; // Flag opcional para seleção em UI (fallback a arrays de IDs)
  // Status de disponibilidade
  currentStatus?: 'Available' | 'PartiallyWithdrawn' | 'TotallyWithdrawn' | 'Withdrawn' | 'Destroyed' | 'Unusable';
  status?: 'AVAILABLE' | 'QUARANTINED' | 'PARTIAL' | 'DEPLETED' | 'UNAVAILABLE' | 'CLOSED' | 'UNKNOWN';
  // Campos de retirada
  withdrawalDate?: Date | string;
  withdrawalType?: 'Parcial' | 'Total';
  withdrawalResponsible?: string;
  sampleDestination?: string;
  storageLocation?: SampleEmbeddedStorageLocation | null;
  // The current placement as the API resolves it (#1374): the physical chain
  // (#1314) first, the open legacy StorageAssignment row (ELM-0167..0178,
  // historical reads only) as a fallback. Added alongside storageLocation
  // above, not replacing it; sent by the sample create responses and by the
  // storage use cases' sample reads. GET /samples/:id does not return it.
  storageAssignment?: SamplePlacement | null;
  // GET /samples (list view) only (#517) — batched, per-row resolution of
  // the same shape GET /storage/sample/:sampleId returns, so SamplesPageView
  // doesn't have to read storageLocation above directly nor make one
  // follow-up request per row.
  resolvedStorageLocation?: SampleStorageLocationDTO | null;
  // GET /samples (list view) only (#517) — the sample's current SPREC
  // snapshot (sealedSpecimenPreanalyticsId-pinned if set, else newest),
  // batched the same way as resolvedStorageLocation above. SampleDetailsPage
  // (#518) also reads this field, sourcing the same sample object from the
  // shared useSamples() list rather than a dedicated per-sample fetch.
  currentSpecimenPreanalytics?: SpecimenPreanalyticsProfile | null;
  // Soft delete fields
  deleted?: boolean;
  deletedAt?: Date | string;
  deletedBy?: {
    userID?: string;
    userName?: string;
  };
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface SampleWithMeasurementUnit {
  _id?: string; // MongoDB ID
  unitID: number;
  description: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface SampleWithQualityDescription {
  _id?: string; // MongoDB ID
  // #881: the canonical business identifier is the string MIABIS code the
  // seed writes on `id` (settled by #902) -- the numeric qualityID this
  // mount used to require is retired.
  id: string;
  description: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface AnalysisType {
  _id?: string; // MongoDB ID
  name: string;
  code: string;
  active?: boolean;
  createdAt?: Date | string;
}

export interface Result {
  _id?: string; // MongoDB ID
  resultID: number;
  fileType: FileType;
  filePath: string;
  description: string; // Obrigatório
  analysisType?: string;
  method?: string;
  responsibleResearcher?: string;
  specimenId: string; // Obrigatório - Specimen.specimenId da amostra vinculada (#628)
  equipmentID?: number; // Associação Result → Equipment
  equipmentName?: string;
  importJobID?: string; // Vincula resultado com job de importação
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface ConsentPermission {
  key: string;
  label: string;
  required?: boolean;
}

export interface ConsentPolicyPermission {
  key: string;
  label: string;
  required?: boolean;
  // RF010 AC3 (#1349): a GA4GH DUO code, the purpose the permission covers.
  purposeCode?: string;
}

// #1349: an active DUO concept a term's permission may name.
export interface PurposeCode {
  code: string;
  display: string;
}

export interface ConsentTemplate {
  _id?: string;
  title: string;
  content: string;
  htmlContent?: string;
  version: string;
  versionGroupId?: string;
  caae: string;
  // RF010 AC1 (ENUM-0043..0046): the modality the term offers.
  consentModel?: 'specific' | 'broad' | 'tiered' | 'dynamic' | null;
  active: boolean;
  permissions: ConsentPermission[];
  granularPermissions?: ConsentPolicyPermission[];
  validFrom?: Date | string;
  validTo?: Date | string;
  validUntil?: Date | string;
  validityDate?: Date | string;
  expirationDate?: Date | string;
  expiresAt?: Date | string;
  validade?: Date | string;
  vigencia?: {
    validTo?: Date | string;
    validUntil?: Date | string;
    endDate?: Date | string;
    fim?: Date | string;
  };
  createdAt?: Date | string;
}

export interface ConsentPolicy {
  _id?: string;
  title: string;
  version: string;
  caae: string;
  active: boolean;
  htmlContent: string;
  validFrom: Date | string;
  validTo?: Date | string;
  validUntil?: Date | string;
  validityDate?: Date | string;
  expirationDate?: Date | string;
  expiresAt?: Date | string;
  validade?: Date | string;
  vigencia?: {
    validTo?: Date | string;
    validUntil?: Date | string;
    endDate?: Date | string;
    fim?: Date | string;
  };
  granularPermissions: ConsentPolicyPermission[];
  revisionType?: 'create' | 'update';
  previousPolicyId?: string | null;
  versionGroupId?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface PatientConsent {
  _id?: string;
  participantId: string;
  consentTemplateId: string;
  signedAt?: Date | string;
  signedTcleDocumentUri?: string | null;
  status: 'ACTIVE' | 'REVOKED';
  revokedAt?: Date | string | null;
  ipAddress?: string;
  userAgent?: string;
  responses: Record<string, boolean>;
  consentId?: string;
  // RF010 AC5: the state derived from the consent's decision events and
  // revocations, and what it still permits.
  currentStateDerived?: ConsentStateDerived;
  effectivePermissions?: Record<string, boolean>;
  withdrawalScope?: string[];
}

export type ConsentStateDerived = 'active' | 'partially_revoked' | 'revoked' | 'superseded';

export interface ConsentPermissionRow {
  permissionCode: string;
  purpose?: { code?: string; display?: string };
  decision?: 'permit' | 'deny';
}

export interface ConsentDecisionEvent {
  consentDecisionEventId: string;
  decision: string;
  occurredAt: Date | string;
  channel: string;
  signerRole: string;
  signerId?: string | null;
  authenticationLevel?: string | null;
}

export interface ConsentRevocationRecord {
  consentRevocationId: string;
  scope: string[];
  reason: string | null;
  effectiveAt: Date | string;
  priorUseDisposition?: string | null;
  channel?: string | null;
  location?: {
    status: 'captured' | 'unavailable';
    latitude?: number;
    longitude?: number;
    accuracyMeters?: number | null;
    capturedAt?: string | null;
  } | null;
}

export interface ConsentCommunicationRecord {
  consentCommunicationEventId: string;
  participantId?: string | null;
  communicationType: string;
  contentTemplateId: string;
  purpose?: string | null;
  deliveryStatus: string;
  sentAt: Date | string;
}

/** GET /api/e-consent/consents/:id/history (RF010 AC5). */
export interface ConsentHistory {
  consentId: string;
  permissions: ConsentPermissionRow[];
  participantId: string | null;
  currentStateDerived: ConsentStateDerived;
  supersededByConsentId: string | null;
  supersedesConsentId: string | null;
  decisionEvents: ConsentDecisionEvent[];
  revocations: ConsentRevocationRecord[];
  communications?: ConsentCommunicationRecord[];
}

export enum FileType {
  PDF = 'PDF',
  IMAGE = 'IMAGE',
  DATA = 'DATA',
  OTHER = 'OTHER'
}

export interface Equipment {
  _id?: string; // MongoDB ID
  equipmentID: number;
  equipmentDescription: string;
  name?: string; // Nome amigável do equipamento
  model?: string;
  serialNumber?: string;
  type?: 'Freezer' | 'Analytical' | 'Storage' | 'Processing' | 'Other'; // Tipo de equipamento
  status?: 'Calibrado' | 'Maintenance' | 'Active' | 'Inactive' | 'Needs Calibration'; // Status do equipamento
  purchaseDate?: Date | string;
  organizationId?: string | null; // Organization.organizationId (UUID) -- sem backfill, null = não escopado/legado (#635)
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface Location {
  _id?: string; // MongoDB ID
  locationID?: number; // Identificador próprio conforme diagrama
  equipmentType: number; // Mantido conforme diagrama
  equipmentID?: number; // Associação Equipment → Location
  block: number;
  rack: number;
  drawer: number;
  box: number;
  eppendorfWell?: string; // Campo do frontend (string)
  wellPosition?: string; // Campo do backend (string) - posição do eppendorf
}

export interface Organization {
  _id?: string; // MongoDB ID
  organizationId: string;
  officialName: string;
  normalizedName?: string;
  acronym?: string | null;
  organizationType?: string | null;
  countryCode: string;
  website?: string | null;
}

// #726 (RF008 AC#6) — ReportTemplate, api/backend/src/models/ReportTemplate.js
export const REPORT_TEMPLATE_HANDLER_KEYS = [
  'samplesByPatient',
  'patient',
  'sample',
  'sampleAnalysis',
  'temperature',
  'sensor',
  'equipment',
  'result',
  'withdrawalHistory',
  'tissueOriginHistory',
  'extracellularNetwork',
  'accessLogs',
  'auditEvents',
] as const;

export type ReportTemplateHandlerKey = typeof REPORT_TEMPLATE_HANDLER_KEYS[number];

export interface ReportTemplate {
  _id?: string;
  code: string;
  name: string;
  description?: string | null;
  handlerKey: ReportTemplateHandlerKey | string;
  handlerOptions?: Record<string, unknown>;
  isSystemDefined: boolean;
  templateStatus: 'active' | 'retired';
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

// RF020 / MIABIS Collection (ELM-0039..0052) — dict-02_DICIONARIO.md
export interface Collection {
  _id?: string; // MongoDB ID
  collectionId: string;
  collectionName: string;
  collectionStatus?: string;
  // V2E-0427, RF004 AC2: set at creation, never edited.
  governanceRegime?: 'biobank' | 'biorepository' | null;
  sampleTypes?: Array<Record<string, unknown>>;
  datasetTypes?: Array<Record<string, unknown>>;
  diseaseScope?: Array<Record<string, unknown>>;
  inclusionCriteriaCategories?: Array<Record<string, unknown>>;
  exclusionCriteria?: string | null;
  miabisUseAccessConditions?: Array<Record<string, unknown>>;
  storageTemperatureCategories?: Array<Record<string, unknown>>;
  participantCount?: number | null;
  sampleCount?: number | null;
  relatedPublications?: Array<Record<string, unknown>>;
}

// RF004 AC3, RF020 AC3, RF021 AC2 (V2E-0067..0075): an approval a
// collection's governance rests on.
export type CollectionGovernanceApprovalStatus = 'draft' | 'active' | 'suspended' | 'revoked';

export interface CollectionGovernanceApproval {
  approvalId: string;
  collectionId: string;
  authority: string;
  caae?: string | null;
  documentUri: string;
  documentChecksum: string;
  effectivePeriod: { start: string; end?: string | null };
  status: CollectionGovernanceApprovalStatus;
  responsibleOrganizationId: string;
  statusHistory?: Array<{ from: string; to: string; reason?: string | null; changedAt?: string }>;
  createdAt?: string;
}

// RF020 AC4 (V2E-0097..0104): the event that sets or converts a regime.
export interface CollectionGovernanceEvent {
  collectionGovernanceEventId: string;
  collectionId: string;
  previousRegime: 'biobank' | 'biorepository' | null;
  newRegime: 'biobank' | 'biorepository';
  decisionType: 'created' | 'regime_change';
  approvalIds: string[];
  justification: string;
  occurredAt: string;
}

// GET /api/collections/:collectionId/governance. The context holds the
// regime's own fields (BiorepositoryContext or BiobankGovernanceContext).
export interface CollectionGovernance {
  collectionId: string;
  governanceRegime: 'biobank' | 'biorepository' | null;
  governanceContext: Record<string, unknown> | null;
  approvals: CollectionGovernanceApproval[];
  events: CollectionGovernanceEvent[];
}

export interface User {
  _id?: string; // MongoDB ID
  userID?: string;
  id: number;
  name: string;
  email: string;
  phone?: string;
  organizationId?: string | null; // Reference -> Organization.organizationId (#347 cutover, replaces the old free-text `institution` field)
  username: string;
  password?: string; // Não deve ser retornado em respostas GET
  accessType?: number; // Mantido para compatibilidade (1: Básico, 2: Intermediário, 3: Completo)
  roleName?: 'Coordenador' | 'Técnico' | 'Administrador' | 'Usuário Externo'; // Role conforme diagrama de caso de uso
  // #1239: the backend's audit-trail rule (administrator or the additive
  // auditor role), sent on login and verify. roleName cannot express it.
  isAuditReader?: boolean;
  // #1240: whether this user holds the additive auditor role. Read on the
  // user list and item; written through PUT /api/users/:id only.
  auditorRole?: boolean;
  accessIDs?: number[]; // IDs dos Access permitidos (reportID da tabela Access)
  allowedReports?: string[]; // Tipos de relatórios permitidos (preenchido pelo backend)
  status?: string;
  // Campos para Google Authenticator 2FA
  twoFactorEnabled?: boolean;
  twoFactorSecret?: string;
  twoFactorBackupCodes?: string[];
  twoFactorFailedAttempts?: number;
  twoFactorLockedUntil?: Date | string | null;
  firstLogin?: boolean; // Indica se é o primeiro login (2FA obrigatório)
  mfaEnabled?: boolean;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface SpecificUser extends User {
  mfaEnabled?: boolean;
  mfaActivationDate?: Date | string | null;
  mfaFailedAttempts?: number;
  mfaLocked?: boolean;
}

export interface Access {
  _id?: string; // MongoDB ID
  reportID: number;
  reportType: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface Reports {
  reportID: number;
  reportType: string;
  reportData?: string; // JSON string com os dados do relatório
  generatedAt?: Date | string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface Temperature {
  _id?: string; // MongoDB ID
  logID: string;
  telemetryReadingId?: string;
  timestamp?: Date | string;
  temperatureValue: number;
  temperatureUnit?: string;
  readingStatus?: string;
  dataQualityScore?: number;
  errorCode?: string;
  errorMessage?: string;
  sensorId: string; // Campo canônico -- ver Sensor acima (#940)
  sensorID?: string; // Alias legado
  policyID: number; // Padronizado para Number (consistente com Policy)
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface LogTracking {
  ip?: string;
  ipOriginal?: string;
  forwardedFor?: string;
  realIp?: string;
  userAgent?: string;
  referer?: string;
  host?: string;
  protocol?: string;
  secure?: boolean;
}

export interface LogRequest {
  method?: string;
  path?: string;
  origin?: string;
  headers?: {
    accept?: string;
    'accept-language'?: string;
    'accept-encoding'?: string;
    'content-type'?: string;
    'user-agent'?: string;
  };
}

export interface LogMetadata {
  tracking?: LogTracking;
  request?: LogRequest;
  user?: {
    userID?: string;
    userName?: string;
    userRole?: string;
  };
  [key: string]: any;
}

export interface Log {
  _id?: string; // MongoDB ID
  logID?: number | string;
  timestamp?: Date | string;
  dateTime?: Date | string;
  timestampISO?: string;
  timestampFormatted?: string;
  auditHash?: string;
  userID?: string;
  userId?: string;
  userName?: string;
  user?: string;
  action: string;
  resourceType?: string;
  resourceId?: string | number;
  status?: string;
  entity: string;
  entityID?: string | number;
  result: string;
  severity: string;
  origin?: string;
  source?: string;
  sourceIP?: string;
  ipSource?: string;
  ip?: string;
  module?: string;
  message?: string;
  payload?: any;
  errorStack?: string;
  metadata?: LogMetadata;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface Sensor {
  _id?: string; // MongoDB ID
  sensorId: string; // Campo canônico -- api/backend/src/models/Sensor.js#create grava sensorId (lowercase-d), independente do spelling de entrada (#940)
  sensorID?: string; // Alias legado -- api.ts ainda envia esta grafia em requests; não removido
  sensorType: string;
  sensorModel?: string;
  maintenanceStatus?: string;
  lastCalibration?: Date | string | null;
  nextCalibration?: Date | string | null;
  calibrationCertificate?: string;
  locationID?: number; // Padronizado para Number (consistente com Sample e Location)
  // #1145: _id da TemperaturePolicy, vinculado ao SensorMetadata no cadastro
  // (é o que a telemetria lê). Substitui policyID, que gravava Sensor.policyId
  // e não era lido por nenhum resolvedor. Exige macAddress.
  temperaturePolicy?: string;
  macAddress?: string; // Opcional: presente => backend vincula um SensorMetadata (ver #311)
  storageContainer?: string; // ID do StorageContainer (freezer) vinculado ao SensorMetadata
  organizationId?: string | null; // Organization.organizationId (UUID) -- sem backfill, null = não escopado/legado (#634)
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface Policy {
  _id?: string; // MongoDB ID -- the id every policy route keys on (#1178)
  // #1178: legacy numeric id. The API returns it as `policyId` (lowercase d)
  // and it is null for any policy created since #1089, so nothing keys on it.
  policyId?: number | null;
  // #1139: the API's field names are the stored temperaturePolicies document's
  // (dict-02 ThresholdProfile), with no translation in between.
  name?: string; // dict-02 P1X-0106 profileName
  minTemp: number; // P1X-0108 lowerLimit
  maxTemp: number; // P1X-0109 upperLimit
  hysteresis?: number;
  minimumDuration?: number | null; // P1X-0110, minutes before an excursion opens
  temperatureUnit?: string;
  effectivePeriod: {
    // P1X-0111
    start: Date | string;
    end?: Date | string | null;
  };
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

// Interface para Withdrawal mencionada em User.recordSampleWithdrawal()
export interface SampleHistory {
  _id?: string; // MongoDB ID
  historyID: number;
  sampleID: number;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'WITHDRAWAL' | 'LOCATION_CHANGE' | 'STATUS_CHANGE' | 'QUANTITY_CHANGE';
  changedBy: {
    userID: string;
    userName: string;
  };
  timestamp?: Date | string;
  previousValues?: Record<string, any>;
  newValues?: Record<string, any>;
  changedFields?: string[];
  reason?: string;
  sourceIP?: string;
  message?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface Withdrawal {
  _id?: string; // MongoDB ID
  withdrawalID: number;
  sampleID: number;
  withdrawalDate?: Date | string;
  withdrawalType: 'Parcial' | 'Total';
  withdrawalQuantity?: number; // Quantidade retirada (obrigatório se Parcial)
  withdrawalResponsible: string;
  withdrawalDestination?: string; // Renomeado de sampleDestination conforme RF006
  linkedProject: string; // Campo obrigatório conforme RF006
  justification?: string; // Renomeado de notes conforme RF006
  // Campos legados para compatibilidade
  sampleDestination?: string;
  notes?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface Return {
  _id?: string; // MongoDB ID
  returnID: number;
  sampleID: number;
  returnDate?: Date | string;
  returnType: 'Parcial' | 'Total';
  returnQuantity: number; // Quantidade devolvida
  returnResponsible: string;
  linkedProject: string; // Campo obrigatório
  condition?: 'Íntegra' | 'Parcialmente comprometida' | 'Inutilizada'; // Condição da amostra ao devolver
  notes?: string; // Observações sobre a devolução
  relatedWithdrawalID?: number; // Referência à retirada original
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

// Interface para movimentações de amostras (ledger imutável)
export interface SampleMovement {
  _id?: string;
  movementID: number;
  sampleID: string;
  barcode?: string;
  type: 'withdraw' | 'return' | 'adjust';
  quantity: number;
  unit?: string;
  responsible: string;
  // Campos de retirada
  destination?: string;
  purpose?: string;
  linkedProject?: string;
  // Campos de devolução
  condition?: 'Íntegra' | 'Parcialmente comprometida' | 'Inutilizada';
  relatedWithdrawalID?: number;
  // Observações
  observations?: string;
  // Auditoria
  userId?: string;
  userName?: string;
  userRole?: string;
  ipAddress?: string;
  // Saldos
  previousQuantity?: number;
  newQuantity?: number;
  // Timestamps
  timestamp: Date | string;
  createdAt?: Date | string;
}

// ========== IMPORT SYSTEM TYPES ==========

export enum ImportDataType {
  PATIENTS = 'patients',
  SAMPLES = 'samples',
  RESULTS = 'results',
  TEMPERATURE = 'temperature'
}

export enum ImportJobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  // #890: terminal status for a result-import run that finished normally
  // but wrote nothing because every processed entry hit an
  // unimplemented/unsupported format stub (.raw / generic-file).
  COMPLETED_NO_DATA = 'completed_no_data',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export interface ImportJob {
  _id?: string; // MongoDB ID
  jobID: string; // UUID único
  userID: string;
  userName: string;
  dataType: ImportDataType;
  fileName: string;
  filePath: string;
  fileSize: number;
  fileFormat: string; // CSV, XLSX, JSON, ZIP, RAW
  status: ImportJobStatus;
  metadata?: Record<string, any>;
  validationErrors?: ImportValidationError[];
  processingErrors?: string[];
  metrics?: ImportMetrics;
  // #905: the worker persists flat counts and the jobs-list endpoint
  // returns them verbatim; `metrics` above only exists on the report
  // shape (mapped server-side in getJobReport).
  totalRecords?: number;
  successCount?: number;
  errorCount?: number;
  unprocessedFormats?: number;
  errors?: Array<{ row?: number; error: string; code?: string; fileName?: string; filePath?: string }>;
  createdAt?: Date | string;
  startedAt?: Date | string;
  completedAt?: Date | string;
  updatedAt?: Date | string;
}

export interface ImportValidationError {
  row?: number;
  field?: string;
  message: string;
  value?: any;
}

export interface ImportMetrics {
  totalRecords: number;
  successfulRecords: number;
  failedRecords: number;
  // #925: both were declared required and neither was produced at the time.
  // duplicatesFound was read by the report modal against a `?? 0` default
  // that made "nobody counted" indistinguishable from "none found". Optional
  // now, so a consumer has to decide what an absent value means instead of
  // being handed a zero.
  //
  // #991: skippedRecords is now written end to end -- import-worker.js puts
  // it in the job-completion payload and import-async.service.js carries it
  // into this metrics object -- and ResultsPage.tsx renders it (gated on
  // `!== undefined`, same idiom as duplicatesFound). Still optional: pre-#991
  // jobs never had it written, and an absent value must stay absent rather
  // than render as a false zero.
  skippedRecords?: number;
  /**
   * #931: a labelled SUBSET of `failedRecords`, not a sibling of it. Every
   * duplicate row is pushed onto the import's `errors` array and skipped, so
   * it is already inside `failedRecords` -- `successfulRecords +
   * failedRecords + duplicatesFound` deliberately exceeds `totalRecords`.
   * Present only on jobs run since #931; still optional so pre-#931 jobs omit
   * the tile rather than claiming zero (#925).
   */
  duplicatesFound?: number;
  processingTime?: number; // em segundos
  recordsPerSecond?: number;
}

export interface ImportReport {
  jobID: string;
  status: ImportJobStatus;
  dataType: ImportDataType;
  fileName: string;
  metrics: ImportMetrics;
  errors: ImportValidationError[];
  processingErrors?: string[];
  createdAt: Date | string;
  completedAt?: Date | string;
}

export interface SampleFile {
  _id?: string; // MongoDB ID
  sampleID: string; // ID da amostra (vinculação obrigatória)
  fileName: string; // Nome original do arquivo
  fileType: 'RAW' | 'ZIP' | 'CSV' | 'XLS' | 'XLSX' | 'PDF' | 'TXT'; // Tipo do arquivo
  fileSize: number; // Tamanho em bytes
  uploaderAnonId?: string; // ID anonimizado do uploader (LGPD)
  uploadDate: Date | string; // Data do upload
  createdAt?: Date | string;
  updatedAt?: Date | string;
  // storagePath não é exposto ao frontend (segurança)
  
  // Campos HL7 opcionais (extensão para interoperabilidade)
  accessionNumber?: string; // Número de acesso do exame
  orderNumber?: string; // Número da requisição
  equipmentID?: number; // ID do equipamento que gerou o arquivo
  collectionDateTime?: Date | string; // Data/hora da coleta da amostra
  processingDateTime?: Date | string; // Data/hora do processamento
  analysisDateTime?: Date | string; // Data/hora da análise
  loincCode?: string; // Código LOINC do exame/procedimento
  procedureCode?: string; // Código do procedimento (SNOMED ou local)
  equipmentManufacturer?: string;
  equipmentModel?: string;
  equipmentSerialNumber?: string;
  softwareVersion?: string;
  resultStatus?: 'F' | 'P' | 'C'; // F (Final), P (Preliminar), C (Cancelado)
  unitOfMeasure?: string; // Unidade de medida padronizada
  resultValue?: number; // Valor numérico do resultado
  interpretation?: 'N' | 'A' | 'H' | 'L' | 'HH' | 'LL' | 'C'; // Normal, Anormal, Alto, Baixo, etc.
  hl7Version?: string; // Ex: "2.8", "FHIR R4"
  messageType?: string; // Ex: "ORU^R01", "OBR"
}


// RF024 (#1350): an access or distribution request, as /api/access-requests
// returns it (api/backend/src/models/AccessRequest.js).
export type AccessRequestItemType = 'specimen' | 'dataset' | 'file';
export type AccessDecisionStatus = 'pending' | 'approved' | 'rejected' | 'conditioned' | 'revoked';

export interface AccessRequestItem {
  itemType: AccessRequestItemType;
  itemId: string;
  quantity?: number | null;
}

export interface AccessRequestItemCompatibility {
  itemId: string;
  itemType: AccessRequestItemType;
  participantId: string | null;
  consentValid: boolean | null;
  consentAuthorizationDecisionId: string | null;
  consentAuthorizationResult: 'permit' | 'deny' | 'review_required' | null;
  consentAuthorizationReasons: string[];
  duoCompatible: boolean | null;
  studyActive: boolean;
  compatible: boolean;
}

export interface AccessRequest {
  accessRequestId: string;
  requesterId: string;
  organizationId: string;
  studyId: string;
  protocolId: string;
  protocolVersion: string | null;
  requestedPurpose: string;
  duoCode: string | null;
  requestedItems: AccessRequestItem[];
  consentCompatibility: AccessRequestItemCompatibility[];
  compatibilityEvaluatedAt: string | null;
  overallCompatible: boolean | null;
  policyDecision: { effect: 'permit' | 'deny' | 'review_required'; reasons: string[] } | null;
  committeeDecision: {
    decisionId: string | null;
    status: AccessDecisionStatus;
    justification: string | null;
    decidedBy: string | null;
    decidedAt: string | null;
    policyVersion: string | null;
    policyEffect: string | null;
    configurationReleaseId: string | null;
  };
  approvalPeriod: { start: string; end?: string | null } | null;
  distributionStatus: 'pending' | 'released';
  distributedAt: string | null;
  distributionDecisionId: string | null;
  createdAt: string;
}

export interface AccessCheck {
  allowed: boolean;
  reason: string;
}

// ELM-0275..0285 (#1402): BiomarkerAssociation reference data. A Coding is
// the {systemUri, code, version, display} shape the backend model stores.
export interface Coding {
  systemUri: string;
  code: string;
  version?: string;
  display?: string;
}

export interface BiomarkerEvidenceReference {
  system: 'DOI' | 'PMID';
  value: string;
}

export type BiomarkerRole = 'diagnostic' | 'prognostic' | 'risk' | 'safety' | 'monitoring' | 'response';

export interface BiomarkerAssociation {
  _id?: string;
  biomarkerId: string;
  analyte: Coding;
  associatedCondition: Coding[];
  biomarkerRole: BiomarkerRole;
  contextOfUse: string;
  evidenceReferences: BiomarkerEvidenceReference[];
  biospecimenMatrix?: unknown;
  assayMethod?: unknown;
  cutoff?: unknown;
  evidenceLevel?: unknown;
  regulatoryStatus?: unknown;
  createdAt?: string;
  updatedAt?: string;
}
