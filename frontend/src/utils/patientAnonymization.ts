import type { Patient, User } from '../types/models';

type PatientIdentity = Pick<Patient, 'patientID'> & {
  patientName?: string;
  recordNumber?: string | number;
};

/**
 * Retorna sempre "Anônimo" para garantir privacidade total dos pacientes
 * O nome do paciente nunca é exibido no frontend após o cadastro
 */
export function getPatientDisplayName(_patient: PatientIdentity, _user: User | null): string {
  // Sempre retorna anônimo - o nome nunca é exibido no frontend
  return 'Anônimo';
}

/**
 * Retorna uma string formatada para exibição do paciente
 * Sempre mostra apenas "Anônimo (ID: X)" - nome nunca é exibido
 */
export function formatPatientDisplay(
  patient: PatientIdentity,
  _user: User | null
): string {
  // Sempre retorna anônimo - o nome nunca é exibido no frontend
  return `Anônimo (ID: ${patient.patientID})`;
}

/**
 * Retorna uma string simplificada para selects/opções
 * Sempre mostra apenas "Anônimo (ID: X)" - nome nunca é exibido
 */
export function formatPatientOption(
  patient: PatientIdentity,
  _user: User | null
): string {
  // Sempre retorna anônimo - o nome nunca é exibido no frontend
  return `Anônimo (ID: ${patient.patientID})`;
}

