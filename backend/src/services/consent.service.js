const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { ObjectId } = require('mongodb');
const ConsentTemplateModel = require('../models/ConsentTemplate');
const PatientConsentModel = require('../models/PatientConsent');
const { validatePatientID } = require('../utils/patientAnonymization');
const logger = require('../utils/logger');

const ajv = new Ajv({ allErrors: true, strict: false, removeAdditional: 'all' });
addFormats(ajv);

const consentTemplateSchema = {
  type: 'object',
  required: ['title', 'content', 'version'],
  properties: {
    title: { type: 'string', minLength: 1 },
    content: { type: 'string', minLength: 1 },
    version: { type: 'string', minLength: 1 },
    active: { type: 'boolean' },
    permissions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'label'],
        properties: {
          key: { type: 'string', minLength: 1 },
          label: { type: 'string', minLength: 1 }
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
const validatePatientConsentSchema = ajv.compile(patientConsentSchema);

class ConsentService {
  validateTemplatePayload(payload) {
    const valid = validateTemplateSchema(payload);
    if (!valid) {
      const errors = (validateTemplateSchema.errors || []).map(err => `${err.instancePath || 'template'} ${err.message}`);
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
      throw new Error(`Respostas inválidas: ${missing.map(p => p.key).join(', ')} devem ser boolean`);
    }

    const extraKeys = Object.keys(responses).filter(key => !keys.has(key));
    if (extraKeys.length > 0) {
      throw new Error(`Respostas contém chaves inválidas: ${extraKeys.join(', ')}`);
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
            label: permission.label.trim()
          }))
        : [];
      this.ensureUniquePermissionKeys(permissions);

      const templatesCollection = db.collection('consent_templates');

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

  async getActiveTemplate(db) {
    const templatesCollection = db.collection('consent_templates');
    const template = await templatesCollection
      .find({ active: true })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();

    return template[0] || null;
  }

  async createPatientConsent(db, payload) {
    try {
      this.validatePatientConsentPayload(payload);

      const validation = PatientConsentModel.validate(payload);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      }

      const patientId = payload.patientId;
      const patientExists = await validatePatientID(db, patientId, 'pacientes');
      if (!patientExists) {
        throw new Error(`Paciente ${patientId} não encontrado`);
      }

      let templateId;
      try {
        templateId = new ObjectId(payload.templateId);
      } catch (error) {
        throw new Error('templateId inválido');
      }

      const templatesCollection = db.collection('consent_templates');
      const template = await templatesCollection.findOne({ _id: templateId });
      if (!template) {
        throw new Error('Template de consentimento não encontrado');
      }

      if (!template.active) {
        throw new Error('Template de consentimento não está ativo');
      }

      this.validateResponsesAgainstTemplate(template, payload.responses || {});

      const consentsCollection = db.collection('patient_consents');
      await consentsCollection.updateMany(
        { patientId, status: 'ACTIVE' },
        { $set: { status: 'REVOKED', revokedAt: new Date(), updatedAt: new Date() } }
      );

      const consent = PatientConsentModel.create({
        ...payload,
        templateId: templateId.toString(),
        status: 'ACTIVE'
      });

      const insertResult = await consentsCollection.insertOne(consent);
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
    const consentsCollection = db.collection('patient_consents');

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

    return {
      ...consent,
      status: 'REVOKED',
      revokedAt: new Date(),
      updatedAt: new Date()
    };
  }

  async getPatientConsent(db, patientId) {
    const consentsCollection = db.collection('patient_consents');
    const consent = await consentsCollection
      .find({ patientId })
      .sort({ signedAt: -1, createdAt: -1 })
      .limit(1)
      .toArray();

    return consent[0] || null;
  }
}

module.exports = new ConsentService();
