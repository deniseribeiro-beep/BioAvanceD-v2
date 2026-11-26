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
  /**
   * #915: the listing now carries participant batches ('LGPD_PATIENT_CSV')
   * alongside specimen ones ('LGPD_SAMPLE_CSV'), for a caller holding both
   * import permissions. The two have different rejected-row shapes, so the
   * operator has to be able to tell them apart in one table.
   */
  type?: string | null;
  fileName?: string | null;
  status?: string | null;
  counts?: { total?: number; success?: number; errors?: number } | null;
  createdAt?: string | Date | null;
  createdBy?: string | null;
  /** Written by #792 when the upload was retained. Best-effort, so legitimately absent. */
  sourceFile?: {
    storageUri?: string;
    storageObjectVersion?: string | null;
    storedPath?: string | null;
    originalName?: string;
    size?: number;
  } | null;
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
  /** #915: human label for the batch's origin -- 'Amostras', 'Participantes', or the raw type. */
  kindLabel: string;
}

/**
 * #915: the two LGPD quarantine batch types, as the operator should read
 * them. An unknown type is shown verbatim rather than guessed at or hidden --
 * `import_batches` is shared with the FHIR and async importers, and if one of
 * those ever reaches this list the label should say so loudly.
 */
const BATCH_KIND_LABELS: Record<string, string> = {
  LGPD_SAMPLE_CSV: 'Amostras',
  LGPD_PATIENT_CSV: 'Participantes',
};

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
    // #1419: an object-store batch carries storageUri (storedPath is null on
    // S3); one retained before it carries only storedPath.
    sourceFileRetained: Boolean(batch?.sourceFile?.storageUri || batch?.sourceFile?.storedPath),
    // #806: only a FAILED batch carries an error -- a QUARANTINED batch's
    // rejections live on its records, not on the batch itself.
    errorMessage: batch?.status === 'FAILED' ? (batch?.error || null) : null,
    kindLabel: BATCH_KIND_LABELS[String(batch?.type ?? '')] || String(batch?.type ?? '--'),
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

/**
 * #1352: whether a record can be corrected and resubmitted from this page.
 * Only a sample batch's rows (the backend 404s a participant batch here), only
 * a record still in ERROR, and only one whose original row was retained, since
 * the correction starts from it.
 */
export function canResubmit(
  batch: QuarantineBatch | null | undefined,
  record: QuarantineRecord | null | undefined
): boolean {
  if (batch?.type !== 'LGPD_SAMPLE_CSV') return false;
  if (record?.status !== 'ERROR' || !record?._id) return false;
  const row = record?.row;
  return Boolean(row && typeof row === 'object' && Object.keys(row).length > 0);
}

/**
 * #1352: the editable form of a retained row, every cell as text, in the
 * file's column order. A non-scalar cell is shown as JSON so it can be fixed
 * by hand rather than sent back as "[object Object]".
 */
export function toEditableRow(record: QuarantineRecord | null | undefined): Record<string, string> {
  const row = record?.row;
  if (!row || typeof row !== 'object') return {};
  const editable: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) editable[key] = '';
    else editable[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  return editable;
}

/**
 * #1352: the errors a failed resubmit answered with. A 422 carries the row's
 * new errors in `errors`; anything else carries one message in `error`.
 */
export function resubmitErrorMessages(responseData: unknown): string[] {
  const data = (responseData || {}) as { errors?: unknown; error?: unknown };
  const fromRow = formatRecordErrors({ errors: data.errors });
  if (fromRow.length > 0) return fromRow;
  if (typeof data.error === 'string' && data.error) return [data.error];
  return ['Não foi possível reenviar a linha.'];
}
