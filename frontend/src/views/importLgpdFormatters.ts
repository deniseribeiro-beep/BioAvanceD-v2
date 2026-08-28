/**
 * Pure helpers for the LGPD import surface (#808).
 *
 * Extracted from ImportLGPDPage per the repo's frontend test convention:
 * unit tests target exported pure functions, not rendered components
 * (see bioavanced-v2-conventions, "Repo layout").
 */

export type ImportType = 'patients' | 'samples';
export type TemplateFormat = 'csv' | 'xlsx';

/** Mirrors import-async.service.js's own 100MB ceiling. */
export const MAX_IMPORT_FILE_BYTES = 100 * 1024 * 1024;

const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];

/**
 * Both formats, for both types. This used to return `['xlsx']` for patients
 * because `/pacientes/template/csv` was the one type x format combination
 * `import-lgpd.routes.js` never registered, while
 * `importLGPDService.downloadTemplate` built the URL anyway (#815, fixed).
 *
 * Kept as a function rather than collapsed into a constant: it is the single
 * place the UI asks what the backend actually serves, so a future asymmetry
 * has somewhere to live other than the render path.
 */
export function availableTemplateFormats(_type: ImportType): TemplateFormat[] {
  return ['csv', 'xlsx'];
}

export type FileCheck = { ok: true } | { ok: false; reason: string };

/**
 * Cheap client-side pre-check. Not a security boundary — the backend
 * validates independently — it just avoids uploading a file that is going to
 * be rejected, which for a 100MB ceiling is worth doing before the request.
 */
export function validateImportFile(file: File | null | undefined): FileCheck {
  if (!file) return { ok: false, reason: 'Selecione um arquivo.' };

  const name = String(file.name || '').toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return { ok: false, reason: 'Formato não suportado. Envie um arquivo .csv, .xlsx ou .xls.' };
  }

  if (!file.size) return { ok: false, reason: 'Arquivo vazio.' };
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return { ok: false, reason: 'Arquivo muito grande. Tamanho máximo: 100MB.' };
  }

  return { ok: true };
}

export type RejectedRow = {
  row: number | null;
  participantId: string | null;
  errors: string[];
};

export type ImportOutcome = 'clean' | 'partial' | 'partial-unretained' | 'unknown';

export type ImportSummary = {
  outcome: ImportOutcome;
  total: number;
  imported: number;
  rejected: number;
  /**
   * Blank rows the backend guarded out (`isEmptyRow`) before counting
   * anything toward `total`/`success`/`errors` -- deliberately outside the
   * `total === success + errors` invariant (#786), so it is surfaced as its
   * own figure rather than folded in (#798 item 3).
   */
  skipped: number;
  /** Deep link into #794 item 2's review surface, or null when no batch exists. */
  quarantineHref: string | null;
  rows: RejectedRow[];
  message: string | null;
};

const EMPTY: ImportSummary = {
  outcome: 'unknown',
  total: 0,
  imported: 0,
  rejected: 0,
  skipped: 0,
  quarantineHref: null,
  rows: [],
  message: null,
};

/**
 * Turns an import response into what the operator needs to see next.
 *
 * Three distinct partial outcomes matter here, and collapsing them would be
 * the same silent-correction problem RNF011 AC#4 is about:
 *
 * - `partial` — rows were rejected AND quarantined; there is a batch to open.
 *   Only `POST /api/import-lgpd/amostras` produces this today (#787).
 * - `partial-unretained` — rows were rejected and **not** retained anywhere.
 *   Both patient import paths behave this way (#814); the response is the
 *   only copy of the failure, so the UI has to say so rather than showing
 *   the same screen as a retained batch.
 * - `unknown` — no usable `data` envelope. Reporting that as "0 of 0
 *   imported, nothing rejected" would read as a clean import.
 */
export function summarizeImportResult(payload: any): ImportSummary {
  const data = payload?.data;
  if (!data || typeof data !== 'object') return { ...EMPTY };

  const total = Number(data.total) || 0;
  const imported = Number(data.success) || 0;
  const rejected = Number(data.errors) || 0;
  const skipped = Number(data.skipped) || 0;
  const batchId = data.stagingBatchId ? String(data.stagingBatchId) : null;

  const rows: RejectedRow[] = (Array.isArray(data.errorsDetails) ? data.errorsDetails : []).map(
    (detail: any) => ({
      row: typeof detail?.row === 'number' ? detail.row : null,
      participantId: detail?.participantId ? String(detail.participantId) : null,
      errors: Array.isArray(detail?.errors) ? detail.errors.map(String) : [String(detail?.errors ?? '')],
    })
  );

  let outcome: ImportOutcome;
  if (rejected === 0) {
    outcome = 'clean';
  } else if (batchId) {
    outcome = 'partial';
  } else {
    outcome = 'partial-unretained';
  }

  return {
    outcome,
    total,
    imported,
    rejected,
    skipped,
    quarantineHref: batchId ? `/import/quarantine?batchId=${encodeURIComponent(batchId)}` : null,
    rows,
    message: payload?.message ? String(payload.message) : null,
  };
}
