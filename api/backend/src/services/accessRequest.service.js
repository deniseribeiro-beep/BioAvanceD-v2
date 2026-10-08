const crypto = require('crypto');
const { ObjectId } = require('mongodb');
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

  // RF024 AC6 ("bloquear acesso ... incompatível"): an approval stands only
  // on a compatibility evaluation that passed, and the latest one wins, so a
  // re-evaluation that turns incompatible blocks an approved request too.
  // Fail-closed: a document with no passing evaluation is incompatible.
  if (accessRequest.overallCompatible !== true) return { allowed: false, reason: 'incompatible' };

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

function unprocessable(message) {
  const error = new Error(message);
  error.statusCode = 422;
  return error;
}

/**
 * RF024 AC4: the version of the rule set a decision applies. No AccessPolicy
 * entity exists yet (#663), so the policy in force is evaluateCompatibility's
 * own rules: active consent per participant-linked item, an active DUO
 * concept when a duoCode is given, and an active Study. Bump it whenever
 * those rules change, so a stored decision names the rules it stood on.
 */
const ACCESS_COMPATIBILITY_POLICY_VERSION = 'rf024-compatibility/1.0.0';

/**
 * RF024 AC4, CFG-004 ("Toda execução ou decisão registra
 * configurationReleaseId"): the ConfigurationRelease the stored configuration
 * names at the moment of the decision, or null before any release exists.
 */
async function activeConfigurationReleaseId(db) {
  const config = await db.collection('security_config').findOne({ _id: 'main' });
  return config?.configurationReleaseId || null;
}

async function decisionContext(db) {
  return {
    decisionId: crypto.randomUUID(),
    decidedAt: new Date(),
    policyVersion: ACCESS_COMPATIBILITY_POLICY_VERSION,
    configurationReleaseId: await activeConfigurationReleaseId(db),
  };
}

class AccessRequestService {
  async createRequest(db, payload) {
    const validation = AccessRequestModel.validate(payload);
    if (!validation.isValid) {
      // RNF018 (#1300): a validation failure answers 422; the caller's catch
      // keeps every other error on its own status.
      const validationError = new Error(validation.errors.join(', '));
      validationError.statusCode = 422;

      validationError.details = validation.errors;
      throw validationError;
    }

    // RF024 AC1: the organization and the protocol are references, so each
    // must resolve; the protocol must be approved (RF021 AC5's gate, as for
    // a Sample), and its version in force is recorded with the request.
    const organizations = await getCollection(db, 'organizations');
    if (!(await organizations.findOne({ organizationId: payload.organizationId }))) {
      throw unprocessable(`organizationId ${payload.organizationId} não encontrado`);
    }
    const protocol = await db.collection('protocols').findOne({ protocolId: payload.protocolId });
    if (!protocol) {
      throw unprocessable(`protocolId ${payload.protocolId} não encontrado`);
    }
    if (protocol.approvalStatus !== 'approved') {
      throw unprocessable(`Protocolo ${payload.protocolId} não está aprovado (status: ${protocol.approvalStatus})`);
    }

    const collection = await getCollection(db, 'accessRequests');
    const document = AccessRequestModel.create({ ...payload, protocolVersion: protocol.protocolVersion ?? null });
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
   *
   * #661: 'file' items (SampleFile) always carry the specimenId they were
   * uploaded against, so they resolve to a real participant the same way a
   * 'specimen' item does. 'dataset' items don't get the same treatment —
   * dict-02_DICIONARIO.md models Dataset (ELM-0416–0423, categoria "FAIR e
   * publicação") purely as a citable, published artifact (DataCite/RO-Crate
   * fields: doi, license, distributionFiles), with no participant-linkage
   * field at all. That's this repo's own data model declaring datasets
   * de-identified-by-design, not an oversight — participantId/consentValid
   * stay null (non-blocking) for them, same as before #661.
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
    // Study/SampleFile have no CANONICAL_COLLECTIONS entry — master-data.routes.js
    // and sample-file.controller.js already read them straight off the raw
    // driver, same as here.
    const studies = db.collection('studies');
    const sampleFiles = db.collection('sample_files');

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

    const resolveConsent = async (resolvedParticipantId) => {
      if (!resolvedParticipantId) {
        // Item references a specimen/file that doesn't resolve to a real
        // participant — don't default to "consent ok", that would silently
        // approve compatibility for a nonexistent item.
        return false;
      }
      const consent = await consents.findOne({ participantId: resolvedParticipantId, status: 'ACTIVE' });
      return !!consent;
    };

    const consentCompatibility = [];
    for (const item of accessRequest.requestedItems) {
      let participantId = null;
      let consentValid = null;

      if (item.itemType === 'specimen') {
        const sample = await samples.findOne({ specimenId: item.itemId });
        participantId = sample?.participantId || null;
        consentValid = await resolveConsent(participantId);
      } else if (item.itemType === 'file') {
        const file = ObjectId.isValid(item.itemId)
          ? await sampleFiles.findOne({ _id: new ObjectId(item.itemId) })
          : null;
        const sample = file?.specimenId ? await samples.findOne({ specimenId: file.specimenId }) : null;
        participantId = sample?.participantId || null;
        consentValid = await resolveConsent(participantId);
      }
      // 'dataset' items: intentionally left untouched — participantId/
      // consentValid stay null (non-blocking), per #661's de-identified-
      // by-design conclusion documented on evaluateCompatibility above.

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

    // RF024 AC6: evaluated is not enough; an approval needs the evaluation to
    // have passed. A rejection stays open whatever the evaluation said.
    if (['approved', 'conditioned'].includes(payload.status) && accessRequest.overallCompatible !== true) {
      throw new Error('Uma solicitação incompatível com consentimento/DUO/política não pode ser aprovada ou condicionada');
    }

    const committeeDecision = {
      ...(await decisionContext(db)),
      status: payload.status,
      justification: payload.justification.trim(),
      decidedBy: decidedBy || null,
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
      {
        $set: {
          distributionStatus: 'released',
          distributedAt: new Date(),
          // RF024 AC7: the distribution names the decision that allowed it.
          distributionDecisionId: accessRequest.committeeDecision.decisionId || null,
          updatedAt: new Date(),
        },
      }
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

    // A revocation is a decision of its own: a new decisionId, and the
    // policyVersion and configurationReleaseId in force now.
    const committeeDecision = {
      ...accessRequest.committeeDecision,
      ...(await decisionContext(db)),
      status: 'revoked',
      justification: String(justification).trim(),
      decidedBy: decidedBy || accessRequest.committeeDecision.decidedBy,
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
module.exports.ACCESS_COMPATIBILITY_POLICY_VERSION = ACCESS_COMPATIBILITY_POLICY_VERSION;
