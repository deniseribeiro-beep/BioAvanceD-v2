const ReferenceImportIssueModel = require('../../models/ReferenceImportIssue');
const { getCanonicalCollectionName } = require('../../config/canonicalEntityCollections.v2');

const { RESOLUTION_STATUSES } = ReferenceImportIssueModel;
const TERMINAL_STATUSES = RESOLUTION_STATUSES.filter((status) => status !== 'open');

/**
 * RF028 AC 7 quarantine recovery (Plano Integrado §7.3: "erros vão à
 * quarentena e não são descartados silenciosamente"): transitions a
 * quarantined ReferenceImportIssue (`resolutionStatus: 'open'`) to a
 * terminal resolution, recording who resolved it, when, and why. Never
 * overwrites an existing resolution — resolve once per issue.
 */
async function resolveImportIssue({ db, referenceImportIssueId, resolutionStatus, resolvedBy, resolutionNotes = null, resolvedAt = new Date() }) {
  if (!referenceImportIssueId) {
    throw new Error('referenceImportIssueId é obrigatório');
  }
  if (!TERMINAL_STATUSES.includes(resolutionStatus)) {
    throw new Error(`resolutionStatus deve ser um de: ${TERMINAL_STATUSES.join('|')}`);
  }
  if (!resolvedBy) {
    throw new Error('resolvedBy é obrigatório');
  }

  const issues = db.collection(getCanonicalCollectionName('ReferenceImportIssue'));
  const existing = await issues.findOne({ referenceImportIssueId });
  if (!existing) {
    throw new Error(`ReferenceImportIssue não encontrado: ${referenceImportIssueId}`);
  }
  if (existing.resolutionStatus !== 'open') {
    throw new Error(`ReferenceImportIssue ${referenceImportIssueId} já foi resolvido (resolutionStatus=${existing.resolutionStatus})`);
  }

  await issues.updateOne(
    { referenceImportIssueId },
    { $set: { resolutionStatus, resolvedAt, resolvedBy, resolutionNotes } },
  );

  return { ...existing, resolutionStatus, resolvedAt, resolvedBy, resolutionNotes };
}

module.exports = { resolveImportIssue };
