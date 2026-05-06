/**
 * Camada leve de compatibilidade entre campos legados e os novos campos canônicos.
 * Não altera seeds nem regras de governança; apenas normaliza payloads de entrada
 * para usar: `rcs_score`, `final_grade`, `p_bio`, `grade_route`, `calculation_trace`.
 */
function normalizeSample(sample = {}) {
  const normalized = { ...sample };

  // Mapeamentos simples: preserve legacy fields, mas promova valores para nomes canônicos
  if (normalized.quality_score !== undefined && (normalized.rcs_score === undefined || normalized.rcs_score === null)) {
    normalized.rcs_score = Number.isFinite(Number(normalized.quality_score)) ? Number(normalized.quality_score) : null;
  }

  if ((normalized.quality_category !== undefined && normalized.quality_category !== null) && (!normalized.final_grade || normalized.final_grade === '')) {
    // assume legacy categories already use A..E; promote to final_grade
    normalized.final_grade = String(normalized.quality_category);
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
