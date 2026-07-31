/**
 * RF028 7.2 steps 6-8 ("Normalize"/"Stage"/"Validate"), kept pure and
 * DB-free so the parsing/validation logic is unit-testable without a Mongo
 * connection. `pipeline.js` feeds this the streamed raw lines and handles
 * everything DB-shaped (staging writes, promotion, idempotency) itself.
 */
function processRecords(rawLines, normalizeRecord) {
  const concepts = new Map(); // code -> concept candidate
  const relationCandidates = []; // { sourceCode, relationType, targetCode }
  const issues = [];
  let recordsRead = 0;

  for (const { rowNumber, line } of rawLines) {
    recordsRead += 1;
    let raw;
    try {
      raw = JSON.parse(line);
    } catch (parseError) {
      issues.push({
        rowNumber,
        entityType: 'TerminologyConcept',
        errorCode: 'INVALID_JSON',
        errorMessage: `Linha ${rowNumber} não é JSON válido: ${parseError.message}`,
        severity: 'error',
        rawValue: line,
      });
      continue;
    }

    const normalized = normalizeRecord(raw, rowNumber);
    if (!normalized.ok) {
      issues.push({ entityType: 'TerminologyConcept', ...normalized.issue });
      continue;
    }

    concepts.set(normalized.concept.code, normalized.concept);
    for (const parentCode of normalized.parents) {
      relationCandidates.push({ sourceCode: normalized.concept.code, relationType: 'is_a', targetCode: parentCode });
    }
  }

  // Integrity rule (Plano Integrado §7.3): mappings/relations must be
  // explicit, never orphaned — a relation whose endpoint didn't survive
  // normalization is itself a rejection, not a silently dropped edge.
  const relations = [];
  for (const candidate of relationCandidates) {
    if (concepts.has(candidate.sourceCode) && concepts.has(candidate.targetCode)) {
      relations.push(candidate);
      continue;
    }
    issues.push({
      entityType: 'TerminologyRelation',
      sourceRecordId: `${candidate.sourceCode}>${candidate.targetCode}`,
      errorCode: 'ORPHAN_RELATION',
      errorMessage: `Relação ${candidate.relationType} de ${candidate.sourceCode} para ${candidate.targetCode} aponta para um conceito que não foi normalizado nesta execução.`,
      severity: 'error',
      rawValue: candidate,
    });
  }

  return { recordsRead, concepts, relations, issues };
}

module.exports = { processRecords };
