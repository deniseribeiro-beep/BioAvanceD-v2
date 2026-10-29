/**
 * #1376, #1192: the organization a create stamps, resolved from the caller.
 *
 * POST /api/samples runs requireOrganizationScope and then
 * resolveOrganizationIdForCreate (#1185), so the sample it writes carries the
 * caller's organization as Sample.organizationId. The create paths with no
 * route-level scope -- POST /api/users/register-sample and the generic
 * imports -- resolve the caller's scope here instead, by the same rule: a
 * single-organization caller gets their own; a multi-organization caller
 * names one of theirs; a global caller may name any existing one, or none.
 * An org-less caller gets the refusal requireOrganizationScope gives.
 *
 * Throws an Error with a statusCode (403, 400 or 404) on a refusal.
 */

const {
  resolveUserOrganizationScope,
  isOrganizationScopeUsable,
  resolveOrganizationIdForCreate
} = require('./rbac-assignment.service');

async function resolveCallerCreateOrganization(db, { userId, organizationScope, requested } = {}) {
  const scope = organizationScope || await resolveUserOrganizationScope(db, userId);
  if (!isOrganizationScopeUsable(scope)) {
    const error = new Error('Sem organização atribuída');
    error.statusCode = 403;
    throw error;
  }

  const organizationId = resolveOrganizationIdForCreate(scope, requested);

  if (scope.scope === 'global' && organizationId != null) {
    const organization = await db.collection('organizations').findOne({ organizationId: String(organizationId) });
    if (!organization) {
      const error = new Error(`organizationId ${organizationId} não encontrado`);
      error.statusCode = 404;
      throw error;
    }
  }

  return {
    organizationId: organizationId == null ? null : String(organizationId),
    organizationScope: scope
  };
}

module.exports = { resolveCallerCreateOrganization };
