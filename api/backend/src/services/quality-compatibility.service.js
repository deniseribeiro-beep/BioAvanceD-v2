/**
 * Camada leve de compatibilidade entre campos legados e os novos campos canônicos.
 * Não altera seeds nem regras de governança; apenas normaliza payloads de entrada
 * para usar: `rcs_score`, `final_grade`, `p_bio`, `grade_route`, `calculation_trace`.
 */
function normalizeSample(sample = {}) {
  const normalized = { ...sample };

  // Mapeamentos simples: preserve legacy fields, mas promova valores para nomes canônicos
  // Do not promote legacy `quality_*` fields automatically into canonical decision fields.
  // Preserve legacy values under a compatibility namespace for auditing and migration.
  if ((normalized.quality_score !== undefined || normalized.quality_category !== undefined || normalized.penalty_log !== undefined)) {
    normalized.legacy_compat = normalized.legacy_compat || {};
    if (normalized.quality_score !== undefined) normalized.legacy_compat.quality_score = normalized.quality_score;
    if (normalized.quality_category !== undefined) normalized.legacy_compat.quality_category = normalized.quality_category;
    if (normalized.penalty_log !== undefined) normalized.legacy_compat.penalty_log = normalized.penalty_log;
  }

  // Ensure canonical fields exist
  if (normalized.rcs_score === undefined) normalized.rcs_score = null;
  if (normalized.final_grade === undefined) normalized.final_grade = '';
  if (normalized.p_bio === undefined) normalized.p_bio = null;
  if (normalized.grade_route === undefined) normalized.grade_route = null;
  if (normalized.calculation_trace === undefined) normalized.calculation_trace = {};

  // Mark trace indicating normalization happened (non-destructive)
  normalized.calculation_trace = {
    ...(normalized.calculation_trace || {}),
    compatibility: (normalized.calculation_trace && normalized.calculation_trace.compatibility) || 'mapped-from-legacy-fields',
  };

  return normalized;
}

module.exports = {
  normalizeSample,
};
