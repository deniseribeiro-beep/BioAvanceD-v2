// dict-02_DICIONARIO.md ELM-0255..ELM-0259 (DerivedScore), dict-05_REFERENCIAS.md
// REF-033 (Charlson ME, Pompei P, Ales KL, MacKenzie CR. "A new method of
// classifying prognostic comorbidity in longitudinal studies," Journal of
// Chronic Diseases, 1987) -- #713 (RF005 clinical-UI slice 6/6, tracker
// #707). dict-02's own ELM-0257 example value is literally "CCI-original,"
// i.e. the 1987 weight table, not a later ICD-adapted revision (Charlson-
// Deyo/Quan) -- ALGORITHM_VERSION below is that exact string.
//
// The intake wizard's own `charlsonConditions` checklist (intake-
// dictionaries.constants.ts's CLINICAL_COMORBIDITIES) predates this slice
// and was never actually the canonical 19-category Charlson set -- it's a
// general comorbidity/risk-factor checklist (hypertension, obesity,
// smoking, alcohol/antibiotic/insulin/antiviral use, etc.) that happens to
// share a few labels with real Charlson categories. Rather than inventing
// weights for categories the original 1987 index doesn't define (which
// would silently misrepresent "CCI-original"), only the wizard slugs that
// genuinely correspond to a real Charlson category are scored here; the
// rest are recognized as clinically real data (still stored in
// clinicalData.charlsonComorbidities) but simply don't participate in the
// index, matching dict-05_REFERENCIAS.md REF-033's own caution: "Usar
// somente se CCI permanecer no escopo clínico associado" (use CCI only if
// it stays within its associated clinical scope).
//
// Diabetes is deliberately collapsed into ONE category regardless of
// whether the wizard's diabetesType1 and/or diabetesType2 boxes are
// checked -- the original CCI counts "diabetes" once, not once per type;
// a patient with both boxes checked (data-entry inconsistency aside) still
// contributes a single point, not two.
const ALGORITHM_VERSION = 'CCI-original';

const SCORE_TYPE = { code: 'cci', display: 'Charlson Comorbidity Index' };

// wizard slug -> Charlson category id. Slugs not listed here (hypertension,
// obesity, asthma, smoking, alcoholUse, antibioticUse, insulinUse,
// antiviralUse) are outside the original 1987 index's scope and are never
// scored, by design -- see the file-level comment above.
const SLUG_TO_CATEGORY = {
  diabetesType1: 'diabetes',
  diabetesType2: 'diabetes',
  copd: 'chronicPulmonaryDisease',
  ckd: 'renalDisease',
};

// Category id -> { weight, display } per the original 1987 Charlson weight
// table (Charlson et al. 1987, Table 1). Only the categories this wizard
// can actually report today are included -- extending this table is a
// UI-wiring question (a new checkbox), not a scoring-algorithm one.
const CATEGORY_WEIGHTS = {
  diabetes: { weight: 1, display: 'Diabetes (sem lesão de órgão-alvo)' },
  chronicPulmonaryDisease: { weight: 1, display: 'Doença pulmonar crônica' },
  renalDisease: { weight: 2, display: 'Doença renal moderada/grave' },
};

/**
 * Computes the original-1987 Charlson Comorbidity Index score from the
 * intake wizard's `charlsonConditions` array (checked comorbidity slugs).
 * Returns an empty scoreComponents array when no reported condition maps
 * to a real Charlson category -- callers must not persist a DerivedScore
 * in that case (dict-02 ELM-0259: scoreComponents is required non-empty,
 * "nunca armazenar somente o escore final").
 */
function computeCharlsonScore(charlsonConditions) {
  const slugs = Array.isArray(charlsonConditions) ? charlsonConditions : [];

  const categoriesPresent = new Map();
  for (const slug of slugs) {
    const category = SLUG_TO_CATEGORY[String(slug || '').trim()];
    if (!category || !CATEGORY_WEIGHTS[category]) continue;
    if (!categoriesPresent.has(category)) categoriesPresent.set(category, []);
    categoriesPresent.get(category).push(slug);
  }

  if (categoriesPresent.size === 0) {
    return { scoreValue: null, scoreComponents: [] };
  }

  const scoreComponents = [];
  let scoreValue = 0;
  for (const [category, sourceSlugs] of categoriesPresent.entries()) {
    const { weight, display } = CATEGORY_WEIGHTS[category];
    scoreValue += weight;
    scoreComponents.push({
      condition: { code: category, display },
      weight,
      sourceSlugs,
    });
  }

  return { scoreValue, scoreComponents };
}

module.exports = {
  computeCharlsonScore,
  ALGORITHM_VERSION,
  SCORE_TYPE,
  SLUG_TO_CATEGORY,
  CATEGORY_WEIGHTS,
};
