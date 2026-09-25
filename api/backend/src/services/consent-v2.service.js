const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const ConsentTemplateModel = require('../models/ConsentTemplate');
const ConsentPolicyModel = require('../models/ConsentPolicy');
const PatientConsentModel = require('../models/PatientConsent');
const { validateParticipantId } = require('../utils/patientAnonymization');
const logger = require('../utils/logger');
const { getCollection } = require('../utils/collectionResolver');
const { withMongoTransaction } = require('../utils/mongoTransaction');
const ConsentGovernanceV2Repository = require('../infrastructure/persistence/mongo/ConsentGovernanceV2Repository');
const participantIdentityService = require('./participantIdentity.service');
const notificationDispatchService = require('./notificationDispatch.service');
const { hashToken } = require('../utils/tokenHash');

const ajv = new Ajv({ allErrors: true, strict: false, removeAdditional: 'failing' });
addFormats(ajv);

const consentTemplateSchema = {
  type: 'object',
  required: ['title', 'content'],
  properties: {
    title: { type: 'string', minLength: 1 },
    content: { type: 'string', minLength: 1 },
    htmlContent: { type: 'string' },
    version: { type: 'string', minLength: 1 },
    caae: { type: 'string', minLength: 1 },
    active: { type: 'boolean' },
    permissions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'label'],
        properties: {
          key: { type: 'string', minLength: 1 },
          label: { type: 'string', minLength: 1 },
          required: { type: 'boolean' },
          purposeCode: { type: 'string' }
        },
        additionalProperties: true
      }
    }
  },
  additionalProperties: true
};

const patientConsentSchema = {
  type: 'object',
  required: ['participantId', 'consentTemplateId', 'responses'],
  properties: {
    participantId: { type: 'string', minLength: 1 },
    consentTemplateId: { type: 'string', minLength: 1 },
    signatureName: { type: 'string', minLength: 1 },
    signatureImageBase64: { type: 'string', minLength: 1 },
    signatureMimeType: { type: 'string' },
    signatureHash: { type: 'string' },
    responses: { type: 'object', additionalProperties: { type: 'boolean' } },
    ipAddress: { type: 'string' },
    userAgent: { type: 'string' },
    studyId: { type: ['string', 'null'] },
    consentModel: { type: 'string' }
  },
  additionalProperties: true
};

const validateTemplateSchema = ajv.compile(consentTemplateSchema);
const validatePatientConsentSchema = ajv.compile(patientConsentSchema);
const SIGNATURE_FIELDS = ['signatureName', 'signatureImageBase64', 'signatureMimeType', 'signatureHash'];

class ConsentV2Service {
  repository(db) {
    return new ConsentGovernanceV2Repository(db);
  }

  parseVersionNumber(version) {
    const match = String(version || '').trim().toLowerCase().match(/^v?(\d+)$/);
    return match ? Number(match[1]) : 0;
  }

  async generateNextPolicyVersion(db) {
    const latest = await getCollection(db, 'consentTemplates')
      .find({}, { projection: { version: 1 } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(200)
      .toArray();
    const max = latest.reduce((value, item) => Math.max(value, this.parseVersionNumber(item.version)), 0);
    return `v${max + 1}`;
  }

  normalizeSignaturePayload(payload) {
    const signatureName = typeof payload.signatureName === 'string' ? payload.signatureName.trim() : '';
    const raw = typeof payload.signatureImageBase64 === 'string' ? payload.signatureImageBase64.trim() : '';
    if (!raw) return signatureName ? { signatureName } : {};
    if (raw.length > 6 * 1024 * 1024) throw new Error('Assinatura digital excede tamanho permitido');

    let content = raw;
    let mime = typeof payload.signatureMimeType === 'string' && payload.signatureMimeType.trim()
      ? payload.signatureMimeType.trim().toLowerCase()
      : 'image/png';
    const dataUrl = raw.match(/^data:([^;]+);base64,(.+)$/i);
    if (dataUrl) {
      mime = dataUrl[1].toLowerCase();
      content = dataUrl[2];
    }
    if (!/^image\/(png|jpeg|jpg|webp)$/i.test(mime)) throw new Error('Formato de assinatura digital inválido');
    return {
      signatureName,
      signatureImageBase64: raw,
      signatureMimeType: mime,
      signatureHash: crypto.createHash('sha256').update(content).digest('hex')
    };
  }

  normalizePermissions(permissions = []) {
    const seen = new Set();
    return (Array.isArray(permissions) ? permissions : []).map((permission) => {
      const key = String(permission.key || permission.permissionCode || '').trim();
      if (!key) throw new Error('Chave de permissão obrigatória');
      if (seen.has(key)) throw new Error(`Chave de permissão duplicada: ${key}`);
      seen.add(key);
      return {
        ...permission,
        key,
        permissionCode: key,
        label: String(permission.label || key).trim(),
        required: Boolean(permission.required),
        purposeCode: String(permission.purposeCode || permission.purpose?.code || key).trim()
      };
    });
  }

  validateResponsesAgainstTemplate(template, responses) {
    const permissions = Array.isArray(template.permissions) ? template.permissions : [];
    const allowed = new Set(permissions.map((item) => String(item.key || item.permissionCode)));
    const missing = permissions.filter((item) => typeof responses[String(item.key || item.permissionCode)] !== 'boolean');
    if (missing.length) throw new Error(`Respostas inválidas: ${missing.map((item) => item.key || item.permissionCode).join(', ')} devem ser booleano`);
    const requiredDenied = permissions.filter((item) => item.required && responses[String(item.key || item.permissionCode)] !== true);
    if (requiredDenied.length) throw new Error(`Permissões obrigatórias não aceitas: ${requiredDenied.map((item) => item.key || item.permissionCode).join(', ')}`);
    const extra = Object.keys(responses).filter((key) => !allowed.has(key));
    if (extra.length) throw new Error(`Respostas contêm chaves inválidas: ${extra.join(', ')}`);
  }

  async createTemplate(db, payload) {
    const normalized = {
      ...payload,
      title: String(payload.title || '').trim(),
      content: String(payload.content || payload.htmlContent || '').trim(),
      htmlContent: String(payload.htmlContent || payload.content || '').trim(),
      version: String(payload.version || '').trim() || await this.generateNextPolicyVersion(db),
      caae: typeof payload.caae === 'string' ? payload.caae.trim() : undefined,
      active: payload.active === undefined ? true : Boolean(payload.active),
      versionGroupId: String(payload.versionGroupId || '').trim() || crypto.randomUUID(),
      permissions: this.normalizePermissions(payload.permissions || [])
    };
    if (!validateTemplateSchema(normalized)) {
      throw new Error((validateTemplateSchema.errors || []).map((error) => `${error.instancePath || 'template'} ${error.message}`).join(', '));
    }
    const validation = ConsentTemplateModel.validate(normalized);
    if (!validation.isValid) throw new Error(validation.errors.join(', '));

    const collection = await getCollection(db, 'consentTemplates');
    if (normalized.active) {
      await collection.updateMany({ active: true }, { $set: { active: false, updatedAt: new Date() } });
    }
    const template = ConsentTemplateModel.create(normalized);
    const result = await collection.insertOne(template);
    return { _id: result.insertedId, ...template };
  }

  async getTemplateById(db, consentTemplateId) {
    let objectId;
    try { objectId = new ObjectId(String(consentTemplateId || '').trim()); } catch { throw new Error('ID do template de consentimento inválido'); }
    return (await getCollection(db, 'consentTemplates').findOne({ _id: objectId })) || null;
  }

  async updateTemplate(db, consentTemplateId, payload) {
    const existing = await this.getTemplateById(db, consentTemplateId);
    if (!existing) throw new Error('Template de consentimento não encontrado');
    const collection = await getCollection(db, 'consentTemplates');
    const versionGroupId = String(existing.versionGroupId || existing._id);
    const normalized = {
      ...existing,
      ...payload,
      title: String(payload.title || existing.title || '').trim(),
      content: String(payload.content || payload.htmlContent || existing.content || existing.htmlContent || '').trim(),
      htmlContent: String(payload.htmlContent || payload.content || existing.htmlContent || existing.content || '').trim(),
      version: `v${Math.max(1, this.parseVersionNumber(existing.version) + 1)}`,
      versionGroupId,
      previousTemplateId: String(existing._id),
      caae: existing.caae,
      active: payload.active === undefined ? true : Boolean(payload.active),
      permissions: this.normalizePermissions(payload.permissions || existing.permissions || [])
    };
    if (normalized.active) {
      await collection.updateMany({ versionGroupId, active: true }, { $set: { active: false, updatedAt: new Date() } });
    }
    await collection.updateOne({ _id: existing._id }, { $set: { active: false, updatedAt: new Date(), versionGroupId } });
    const template = ConsentTemplateModel.create(normalized);
    const result = await collection.insertOne({ ...template, updatedAt: new Date() });
    return { _id: result.insertedId, ...template };
  }

  async createPolicy(db, payload, options = {}) {
    const previousPolicyId = String(options.previousPolicyId || '').trim();
    let previous = null;
    if (previousPolicyId) {
      previous = await this.getTemplateById(db, previousPolicyId);
      if (!previous) throw new Error('TCLE anterior não encontrado para atualização');
    }

    const validFrom = new Date(payload.validFrom || new Date());
    const validTo = new Date(payload.validTo);
    if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validTo.getTime())) throw new Error('Período de vigência inválido');
    if (validTo < validFrom) throw new Error('Data final de vigência deve ser maior ou igual à data inicial');

    const permissions = this.normalizePermissions(payload.granularPermissions || payload.permissions || []);
    const normalized = {
      ...payload,
      title: String(payload.title || '').trim(),
      htmlContent: String(payload.htmlContent || payload.content || '').trim(),
      content: String(payload.htmlContent || payload.content || '').trim(),
      version: await this.generateNextPolicyVersion(db),
      caae: String(payload.caae || '').trim(),
      validFrom: validFrom.toISOString(),
      validTo: validTo.toISOString(),
      active: payload.active === undefined ? true : Boolean(payload.active),
      granularPermissions: permissions,
      permissions,
      previousPolicyId: previousPolicyId || null,
      versionGroupId: String(options.versionGroupId || previous?.versionGroupId || previous?._id || crypto.randomUUID()),
      revisionType: previousPolicyId ? 'update' : 'create'
    };
    const validation = ConsentPolicyModel.validate(normalized);
    if (!validation.isValid) throw new Error(validation.errors.join(', '));

    const collection = await getCollection(db, 'consentTemplates');
    if (normalized.active) {
      await collection.updateMany({ active: true }, { $set: { active: false, updatedAt: new Date() } });
    }
    const policy = ConsentPolicyModel.create(normalized);
    const result = await collection.insertOne({ ...policy, ...normalized });

    const consentNotifications = await this.notifyPendingParticipants(db, {
      insertedId: result.insertedId,
      previousPolicyId,
      versionGroupId: normalized.versionGroupId
    });
    return { _id: result.insertedId, ...policy, ...normalized, consentNotifications };
  }

  async notifyPendingParticipants(db, { insertedId, previousPolicyId, versionGroupId }) {
    const outcome = { total: 0, notified: 0, failed: 0 };
    try {
      const templates = await getCollection(db, 'consentTemplates');
      const lineageIds = new Set(previousPolicyId ? [previousPolicyId] : []);
      if (versionGroupId) {
        const lineage = await templates.find({ versionGroupId, _id: { $ne: insertedId } }, { projection: { _id: 1 } }).toArray();
        lineage.forEach((item) => lineageIds.add(String(item._id)));
      }
      if (!lineageIds.size) return outcome;

      const patients = await getCollection(db, 'Participant').find({
        status: 'PENDING_CONSENT',
        consentTemplateId: { $in: [...lineageIds] }
      }).toArray();
      outcome.total = patients.length;
      const notificationService = require('./notification.service');
      const identities = await getCollection(db, 'participantIdentities');

      for (const patient of patients) {
        const previousToken = patient.consentToken || null;
        const previousCreatedAt = patient.consentTokenCreatedAt || null;
        const previousExpiresAt = patient.consentTokenExpiresAt || null;
        try {
          const rawIdentity = await identities.findOne({ participantId: patient.participantId });
          const identity = rawIdentity ? participantIdentityService.decryptIdentity(rawIdentity) : null;
          const patientWithIdentity = identity ? { ...patient, patientName: identity.patientName } : patient;
          const metadata = notificationService.buildConsentMetadata();
          const link = notificationService.buildConsentLink(patientWithIdentity, metadata.token);
          // #1049: store hash at rest; plaintext only lives in the emailed link.
          await getCollection(db, 'Participant').updateOne({ _id: patient._id }, { $set: {
            consentToken: hashToken(metadata.token),
            consentTokenCreatedAt: metadata.createdAt,
            consentTokenExpiresAt: metadata.expiresAt,
            updatedAt: new Date()
          } });
          try {
            await notificationService.enqueueConsentNotification(patientWithIdentity, link);
          } catch (notifyError) {
            // #836: restore prior token so the old link still works if send fails.
            await getCollection(db, 'Participant').updateOne({ _id: patient._id }, { $set: {
              consentToken: previousToken,
              consentTokenCreatedAt: previousCreatedAt,
              consentTokenExpiresAt: previousExpiresAt,
              updatedAt: new Date()
            } });
            throw notifyError;
          }
          await getCollection(db, 'Participant').updateOne({ _id: patient._id }, { $set: { consentNotifiedAt: new Date(), updatedAt: new Date() } });
          outcome.notified += 1;
        } catch (error) {
          outcome.failed += 1;
          logger.error(`Falha ao notificar participante ${patient.participantId} sobre novo TCLE:`, error.message);
        }
      }
    } catch (error) {
      logger.error('Erro ao notificar participantes do novo TCLE:', error.message);
    }
    return outcome;
  }

  async getActiveTemplate(db) {
    const rows = await getCollection(db, 'consentTemplates').find({ active: true }).sort({ createdAt: -1 }).limit(1).toArray();
    return rows[0] || null;
  }

  async getAllTemplates(db) {
    return getCollection(db, 'consentTemplates').find({}).sort({ active: -1, createdAt: -1, _id: -1 }).toArray();
  }

  async getLatestTemplate(db) {
    const rows = await getCollection(db, 'consentTemplates').find({}).sort({ createdAt: -1, _id: -1 }).limit(1).toArray();
    return rows[0] || null;
  }

  async getActivePolicy(db) { return this.getActiveTemplate(db); }
  async getAllPolicies(db) { return getCollection(db, 'consentTemplates').find({}).sort({ createdAt: -1 }).toArray(); }

  async getPoliciesHistory(db, options = {}) {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(options.limit) || 10));
    const filter = {};
    const groupId = String(options.groupId || options.versionGroupId || '').trim();
    const search = String(options.search || '').trim();
    if (groupId) filter.versionGroupId = groupId;
    else if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      const searchFilter = [
        { title: { $regex: regex } },
        { version: { $regex: regex } },
        { caae: { $regex: regex } },
        { htmlContent: { $regex: regex } },
        { 'permissions.key': { $regex: regex } }
      ];
      const normalizedSearch = search.toLowerCase();
      const activeFilter = ['ativo', 'active'].includes(normalizedSearch)
        ? true
        : ['inativo', 'inactive'].includes(normalizedSearch)
          ? false
          : null;
      if (activeFilter === null) filter.$or = searchFilter;
      else filter.$and = [{ active: activeFilter }, { $or: searchFilter }];
    }
    const collection = await getCollection(db, 'consentTemplates');
    const [items, total] = await Promise.all([
      collection.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
      collection.countDocuments(filter)
    ]);
    return { items, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  }

  async updatePolicy(db, policyId, payload) {
    return this.createPolicy(db, payload, { previousPolicyId: policyId });
  }

  async getActivePoliciesWithCaae(db) {
    return getCollection(db, 'consentTemplates').find({ active: true, caae: { $exists: true, $nin: ['', null] } }).sort({ createdAt: -1 }).toArray();
  }

  async createPatientConsent(db, payload) {
    let patched = { ...payload };
    if (payload.signatureBase64 && !payload.signatureImageBase64) patched.signatureImageBase64 = payload.signatureBase64;
    const signature = this.normalizeSignaturePayload(patched);
    for (const field of SIGNATURE_FIELDS) delete patched[field];
    patched = { ...patched, ...signature };

    if (!validatePatientConsentSchema(patched)) {
      const error = new Error((validatePatientConsentSchema.errors || []).map((item) => `${item.instancePath || 'consent'} ${item.message}`).join(', '));
      error.statusCode = 422;
      throw error;
    }
    const modelValidation = PatientConsentModel.validate(patched);
    if (!modelValidation.isValid) {
      const error = new Error(modelValidation.errors.join(', '));
      error.statusCode = 422;
      throw error;
    }
    if (!(await validateParticipantId(db, patched.participantId))) throw new Error(`Paciente ${patched.participantId} não encontrado`);

    const template = await this.getTemplateById(db, patched.consentTemplateId);
    if (!template) throw new Error('Template de consentimento não encontrado');
    if (!template.active) throw new Error('Template de consentimento não está ativo');
    const now = new Date();
    const validFrom = template.validFrom ? new Date(template.validFrom) : null;
    const validTo = template.validTo ? new Date(template.validTo) : null;
    if (validFrom && now < validFrom) throw new Error('Template de consentimento ainda não está vigente');
    if (validTo && now > validTo) throw new Error('Template de consentimento expirado');
    this.validateResponsesAgainstTemplate(template, patched.responses || {});

    if (patched.studyId) {
      const study = await db.collection('studies').findOne({ studyId: String(patched.studyId) });
      if (!study) throw new Error(`studyId ${patched.studyId} não encontrado`);
      if (study.studyStatus !== 'active') {
        const error = new Error(`Estudo ${patched.studyId} não está ativo (status: ${study.studyStatus})`);
        error.statusCode = 422;
        throw error;
      }
    }

    const repository = this.repository(db);
    const canonical = await withMongoTransaction(db, (session) => repository.createConsent({
      participantId: patched.participantId,
      template,
      templateVersionId: String(template._id),
      consentModel: patched.consentModel || template.consentModel || 'specific',
      responses: patched.responses,
      signedAt: new Date(),
      studyId: patched.studyId || null,
      signatureName: patched.signatureName,
      signatureHash: patched.signatureHash,
      signatureMimeType: patched.signatureMimeType,
      signatureImageBase64: patched.signatureImageBase64,
      actorId: patched.actorId || null
    }, session));

    return repository.toLegacyView(canonical, canonical.permissions);
  }

  async revokeConsent(db, consentId, options = {}) {
    const repository = this.repository(db);
    const result = await withMongoTransaction(db, (session) => repository.revokeConsent(consentId, {
      reasonCode: options.reasonCode || 'participant_request',
      actorId: options.actorId || null,
      communicationRequired: true
    }, session));
    if (!result) return null;

    if (!result.alreadyRevoked) {
      void notificationDispatchService.dispatchNotification(db, {
        eventType: 'consent_revoked',
        sourceEventType: 'ConsentRevocation',
        sourceEventId: result.revocation.consentRevocationId,
        payload: { participantId: result.consent.participantId, consentId: result.consent.consentId }
      }).catch((error) => logger.error('[NOTIFICATION_DISPATCH] Falha ao notificar revogação:', error.message || error));
    }

    const permissions = await repository.listPermissions(result.consent.consentId);
    return repository.toLegacyView(result.consent, permissions);
  }

  async getPatientConsent(db, participantId) {
    return this.repository(db).getLegacyViewForParticipant(participantId);
  }

  async authorize(db, input, session) {
    return this.repository(db).authorize(input, session);
  }
}

module.exports = new ConsentV2Service();
