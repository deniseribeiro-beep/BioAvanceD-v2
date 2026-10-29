/**
 * RF002 AC4 (Requisitos v4.0.0): "O Usuário Externo visualiza somente dados e
 * relatórios previamente autorizados." The authorization is a per-report
 * grant in the `access` collection (models/Access.js, dict v2.0.0
 * AccessGrant, #1202, #1201).
 *
 * A caller whose highest active role is hierarchy level 1 (UsuarioExterno)
 * reads a stored report only when an active, unexpired grant names its
 * reportID, and builds a report type (preview, generate, export) only when
 * such a grant names that type. Every other caller is unaffected: their
 * permission and organization-scope gates are unchanged.
 */

const { resolveUserHierarchyLevel } = require('./rbac-assignment.service');

const EXTERNAL_LEVEL = 1;

function normalizeType(value) {
  return String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function isActive(grant, now) {
  if (grant.grantStatus && grant.grantStatus !== 'active') return false;
  if (grant.revokedAt) return false;
  if (grant.expiresAt && new Date(grant.expiresAt) <= now) return false;
  return true;
}

/**
 * null when the caller is not restricted by grants; otherwise the report ids
 * (as strings) and the normalized report types the caller's grants authorize.
 */
async function resolveReportGrantScope(db, userAccountId, now = new Date()) {
  const level = await resolveUserHierarchyLevel(db, userAccountId);
  if (level !== EXTERNAL_LEVEL) return null;

  // #1201: a grant names its beneficiary under userAccountId (P1X-0239), or
  // under userId when it was written before the rename.
  const id = String(userAccountId);
  const grants = await db.collection('access')
    .find({ resourceType: 'report', $or: [{ userAccountId: id }, { userId: id }] })
    .toArray();
  const active = grants.filter((grant) => isActive(grant, now));
  return {
    reportIds: new Set(active.map((grant) => String(grant.reportID ?? grant.resourceId)).filter((id) => id !== 'undefined')),
    reportTypes: new Set(active.map((grant) => normalizeType(grant.reportType)).filter(Boolean)),
  };
}

function allowsReport(scope, report) {
  return scope === null || scope.reportIds.has(String(report.reportID));
}

function allowsReportType(scope, reportType) {
  return scope === null || scope.reportTypes.has(normalizeType(reportType));
}

/** A Mongo filter on `reports` limiting a restricted caller to granted ids. */
function reportIdFilter(scope) {
  if (scope === null) return {};
  const ids = [...scope.reportIds];
  const numeric = ids.filter((id) => /^\d+$/.test(id)).map(Number);
  return { reportID: { $in: [...ids, ...numeric] } };
}

module.exports = {
  EXTERNAL_LEVEL,
  resolveReportGrantScope,
  allowsReport,
  allowsReportType,
  reportIdFilter,
};
