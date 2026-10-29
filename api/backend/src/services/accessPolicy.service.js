const AccessPolicyModel = require('../models/AccessPolicy');
const { compareVersions, policiesInForce } = require('../models/AccessPolicy');
const { getCollection } = require('../utils/collectionResolver');

function httpError(message, statusCode, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

/**
 * POL-001 "Versionar AccessPolicy": a policy version is written once and
 * never rewritten. A change is a new version of the same accessPolicyId,
 * with a higher policyVersion; the evaluation takes, per policy, the highest
 * version whose effectivePeriod holds.
 */
class AccessPolicyService {
  async validatePayload(db, payload) {
    const validation = AccessPolicyModel.validate(payload);
    if (!validation.isValid) {
      throw httpError(validation.errors.join(', '), 422, validation.errors);
    }
    // REL-0115: each organizationScopeId must name an Organization.
    const organizations = await getCollection(db, 'organizations');
    for (const organizationId of payload.organizationScopeIds) {
      if (!(await organizations.findOne({ organizationId }))) {
        throw httpError(`organizationScopeIds: ${organizationId} não encontrado`, 422);
      }
    }
  }

  async createPolicy(db, payload, createdBy) {
    const { accessPolicyId, ...fields } = payload || {};
    await this.validatePayload(db, fields);
    const collection = await getCollection(db, 'accessPolicies');
    const policy = AccessPolicyModel.create({ ...fields, createdBy });
    await collection.insertOne(policy);
    return policy;
  }

  async createVersion(db, accessPolicyId, payload, createdBy) {
    const collection = await getCollection(db, 'accessPolicies');
    const versions = await collection.find({ accessPolicyId }).toArray();
    if (versions.length === 0) {
      throw httpError('Política de acesso não encontrada', 404);
    }
    const { accessPolicyId: ignored, ...fields } = payload || {};
    await this.validatePayload(db, fields);
    const latest = versions.reduce((a, b) => (compareVersions(a.policyVersion, b.policyVersion) >= 0 ? a : b));
    if (compareVersions(fields.policyVersion, latest.policyVersion) <= 0) {
      throw httpError(`policyVersion ${fields.policyVersion} deve ser maior que a versão atual ${latest.policyVersion}`, 422);
    }
    const policy = AccessPolicyModel.create({ ...fields, accessPolicyId, createdBy });
    await collection.insertOne(policy);
    return policy;
  }

  /** Every version of one policy, newest first. */
  async getVersions(db, accessPolicyId) {
    const collection = await getCollection(db, 'accessPolicies');
    const versions = await collection.find({ accessPolicyId }).toArray();
    return versions.sort((a, b) => compareVersions(b.policyVersion, a.policyVersion));
  }

  async getAll(db) {
    const collection = await getCollection(db, 'accessPolicies');
    return collection.find({}).sort({ createdAt: -1 }).toArray();
  }

  async getInForce(db, now = new Date()) {
    return policiesInForce(await this.getAll(db), now);
  }
}

module.exports = new AccessPolicyService();
