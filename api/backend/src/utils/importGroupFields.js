/**
 * #818: `groupFields` arrives as a multipart form field and used to be
 * `JSON.parse`d inline at each import call site with no schema, key filter
 * or type check. Nothing downstream ever reached a query as an operator
 * (every consumer independently coerced, e.g. `String(groupFields.x)`), but
 * the safety lived entirely in each consumer remembering to do that, with
 * nothing stating or testing it. This util centralizes the parse and
 * rejects the whole payload at the boundary instead.
 *
 * Mirrors the admitted-value rules of
 * `ImportLGPDService.sanitizeImportOptions` (import-lgpd.service.js) --
 * plain object only, no `$`-prefixed keys, no dotted keys, only
 * string/number/boolean values -- with one deliberate difference:
 * `sanitizeImportOptions` silently *drops* offending entries because it
 * sanitizes a copy that is about to be persisted; this util *rejects* the
 * whole payload, because it runs at the request boundary where a caller
 * sending `{"$ne": null}` should get a 400, not a quietly emptied object.
 *
 * @param {*} raw - `req.body.groupFields`: undefined, a JSON string, or
 *   (per some call sites' multer setups) an already-parsed object.
 * @returns {{ ok: true, value: object } | { ok: false, reason: string }}
 */
function parseGroupFields(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: {} };
  }

  let candidate = raw;
  if (typeof raw === 'string') {
    try {
      candidate = JSON.parse(raw);
    } catch (error) {
      return { ok: false, reason: 'malformed' };
    }
  }

  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return { ok: false, reason: 'shape' };
  }

  const value = {};
  for (const [key, val] of Object.entries(candidate)) {
    if (key.startsWith('$') || key.includes('.')) {
      return { ok: false, reason: 'value' };
    }
    const type = typeof val;
    if (type !== 'string' && type !== 'number' && type !== 'boolean') {
      return { ok: false, reason: 'value' };
    }
    value[key] = val;
  }

  return { ok: true, value };
}

// #840: the four import endpoints that refuse a groupFields payload used to
// answer three different ways -- one put the reason token inline in an
// English-shaped `message`, the other three dropped the reason entirely and
// always said "must be valid JSON" even when the payload parsed fine but had
// the wrong shape or an unsafe key/value. One builder, called from all four
// 400 sites, so the body can only drift by drifting here.
const GROUP_FIELDS_ERROR_MESSAGES = {
  malformed: 'groupFields deve ser um JSON válido',
  shape: 'groupFields deve ser um objeto JSON',
  value: 'groupFields aceita apenas chaves simples com valores texto, número ou booleano',
};

/**
 * Builds the 400 body for a rejected groupFields, shared by all four import
 * endpoints. `reason` is the machine-readable token from `parseGroupFields`;
 * an unrecognized token falls back to the `malformed` sentence rather than
 * throwing, since it is a defensive default, not a thing a caller chooses.
 *
 * @param {string} reason - one of `malformed | shape | value`.
 * @returns {{ success: false, error: string, reason: string, message: string }}
 */
function groupFieldsErrorBody(reason) {
  const message = GROUP_FIELDS_ERROR_MESSAGES[reason] || GROUP_FIELDS_ERROR_MESSAGES.malformed;
  return {
    success: false,
    error: 'groupFields inválido',
    reason,
    message,
  };
}

module.exports = { parseGroupFields, groupFieldsErrorBody };
