// Funções auxiliares para Sample conforme diagrama UML

// #539 (Phase B of #538's currentStatus/status migration): shared
// specimenStatus derivation, extracted from SampleWithdrawalReturnPage.tsx's
// #538 Phase A fix so every reader (not just the withdrawal page) derives
// display state from the canonical `specimenStatus` (dict-02 ELM-0123)
// instead of the legacy `currentStatus`/`status` fields
// canonical-data-contract-v1.md bans.
export interface SpecimenStatusLike {
  specimenStatus?: string | null;
}

const SPECIMEN_STATUS_LABELS: Record<string, string> = {
  available: 'Disponível',
  reserved: 'Reservada',
  checked_out: 'Retirada (Check-out)',
  partial: 'Parcialmente Retirada',
  depleted: 'Totalmente Retirada',
  quarantined: 'Em Quarentena',
  destroyed: 'Destruída',
  unavailable: 'Indisponível',
  disposed: 'Descartada',
};

const SPECIMEN_STATUS_COLORS: Record<string, string> = {
  available: 'var(--success)',
  reserved: 'var(--warning)',
  checked_out: 'var(--warning)',
  partial: 'var(--warning)',
  depleted: 'var(--danger)',
  quarantined: 'var(--danger)',
  destroyed: 'var(--danger)',
  unavailable: 'var(--danger)',
  disposed: 'var(--danger)',
};

// Specimen documents always default specimenStatus to 'available' at write
// time (Sample.js), so a missing value here means an unpopulated field, not
// an unknown state.
export function resolveSpecimenStatus(sample: SpecimenStatusLike | null | undefined): string {
  return String(sample?.specimenStatus || 'available').toLowerCase();
}

export function getSpecimenStatusColor(status: string | undefined): string {
  return SPECIMEN_STATUS_COLORS[String(status || '').toLowerCase()] || 'var(--text)';
}

export function translateSpecimenStatus(status: string | undefined): string {
  return SPECIMEN_STATUS_LABELS[String(status || '').toLowerCase()] || (status || '-');
}

