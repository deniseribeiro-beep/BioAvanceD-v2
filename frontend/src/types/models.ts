// Modelos baseados no diagrama UML

export interface Patient {
  _id?: string; // MongoDB ID
  // 1. ID - Numérico - Identificador único (gerado automaticamente)
  participantId: string; // ID canônico do participante
  
  // 2. NOME - Caractere - Nome completo do paciente
  patientName: string;

  // Contato para envio do TCLE
  email?: string;
  phone?: string;
  
  // 3. DATA_NASCIMENTO - Caractere - Data de nascimento (formato DD/MM/YYYY)
  birthDate: string; // Alterado para string no formato DD/MM/YYYY
  
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
  representativeName?: string;
  representativeEmail?: string;
  representativeIdentityDocument?: string;
  representativePhone?: string;
  
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
  sampleList?: Sample[] | string[];
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

export interface Sample {
  _id?: string; // MongoDB ID
  participantId: string;
  sampleID?: number | null; // ID da amostra (pode ser null, usar _id como fallback)
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
  release_status?: 'AVAILABLE' | 'BLOCKED' | 'QUARANTINE' | string;
  consentStatus?: 'PENDING' | 'SIGNED' | 'EXTERNAL_ATTACHED' | 'WAIVED_TRANSFER' | 'NOT_REQUIRED' | string;
  // Canonical status (storage/custody split, #389/#409) — derive quarantine/availability
  // UI state from this.
  specimenStatus?: 'available' | 'reserved' | 'checked_out' | 'partial' | 'depleted' | 'quarantined' | 'destroyed' | 'unavailable' | 'disposed' | string;
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
  // Controle de volume (normaliza naming para front/back)
  volumeInitial?: number; // Volume inicial
  volumeCurrent?: number; // Volume atual
  checked?: boolean; // Flag opcional para seleção em UI (fallback a arrays de IDs)
  // Status de disponibilidade
  currentStatus?: 'Available' | 'PartiallyWithdrawn' | 'TotallyWithdrawn' | 'Withdrawn' | 'Expired' | 'Destroyed' | 'Unusable';
  status?: 'AVAILABLE' | 'QUARANTINED' | 'PARTIAL' | 'DEPLETED' | 'UNAVAILABLE';
  // Campos de retirada
  withdrawalDate?: Date | string;
  withdrawalType?: 'Parcial' | 'Total';
  withdrawalResponsible?: string;
  sampleDestination?: string;
  storageLocation?: {
    freezerId?: string | null;
    freezerName?: string | null;
    shelfId?: string | null;
    shelfName?: string | null;
    rackId?: string | null;
    rackName?: string | null;
    boxId?: string | null;
    boxName?: string | null;
    position?: string | null;
    path?: string | null;
  } | null;
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
  qualityID: number;
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
  sampleID: number; // Obrigatório - deve estar vinculado a uma amostra
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
}

export interface ConsentTemplate {
  _id?: string;
  title: string;
  content: string;
  htmlContent?: string;
  version: string;
  versionGroupId?: string;
  caae: string;
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
  status: 'ACTIVE' | 'REVOKED';
  revokedAt?: Date | string | null;
  ipAddress?: string;
  userAgent?: string;
  responses: Record<string, boolean>;
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

export interface User {
  _id?: string; // MongoDB ID
  userID?: string;
  id: number;
  name: string;
  email: string;
  phone?: string;
  institution?: string;
  username: string;
  password?: string; // Não deve ser retornado em respostas GET
  accessType?: number; // Mantido para compatibilidade (1: Básico, 2: Intermediário, 3: Completo)
  roleName?: 'Coordenador' | 'Técnico' | 'Administrador' | 'Usuário Externo'; // Role conforme diagrama de caso de uso
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
  timestamp?: Date | string;
  temperatureValue: number;
  temperatureUnit?: string;
  readingStatus?: string;
  dataQualityScore?: number;
  errorCode?: string;
  errorMessage?: string;
  sensorID: string;
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
  sensorID: string;
  sensorType: string;
  sensorModel?: string;
  maintenanceStatus?: string;
  lastCalibration?: Date | string | null;
  nextCalibration?: Date | string | null;
  calibrationCertificate?: string;
  locationID?: number; // Padronizado para Number (consistente com Sample e Location)
  policyID?: number; // Padronizado para Number (consistente com Policy)
  macAddress?: string; // Opcional: presente => backend vincula um SensorMetadata (ver #311)
  storageContainer?: string; // ID do StorageContainer (freezer) vinculado ao SensorMetadata
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface Policy {
  _id?: string; // MongoDB ID
  policyID: number;
  policyName?: string;
  minThreshold: number;
  maxThreshold: number;
  targetTemperature: number;
  hysteresis?: number;
  alertDelayMin?: number;
  temperatureUnit?: string;
  validFrom: Date | string;
  validTo: Date | string;
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
  skippedRecords: number;
  duplicatesFound: number;
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

