// Implementação dos métodos de validação do diagrama UML

import { Patient, Sample, Temperature, Policy, Log, SpecificUser } from '../types/models';
import {
  SPECIMEN_TYPE_IDS,
  SAMPLE_ORIGIN_IDS,
  EXTRACTION_PROTOCOL_IDS,
} from '../config/constants/specimen.constants';

// ========== PATIENT VALIDATIONS ==========

/**
 * Valida se a unidade clínica é válida
 * Implementa: Patient.validateUnit(clinicalUnit): Boolean
 */
export function validateUnit(clinicalUnit: string): boolean {
  const validUnits = [
    'Cardiologia',
    'Neurologia',
    'Oncologia',
    'Hematologia',
    'Endocrinologia',
    'Pneumologia',
    'Nefrologia',
    'Gastroenterologia',
  ];
  return validUnits.includes(clinicalUnit) || clinicalUnit.length >= 3;
}

/**
 * Gera sigla da unidade clínica
 * Implementa: Patient.fillAcronym(): String
 */
export function fillAcronym(clinicalUnit: string): string {
  const acronyms: Record<string, string> = {
    Cardiologia: 'CARD',
    Neurologia: 'NEURO',
    Oncologia: 'ONCO',
    Hematologia: 'HEMA',
    Endocrinologia: 'ENDO',
    Pneumologia: 'PNEU',
    Nefrologia: 'NEFRO',
    Gastroenterologia: 'GASTRO',
  };
  return acronyms[clinicalUnit] || clinicalUnit.substring(0, 4).toUpperCase();
}

/**
 * Valida variante genética (agora é string obrigatória)
 * Implementa: Patient.validateGeneticVariant(geneticVariant): Boolean
 */
export function validateGeneticVariant(geneticVariant: string): boolean {
  // Aceita qualquer string não vazia (códigos de variantes ou status descritivos)
  return typeof geneticVariant === 'string' && geneticVariant.trim().length > 0;
}

// ========== SAMPLE VALIDATIONS ==========

/**
 * Valida tipo de amostra
 * Implementa: Sample.validateSampleType(sampleType): Boolean
 */
export function validateSampleType(sampleType: string): boolean {
  return SPECIMEN_TYPE_IDS.includes(sampleType);
}

/**
 * Valida tipo de retirada
 * Implementa: Sample.validateWithdrawalType(withdrawalType): Boolean
 */
export function validateWithdrawalType(withdrawalType: string): boolean {
  const validTypes = ['Parcial', 'Total'];
  return validTypes.includes(withdrawalType);
}

/**
 * Valida nome do responsável
 * Implementa: Sample.validateResponsibleName(withdrawalResponsible): Boolean
 */
export function validateResponsibleName(withdrawalResponsible: string): boolean {
  // Deve ter pelo menos nome e sobrenome
  const parts = withdrawalResponsible.trim().split(' ');
  return parts.length >= 2 && withdrawalResponsible.length >= 5;
}

/**
 * Valida tipo de extração
 * Implementa: Sample.validateExtractionType(extractionProtocol): Boolean
 */
export function validateExtractionType(extractionProtocol: string): boolean {
  return EXTRACTION_PROTOCOL_IDS.includes(extractionProtocol);
}

/**
 * Valida destino da amostra
 * Implementa: Sample.validateSampleDestination(sampleDestination): Boolean
 */
export function validateSampleDestination(sampleDestination: string): boolean {
  const validDestinations = [
    'Laboratório',
    'Armazenamento',
    'Análise',
    'Descarte',
    'Transferência',
  ];
  return validDestinations.includes(sampleDestination) || sampleDestination.length >= 3;
}

/**
 * Valida origem da amostra
 * Implementa: Sample.validateSampleOrigin(sampleOrigin): Boolean
 */
export function validateSampleOrigin(sampleOrigin: string): boolean {
  return SAMPLE_ORIGIN_IDS.includes(sampleOrigin);
}

/**
 * Valida status da amostra
 * Implementa: Sample.validateSampleStatus(currentStatus): Boolean
 */
export function validateSampleStatus(currentStatus: string): boolean {
  const validStatuses = ['Available', 'Withdrawn'];
  return validStatuses.includes(currentStatus);
}

/**
 * Validação MIABIS (Minimum Information About BIobank data Sharing)
 * Implementa: Sample.validateMIABIS(): Object
 */
export interface MIABISValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  miabisCompliant: boolean;
}

export function validateMIABIS(sample: Partial<Sample>): MIABISValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Campos obrigatórios MIABIS
  if (!sample.sampleType) {
    errors.push('sampleType é obrigatório (MIABIS)');
  }
  
  if (!sample.participantId) {
    errors.push('participantId é obrigatório (MIABIS)');
  }
  
  if (!sample.registrationDate) {
    errors.push('registrationDate é obrigatório (MIABIS)');
  }
  
  if (!sample.barcode) {
    errors.push('barcode é obrigatório (MIABIS)');
  }
  
  // Campos recomendados MIABIS
  if (!sample.sampleOrigin) {
    warnings.push('sampleOrigin é recomendado (MIABIS)');
  }
  
  if (sample.quantity === undefined || sample.quantity === null) {
    warnings.push('quantity é recomendado (MIABIS)');
  }
  
  if (!sample.extractionProtocol) {
    warnings.push('extractionProtocol é recomendado (MIABIS)');
  }
  
  // Validações de formato MIABIS
  if (sample.sampleType && !validateSampleType(sample.sampleType)) {
    errors.push(`sampleType "${sample.sampleType}" não é válido conforme MIABIS`);
  }
  
  if (sample.sampleOrigin && !validateSampleOrigin(sample.sampleOrigin)) {
    warnings.push(`sampleOrigin "${sample.sampleOrigin}" pode não estar em conformidade com MIABIS`);
  }
  
  if (sample.extractionProtocol && !validateExtractionType(sample.extractionProtocol)) {
    warnings.push(`extractionProtocol "${sample.extractionProtocol}" pode não estar em conformidade com MIABIS`);
  }
  
  // Validação de data
  if (sample.registrationDate) {
    const regDate = new Date(sample.registrationDate);
    if (regDate > new Date()) {
      errors.push('registrationDate não pode ser no futuro (MIABIS)');
    }
  }
  
  // Validação de quantidade
  if (sample.quantity !== undefined && sample.quantity !== null && sample.quantity < 0) {
    errors.push('quantity não pode ser negativo (MIABIS)');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    miabisCompliant: errors.length === 0 && warnings.length === 0
  };
}

// ========== TEMPERATURE VALIDATIONS ==========

/**
 * Valida leitura de temperatura
 * Implementa: Temperature.validateReading(): Boolean
 */
export function validateReading(temperature: Temperature): boolean {
  return (
    temperature.readingStatus === 'valid' &&
    (temperature.dataQualityScore ?? 0) >= 0.8 &&
    !isNaN(temperature.temperatureValue) &&
    temperature.temperatureValue >= -200 &&
    temperature.temperatureValue <= 200
  );
}

/**
 * Valida unidade de temperatura
 * Implementa: Temperature.validateTemperatureUnit(): Boolean
 */
export function validateTemperatureUnit(unit: string): boolean {
  return unit === '°C' || unit === '°F' || unit === 'K';
}

/**
 * Gera alerta de temperatura
 * Implementa: Temperature.generateAlert(): void
 */
export function generateAlert(temperature: Temperature, policy: Policy): void {
  if (
    temperature.temperatureValue < policy.minTemp ||
    temperature.temperatureValue > policy.maxTemp
  ) {
    console.warn(
      `ALERTA: Temperatura ${temperature.temperatureValue}${temperature.temperatureUnit} fora dos limites (${policy.minTemp} - ${policy.maxTemp})`
    );
    // Em produção, isso enviaria notificação/email
  }
}

// ========== POLICY VALIDATIONS ==========

/**
 * Valida limites de temperatura
 * Implementa: Policy.validateThresholds(): Boolean
 */
export function validateThresholds(policy: Policy): boolean {
  return (
    policy.minTemp < policy.targetTemp &&
    policy.targetTemp < policy.maxTemp &&
    policy.minTemp < policy.maxTemp &&
    (policy.hysteresis ?? 0) >= 0 &&
    (policy.minimumDuration ?? 0) >= 0
  );
}

/**
 * Obtém limite ativo
 * Implementa: Policy.getActiveLimit(): Float
 */
export function getActiveLimit(policy: Policy, isMax: boolean = true): number {
  if (isMax) {
    return policy.maxTemp + (policy.hysteresis ?? 0);
  }
  return policy.minTemp - (policy.hysteresis ?? 0);
}

// ========== LOG VALIDATIONS ==========

/**
 * Valida resultado do log
 * Implementa: Log.validateResult(): Boolean
 */
export function validateResult(result: string): boolean {
  const validResults = ['SUCCESS', 'FAILURE', 'ERROR', 'WARNING', 'INFO'];
  return validResults.includes(result.toUpperCase());
}

/**
 * Valida severidade do log
 * Implementa: Log.validateSeverity(): Boolean
 */
export function validateSeverity(severity: string): boolean {
  const validSeverities = ['INFO', 'WARNING', 'ERROR', 'CRITICAL', 'DEBUG'];
  return validSeverities.includes(severity.toUpperCase());
}

/**
 * Registra evento no log
 * Implementa: Log.registerEvent(): void
 */
export function registerEvent(log: Log): void {
  if (!validateResult(log.result) || !validateSeverity(log.severity)) {
    console.error('Log inválido:', log);
    return;
  }
  // Em produção, isso salvaria no banco de dados
  console.log('Evento registrado:', log);
}

// ========== SPECIFIC USER VALIDATIONS ==========

/**
 * Valida MFA
 * Implementa: SpecificUser.validateMFA(mfaEnabled): Boolean
 */
export function validateMFA(mfaEnabled: string): boolean {
  return mfaEnabled === 'enabled' || mfaEnabled === 'disabled';
}

// ========== ACCESS VALIDATIONS ==========

/**
 * Valida tipo de acesso
 * Implementa: Access.validateAccessType(description): Boolean
 */
export function validateAccessType(description: string): boolean {
  const validTypes = [
    'Relatório de Pacientes',
    'Relatório de Amostras',
    'Relatório de Temperatura',
    'Relatório de Sensores',
    'Acesso Completo',
  ];
  return validTypes.includes(description) || description.length > 0;
}



