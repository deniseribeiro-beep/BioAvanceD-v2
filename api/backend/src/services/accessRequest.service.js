const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const AccessRequestModel = require('../models/AccessRequest');
const { evaluatePolicies } = require('../models/AccessPolicy');
const { associationInForce } = require('../models/researchResourceAssociation');
const ConsentAuthorizationDecisionModel = require('../models/ConsentAuthorizationDecision');
const { SampleModel } = require('../models/Sample');
const { getCollection } = require('../utils/collectionResolver');
const collectionGovernanceService = require('./collectionGovernance.service');
const custodianship = require('./custodianship.service');

// sources/duo.js's own fixed systemUri for every DUO-imported TerminologyConcept.
const { DUO_SYSTEM_URI } = require('../models/ConsentPermission');

/**
 * #1347: a DUO code and every code it `is_a` descends from, read from the
 * imported terminology (TerminologyConcept, TerminologyRelation). A use
 * requested for a purpose is covered by a permission for that purpose or
 * for any broader one (GA4GH DUO matching).
 */
async function duoCodeWithAncestors(db, code) {
  const concepts = await getCollection(db, 'terminologyConcepts');
  const relations = await getCollection(db, 'terminologyRelations');
  const codes = new Set();
  const pending = [code];
  while (pending.length > 0) {
    const current = pending.pop();
    if (codes.has(current)) continue;
    const concept = await concepts.findOne({ systemUri: DUO_SYSTEM_URI, code: current });
    if (!concept) continue;
    codes.add(current);
    const parents = await relations
      .find({ sourceConceptId: concept.terminologyConceptId, relationType: 'is_a' })
      .toArray();
    for (const relation of parents) {
      if (relation.relationStatus && relation.relationStatus !== 'active') continue;
      const parent = await concepts.findOne({ terminologyConceptId: relation.targetConceptId });
      if (parent?.code) pending.push(parent.code);
    }
  }
  return codes;
}

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

  // RF024 AC3/AC6: a re-evaluation whose AccessPolicy effect is deny blocks
  // an approved request as well.
  if (accessRequest.policyDecision?.effect === 'deny') return { allowed: false, reason: 'policy_denied' };

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

/**
 * #1495 (RF024 AC2): a specimen registered into a collection is released only
 * while that collection holds its regime, its context and an approval in force
 * (the registration rule, RF004 AC3/AC7) and the specimen's custody holds with
 * its approval in force (RF021 AC6). The reasons that refuse, [] when all hold,
 * or null for a specimen in no collection, which no collection governs.
 */
async function governanceRefusals(db, sample, now) {
  if (!sample?.collectionId) return null;
  // `collections` has no resolver key; collectionGovernance reads it the same way.
  const collection = await db.collection('collections').findOne({ collectionId: String(sample.collectionId) });
  if (!collection) return [`Coleção ${sample.collectionId} do espécime ${sample.specimenId} não encontrada`];
  const reasons = [];
  const regimeRefusal = await collectionGovernanceService.registrationRefusal(db, collection, now);
  if (regimeRefusal) reasons.push(regimeRefusal);
  const custodyRefusal = await custodianship.operabilityRefusal(db, sample.specimenId, now);
  if (custodyRefusal) reasons.push(custodyRefusal);
  return reasons;
}

// RF019 AC3 (#1510): a quarantined specimen is not released for use. Its
// reason joins the governance reasons, so the item is incompatible and the
// policy decision denies, naming it. Read from the specimen the item resolves to.
function withQuarantineRefusal(sample, governance) {
  if (!sample || SampleModel.resolveSpecimenStatus(sample) !== 'quarantined') return governance;
  return [...(governance || []), `Espécime ${sample.specimenId} em quarentena (RF019)`];
}

/**
 * RNF008 AC3 (#1496): the biobanks a collection belongs to, sorted, through
 * Collection <- ResearchResourceCollection -> ResearchResource <-
 * ResearchResourceBiobank -> Biobank, each link counted only while in force
 * (associationInForce). [] for no collection or no link in force.
 */
async function collectionBiobankIds(db, collectionId, now) {
  if (!collectionId) return [];
  // Neither link collection has a CANONICAL_COLLECTIONS entry; each is read
  // by name with a static filter key, as institutionalReferenceValidator does.
  const resourceLinks = await db.collection('researchResourceCollections').find({ collectionId: String(collectionId) }).toArray();
  const biobankIds = new Set();
  for (const resourceLink of resourceLinks) {
    if (!associationInForce(resourceLink, now) || !resourceLink.researchResourceId) continue;
    const biobankLinks = await db.collection('researchResourceBiobanks')
      .find({ researchResourceId: String(resourceLink.researchResourceId) }).toArray();
    for (const biobankLink of biobankLinks) {
      if (associationInForce(biobankLink, now) && biobankLink.biobankId) biobankIds.add(String(biobankLink.biobankId));
    }
  }
  return [...biobankIds].sort();
}

function unprocessable(message) {
  const error = new Error(message);
  error.statusCode = 422;
  return error;
}

/**
 * RF024 AC4: the version of evaluateCompatibility's own rules: active consent
 * per participant-linked item, an active DUO concept when a duoCode is
 * given, an active Study and, for a specimen in a collection, the collection's
 * regime, its approval in force and the specimen's custody (#1495), and
 * no quarantined specimen (RF019 AC3, #1510). Bump it whenever those rules change, so a
 * stored decision names the rules it stood on. The AccessPolicy versions a
 * decision applied are recorded beside it, in appliedPolicies.
 */
const ACCESS_COMPATIBILITY_POLICY_VERSION = 'rf024-compatibility/1.2.0';

/**
 * RF024 AC4, CFG-004 ("Toda execução ou decisão registra
 * configurationReleaseId"): the ConfigurationRelease the stored configuration
 * names at the moment of the decision, or null before any release exists.
 */
async function activeConfigurationReleaseId(db) {
  const config = await db.collection('security_config').findOne({ _id: 'main' });
  return config?.configurationReleaseId || null;
}

async function decisionContext(db, policyDecision) {
  return {
    decisionId: crypto.randomUUID(),
    decidedAt: new Date(),
    policyVersion: ACCESS_COMPATIBILITY_POLICY_VERSION,
    // RNF008 AC4: the AccessPolicy/version pairs the decision stood on, and
    // the effect and reasons they produced (RF024 AC3).
    appliedPolicies: (policyDecision?.appliedPolicies || []).map(({ accessPolicyId, policyVersion, decisionEffect }) => ({
      accessPolicyId,
      policyVersion,
      decisionEffect,
    })),
    policyEffect: policyDecision?.effect || null,
    policyReasons: policyDecision?.reasons || [],
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
   * DUO (o duoCode da própria solicitação, se informado), o Study de destino
   * (precisa estar `active`, mesmo gate que RF021 já usa para
   * Sample/Consent/Patient), o regime, a aprovação vigente e a custódia de
   * cada espécime registrado numa coleção (#1495, governanceRefusals) e as
   * AccessPolicy vigentes. AC#3: o resultado
   * das políticas é `policyDecision` (permit, deny ou review_required, com
   * as políticas aplicadas e as razões; ver models/AccessPolicy.js).
   * RNF008 AC3 (#1496): cada entrada registra o estudo, o protocolo e a
   * coleção da amostra do seu item (studyId, protocolId, collectionId; null
   * para dataset ou item não resolvido), lidos pelas condições de mesmo nome
   * da AccessPolicy, e os biobancos da coleção (biobankIds, pelos vínculos
   * ResearchResource vigentes; biobankId só quando há exatamente um).
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

    // RF010 AC7: each item's consent in force answers permit, deny or
    // review_required for this request's use, recorded as a
    // ConsentAuthorizationDecision. A deny makes the item incompatible; a
    // review_required leaves it to the committee, with its reasons.
    const decisions = await getCollection(db, 'consentAuthorizationDecisions');
    const consentPermissions = await getCollection(db, 'consentPermissions');
    const configurationReleaseId = await activeConfigurationReleaseId(db);
    // #1347: the requested purpose with its DUO ancestors, so a partially
    // revoked consent is judged on the purpose rather than sent to review.
    const requestedPurposeCodes = duoCompatible
      ? await duoCodeWithAncestors(db, accessRequest.duoCode)
      : null;
    const resolveConsent = async (resolvedParticipantId, itemId) => {
      if (!resolvedParticipantId) {
        // Item references a specimen/file that doesn't resolve to a real
        // participant — don't default to "consent ok", that would silently
        // approve compatibility for a nonexistent item.
        return { consentValid: false, decision: null };
      }
      const consent = await consents.findOne(
        { participantId: resolvedParticipantId, status: 'ACTIVE' },
        { sort: { signedAt: -1, createdAt: -1 } }
      );
      if (!consent) {
        return { consentValid: false, decision: null };
      }
      const permissions = consent.currentStateDerived === 'partially_revoked'
        ? await consentPermissions.find({ consentId: consent.consentId || String(consent._id) }).toArray()
        : [];
      const evaluation = ConsentAuthorizationDecisionModel.evaluateConsentAuthorization(
        consent, accessRequest, { permissions, requestedPurposeCodes }
      );
      const decision = ConsentAuthorizationDecisionModel.create({
        ...evaluation,
        consentId: consent.consentId || String(consent._id),
        participantId: resolvedParticipantId,
        purpose: accessRequest.requestedPurpose,
        studyId: accessRequest.studyId,
        protocolId: accessRequest.protocolId,
        accessRequestId: accessRequest.accessRequestId,
        itemId,
        configurationReleaseId,
      });
      await decisions.insertOne(decision);
      return { consentValid: decision.result !== 'deny', decision };
    };

    const governanceNow = new Date();
    const consentCompatibility = [];
    for (const item of accessRequest.requestedItems) {
      let participantId = null;
      let studyId = null;
      let protocolId = null;
      let collectionId = null;
      let biobankIds = [];
      let consentValid = null;
      let decision = null;
      let governance = null;

      if (item.itemType === 'specimen') {
        const sample = await samples.findOne({ specimenId: item.itemId });
        participantId = sample?.participantId || null;
        studyId = sample?.studyId || null;
        protocolId = sample?.protocolId || null;
        collectionId = sample?.collectionId || null;
        biobankIds = await collectionBiobankIds(db, collectionId, governanceNow);
        ({ consentValid, decision } = await resolveConsent(participantId, item.itemId));
        governance = withQuarantineRefusal(sample, await governanceRefusals(db, sample, governanceNow));
      } else if (item.itemType === 'file') {
        const file = ObjectId.isValid(item.itemId)
          ? await sampleFiles.findOne({ _id: new ObjectId(item.itemId) })
          : null;
        const sample = file?.specimenId ? await samples.findOne({ specimenId: file.specimenId }) : null;
        participantId = sample?.participantId || null;
        studyId = sample?.studyId || null;
        protocolId = sample?.protocolId || null;
        collectionId = sample?.collectionId || null;
        biobankIds = await collectionBiobankIds(db, collectionId, governanceNow);
        ({ consentValid, decision } = await resolveConsent(participantId, item.itemId));
        governance = withQuarantineRefusal(sample, await governanceRefusals(db, sample, governanceNow));
      }
      // 'dataset' items: intentionally left untouched — participantId/
      // consentValid stay null (non-blocking), per #661's de-identified-
      // by-design conclusion documented on evaluateCompatibility above.

      const governanceValid = governance === null ? null : governance.length === 0;
      const compatible = consentValid !== false && duoCompatible !== false && studyActive && governanceValid !== false;

      consentCompatibility.push({
        itemId: item.itemId,
        itemType: item.itemType,
        participantId,
        studyId,
        protocolId,
        collectionId,
        biobankId: biobankIds.length === 1 ? biobankIds[0] : null,
        biobankIds,
        consentValid,
        consentAuthorizationDecisionId: decision?.consentAuthorizationDecisionId || null,
        consentAuthorizationResult: decision?.result || null,
        consentAuthorizationReasons: decision?.reasons || [],
        duoCompatible,
        studyActive,
        governanceValid,
        governanceReasons: governance || [],
        compatible,
      });
    }

    const overallCompatible = consentCompatibility.length > 0 && consentCompatibility.every((entry) => entry.compatible);
    const compatibilityEvaluatedAt = new Date();

    const policies = await (await getCollection(db, 'accessPolicies')).find({}).toArray();
    const policyDecision = evaluatePolicies(policies, accessRequest, consentCompatibility, compatibilityEvaluatedAt);

    await collection.updateOne(
      { accessRequestId },
      { $set: { consentCompatibility, compatibilityEvaluatedAt, overallCompatible, policyDecision, updatedAt: new Date() } }
    );

    return { ...accessRequest, consentCompatibility, compatibilityEvaluatedAt, overallCompatible, policyDecision };
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

    // RF024 AC3: the AccessPolicy effect gates the approval. deny refuses it;
    // review_required is what the committee's decision resolves; a request
    // evaluated before policies existed has no effect and is re-evaluated.
    if (['approved', 'conditioned'].includes(payload.status)) {
      const effect = accessRequest.policyDecision?.effect;
      if (!effect) {
        throw new Error('A solicitação deve ser reavaliada contra as políticas de acesso antes da aprovação');
      }
      if (effect === 'deny') {
        throw new Error(`Uma solicitação negada pela política de acesso não pode ser aprovada ou condicionada: ${accessRequest.policyDecision.reasons.join('; ')}`);
      }
    }

    const committeeDecision = {
      ...(await decisionContext(db, accessRequest.policyDecision)),
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

    // RF019 AC3 (#1315): a specimen quarantined since the approval is not
    // sent. The compatibility decision read its state then; this reads it now.
    const specimenIds = (accessRequest.requestedItems || [])
      .filter((item) => item.itemType === 'specimen')
      .map((item) => String(item.itemId));
    if (specimenIds.length) {
      const samples = await getCollection(db, 'samples');
      const quarantined = [];
      for (const specimenId of specimenIds) {
        const sample = await samples.findOne({ specimenId });
        if (sample && SampleModel.resolveSpecimenStatus(sample) === 'quarantined') quarantined.push(specimenId);
      }
      if (quarantined.length) {
        throw new Error(`Não é possível vincular a remessa/disponibilização: espécime em quarentena (${quarantined.join(', ')}) (RF019)`);
      }
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
      ...(await decisionContext(db, accessRequest.policyDecision)),
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
module.exports.duoCodeWithAncestors = duoCodeWithAncestors;
