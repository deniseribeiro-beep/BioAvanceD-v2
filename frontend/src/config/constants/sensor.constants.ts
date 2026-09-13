/**
 * Sensor.maintenanceStatus: backend (SensorModel.validate(), api/backend/src/models/Sensor.js)
 * only accepts the English enum below. The UI shows Portuguese labels, so every
 * <select> option needs a `value` distinct from its display label, translated
 * before the value reaches the API (#314).
 */
export const MAINTENANCE_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'operational', label: 'Operacional' },
  { value: 'maintenance', label: 'Em Manutenção' },
  { value: 'calibration', label: 'Calibração Pendente' },
  { value: 'error', label: 'Fora de Serviço' },
  { value: 'maintenance', label: 'Aguardando Reparo' },
];

export const MAINTENANCE_STATUS_LABELS: Record<string, string> = {
  operational: 'Operacional',
  maintenance: 'Em Manutenção',
  calibration: 'Calibração Pendente',
  error: 'Fora de Serviço',
};

export function getMaintenanceStatusLabel(value?: string): string {
  if (!value) return MAINTENANCE_STATUS_LABELS.operational;
  return MAINTENANCE_STATUS_LABELS[value] || value;
}
