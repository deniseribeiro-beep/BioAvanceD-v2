const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const ConsentTemplateModel = require('../models/ConsentTemplate');
const ConsentPolicyModel = require('../models/ConsentPolicy');
const PatientConsentModel = require('../models/PatientConsent');
const { validatePatientID } = require('../utils/patientAnonymization');
const logger = require('../utils/logger');
const fhirSyncService = require('./fhir-sync.service');
const { getCollection } = require('../utils/collectionResolver');
const { GraphProjectionService } = require('./graphProjection.service');

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
          required: { type: 'boolean' }
        },
        additionalProperties: false
      }
    }
  },
  additionalProperties: true
};

const consentPolicySchema = {
  type: 'object',
  required: ['title', 'htmlContent', 'version', 'validFrom', 'validTo', 'granularPermissions'],
  properties: {
    title: { type: 'string', minLength: 1 },
    htmlContent: { type: 'string', minLength: 1 },
    version: { type: 'string', minLength: 1 },
    caae: { type: 'string' },
    validFrom: { type: 'string', format: 'date-time' },
    validTo: { type: 'string', format: 'date-time' },
    active: { type: 'boolean' },
    granularPermissions: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['key', 'label'],
        properties: {
          key: { type: 'string', minLength: 1 },
          label: { type: 'string', minLength: 1 },
          required: { type: 'boolean' }
        },
        additionalProperties: false
      }
    }
  },
  additionalProperties: true
};

const patientConsentSchema = {
  type: 'object',
  required: ['patientId', 'templateId', 'responses'],
  properties: {
    patientId: { type: 'string', minLength: 1 },
    templateId: { type: 'string', minLength: 1 },
    signatureName: { type: 'string', minLength: 1 },
    signatureImageBase64: { type: 'string', minLength: 1 },
    signatureMimeType: { type: 'string' },
    signatureHash: { type: 'string' },
    responses: {
      type: 'object',
      additionalProperties: { type: 'boolean' }
    },
    ipAddress: { type: 'string' },
    userAgent: { type: 'string' },
    status: { type: 'string', enum: ['ACTIVE', 'REVOKED'] }
  },
  additionalProperties: true
};

const validateTemplateSchema = ajv.compile(consentTemplateSchema);
const validatePolicySchema = ajv.compile(consentPolicySchema);
const validatePatientConsentSchema = ajv.compile(patientConsentSchema);

class ConsentService {
  constructor() {
    this.graphProjectionService = new GraphProjectionService();
  }
  parseVersionNumber(version) {
    const value = String(version || '').trim().toLowerCase();
    const match = value.match(/^v?(\d+)$/);
    return match ? Number(match[1]) : 0;
  }

  async generateNextPolicyVersion(db) {
    const templatesCollection = await getCollection(db, 'consentTemplates');
    const latestPolicies = await templatesCollection
      .find({}, { projection: { version: 1 } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(200)
      .toArray();

    const maxVersion = latestPolicies.reduce((max, item) => {
      const current = this.parseVersionNumber(item?.version);
      return current > max ? current : max;
    }, 0);

    return `v${maxVersion + 1}`;
  }

  normalizeSignaturePayload(payload) {
    const signatureName = typeof payload.signatureName === 'string' ? payload.signatureName.trim() : '';
    const signatureImageBase64 = typeof payload.signatureImageBase64 === 'string' ? payload.signatureImageBase64.trim() : '';
    const signatureMimeType = typeof payload.signatureMimeType === 'string' && payload.signatureMimeType.trim()
      ? payload.signatureMimeType.trim().toLowerCase()
      : 'image/png';

    if (!signatureImageBase64) {
      return {
        signatureName,
        signatureImageBase64: '',
        signatureMimeType,
        signatureHash: null,
      };
    }

    const maxSignatureLength = 6 * 1024 * 1024;
    if (signatureImageBase64.length > maxSignatureLength) {
      throw new Error('Assinatura digital excede tamanho permitido');
    }

    let normalizedContent = signatureImageBase64;
    const dataUrlMatch = signatureImageBase64.match(/^data:([^;]+);base64,(.+)$/i);

    let detectedMime = signatureMimeType;
    if (dataUrlMatch) {
      detectedMime = dataUrlMatch[1].toLowerCase();
      normalizedContent = dataUrlMatch[2];
    }

    if (!/^image\/(png|jpeg|jpg|webp)$/i.test(detectedMime)) {
      throw new Error('Formato de assinatura digital inválido');
    }

    const signatureHash = crypto.createHash('sha256').update(normalizedContent).digest('hex');

    return {
      signatureName,
      signatureImageBase64,
      signatureMimeType: detectedMime,
      signatureHash,
    };
  }

  validateTemplatePayload(payload) {
    const valid = validateTemplateSchema(payload);
    if (!valid) {
      const errors = (validateTemplateSchema.errors || []).map(err => `${err.instancePath || 'template'} ${err.message}`);
      throw new Error(errors.join(', '));
    }
  }

  validatePolicyPayload(payload) {
    const valid = validatePolicySchema(payload);
    if (!valid) {
      const errors = (validatePolicySchema.errors || []).map(err => `${err.instancePath || 'policy'} ${err.message}`);
      throw new Error(errors.join(', '));
    }
  }

  validatePatientConsentPayload(payload) {
    const valid = validatePatientConsentSchema(payload);
    if (!valid) {
      const errors = (validatePatientConsentSchema.errors || []).map(err => `${err.instancePath || 'consent'} ${err.message}`);
      throw new Error(errors.join(', '));
    }
  }

  ensureUniquePermissionKeys(permissions) {
    const keys = new Set();
    for (const permission of permissions) {
      const key = permission.key.trim();
      if (keys.has(key)) {
        throw new Error(`Chave de permissão duplicada: ${key}`);
      }
      keys.add(key);
    }
  }

  validateResponsesAgainstTemplate(template, responses) {
    const permissions = Array.isArray(template.permissions) ? template.permissions : [];
    const keys = new Set(permissions.map(permission => permission.key));

    const missing = permissions.filter(permission => typeof responses[permission.key] !== 'boolean');
    if (missing.length > 0) {
      throw new Error(`Respostas inválidas: ${missing.map(p => p.key).join(', ')} devem ser booleano`);
    }

    const missingRequired = permissions.filter(permission => permission.required && responses[permission.key] !== true);
    if (missingRequired.length > 0) {
      throw new Error(`Permissões obrigatórias não aceitas: ${missingRequired.map(p => p.key).join(', ')}`);
    }

    const extraKeys = Object.keys(responses).filter(key => !keys.has(key));
    if (extraKeys.length > 0) {
      throw new Error(`Respostas contêm chaves inválidas: ${extraKeys.join(', ')}`);
    }
  }

  async createTemplate(db, payload) {
    try {
      this.validateTemplatePayload(payload);

      const permissions = Array.isArray(payload.permissions)
        ? payload.permissions.map(permission => ({
            key: permission.key.trim(),
            label: permission.label.trim(),
            required: Boolean(permission.required)
          }))
        : [];
      this.ensureUniquePermissionKeys(permissions);

      const templatesCollection = await getCollection(db, 'consentTemplates');
      const version = typeof payload.version === 'string' && payload.version.trim()
        ? payload.version.trim()
        : await this.generateNextPolicyVersion(db);
      const htmlContent = typeof payload.htmlContent === 'string' && payload.htmlContent.trim()
        ? payload.htmlContent.trim()
        : typeof payload.content === 'string'
          ? payload.content.trim()
          : '';
      const normalizedPayload = {
        ...payload,
        title: typeof payload.title === 'string' ? payload.title.trim() : payload.title,
        htmlContent,
        content: htmlContent,
        version,
        versionGroupId: typeof payload.versionGroupId === 'string' && payload.versionGroupId.trim().length > 0
          ? payload.versionGroupId.trim()
          : crypto.randomUUID(),
        caae: typeof payload.caae === 'string' ? payload.caae.trim() : undefined,
        active: payload.active === undefined ? true : Boolean(payload.active),
        permissions
      };

      const validation = ConsentTemplateModel.validate(normalizedPayload);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      }

      if (normalizedPayload.active === true) {
        await templatesCollection.updateMany({ active: true }, { $set: { active: false, updatedAt: new Date() } });
      }

      const template = ConsentTemplateModel.create(normalizedPayload);

      const result = await templatesCollection.insertOne(template);
      return {
        _id: result.insertedId,
        ...template
      };
    } catch (error) {
      logger.error('Erro ao criar template de consentimento:', error.message);
      throw error;
    }
  }

  async getTemplateById(db, templateId) {
    const templatesCollection = await getCollection(db, 'consentTemplates');

    let objectId;
    try {
      objectId = new ObjectId(String(templateId || '').trim());
    } catch {
      throw new Error('ID do template de consentimento inválido');
    }

    const template = await templatesCollection.findOne({ _id: objectId });
    return template || null;
  }

  async updateTemplate(db, templateId, payload) {
    try {
      const templatesCollection = await getCollection(db, 'consentTemplates');

      let objectId;
      try {
        objectId = new ObjectId(String(templateId || '').trim());
      } catch {
        throw new Error('ID do template de consentimento inválido');
      }

      const existingTemplate = await templatesCollection.findOne({ _id: objectId });
      if (!existingTemplate) {
        throw new Error('Template de consentimento não encontrado');
      }

      this.validateTemplatePayload({
        ...existingTemplate,
        ...payload,
        version: existingTemplate.version,
        caae: existingTemplate.caae,
      });

      const permissions = Array.isArray(payload.permissions)
        ? payload.permissions.map(permission => ({
            key: permission.key.trim(),
            label: permission.label.trim(),
            required: Boolean(permission.required)
          }))
        : Array.isArray(existingTemplate.permissions)
          ? existingTemplate.permissions.map(permission => ({
              key: String(permission.key || '').trim(),
              label: String(permission.label || '').trim(),
              required: Boolean(permission.required)
            }))
          : [];
      this.ensureUniquePermissionKeys(permissions);

      const htmlContent = typeof payload.htmlContent === 'string' && payload.htmlContent.trim()
        ? payload.htmlContent.trim()
        : typeof payload.content === 'string' && payload.content.trim()
          ? payload.content.trim()
          : String(existingTemplate.htmlContent || existingTemplate.content || '').trim();

      const active = payload.active === undefined ? true : Boolean(payload.active);
      const versionGroupId = String(existingTemplate.versionGroupId || existingTemplate._id || objectId).trim();
      const nextVersionNumber = Math.max(1, this.parseVersionNumber(existingTemplate.version) + 1);
      const template = ConsentTemplateModel.create({
        ...existingTemplate,
        ...payload,
        title: typeof payload.title === 'string' ? payload.title.trim() : String(existingTemplate.title || '').trim(),
        htmlContent,
        content: htmlContent,
        version: `v${nextVersionNumber}`,
        versionGroupId,
        previousTemplateId: String(objectId),
        caae: typeof existingTemplate.caae === 'string' ? existingTemplate.caae.trim() : '',
        active,
        permissions
      });

      if (template.active) {
        await templatesCollection.updateMany(
          { versionGroupId, active: true },
          { $set: { active: false, updatedAt: new Date() } }
        );
      }

      await templatesCollection.updateOne(
        { _id: objectId },
        {
          $set: {
            active: false,
            updatedAt: new Date(),
            versionGroupId,
          }
        }
      );

      const result = await templatesCollection.insertOne({
        ...template,
        updatedAt: new Date(),
      });

      return {
        _id: result.insertedId,
        ...template,
        updatedAt: new Date(),
      };
    } catch (error) {
      logger.error('Erro ao atualizar template de consentimento:', error.message);
      throw error;
    }
  }

  async createPolicy(db, payload, options = {}) {
    try {
      const previousPolicyId = options?.previousPolicyId ? String(options.previousPolicyId).trim() : '';
      const explicitVersionGroupId = options?.versionGroupId ? String(options.versionGroupId).trim() : '';
      let versionGroupId = explicitVersionGroupId || '';
      const nextVersion = await this.generateNextPolicyVersion(db);

      const normalizedPayload = {
        ...payload,
        htmlContent: payload.htmlContent || payload.content,
        caae: typeof payload.caae === 'string' ? payload.caae.trim() : '',
        validFrom: payload.validFrom || new Date().toISOString(),
        validTo: payload.validTo,
        version: nextVersion,
        granularPermissions: payload.granularPermissions || payload.permissions || []
      };

      const validFromDate = new Date(normalizedPayload.validFrom);
      const validToDate = new Date(normalizedPayload.validTo);
      if (Number.isNaN(validFromDate.getTime()) || Number.isNaN(validToDate.getTime())) {
        throw new Error('Período de vigência inválido');
      }
      if (validToDate.getTime() < validFromDate.getTime()) {
        throw new Error('Data final de vigência deve ser maior ou igual à data inicial');
      }

      this.validatePolicyPayload(normalizedPayload);

      const validation = ConsentPolicyModel.validate(normalizedPayload);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      }

      const permissions = Array.isArray(normalizedPayload.granularPermissions)
        ? normalizedPayload.granularPermissions.map(permission => ({
            key: permission.key.trim(),
            label: permission.label.trim(),
            required: Boolean(permission.required)
          }))
        : [];
      this.ensureUniquePermissionKeys(permissions);

      const templatesCollection = await getCollection(db, 'consentTemplates');
      let previousPolicy = null;

      if (previousPolicyId) {
        let previousObjectId;
        try {
          previousObjectId = new ObjectId(previousPolicyId);
        } catch {
          throw new Error('ID do TCLE para atualização é inválido');
        }

        previousPolicy = await templatesCollection.findOne({ _id: previousObjectId });
        if (!previousPolicy) {
          throw new Error('TCLE anterior não encontrado para atualização');
        }

        if (!versionGroupId) {
          versionGroupId = String(previousPolicy.versionGroupId || previousPolicy._id || previousPolicyId).trim();
        }
      }

      if (!versionGroupId) {
        versionGroupId = crypto.randomUUID();
      }

      if (normalizedPayload.active === undefined || normalizedPayload.active === true) {
        await templatesCollection.updateMany({ active: true }, { $set: { active: false, updatedAt: new Date() } });
      }

      const policy = ConsentPolicyModel.create({
        ...normalizedPayload,
        granularPermissions: permissions
      });

      const document = {
        ...policy,
        previousPolicyId: previousPolicyId || null,
        versionGroupId,
        content: policy.htmlContent,
        permissions: permissions,
        htmlContent: policy.htmlContent,
        caae: policy.caae,
        granularPermissions: permissions,
        validTo: policy.validTo,
        revisionType: previousPolicyId ? 'update' : 'create'
      };

      const result = await templatesCollection.insertOne(document);
      // --- Notify all patients with PENDING_CONSENT for this TCLE ---
      try {
        const patientsCollection = await getCollection(db, 'patients');
        // Find all patients with PENDING_CONSENT and consentTemplateId matching this policy _id
        const pendingPatients = await patientsCollection.find({
          status: 'PENDING_CONSENT',
          consentTemplateId: result.insertedId.toString()
        }).toArray();
        const notificationService = require('./notification.service');
        for (const patient of pendingPatients) {
          // Generate new consent token for each patient
          const consentMetadata = notificationService.buildConsentMetadata();
          const consentLink = notificationService.buildConsentLink(patient, consentMetadata.token);
          await notificationService.enqueueConsentNotification(patient, consentLink);
          await patientsCollection.updateOne(
            { _id: patient._id },
            {
              $set: {
                consentToken: consentMetadata.token,
                consentTokenCreatedAt: consentMetadata.createdAt,
                consentTokenExpiresAt: consentMetadata.expiresAt,
                consentNotifiedAt: new Date(),
                updatedAt: new Date()
              }
            }
          );
        }
      } catch (notifyError) {
        logger.error('Erro ao notificar pacientes do novo TCLE:', notifyError.message);
      }
      // --- End notification logic ---
      return {
        _id: result.insertedId,
        ...document
      };
    } catch (error) {
      logger.error('Erro ao criar política de consentimento:', error.message);
      throw error;
    }
  }

  async getActiveTemplate(db) {
    const templatesCollection = await getCollection(db, 'consentTemplates');
    const template = await templatesCollection
      .find({ active: true })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();

    return template[0] || null;
  }

  async getAllTemplates(db) {
    const templatesCollection = await getCollection(db, 'consentTemplates');
    return templatesCollection
      .find({})
      .sort({ active: -1, createdAt: -1, _id: -1 })
      .toArray();
  }

  async getLatestTemplate(db) {
    const templatesCollection = await getCollection(db, 'consentTemplates');
    const template = await templatesCollection
      .find({})
      .sort({ createdAt: -1, _id: -1 })
      .limit(1)
      .toArray();

    return template[0] || null;
  }

  async getActivePolicy(db) {
    const templatesCollection = await getCollection(db, 'consentTemplates');
    const template = await templatesCollection
      .find({ active: true })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();

    return template[0] || null;
  }

  async getAllPolicies(db) {
    const templatesCollection = await getCollection(db, 'consentTemplates');
    return templatesCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
  }

  async getPoliciesHistory(db, options = {}) {
    const templatesCollection = await getCollection(db, 'consentTemplates');
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(options.limit) || 10));
    const skip = (page - 1) * limit;
    const search = String(options.search || '').trim();
    const versionGroupId = String(options.groupId || options.versionGroupId || '').trim();

    const filter = {};
    if (versionGroupId) {
      filter.versionGroupId = versionGroupId;
    } else if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      const normalized = search.toLowerCase();

      const statusFilter = normalized === 'ativo' || normalized === 'active'
        ? { active: true }
        : normalized === 'inativo' || normalized === 'inactive'
          ? { active: false }
          : null;

      const searchOr = [
        { title: { $regex: regex } },
        { version: { $regex: regex } },
        { caae: { $regex: regex } },
        { htmlContent: { $regex: regex } },
        { 'granularPermissions.key': { $regex: regex } },
        { 'granularPermissions.label': { $regex: regex } }
      ];

      if (statusFilter) {
        filter.$and = [statusFilter, { $or: searchOr }];
      } else {
        filter.$or = searchOr;
      }
    }

    const [items, total] = await Promise.all([
      templatesCollection.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).toArray(),
      templatesCollection.countDocuments(filter)
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit))
      }
    };
  }

  async updatePolicy(db, policyId, payload) {
    return this.createPolicy(db, payload, { previousPolicyId: policyId });
  }

  async getActivePoliciesWithCaae(db) {
    const templatesCollection = await getCollection(db, 'consentTemplates');
    return templatesCollection
      .find({
        active: true,
        caae: { $exists: true, $nin: ['', null] }
      })
      .sort({ createdAt: -1 })
      .toArray();
  }

  async createPatientConsent(db, payload) {
    try {
      // Suporte ao campo signatureBase64 vindo do frontend
      let patchedPayload = { ...payload };
      if (payload.signatureBase64 && !payload.signatureImageBase64) {
        patchedPayload.signatureImageBase64 = payload.signatureBase64;
      }

      const normalizedSignature = this.normalizeSignaturePayload(patchedPayload);
      const normalizedPayload = {
        ...patchedPayload,
        ...normalizedSignature,
      };

      this.validatePatientConsentPayload(normalizedPayload);

      const validation = PatientConsentModel.validate(normalizedPayload);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      }

      const patientId = normalizedPayload.patientId;
      const patientExists = await validatePatientID(db, patientId);
      if (!patientExists) {
        throw new Error(`Paciente ${patientId} não encontrado`);
      }

      let templateId;
      try {
        templateId = new ObjectId(normalizedPayload.templateId);
      } catch (error) {
        throw new Error('templateId inválido');
      }

      const templatesCollection = await getCollection(db, 'consentTemplates');
      const template = await templatesCollection.findOne({ _id: templateId });
      if (!template) {
        throw new Error('Template de consentimento não encontrado');
      }

      if (!template.active) {
        throw new Error('Template de consentimento não está ativo');
      }

      const now = new Date();
      const validFrom = template.validFrom ? new Date(template.validFrom) : null;
      const validTo = template.validTo ? new Date(template.validTo) : null;

      if (validFrom && !Number.isNaN(validFrom.getTime()) && now.getTime() < validFrom.getTime()) {
        throw new Error('Template de consentimento ainda não está vigente');
      }

      if (validTo && !Number.isNaN(validTo.getTime()) && now.getTime() > validTo.getTime()) {
        throw new Error('Template de consentimento expirado');
      }

      this.validateResponsesAgainstTemplate(template, normalizedPayload.responses || {});

      const consentsCollection = await getCollection(db, 'consents');
      await consentsCollection.updateMany(
        { patientId, status: 'ACTIVE' },
        { $set: { status: 'REVOKED', revokedAt: new Date(), updatedAt: new Date() } }
      );

      // Logar apenas o tamanho da assinatura, se existir
      if (normalizedPayload.signatureImageBase64) {
        logger.info(
          `Assinatura recebida para paciente ${patientId}: tamanho ${normalizedPayload.signatureImageBase64.length} caracteres.`
        );
      }

      const consent = PatientConsentModel.create({
        ...normalizedPayload,
        templateId: templateId.toString(),
        status: 'ACTIVE'
      });

      const insertResult = await consentsCollection.insertOne(consent);
      await this.recordConsentProjectionEvent(db, {
        patientId,
        consentId: insertResult.insertedId.toString(),
        status: 'ACTIVE',
        signedAt: consent.signedAt || new Date(),
      });

      await fhirSyncService.upsertConsentFromLegacy(db, {
        _id: insertResult.insertedId,
        ...consent
      });

      return {
        _id: insertResult.insertedId,
        ...consent
      };
    } catch (error) {
      logger.error('Erro ao criar consentimento do paciente:', error.message);
      throw error;
    }
  }

  async revokeConsent(db, consentId) {
    const consentsCollection = await getCollection(db, 'consents');

    let objectId;
    try {
      objectId = new ObjectId(consentId);
    } catch (error) {
      throw new Error('ID de consentimento inválido');
    }

    const consent = await consentsCollection.findOne({ _id: objectId });
    if (!consent) {
      return null;
    }

    if (consent.status === 'REVOKED') {
      return consent;
    }

    await consentsCollection.updateOne(
      { _id: objectId },
      { $set: { status: 'REVOKED', revokedAt: new Date(), updatedAt: new Date() } }
    );

    await this.recordConsentProjectionEvent(db, {
      patientId: consent.patientId || consent.patientID || null,
      consentId: objectId.toString(),
      status: 'REVOKED',
      signedAt: consent.signedAt || consent.createdAt || new Date(),
    });

    const revokedConsent = {
      ...consent,
      status: 'REVOKED',
      revokedAt: new Date(),
      updatedAt: new Date()
    };

    await fhirSyncService.upsertConsentFromLegacy(db, {
      _id: objectId,
      ...revokedConsent
    });

    return {
      ...revokedConsent
    };
  }

  async getPatientConsent(db, patientId) {
    const consentFromFhir = await fhirSyncService.getPatientConsentFhirFirst(db, patientId);
    if (consentFromFhir) {
      return consentFromFhir;
    }

    const consentsCollection = await getCollection(db, 'consents');
    const consent = await consentsCollection
      .find({ patientId })
      .sort({ signedAt: -1, createdAt: -1 })
      .limit(1)
      .toArray();

    return consent[0] || null;
  }

  async recordConsentProjectionEvent(db, { patientId, consentId, status, signedAt }) {
    if (!db) return null;
    return this.graphProjectionService.appendConsentEvent(db, {
      donorKey: patientId,
      sampleId: null,
      ethicalConsentId: consentId,
      status,
      signedAt,
      sourceService: 'consent.service'
    });
  }
}

module.exports = new ConsentService();
