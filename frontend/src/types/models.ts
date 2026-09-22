// Modelos baseados no diagrama UML

export interface Patient {
  _id?: string;
  participantId: string;
  patientName?: string;
  email?: string;
  phone?: string;
  birthDate?: string;
  age?: number;
  recordNumber: string;
  clinicalUnitId?: string;
  clinicalUnit?: string;
  unitAcronym?: string;
  isDeceased?: boolean;
  representativeName?: string;
  representativeEmail?: string;
  representativeIdentityDocument?: string;
  representativePhone?: string;
  sex: string;
  diagnosticHypothesis?: string;
  icdCode?: string;
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
  weight?: number;
  heightCm?: number;
  hypertension?: string;
  obesity?: string;
  diabetesType1?: string;
  diabetesType2?: string;
  copd?: string;
  ckd?: string;
  smoking?: string;
  alcoholUse?: string;
  asthma?: string;
  antibioticUse?: string;
  insulinUse?: string;
  antiviralUse?: string;
  geneticVariant: string;
  alphaGal?: number;
  lysoGb3?: number;
  notes?: string;
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

/**
 * Canonical-v2 physical-custody read model. Persistence authority remains
 * SpecimenContainerAssignment -> ContainerPositionAssignment ->
 * StoragePosition -> StorageRack -> RackLocationAssignment; this interface
 * is only the API/UI projection of that normalized chain.
 */
export interface CanonicalPhysicalPlacement {
  specimenId?: string | null;
  containerId?: string | null;
  specimenContainerAssignmentId?: string | null;
  containerPositionAssignmentId?: string | null;
  storagePositionId?: string | null;
  rackLocationAssignmentId?: string | null;
  storageRackId?: string | null;
  storageLocationId?: string | null;
  boxId?: string | null;
  positionCode?: string | null;
  assignedAt?: Date | string | null;
  releasedAt?: Date | string | null;
  placedAt?: Date | string | null;
  removedAt?: Date | string | null;
  sourceService?: string | null;
}

export interface CurrentStoragePlacementDTO {
  specimenId?: string | null;
  barcode?: string | null;
  box?: {
    boxId: string;
    boxName: string | null;
    position: string | null;
  } | null;
  path?: string | null;
  fullHierarchy?: {
    freezerId: string;
    shelfId: string;
    rackId: string;
    boxId: string;
  } | null;
  canonicalPlacement?: CanonicalPhysicalPlacement | null;
  boxId?: string | null;
  boxName?: string | null;
  positionCode?: string | null;
  equipmentID?: string | number | null;
  readable?: string | null;
}

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
  _id?: string;
  specimenId: string;
  participantId: string;
  sampleType: string;
  sampleOrigin?: string;
  extractionProtocol?: string;
  barcode?: string;
  registrationDate?: Date | string;
  quantity?: number;
  quality?: string | number;
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
  quality_score?: number | null;
  quality_category?: 'A' | 'B' | 'C' | 'D' | 'E' | '' | string;
  merkle_root?: string | null;
  consentStatus?: 'PENDING' | 'SIGNED' | 'EXTERNAL_ATTACHED' | 'WAIVED_TRANSFER' | 'NOT_REQUIRED' | string;
  specimenStatus?: 'available' | 'reserved' | 'checked_out' | 'partial' | 'depleted' | 'quarantined' | 'destroyed' | 'unavailable' | 'disposed' | string;
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
  qualityID?: string | number;
  unit?: string;
  unitID?: number;
  locationID?: number;
  linkedProject?: string;
  isRareDisease?: boolean;
  movementType?: 'Armazenamento' | 'Transferência';
  currentQuantity?: number;
  initialQuantity?: number;
  totalWithdrawn?: number;
  totalReturned?: number;
  lastWithdrawalID?: number;
  volumeInitial?: number;
  volumeCurrent?: number;
  checked?: boolean;
  currentStatus?: 'Available' | 'PartiallyWithdrawn' | 'TotallyWithdrawn' | 'Withdrawn' | 'Destroyed' | 'Unusable';
  status?: 'AVAILABLE' | 'QUARANTINED' | 'PARTIAL' | 'DEPLETED' | 'UNAVAILABLE';
  withdrawalDate?: Date | string;
  withdrawalType?: 'Parcial' | 'Total';
  withdrawalResponsible?: string;
  sampleDestination?: string;
  currentStoragePlacement?: CurrentStoragePlacementDTO | null;
  currentSpecimenPreanalytics?: SpecimenPreanalyticsProfile | null;
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
  _id?: string;
  unitID: number;
  description: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface SampleWithQualityDescription {
  _id?: string;
  id: string;
  description: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface AnalysisType {
  _id?: string;
  name: string;
  code: string;
  active?: boolean;
  createdAt?: Date | string;
}

export interface Result {
  _id?: string;
  resultID: number;
  fileType: FileType;
  filePath: string;
  description: string;
  analysisType?: string;
  method?: string;
  responsibleResearcher?: string;
  specimenId: string;
  equipmentID?: number;
  equipmentName?: string;
  importJobID?: string;
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
  _id?: string;
  equipmentID: number;
  equipmentDescription: string;
  name?: string;
  model?: string;
  serialNumber?: string;
  type?: 'Freezer' | 'Analytical' | 'Storage' | 'Processing' | 'Other';
  status?: 'Calibrado' | 'Maintenance' | 'Active' | 'Inactive' | 'Needs Calibration';
  purchaseDate?: Date | string;
  organizationId?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface Location {
  _id?: string;
  locationID?: number;
  equipmentType: number;
  equipmentID?: number;
  block: number;
  rack: number;
  drawer: number;
  box: number;
  eppendorfWell?: string;
  wellPosition?: string;
}

export interface Organization {
  _id?: string;
  organizationId: string;
  officialName: string;
  normalizedName?: string;
  acronym?: string | null;
  organizationType?: string | null;
  countryCode: string;
  website?: string | null;
}

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

export interface Collection {
  _id?: string;
  collectionId: string;
  collectionName: string;
  collectionStatus?: string;
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

export interface User {
  _id?: string;
  userID?: string;
  id: number;
  name: string;
  email: string;
  phone?: string;
  organizationId?: string | null;
  username: string;
  password?: string;
  accessType?: number;
  roleName?: 'Coordenador' | 'Técnico' | 'Administrador' | 'Usuário Externo';
  accessIDs?: number[];
  allowedReports?: string[];
  status?: string;
  twoFactorEnabled?: boolean;
  twoFactorSecret?: string;
  twoFactorBackupCodes?: string[];
  twoFactorFailedAttempts?: number;
  twoFactorLockedUntil?: Date | string | null;
  firstLogin?: boolean;
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
  _id?: string;
  reportID: number;
  reportType: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface Reports {
  reportID: number;
  reportType: string;
  reportData?: string;
  generatedAt?: Date | string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface Temperature {
  _id?: string;
  logID: string;
  timestamp?: Date | string;
  temperatureValue: number;
  temperatureUnit?: string;
  readingStatus?: string;
  dataQualityScore?: number;
  errorCode?: string;
  errorMessage?: string;
  sensorId: string;
  sensorID?: string;
  policyID: number;
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
  _id?: string;
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
  _id?: string;
  sensorId: string;
  sensorID?: string;
  sensorType: string;
  sensorModel?: string;
  maintenanceStatus?: string;
  lastCalibration?: Date | string | null;
  nextCalibration?: Date | string | null;
  calibrationCertificate?: string;
  locationID?: number;
  policyID?: number;
  macAddress?: string;
  storageContainer?: string;
  organizationId?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface Policy {
  _id?: string;
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

export interface SampleHistory {
  _id?: string;
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
  _id?: string;
  withdrawalID: number;
  sampleID: number;
  withdrawalDate?: Date | string;
  withdrawalType: 'Parcial' | 'Total';
  withdrawalQuantity?: number;
  withdrawalResponsible: string;
  withdrawalDestination?: string;
  linkedProject: string;
  justification?: string;
  sampleDestination?: string;
  notes?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface Return {
  _id?: string;
  returnID: number;
  sampleID: number;
  returnDate?: Date | string;
  returnType: 'Parcial' | 'Total';
  returnQuantity: number;
  returnResponsible: string;
  linkedProject: string;
  condition?: 'Íntegra' | 'Parcialmente comprometida' | 'Inutilizada';
  notes?: string;
  relatedWithdrawalID?: number;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface SampleMovement {
  _id?: string;
  movementID: number;
  sampleID: string;
  barcode?: string;
  type: 'withdraw' | 'return' | 'adjust';
  quantity: number;
  unit?: string;
  responsible: string;
  destination?: string;
  purpose?: string;
  linkedProject?: string;
  condition?: 'Íntegra' | 'Parcialmente comprometida' | 'Inutilizada';
  relatedWithdrawalID?: number;
  observations?: string;
  userId?: string;
  userName?: string;
  userRole?: string;
  ipAddress?: string;
  previousQuantity?: number;
  newQuantity?: number;
  timestamp: Date | string;
  createdAt?: Date | string;
}

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
  COMPLETED_NO_DATA = 'completed_no_data',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export interface ImportJob {
  _id?: string;
  jobID: string;
  userID: string;
  userName: string;
  dataType: ImportDataType;
  fileName: string;
  filePath: string;
  fileSize: number;
  fileFormat: string;
  status: ImportJobStatus;
  metadata?: Record<string, any>;
  validationErrors?: ImportValidationError[];
  processingErrors?: string[];
  metrics?: ImportMetrics;
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
  skippedRecords?: number;
  duplicatesFound?: number;
  processingTime?: number;
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
  _id?: string;
  specimenId: string;
  fileName: string;
  fileType: 'RAW' | 'ZIP' | 'CSV' | 'XLS' | 'XLSX' | 'PDF' | 'TXT';
  fileSize: number;
  uploaderAnonId?: string;
  uploadDate: Date | string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  accessionNumber?: string;
  orderNumber?: string;
  equipmentID?: number;
  collectionDateTime?: Date | string;
  processingDateTime?: Date | string;
  analysisDateTime?: Date | string;
  loincCode?: string;
  procedureCode?: string;
  equipmentManufacturer?: string;
  equipmentModel?: string;
  equipmentSerialNumber?: string;
  softwareVersion?: string;
  resultStatus?: 'F' | 'P' | 'C';
  unitOfMeasure?: string;
  resultValue?: number;
  interpretation?: 'N' | 'A' | 'H' | 'L' | 'HH' | 'LL' | 'C';
  hl7Version?: string;
  messageType?: string;
}
