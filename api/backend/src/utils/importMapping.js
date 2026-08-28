/**
 * #869: the `mapping` sibling of `groupFields` in
 * `import-lgpd.controller.js#importPatientsSmart`. Both arrive as multipart
 * form fields, both were `JSON.parse`d inline with no schema, and they sit
 * a dozen lines apart. #818 gave `groupFields` a boundary validator
 * (`parseGroupFields`) and #837 made `mapping`'s malformed-JSON case answer
 * 400 instead of falling to the outer catch's 500 -- but neither gave
 * `mapping` a schema, so the fix for the first never generalised to the
 * second.
 *
 * `mapping` is the more dangerous of the two, and in the opposite direction
 * from `groupFields`: its *values* become document keys downstream, in
 * `ImportLGPDService#buildMappedPatientRow`:
 *
 *     mapped[targetField] = rawRow[sourceColumn];
 *
 * where `targetField` is `mapping[sourceColumn]` -- operator-supplied. So
 * where `parseGroupFields` guards its keys, this guards its *values* as key
 * names. The two sides get deliberately different rules; see
 * `isUnsafeSourceName` for why the source side is laxer.
 *
 * Reading `buildMappedPatientRow` end to end when this was written: the
 * mapped row reaches `parsePatientRow`, which returns a fixed object
 * literal, so an arbitrary key is dropped there and never reaches a driver
 * call. That bounds the severity to unprincipled rather than exploitable
 * *today* -- but the allowlist is incidental to that function's purpose,
 * nothing states or tests that it is load-bearing, and one added
 * pass-through field would remove it silently. Rejecting at the boundary is
 * what makes the guarantee stated instead of inherited.
 *
 * Returns the same `{ ok, value } | { ok, reason }` shape `parseGroupFields`
 * established, so both fields in the handler are validated by one
 * convention. Reasons are distinct per side (`source` vs `target`) because
 * they mean different things to whoever reads the log.
 *
 * @param {*} raw - `req.body.mapping`: undefined, a JSON string, or (per the
 *   handler's multer setup) an already-parsed object.
 * @returns {{ ok: true, value: object } | { ok: false, reason: string }}
 */

// A target field must be usable as a document key. `$` prefix and `.` are
// the driver's operator and path syntax; the three prototype names are the
// assignment hazard on a plain object literal.
const FORBIDDEN_TARGETS = new Set(['__proto__', 'constructor', 'prototype']);

function isUnsafeKeyName(name) {
  return (
    name.startsWith('$') ||
    name.includes('.') ||
    FORBIDDEN_TARGETS.has(name)
  );
}

// The source side is deliberately laxer than the target side, and the
// asymmetry is the point: a source column is only ever *read* off the parsed
// row (`rawRow[sourceColumn]`), never written, so `rawRow['a.b']` is a plain
// miss returning undefined rather than a path expression. Spreadsheet headers
// legitimately contain dots -- "Data Nasc." is an ordinary column name -- and
// rejecting those would 400 a valid import to guard against nothing. A
// `$`-prefixed column is still refused, because it is not a header anyone
// types and `parseGroupFields` already established that shape as
// boundary-rejected.
function isUnsafeSourceName(name) {
  return name.startsWith('$');
}

function parseImportMapping(raw) {
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
  for (const [sourceColumn, targetField] of Object.entries(candidate)) {
    if (isUnsafeSourceName(sourceColumn)) {
      return { ok: false, reason: 'source' };
    }

    // An explicitly empty target is how the UI says "ignore this column",
    // and buildMappedPatientRow already skips it (`if (!targetField)
    // return;`). Admitting it keeps that caller working; anything else
    // non-empty has to be a safe key name.
    if (targetField === '' || targetField === null || targetField === undefined) {
      value[sourceColumn] = targetField;
      continue;
    }

    if (typeof targetField !== 'string' || isUnsafeKeyName(targetField)) {
      return { ok: false, reason: 'target' };
    }

    value[sourceColumn] = targetField;
  }

  return { ok: true, value };
}

module.exports = { parseImportMapping };
