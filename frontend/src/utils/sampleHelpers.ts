// Funções auxiliares para Sample conforme diagrama UML

// #539 (Phase B of #538's currentStatus/status migration): shared
// specimenStatus derivation, extracted from SampleWithdrawalReturnPage.tsx's
// #538 Phase A fix so every reader (not just the withdrawal page) derives
// display state from the canonical `specimenStatus` (V2E-0544)
// instead of the legacy `currentStatus`/`status` fields
// canonical-data-contract-v1.md bans.
//
// RF006 AC2/AC3: specimenStatus carries the operational state only
// (available, reserved, checked_out, quarantined, unavailable, closed); how
// much material is left is the separate, derived `quantityStatus` (full,
// partial, depleted).
export interface SpecimenStatusLike {
  specimenStatus?: string | null;
  quantityStatus?: string | null;
  initialQuantity?: number | null;
  currentQuantity?: number | null;
  quantity?: number | null;
}

export type QuantityStatus = 'full' | 'partial' | 'depleted' | 'unknown';

// The states that refuse withdrawal and return; mirrors the backend's
// BLOCKED_SPECIMEN_STATUSES.
export const BLOCKED_SPECIMEN_STATUSES = ['unavailable', 'quarantined', 'closed'];

// The v1.3.0 values a not-yet-migrated record may still carry, read the way
// the backend reads them: the depletion lives in quantityStatus, and a
// destruction the read cannot prove reads as unavailable.
const LEGACY_SPECIMEN_STATUS_MAP: Record<string, string> = {
  partial: 'available',
  depleted: 'available',
  destroyed: 'unavailable',
  disposed: 'unavailable',
};

const SPECIMEN_STATUS_LABELS: Record<string, string> = {
  available: 'Disponível',
  reserved: 'Reservada',
  checked_out: 'Retirada (Check-out)',
  quarantined: 'Em Quarentena',
  unavailable: 'Indisponível',
  closed: 'Encerrada',
};

const SPECIMEN_STATUS_COLORS: Record<string, string> = {
  available: 'var(--success)',
  reserved: 'var(--warning)',
  checked_out: 'var(--warning)',
  quarantined: 'var(--danger)',
  unavailable: 'var(--danger)',
  closed: 'var(--danger)',
};

const QUANTITY_STATUS_LABELS: Record<QuantityStatus, string> = {
  full: 'Íntegra',
  partial: 'Parcialmente Retirada',
  depleted: 'Totalmente Retirada',
  unknown: 'Não registrada',
};

const QUANTITY_STATUS_COLORS: Record<QuantityStatus, string> = {
  full: 'var(--success)',
  partial: 'var(--warning)',
  depleted: 'var(--danger)',
  unknown: 'var(--text-secondary)',
};

// Specimen documents always default specimenStatus to 'available' at write
// time (Sample.js), so a missing value here means an unpopulated field, not
// an unknown state. A v1.3.0 value folds onto the v2 set.
export function resolveSpecimenStatus(sample: SpecimenStatusLike | null | undefined): string {
  const status = String(sample?.specimenStatus || 'available').toLowerCase();
  return LEGACY_SPECIMEN_STATUS_MAP[status] || status;
}

// The quantityStatus the API sent, or, when a record carries none, the same
// derivation the backend uses (current 0 -> depleted, below initial ->
// partial, otherwise full). A record with no quantity at all is unknown:
// missing amounts are not evidence of a full or depleted vial (#1436).
export function resolveQuantityStatus(sample: SpecimenStatusLike | null | undefined): QuantityStatus {
  const stored = String(sample?.quantityStatus || '').toLowerCase();
  if (stored === 'full' || stored === 'partial' || stored === 'depleted' || stored === 'unknown') {
    return stored as QuantityStatus;
  }
  const initialRaw = sample?.initialQuantity ?? sample?.quantity;
  const currentRaw = sample?.currentQuantity ?? sample?.quantity;
  if (initialRaw == null && currentRaw == null) return 'unknown';
  const initial = Number(initialRaw ?? 0);
  const current = Number(currentRaw ?? 0);
  if (!(current > 0)) return 'depleted';
  if (initial > 0 && current < initial) return 'partial';
  return 'full';
}

/** Raw quantity fields without coercing a missing value to 0 (#1436). */
export function readSampleQuantities(sample: {
  volumeInitial?: number | null;
  volumeCurrent?: number | null;
  initialQuantity?: number | null;
  currentQuantity?: number | null;
  quantity?: number | null;
} | null | undefined): { initial: number | null; current: number | null } {
  // Prefer canonical *Quantity over stale volume* aliases (#1436 / sample detail tests).
  const initialRaw = sample?.initialQuantity ?? sample?.volumeInitial ?? sample?.quantity;
  const currentRaw = sample?.currentQuantity ?? sample?.volumeCurrent ?? sample?.quantity;
  return {
    initial: initialRaw == null ? null : Number(initialRaw),
    current: currentRaw == null ? null : Number(currentRaw),
  };
}

export function isSpecimenBlocked(sample: SpecimenStatusLike | null | undefined): boolean {
  return BLOCKED_SPECIMEN_STATUSES.includes(resolveSpecimenStatus(sample));
}

export function getSpecimenStatusColor(status: string | undefined): string {
  return SPECIMEN_STATUS_COLORS[String(status || '').toLowerCase()] || 'var(--text)';
}

export function translateSpecimenStatus(status: string | undefined): string {
  return SPECIMEN_STATUS_LABELS[String(status || '').toLowerCase()] || (status || '-');
}

export function getQuantityStatusColor(status: string | undefined): string {
  return QUANTITY_STATUS_COLORS[String(status || '').toLowerCase() as QuantityStatus] || 'var(--text)';
}

export function translateQuantityStatus(status: string | undefined): string {
  return QUANTITY_STATUS_LABELS[String(status || '').toLowerCase() as QuantityStatus] || (status || '-');
}
