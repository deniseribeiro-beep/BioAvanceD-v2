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

const ajv = new Ajv({ allErrors: true, strict: false, removeAdditional: 'all' });
addFormats(ajv);

const consentTemplateSchema = {
  type: 'object',
  required: ['title', 'content', 'version'],
  properties: {
    title: { type: 'string', minLength: 1 },
    content: { type: 'string', minLength: 1 },
    htmlContent: { type: 'string' },
    version: { type: 'string', minLength: 1 },
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
  required: ['title', 'htmlContent', 'version', 'validFrom', 'granularPermissions'],
  properties: {
    title: { type: 'string', minLength: 1 },
    htmlContent: { type: 'string', minLength: 1 },
    version: { type: 'string', minLength: 1 },
    validFrom: { type: 'string', format: 'date-time' },
    active: { type: 'boolean' },
    granularPermissions: {
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

      const validation = ConsentTemplateModel.validate(payload);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      }

      const permissions = Array.isArray(payload.permissions)
        ? payload.permissions.map(permission => ({
            key: permission.key.trim(),
            label: permission.label.trim(),
            required: Boolean(permission.required)
          }))
        : [];
      this.ensureUniquePermissionKeys(permissions);

      const templatesCollection = await getCollection(db, 'consentTemplates');

      if (payload.active === undefined || payload.active === true) {
        await templatesCollection.updateMany({ active: true }, { $set: { active: false, updatedAt: new Date() } });
      }

      const template = ConsentTemplateModel.create({
        ...payload,
        permissions
      });

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

  async createPolicy(db, payload) {
    try {
      const normalizedPayload = {
        ...payload,
        htmlContent: payload.htmlContent || payload.content,
        validFrom: payload.validFrom || new Date().toISOString(),
        granularPermissions: payload.granularPermissions || payload.permissions || []
      };

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

      if (normalizedPayload.active === undefined || normalizedPayload.active === true) {
        await templatesCollection.updateMany({ active: true }, { $set: { active: false, updatedAt: new Date() } });
      }

      const policy = ConsentPolicyModel.create({
        ...normalizedPayload,
        granularPermissions: permissions
      });

      const document = {
        ...policy,
        content: policy.htmlContent,
        permissions: permissions,
        htmlContent: policy.htmlContent,
        granularPermissions: permissions
      };

      const result = await templatesCollection.insertOne(document);
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

  async createPatientConsent(db, payload) {
    try {
      const normalizedSignature = this.normalizeSignaturePayload(payload);
      const normalizedPayload = {
        ...payload,
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

      this.validateResponsesAgainstTemplate(template, normalizedPayload.responses || {});

      const consentsCollection = await getCollection(db, 'consents');
      await consentsCollection.updateMany(
        { patientId, status: 'ACTIVE' },
        { $set: { status: 'REVOKED', revokedAt: new Date(), updatedAt: new Date() } }
      );

      const consent = PatientConsentModel.create({
        ...normalizedPayload,
        templateId: templateId.toString(),
        status: 'ACTIVE'
      });

      const insertResult = await consentsCollection.insertOne(consent);

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
}

module.exports = new ConsentService();
