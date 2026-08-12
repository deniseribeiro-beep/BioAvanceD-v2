/**
 * RF028 AC 4/7.2 step 6 ("Normalize"): converts one raw DUO sample record
 * into the canonical TerminologyConcept/TerminologyRelation shape, or
 * reports why the record can't be normalized (7.2 step 8 "Validate" — errors
 * go to ReferenceImportIssue, never dropped silently).
 */
function normalizeRecord(raw, rowNumber) {
  const code = typeof raw.id === 'string' ? raw.id.trim() : '';
  const display = typeof raw.lbl === 'string' ? raw.lbl.trim() : '';

  if (!code) {
    return {
      ok: false,
      issue: {
        rowNumber,
        fieldPath: 'id',
        errorCode: 'MISSING_CODE',
        errorMessage: 'Registro DUO sem código (id) — não é possível derivar um TerminologyConcept.',
        severity: 'error',
        rawValue: raw,
      },
    };
  }

  if (!display) {
    return {
      ok: false,
      issue: {
        rowNumber,
        sourceRecordId: code,
        fieldPath: 'lbl',
        errorCode: 'MISSING_DISPLAY',
        errorMessage: `Registro DUO ${code} sem rótulo (lbl) — não é possível derivar um TerminologyConcept.`,
        severity: 'error',
        rawValue: raw,
      },
    };
  }

  const parents = Array.isArray(raw.is_a) ? raw.is_a.filter((parentCode) => typeof parentCode === 'string' && parentCode.trim()) : [];
  const synonyms = Array.isArray(raw.synonyms)
    ? raw.synonyms.filter((term) => typeof term === 'string' && term.trim()).map((term) => ({ term, scope: 'exact' }))
    : [];

  return {
    ok: true,
    concept: {
      code,
      display,
      sourceRecordId: code,
      synonyms,
      conceptStatus: raw.obsolete ? 'obsolete' : 'active',
      semanticType: ['consent'],
    },
    parents,
  };
}

module.exports = { normalizeRecord };
