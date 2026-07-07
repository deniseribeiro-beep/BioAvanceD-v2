// Implementação dos métodos da classe User conforme diagrama UML
import type { Log, Patient, Reports, Sample, Sensor, Temperature, User, Withdrawal } from '../types/models';

/**
 * Cria novo usuário
 * Implementa: User.createUser(userData): User
 */
export function createUser(userData: Partial<User>): User {
  if (!userData.email || !userData.username || !userData.password) {
    throw new Error('Dados obrigatórios faltando');
  }
  
  const newUser: User = {
    id: 0, // Será definido pelo backend
    name: userData.name || '',
    email: userData.email,
    phone: userData.phone || '',
    institution: userData.institution || '',
    username: userData.username,
    password: userData.password,
    accessType: userData.accessType || 1,
    status: userData.status || 'Ativo',
  };
  
  return newUser;
}

/**
 * Valida status do usuário
 * Implementa: User.validateUserStatus(): Status
 */
export function validateUserStatus(user: User): string {
  const validStatuses = ['Ativo', 'Inativo', 'Suspenso', 'Bloqueado'];
  if (!user.status || !validStatuses.includes(user.status)) {
    return 'Ativo'; // Status padrão
  }
  return user.status;
}

/**
 * Registra um novo paciente
 * Implementa: User.registerPatient(): Patient
 */
export function registerPatient(patientData: Partial<Patient>): Patient {
  const newPatient: Patient = {
    patientID: 0, // Será definido pelo backend
    patientName: patientData.patientName || '',
    birthDate: patientData.birthDate || new Date().toISOString(),
    sex: patientData.sex || '',
    weight: patientData.weight || 0,
    heightCm: patientData.heightCm || 0,
    recordNumber: patientData.recordNumber || '',
    clinicalUnit: patientData.clinicalUnit || '',
    unitAcronym: patientData.unitAcronym || '',
    diagnosticHypothesis: patientData.diagnosticHypothesis || '',
    icdCode: patientData.icdCode || '',
    hypertension: patientData.hypertension || 'Não',
    obesity: patientData.obesity || 'Não',
    diabetesType1: patientData.diabetesType1 || 'Não',
    diabetesType2: patientData.diabetesType2 || 'Não',
    copd: patientData.copd || 'Não',
    ckd: patientData.ckd || 'Não',
    smoking: patientData.smoking || 'Não',
    alcoholUse: patientData.alcoholUse || 'Não',
    asthma: patientData.asthma || 'Não',
    antibioticUse: patientData.antibioticUse || 'Não',
    insulinUse: patientData.insulinUse || 'Não',
    antiviralUse: patientData.antiviralUse || 'Não',
    geneticVariant: patientData.geneticVariant || '',
    alphaGal: patientData.alphaGal || 0,
    lysoGb3: patientData.lysoGb3 || 0,
    sampleList: [],
    notes: patientData.notes || '',
  };
  
  return newPatient;
}

/**
 * Registra uma nova amostra
 * Implementa: User.registerSample(): Sample
 */
export function registerSample(sampleData: Partial<Sample>): Sample {
  const newSample: Sample = {
    patientID: sampleData.patientID || 0,
    sampleID: 0, // Será definido pelo backend
    sampleType: sampleData.sampleType || '',
    sampleOrigin: sampleData.sampleOrigin || '',
    extractionProtocol: sampleData.extractionProtocol || '',
    barcode: sampleData.barcode || '',
    registrationDate: sampleData.registrationDate || new Date(),
    withdrawalDate: sampleData.withdrawalDate || new Date(),
    quantity: sampleData.quantity || 0,
    qualityID: sampleData.qualityID || 0,
    locationID: sampleData.locationID || 0,
    linkedProject: sampleData.linkedProject || '',
    withdrawalType: sampleData.withdrawalType || 'Parcial',
    withdrawalResponsible: sampleData.withdrawalResponsible || '',
    sampleDestination: sampleData.sampleDestination || '',
    currentStatus: sampleData.currentStatus || 'Available',
  };
  
  return newSample;
}

/**
 * Registra retirada de amostra
 * Implementa: User.recordSampleWithdrawal(): Withdrawal
 */
export function recordSampleWithdrawal(
  sampleID: number,
  withdrawalData: Partial<Withdrawal>
): Withdrawal {
  const withdrawal: Withdrawal = {
    withdrawalID: 0, // Será definido pelo backend
    sampleID,
    withdrawalDate: withdrawalData.withdrawalDate || new Date(),
    withdrawalType: withdrawalData.withdrawalType || 'Parcial',
    withdrawalResponsible: withdrawalData.withdrawalResponsible || '',
    withdrawalQuantity: withdrawalData.withdrawalQuantity || 0,
    linkedProject: withdrawalData.linkedProject || '',
    notes: withdrawalData.notes || '',
  };
  
  return withdrawal;
}

/**
 * Gera relatórios
 * Implementa: User.generateReports(): Report
 */
export function generateReports(reportType: string): Reports {
  const report: Reports = {
    reportID: 0, // Será definido pelo backend
    reportType,
  };
  
  return report;
}

/**
 * Visualiza controle de temperatura
 * Implementa: User.viewTemperatureControl(): TemperatureControl
 * Retorna array de Temperature (TemperatureControl não existe no diagrama, retornamos Temperature[])
 */
export function viewTemperatureControl(
  sensorID?: string,
  policyID?: string
): Temperature[] {
  // Em produção, isso buscaria do backend
  // Por enquanto retorna array vazio
  return [];
}

/**
 * Registra um novo sensor
 * Implementa: User.registerSensor(): Sensor
 */
export function registerSensor(sensorData: Partial<Sensor>): Sensor {
  const newSensor: Sensor = {
    sensorID: sensorData.sensorID || '',
    sensorType: sensorData.sensorType || '',
    sensorModel: sensorData.sensorModel || '',
    maintenanceStatus: sensorData.maintenanceStatus || 'Operacional',
    lastCalibration: sensorData.lastCalibration || null,
    nextCalibration: sensorData.nextCalibration || null,
    calibrationCertificate: sensorData.calibrationCertificate || '',
    locationID: sensorData.locationID,
    policyID: sensorData.policyID,
  };
  
  return newSensor;
}

/**
 * Obtém logs do sistema
 * Implementa: User.getLogs(): List<AuditLog>
 * Retorna array de Log (AuditLog não existe no diagrama, retornamos Log[])
 */
export function getLogs(
  filters?: {
    userID?: string;
    action?: string;
    entity?: string;
    severity?: string;
    startDate?: Date;
    endDate?: Date;
  }
): Log[] {
  // Em produção, isso buscaria do backend com filtros
  // Por enquanto retorna array vazio
  return [];
}


