import { Patient } from '../types/models';
import { User } from '../types/models';

/**
 * Retorna sempre "Anônimo" para garantir privacidade total dos pacientes
 * O nome do paciente nunca é exibido no frontend após o cadastro
 */
export function getPatientDisplayName(patient: Patient | { patientID: number; patientName?: string }, user: User | null): string {
  // Sempre retorna anônimo - o nome nunca é exibido no frontend
  return 'Anônimo';
}

/**
 * Retorna uma string formatada para exibição do paciente
 * Sempre mostra apenas "Anônimo (ID: X)" - nome nunca é exibido
 */
export function formatPatientDisplay(
  patient: Patient | { patientID: number; patientName?: string; recordNumber?: number },
  user: User | null
): string {
  const patientID = 'patientID' in patient ? patient.patientID : patient.patientID;
  // Sempre retorna anônimo - o nome nunca é exibido no frontend
  return `Anônimo (ID: ${patientID})`;
}

/**
 * Retorna uma string simplificada para selects/opções
 * Sempre mostra apenas "Anônimo (ID: X)" - nome nunca é exibido
 */
export function formatPatientOption(
  patient: Patient | { patientID: number; patientName?: string; recordNumber?: number },
  user: User | null
): string {
  const patientID = 'patientID' in patient ? patient.patientID : patient.patientID;
  // Sempre retorna anônimo - o nome nunca é exibido no frontend
  return `Anônimo (ID: ${patientID})`;
}

