/**
 * Display helpers for the LGPD import quarantine (#794 item 2, RNF011 AC#4).
 *
 * Kept as pure functions, separate from the page component, per this repo's
 * frontend convention — the logic worth testing here is defensive, and the
 * shapes it defends against come straight from whatever the importer wrote
 * rather than from a typed contract.
 */

export interface QuarantineBatch {
  _id: string;
  fileName?: string | null;
  status?: string | null;
  counts?: { total?: number; success?: number; errors?: number } | null;
  createdAt?: string | Date | null;
  createdBy?: string | null;
  /** Written by #792 when the upload was retained. Best-effort, so legitimately absent. */
  sourceFile?: { storedPath?: string; originalName?: string; size?: number } | null;
  /** Written by #806 on a FAILED batch: recordFailedImportBatch's error message. */
  error?: string | null;
}

export interface QuarantineRecord {
  _id?: string;
  rowNumber?: number;
  status?: string;
  errors?: unknown;
  validationErrors?: unknown;
  /** The original spreadsheet line. Carries civil identifiers (#807). */
  row?: Record<string, unknown> | null;
  normalized?: Record<string, unknown> | null;
}

export interface BatchSummary {
  id: string;
  fileName: string;
  status: string;
  total: number;
  imported: number;
  rejected: number;
  createdAtLabel: string;
  sourceFileRetained: boolean;
  /** #806: the error a FAILED batch's throw carried. Null for any other status. */
  errorMessage: string | null;
}

function toDateLabel(value: string | Date | null | undefined): string {
  if (!value) return '--';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('pt-BR');
}

export function formatBatchSummary(batch: QuarantineBatch): BatchSummary {
  const counts = batch?.counts || {};
  return {
    id: String(batch?._id ?? ''),
    fileName: batch?.fileName || '(sem nome)',
    status: batch?.status || 'QUARANTINED',
    total: Number(counts.total) || 0,
    imported: Number(counts.success) || 0,
    rejected: Number(counts.errors) || 0,
    createdAtLabel: toDateLabel(batch?.createdAt),
    // #792 retention is best-effort, so this is a real distinction to surface:
    // "the file is still available for review" vs "it was not kept".
    sourceFileRetained: Boolean(batch?.sourceFile?.storedPath),
    // #806: only a FAILED batch carries an error -- a QUARANTINED batch's
    // rejections live on its records, not on the batch itself.
    errorMessage: batch?.status === 'FAILED' ? (batch?.error || null) : null,
  };
}

/**
 * The LGPD importer pushes plain strings. The FHIR importer, which shares
 * `import_batches`, pushes `{ field, code, message }` objects — the type
 * filter should keep those out of this view, but rendering "[object Object]"
 * if one arrived is a failure nobody notices until a screenshot.
 */
export function formatRecordErrors(record: QuarantineRecord | null | undefined): string[] {
  const raw = record?.errors ?? record?.validationErrors;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object') {
        const { field, message } = entry as { field?: string; message?: string };
        if (message) return field ? `${field}: ${message}` : message;
      }
      return String(entry);
    })
    .filter(Boolean);
}

/**
 * Renders the retained original row as label/value pairs, in the file's own
 * column order. Empty cells are dropped so a wide, sparse spreadsheet stays
 * readable — the operator is looking for what was wrong, not for a grid of
 * blanks.
 */
export function describeRowFields(
  record: QuarantineRecord | null | undefined
): Array<{ label: string; value: string }> {
  const row = record?.row;
  if (!row || typeof row !== 'object') return [];

  return Object.entries(row)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([label, value]) => ({
      label,
      value: typeof value === 'object' ? JSON.stringify(value) : String(value),
    }));
}
