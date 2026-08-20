const AccessRequestModel = require('../models/AccessRequest');
const { getCollection } = require('../utils/collectionResolver');

// sources/duo.js's own fixed systemUri for every DUO-imported TerminologyConcept.
const DUO_SYSTEM_URI = 'http://purl.obolibrary.org/obo/duo.owl';

/**
 * RF024 AC#5 ("bloquear acesso expirado, negado ou revogado") — pure
 * function over a stored AccessRequest document, no I/O, so both the
 * service and its unit tests can exercise every branch directly.
 */
function evaluateAccessState(accessRequest, now = new Date()) {
  const status = accessRequest?.committeeDecision?.status || 'pending';

  if (status === 'pending') return { allowed: false, reason: 'pending' };
  if (status === 'rejected') return { allowed: false, reason: 'denied' };
  if (status === 'revoked') return { allowed: false, reason: 'revoked' };

  const end = accessRequest.approvalPeriod?.end ? new Date(accessRequest.approvalPeriod.end) : null;
  if (end && end.getTime() < now.getTime()) {
    return { allowed: false, reason: 'expired' };
  }

  const start = accessRequest.approvalPeriod?.start ? new Date(accessRequest.approvalPeriod.start) : null;
  if (start && start.getTime() > now.getTime()) {
    return { allowed: false, reason: 'not_yet_active' };
  }

  // 'approved' or 'conditioned'
  return { allowed: true, reason: status };
}

class AccessRequestService {
  async createRequest(db, payload) {
    const validation = AccessRequestModel.validate(payload);
    if (!validation.isValid) {
      throw new Error(validation.errors.join(', '));
    }

    const collection = await getCollection(db, 'accessRequests');
    const document = AccessRequestModel.create(payload);
    await collection.insertOne(document);
    return document;
  }

  /**
   * AC#2: avalia consentimento (por item vinculado a um participante real),
   * DUO (o duoCode da própria solicitação, se informado) e política de
   * acesso (o Study de destino precisa estar `active`, mesmo gate que RF021
   * já usa para Sample/Consent/Patient). Nenhum AccessPolicy dedicado
   * existe neste repositório ainda — o status do Study é o proxy real e
   * verificável disponível hoje para essa terceira perna da AC.
   */
  async evaluateCompatibility(db, accessRequestId) {
    const collection = await getCollection(db, 'accessRequests');
    const accessRequest = await collection.findOne({ accessRequestId });
    if (!accessRequest) {
      throw new Error('Solicitação de acesso não encontrada');
    }

    const samples = await getCollection(db, 'samples');
    const consents = await getCollection(db, 'consents');
    const terminologyConcepts = await getCollection(db, 'terminologyConcepts');
    // Study has no CANONICAL_COLLECTIONS entry — master-data.routes.js
    // itself reads it straight off the raw driver, same as here.
    const studies = db.collection('studies');

    const study = await studies.findOne({ studyId: accessRequest.studyId });
    const studyActive = !!study && study.studyStatus === 'active';

    let duoCompatible = null;
    if (accessRequest.duoCode) {
      const concept = await terminologyConcepts.findOne({
        systemUri: DUO_SYSTEM_URI,
        code: accessRequest.duoCode,
      });
      duoCompatible = !!concept && concept.conceptStatus === 'active';
    }

    const consentCompatibility = [];
    for (const item of accessRequest.requestedItems) {
      let participantId = null;
      let consentValid = null;

      if (item.itemType === 'specimen') {
        const sample = await samples.findOne({ specimenId: item.itemId });
        participantId = sample?.participantId || null;
        if (participantId) {
          const consent = await consents.findOne({ participantId, status: 'ACTIVE' });
          consentValid = !!consent;
        } else {
          // Item references a specimen that doesn't resolve to a real
          // sample — don't default to "consent ok", that would silently
          // approve compatibility for a nonexistent item.
          consentValid = false;
        }
      }

      const compatible = consentValid !== false && duoCompatible !== false && studyActive;

      consentCompatibility.push({
        itemId: item.itemId,
        itemType: item.itemType,
        participantId,
        consentValid,
        duoCompatible,
        studyActive,
        compatible,
      });
    }

    const overallCompatible = consentCompatibility.length > 0 && consentCompatibility.every((entry) => entry.compatible);
    const compatibilityEvaluatedAt = new Date();

    await collection.updateOne(
      { accessRequestId },
      { $set: { consentCompatibility, compatibilityEvaluatedAt, overallCompatible, updatedAt: new Date() } }
    );

    return { ...accessRequest, consentCompatibility, compatibilityEvaluatedAt, overallCompatible };
  }

  /** AC#3: registra decisão, justificativa e vigência. */
  async recordDecision(db, accessRequestId, payload, decidedBy) {
    const validation = AccessRequestModel.validateDecision(payload);
    if (!validation.isValid) {
      throw new Error(validation.errors.join(', '));
    }

    const collection = await getCollection(db, 'accessRequests');
    const accessRequest = await collection.findOne({ accessRequestId });
    if (!accessRequest) {
      throw new Error('Solicitação de acesso não encontrada');
    }

    if (!accessRequest.compatibilityEvaluatedAt) {
      throw new Error('A compatibilidade de consentimento/DUO/política deve ser avaliada antes da decisão do comitê');
    }

    const committeeDecision = {
      status: payload.status,
      justification: payload.justification.trim(),
      decidedBy: decidedBy || null,
      decidedAt: new Date(),
    };

    const approvalPeriod = ['approved', 'conditioned'].includes(payload.status)
      ? {
          start: payload.approvalPeriod?.start ? new Date(payload.approvalPeriod.start) : new Date(),
          end: payload.approvalPeriod?.end ? new Date(payload.approvalPeriod.end) : null,
        }
      : null;

    await collection.updateOne(
      { accessRequestId },
      { $set: { committeeDecision, approvalPeriod, updatedAt: new Date() } }
    );

    return collection.findOne({ accessRequestId });
  }

  /** AC#4: vincula a aprovação à disponibilização — só permitido enquanto o acesso está liberado. */
  async markDistributed(db, accessRequestId) {
    const collection = await getCollection(db, 'accessRequests');
    const accessRequest = await collection.findOne({ accessRequestId });
    if (!accessRequest) {
      throw new Error('Solicitação de acesso não encontrada');
    }

    const access = evaluateAccessState(accessRequest);
    if (!access.allowed) {
      throw new Error(`Não é possível vincular a remessa/disponibilização: acesso ${access.reason}`);
    }

    await collection.updateOne(
      { accessRequestId },
      { $set: { distributionStatus: 'released', distributedAt: new Date(), updatedAt: new Date() } }
    );

    return collection.findOne({ accessRequestId });
  }

  /** AC#5 (revogado): só reversível a partir de um estado já aprovado/condicionado. */
  async revokeAccess(db, accessRequestId, justification, decidedBy) {
    if (!justification || !String(justification).trim()) {
      throw new Error('justification é obrigatório para revogar o acesso');
    }

    const collection = await getCollection(db, 'accessRequests');
    const accessRequest = await collection.findOne({ accessRequestId });
    if (!accessRequest) {
      throw new Error('Solicitação de acesso não encontrada');
    }

    const currentStatus = accessRequest.committeeDecision?.status;
    if (currentStatus !== 'approved' && currentStatus !== 'conditioned') {
      throw new Error('Somente uma solicitação aprovada ou condicionada pode ser revogada');
    }

    const committeeDecision = {
      ...accessRequest.committeeDecision,
      status: 'revoked',
      justification: String(justification).trim(),
      decidedBy: decidedBy || accessRequest.committeeDecision.decidedBy,
      decidedAt: new Date(),
    };

    await collection.updateOne(
      { accessRequestId },
      { $set: { committeeDecision, updatedAt: new Date() } }
    );

    return collection.findOne({ accessRequestId });
  }

  async getById(db, accessRequestId) {
    const collection = await getCollection(db, 'accessRequests');
    return collection.findOne({ accessRequestId });
  }

  /** AC#5 read path: live allow/block decision, not a stored flag. */
  async getAccessCheck(db, accessRequestId) {
    const accessRequest = await this.getById(db, accessRequestId);
    if (!accessRequest) return null;
    return { accessRequestId, ...evaluateAccessState(accessRequest) };
  }

  async getAll(db) {
    const collection = await getCollection(db, 'accessRequests');
    return collection.find({}).sort({ createdAt: -1 }).toArray();
  }
}

const accessRequestService = new AccessRequestService();
module.exports = accessRequestService;
module.exports.evaluateAccessState = evaluateAccessState;
module.exports.DUO_SYSTEM_URI = DUO_SYSTEM_URI;
