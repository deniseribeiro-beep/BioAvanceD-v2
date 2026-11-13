const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const ConsentTemplateModel = require('../models/ConsentTemplate');
const ConsentPolicyModel = require('../models/ConsentPolicy');
const PatientConsentModel = require('../models/PatientConsent');
const ConsentPermissionModel = require('../models/ConsentPermission');
const { DUO_SYSTEM_URI } = ConsentPermissionModel;
const consentEvidence = require('./consentEvidence.service');
const consentHistory = require('./consentHistory.service');
const consentCommunication = require('./consentCommunication.service');
const { validateParticipantId } = require('../utils/patientAnonymization');
const logger = require('../utils/logger');
const { getCollection } = require('../utils/collectionResolver');
const { GraphProjectionService } = require('./graphProjection.service');
const { withTransactionWhereSupported } = require('../utils/mongoTransaction');
const participantIdentityService = require('./participantIdentity.service');
const notificationDispatchService = require('./notificationDispatch.service');
const { hashConsentToken } = require('../utils/consentTokenHash');
const consentPanel = require('./consentPanel.service');

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
          // #1347: a governed purpose (GA4GH DUO code) the permission covers.
          purposeCode: { type: 'string', minLength: 1 }
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
          required: { type: 'boolean' },
          // #1347: a governed purpose (GA4GH DUO code) the permission covers.
          purposeCode: { type: 'string', minLength: 1 }
        },
        additionalProperties: false
      }
    }
  },
  additionalProperties: true
};

// #820: the four fields normalizeSignaturePayload owns. Listed once so the
// normalizer's output cannot be silently merged alongside a caller's raw copy
// of the same key.
const SIGNATURE_FIELDS = [
  'signatureName',
  'signatureImageBase64',
  'signatureMimeType',
  'signatureHash',
];

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

  // #1181: a term's version counts within its lineage (P1X-0365
  // versionGroupId), as updateTemplate's v<N+1> does. It used to be a global
  // counter over the last 200 terms, so a new lineage started at whatever
  // number an unrelated term had reached.
  async generateNextPolicyVersion(db, versionGroupId) {
    if (!versionGroupId) {
      return 'v1';
    }
    const templatesCollection = await getCollection(db, 'consentTemplates');
    const lineage = await templatesCollection
      .find({ versionGroupId }, { projection: { version: 1 } })
      .toArray();

    const maxVersion = lineage.reduce((max, item) => {
      const current = this.parseVersionNumber(item?.version);
      return current > max ? current : max;
    }, 0);

    return `v${maxVersion + 1}`;
  }

  // #1181: one active term per lineage. dict-02 groups a term's revisions by
  // versionGroupId and carries a CAAE on each term, so terms of different
  // lineages are independent documents that can be in force at once.
  // Publishing deactivates only the publishing term's own lineage.
  async deactivateLineage(templatesCollection, versionGroupId) {
    await templatesCollection.updateMany(
      { versionGroupId, active: true },
      { $set: { active: false, updatedAt: new Date() } }
    );
  }

  normalizeSignaturePayload(payload) {
    const signatureName = typeof payload.signatureName === 'string' ? payload.signatureName.trim() : '';
    const signatureImageBase64 = typeof payload.signatureImageBase64 === 'string' ? payload.signatureImageBase64.trim() : '';
    const signatureMimeType = typeof payload.signatureMimeType === 'string' && payload.signatureMimeType.trim()
      ? payload.signatureMimeType.trim().toLowerCase()
      : 'image/png';

    if (!signatureImageBase64) {
      // #820: omit the keys rather than emptying them. They are optional in
      // patientConsentSchema (absent from its `required` list) but declared
      // `minLength: 1`, so a present-and-empty value is rejected -- which made
      // a signature-less manifestation unreachable even though the schema says
      // it is legal. That is the only production path the participant
      // e-consent page takes (POST /api/e-consent/update sends no signature at
      // all), so every acceptance through it 422'd.
      //
      // Optional is the intended reading, not a leniency call: dict-02
      // P1X-0372 `signerDisplayName` is 0..1 Condicional, and RF010 AC#4's
      // "signatário" is ELM-0107 `signerRole` (a role code), not a captured
      // signature. PatientConsentModel.validate type-checks these only when
      // truthy, and PatientConsentModel.create defaults all four to null --
      // three layers already treat a signature-less consent as legal.
      //
      // signatureMimeType is omitted too: declaring 'image/png' for an image
      // that does not exist records a fact that is not true.
      return signatureName ? { signatureName } : {};
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

  // RNF018 (#1300): a schema failure is a validation failure, so it answers
  // 422 with its details, as the model validation after it does.
  validateTemplatePayload(payload) {
    const valid = validateTemplateSchema(payload);
    if (!valid) {
      const errors = (validateTemplateSchema.errors || []).map(err => `${err.instancePath || 'template'} ${err.message}`);
      const error = new Error(errors.join(', '));
      error.statusCode = 422;
      error.details = errors;
      throw error;
    }
  }

  validatePolicyPayload(payload) {
    const valid = validatePolicySchema(payload);
    if (!valid) {
      const errors = (validatePolicySchema.errors || []).map(err => `${err.instancePath || 'policy'} ${err.message}`);
      const error = new Error(errors.join(', '));
      error.statusCode = 422;
      error.details = errors;
      throw error;
    }
  }

  validatePatientConsentPayload(payload) {
    const valid = validatePatientConsentSchema(payload);
    if (!valid) {
      const errors = (validatePatientConsentSchema.errors || []).map(err => `${err.instancePath || 'consent'} ${err.message}`);
      const error = new Error(errors.join(', '));
      error.statusCode = 422;
      throw error;
    }
  }

  // A term's permission as stored: key, label, required, and the governed
  // purpose it covers when the term names one (#1347).
  normalizePermission(permission) {
    const purposeCode = typeof permission.purposeCode === 'string' ? permission.purposeCode.trim() : '';
    return {
      key: permission.key.trim(),
      label: permission.label.trim(),
      required: Boolean(permission.required),
      ...(purposeCode ? { purposeCode } : {})
    };
  }

  /**
   * #1347 (RF010 AC3, V2E-0116): a permission's purpose is a governed code,
   * a GA4GH DUO concept the reference data holds as active, the vocabulary
   * an access request's duoCode is checked against. Anything else is a 422.
   */
  async assertGovernedPurposeCodes(db, permissions) {
    const codes = [...new Set(permissions.map(permission => permission.purposeCode).filter(Boolean))];
    if (codes.length === 0) {
      return;
    }
    const concepts = await getCollection(db, 'terminologyConcepts');
    const unknown = [];
    for (const code of codes) {
      const concept = await concepts.findOne({ systemUri: DUO_SYSTEM_URI, code });
      if (!concept || concept.conceptStatus !== 'active') {
        unknown.push(code);
      }
    }
    if (unknown.length > 0) {
      const details = unknown.map(code => `purposeCode ${code} não é um conceito DUO ativo`);
      const error = new Error(details.join(', '));
      error.statusCode = 422;
      error.details = details;
      throw error;
    }
  }

  // #1349: the purposes a term's permission may name, for the builder.
  async listPurposeCodes(db) {
    const concepts = await getCollection(db, 'terminologyConcepts');
    const active = await concepts
      .find({ systemUri: DUO_SYSTEM_URI, conceptStatus: 'active' })
      .sort({ code: 1 })
      .toArray();
    return active.map(concept => ({ code: concept.code, display: concept.display || concept.code }));
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
        ? payload.permissions.map(permission => this.normalizePermission(permission))
        : [];
      this.ensureUniquePermissionKeys(permissions);
      await this.assertGovernedPurposeCodes(db, permissions);

      const templatesCollection = await getCollection(db, 'consentTemplates');
      const versionGroupId = typeof payload.versionGroupId === 'string' && payload.versionGroupId.trim().length > 0
        ? payload.versionGroupId.trim()
        : crypto.randomUUID();
      const version = typeof payload.version === 'string' && payload.version.trim()
        ? payload.version.trim()
        : await this.generateNextPolicyVersion(db, versionGroupId);
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
        versionGroupId,
        caae: typeof payload.caae === 'string' ? payload.caae.trim() : undefined,
        active: payload.active === undefined ? true : Boolean(payload.active),
        permissions,
        // #824: RF010 AC#1's lineage fields, as createPolicy writes them. A
        // create starts a lineage; updateTemplate continues one.
        previousPolicyId: null,
        revisionType: 'create'
      };

      const validation = ConsentTemplateModel.validate(normalizedPayload);
      if (!validation.isValid) {
        // RNF018 (#1300): a validation failure answers 422; the caller's catch
        // keeps every other error on its own status.
        const validationError = new Error(validation.errors.join(', '));
        validationError.statusCode = 422;

        validationError.details = validation.errors;
        throw validationError;
      }

      if (normalizedPayload.active === true) {
        await this.deactivateLineage(templatesCollection, versionGroupId);
      }

      const template = ConsentTemplateModel.create(normalizedPayload);

      const result = await templatesCollection.insertOne(template);
      // #824: a fresh lineage has no pending cohort unless the caller passed
      // an existing versionGroupId; the sweep decides, and reports 0/0/0.
      const consentNotifications = await this.notifyPendingConsentCohort(db, {
        newTemplateId: result.insertedId,
        previousPolicyId: null,
        versionGroupId: template.versionGroupId
      });
      // RF010 AC8: an active version published into an existing lineage
      // supersedes its earlier versions; their consents' holders are told.
      await consentCommunication.notifyHoldersOfSupersededTerm(db, {
        newTemplateId: result.insertedId,
        newTemplate: template,
        previousPolicyId: null,
        versionGroupId: template.versionGroupId
      });
      return {
        _id: result.insertedId,
        ...template,
        consentNotifications
      };
    } catch (error) {
      logger.error('Erro ao criar template de consentimento:', error.message);
      throw error;
    }
  }

  async getTemplateById(db, consentTemplateId) {
    const templatesCollection = await getCollection(db, 'consentTemplates');

    let objectId;
    try {
      objectId = new ObjectId(String(consentTemplateId || '').trim());
    } catch {
      throw new Error('ID do template de consentimento inválido');
    }

    const template = await templatesCollection.findOne({ _id: objectId });
    return template || null;
  }

  async updateTemplate(db, consentTemplateId, payload) {
    try {
      const templatesCollection = await getCollection(db, 'consentTemplates');

      let objectId;
      try {
        objectId = new ObjectId(String(consentTemplateId || '').trim());
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
        // #824: createTemplate stores an absent CAAE as '' (the builder's field
        // is optional), and '' fails the schema's minLength -- so a term
        // created without one could never be revised. Absent, not empty.
        caae: existingTemplate.caae || undefined,
      });

      const permissions = Array.isArray(payload.permissions)
        ? payload.permissions.map(permission => this.normalizePermission(permission))
        : Array.isArray(existingTemplate.permissions)
          ? existingTemplate.permissions.map(permission => this.normalizePermission({
              ...permission,
              key: String(permission.key || ''),
              label: String(permission.label || '')
            }))
          : [];
      this.ensureUniquePermissionKeys(permissions);
      await this.assertGovernedPurposeCodes(db, permissions);

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
        // #824: the canonical lineage fields createPolicy writes and the
        // publication sweep reads (RF010 AC#1).
        previousPolicyId: String(objectId),
        revisionType: 'update',
        caae: typeof existingTemplate.caae === 'string' ? existingTemplate.caae.trim() : '',
        active,
        permissions
      });

      if (template.active) {
        await this.deactivateLineage(templatesCollection, versionGroupId);
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

      // #824: the builder's revision path. It created the new version and
      // invited nobody -- the sweep lived only in createPolicy, which no UI
      // reaches.
      const consentNotifications = await this.notifyPendingConsentCohort(db, {
        newTemplateId: result.insertedId,
        previousPolicyId: String(objectId),
        versionGroupId
      });
      // RF010 AC8 (LGPD art. 8 §6, art. 9 §2): the holders of consents in
      // force under the superseded versions get a policy change notice, each
      // recorded as a ConsentCommunicationEvent. Never throws, so a failed
      // send cannot undo this publication.
      await consentCommunication.notifyHoldersOfSupersededTerm(db, {
        newTemplateId: result.insertedId,
        newTemplate: template,
        previousPolicyId: String(objectId),
        versionGroupId
      });

      return {
        _id: result.insertedId,
        ...template,
        updatedAt: new Date(),
        consentNotifications,
      };
    } catch (error) {
      logger.error('Erro ao atualizar template de consentimento:', error.message);
      throw error;
    }
  }

  /**
   * #835/#810 publication sweep, extracted from createPolicy for #824 so the
   * builder's createTemplate/updateTemplate run the same one. Invites every
   * participant still PENDING_CONSENT on an earlier version of this term (the
   * immediate predecessor plus the versionGroupId lineage). Never throws: a
   * failed sweep must not undo a publication, and the counts say what reached
   * whom.
   */
  async notifyPendingConsentCohort(db, { newTemplateId, previousPolicyId, versionGroupId }) {
    const consentNotifications = { total: 0, notified: 0, failed: 0 };
    try {
      const patientsCollection = await getCollection(db, 'patients');
      const templatesCollection = await getCollection(db, 'consentTemplates');

      // #835: this used to filter on `result.insertedId` -- the id of the
      // template inserted one line above -- so it could never match anyone.
      // Patient.consentTemplateId is assigned at patient creation and is
      // required (models/Patient.js:27), so a pending participant always
      // points at a template that already existed. The two sets were
      // disjoint by construction, and the sweep issued zero invitations on
      // every publication. #810's hardening of this loop was correct and
      // simply never had an iteration to run on.
      //
      // The cohort to invite is everyone still pending on an *earlier*
      // version of this same term: the immediate predecessor, plus any other
      // template sharing the version lineage, so someone enrolled on v1 who
      // never answered is still invited when v3 publishes.
      const lineageTemplateIds = new Set();
      if (previousPolicyId) {
        lineageTemplateIds.add(previousPolicyId);
      }
      // Guard: `find({ versionGroupId: undefined })` matches every document
      // missing the field, which would sweep unrelated participants. Older
      // templates predate versionGroupId, so this is reachable.
      if (versionGroupId) {
        const lineage = await templatesCollection
          .find(
            { versionGroupId, _id: { $ne: newTemplateId } },
            { projection: { _id: 1 } }
          )
          .toArray();
        for (const template of lineage) {
          lineageTemplateIds.add(String(template._id));
        }
      }

      // A brand-new term with no predecessor genuinely has no cohort --
      // nobody can be pending on a term that did not exist. Skip explicitly
      // rather than issuing a query that matches nothing by accident.
      const pendingPatients = lineageTemplateIds.size === 0
        ? []
        : await patientsCollection.find({
          status: 'PENDING_CONSENT',
          consentTemplateId: { $in: [...lineageTemplateIds] }
        }).toArray();
      const notificationService = require('./notification.service');
      const identityCollection = await getCollection(db, 'participantIdentities');
      consentNotifications.total = pendingPatients.length;
      for (const patient of pendingPatients) {
        // #810: this try is per patient, deliberately. It used to wrap the
        // whole loop, so the first participant who threw ended the entire
        // sweep -- everyone after them got no invitation and no
        // consentToken, while the publication still reported success. The
        // loop body has several reachable throws: enqueueConsentNotification
        // (queue unavailable, or sendConsentEmail's own
        // CONSENT_RECIPIENT_REQUIRED for a participant with no e-mail, which
        // in a bulk import cohort is not exotic), the identity lookup,
        // decryptIdentity on a malformed record, and the writes themselves.
        try {
          // RF005/RNF007 (#561/#564/#574): patientName resolved via
          // ParticipantIdentity instead of read directly off the Patient
          // document. decryptIdentity falls back to the ciphertext sibling
          // once the plaintext field is dropped (#566).
          const rawIdentity = await identityCollection.findOne({ participantId: patient.participantId });
          const identity = rawIdentity ? participantIdentityService.decryptIdentity(rawIdentity) : null;
          // #1166 slice 2: the contact comes from the same decrypted record.
          const patientWithIdentity = identity
            ? { ...participantIdentityService.withIdentityContact(patient, identity), patientName: identity.patientName }
            : patient;

          // Generate new consent token for each patient
          const consentMetadata = notificationService.buildConsentMetadata();
          const consentLink = notificationService.buildConsentLink(patientWithIdentity, consentMetadata.token);

          // #810: persist the token *before* attempting delivery. The link
          // being emailed is only usable if the database already holds the
          // token it carries, so this ordering makes the failure mode
          // "invitation not sent" rather than "invitation sent, token
          // missing" -- the latter is unrecoverable for the participant,
          // who holds a link that can never validate.
          await patientsCollection.updateOne(
            { _id: patient._id },
            {
              $set: {
                consentTokenHash: hashConsentToken(consentMetadata.token),
                consentTokenCreatedAt: consentMetadata.createdAt,
                consentTokenExpiresAt: consentMetadata.expiresAt,
                updatedAt: new Date()
              },
              // #1049: only the hash is stored; a legacy plaintext token on
              // this row is superseded by the new one and removed here.
              $unset: { consentToken: '' }
            }
          );

          await notificationService.enqueueConsentNotification(patientWithIdentity, consentLink);

          // Only now is the participant actually notified.
          await patientsCollection.updateOne(
            { _id: patient._id },
            { $set: { consentNotifiedAt: new Date(), updatedAt: new Date() } }
          );
          consentNotifications.notified += 1;
        } catch (patientError) {
          consentNotifications.failed += 1;
          logger.error(
            `Falha ao notificar o participante ${patient.participantId} sobre o novo TCLE:`,
            patientError.message
          );
        }
      }

      if (consentNotifications.failed > 0) {
        // #810: a partial sweep used to be silent. Whoever published the
        // term needs to know it did not reach everyone.
        logger.error(
          `Notificacao do novo TCLE parcial: ${consentNotifications.notified}/${consentNotifications.total} participantes notificados, ${consentNotifications.failed} falha(s).`
        );
      }
    } catch (notifyError) {
      // Still needed for a failure of the sweep's own setup (resolving the
      // collections, the find itself) -- not for a single patient.
      logger.error('Erro ao notificar pacientes do novo TCLE:', notifyError.message);
    }
    return consentNotifications;
  }

  /**
   * #1181: the policy route (POST/PUT /consent-policies) is a boundary over
   * the builder's write paths, not a second implementation. dict-07 row 39
   * makes ConsentPolicy and ConsentTemplate one entity, ConsentTemplate. The
   * route keeps its stricter input contract (a validity period, at least one
   * permission, the policy schema) and then publishes through createTemplate
   * or, for a revision, updateTemplate, so version numbering, deactivation
   * and the stored shape are the builder's.
   */
  async createPolicy(db, payload, options = {}) {
    try {
      const previousPolicyId = options?.previousPolicyId ? String(options.previousPolicyId).trim() : '';
      const explicitVersionGroupId = options?.versionGroupId ? String(options.versionGroupId).trim() : '';

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
      }

      // The version the write path will assign, so the policy schema's
      // required `version` is checked against the real one.
      const nextVersion = previousPolicy
        ? `v${Math.max(1, this.parseVersionNumber(previousPolicy.version) + 1)}`
        : await this.generateNextPolicyVersion(db, explicitVersionGroupId);

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
        // RNF018 (#1300): a validation failure answers 422; the caller's catch
        // keeps every other error on its own status.
        const validationError = new Error(validation.errors.join(', '));
        validationError.statusCode = 422;

        validationError.details = validation.errors;
        throw validationError;
      }

      const permissions = Array.isArray(normalizedPayload.granularPermissions)
        ? normalizedPayload.granularPermissions.map(permission => this.normalizePermission(permission))
        : [];
      this.ensureUniquePermissionKeys(permissions);

      // RF010 AC1: the same document control the builder's paths record.
      const documentControlErrors = ConsentTemplateModel.documentControlErrors(normalizedPayload);
      if (documentControlErrors.length > 0) {
        const validationError = new Error(documentControlErrors.join(', '));
        validationError.statusCode = 422;
        validationError.details = documentControlErrors;
        throw validationError;
      }

      const policy = ConsentPolicyModel.create({
        ...normalizedPayload,
        granularPermissions: permissions
      });

      // The builder's field names: `content`/`htmlContent` and `permissions`.
      // An empty CAAE is absent, as the template schema reads it.
      const { granularPermissions: _granular, version: _version, ...rest } = normalizedPayload;
      const termPayload = {
        ...rest,
        title: policy.title,
        content: policy.htmlContent,
        htmlContent: policy.htmlContent,
        caae: policy.caae || undefined,
        validFrom: policy.validFrom,
        validTo: policy.validTo,
        permissions
      };

      const term = previousPolicy
        ? await this.updateTemplate(db, previousPolicyId, termPayload)
        : await this.createTemplate(db, {
            ...termPayload,
            versionGroupId: explicitVersionGroupId || undefined
          });

      // The policy route's callers read `granularPermissions` (the audit
      // line in consent.controller), so the response keeps that alias.
      return {
        ...term,
        granularPermissions: term.permissions
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

  /**
   * #1181: the term a participant is asked to answer is the active term of
   * the lineage they were enrolled under (Patient.consentTemplateId's
   * versionGroupId), not the newest active term system-wide. With one active
   * term per lineage, the global pick would show a participant invited under
   * one term the text of another lineage published later.
   *
   * A participant with no resolvable lineage (no consentTemplateId, or a term
   * that predates versionGroupId), or whose lineage has no active term, gets
   * the newest active term, the behaviour before lineages were kept apart.
   */
  async getActiveTemplateForParticipant(db, participantId) {
    const patientsCollection = await getCollection(db, 'patients');
    const patient = participantId
      ? await patientsCollection.findOne(
        { participantId: String(participantId) },
        { projection: { consentTemplateId: 1 } }
      )
      : null;

    let enrolledTemplateId = null;
    try {
      enrolledTemplateId = patient?.consentTemplateId ? new ObjectId(String(patient.consentTemplateId)) : null;
    } catch {
      enrolledTemplateId = null;
    }

    if (enrolledTemplateId) {
      const templatesCollection = await getCollection(db, 'consentTemplates');
      const enrolledTemplate = await templatesCollection.findOne(
        { _id: enrolledTemplateId },
        { projection: { versionGroupId: 1 } }
      );
      if (enrolledTemplate?.versionGroupId) {
        const lineageActive = await templatesCollection
          .find({ versionGroupId: enrolledTemplate.versionGroupId, active: true })
          .sort({ createdAt: -1 })
          .limit(1)
          .toArray();
        if (lineageActive[0]) {
          return lineageActive[0];
        }
      }
    }

    return this.getActiveTemplate(db);
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
        // #1181: a builder-published term stores `permissions` only.
        { 'permissions.key': { $regex: regex } },
        { 'permissions.label': { $regex: regex } },
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

  /**
   * Who manifested a decision, and how (dict v2.0.0 V2E-0124..0127). A
   * caller that names none is a participant signing on paper with no
   * further authentication.
   */
  resolveDecisionActor(actor, participantId) {
    return {
      channel: actor?.channel || 'paper',
      signerRole: actor?.signerRole || 'participant',
      signerId: actor?.signerId ? String(actor.signerId) : String(participantId || ''),
      authenticationLevel: actor?.authenticationLevel || 'basic',
    };
  }

  async createPatientConsent(db, payload, actor = null) {
    try {
      // Suporte ao campo signatureBase64 vindo do frontend
      let patchedPayload = { ...payload };
      if (payload.signatureBase64 && !payload.signatureImageBase64) {
        patchedPayload.signatureImageBase64 = payload.signatureBase64;
      }

      const normalizedSignature = this.normalizeSignaturePayload(patchedPayload);
      // #820: normalizeSignaturePayload is the single source of truth for these
      // four fields, so drop the caller's raw copies before merging its result.
      // Spreading over them was enough while the normalizer always returned all
      // four; now that it omits them for a signature-less consent, a caller who
      // sent an explicit `signatureImageBase64: ''` would otherwise keep it and
      // hit the same minLength rejection the omission exists to avoid.
      const normalizedPayload = { ...patchedPayload };
      for (const field of SIGNATURE_FIELDS) {
        delete normalizedPayload[field];
      }
      Object.assign(normalizedPayload, normalizedSignature);
      if (!normalizedPayload.consentTemplateId && normalizedPayload.templateId) {
        normalizedPayload.consentTemplateId = String(normalizedPayload.templateId);
      }

      this.validatePatientConsentPayload(normalizedPayload);

      const validation = PatientConsentModel.validate(normalizedPayload);
      if (!validation.isValid) {
        const error = new Error(validation.errors.join(', '));
        error.statusCode = 422;
        throw error;
      }

      const participantId = normalizedPayload.participantId;
      const patientExists = await validateParticipantId(db, participantId);
      if (!patientExists) {
        throw new Error(`Paciente ${participantId} não encontrado`);
      }

      let consentTemplateId;
      try {
        consentTemplateId = new ObjectId(normalizedPayload.consentTemplateId);
      } catch (error) {
        throw new Error('consentTemplateId inválido');
      }

      const templatesCollection = await getCollection(db, 'consentTemplates');
      const template = await templatesCollection.findOne({ _id: consentTemplateId });
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

      // RF021 AC#4 (#593): studyId is optional — not every consent is tied
      // to a research study — but when provided, it must resolve to a real
      // Study, same referential-integrity pattern as
      // sample.service.js:187-192 for Sample.studyId.
      if (normalizedPayload.studyId !== undefined && normalizedPayload.studyId !== null && normalizedPayload.studyId !== '') {
        const study = await db.collection('studies').findOne({ studyId: String(normalizedPayload.studyId) });
        if (!study) {
          throw new Error(`studyId ${normalizedPayload.studyId} não encontrado`);
        }
        // RF021 AC#5 (#596): same status gate #591 added for Sample.studyId
        // — a consent can't be linked to a study that isn't active.
        if (study.studyStatus !== 'active') {
          const error = new Error(`Estudo ${normalizedPayload.studyId} não está ativo (status: ${study.studyStatus})`);
          error.statusCode = 422;
          throw error;
        }
      }

      const consentsCollection = await getCollection(db, 'consents');
      // RF010 AC5: the participant's consents still in force are superseded
      // by this one through their history, after it is written, never by
      // overwriting their status.
      const supersededConsents = await consentsCollection.find({ participantId, status: 'ACTIVE' }).toArray();

      // Logar apenas o tamanho da assinatura, se existir
      if (normalizedPayload.signatureImageBase64) {
        logger.info(
          `Assinatura recebida para paciente ${participantId}: tamanho ${normalizedPayload.signatureImageBase64.length} caracteres.`
        );
      }

      // #827: RF010 AC#3/AC#4 -- the exact term version and the stored
      // evidence of this manifestation (dict-02 ELM-0091/0105/0106,
      // P1X-0373), written before the insert so a keyless deployment
      // refuses rather than recording a consent with no evidence.
      const consentId = crypto.randomUUID();
      const signedAt = new Date();
      const evidence = consentEvidence.storeConsentEvidence({
        consentId,
        participantId,
        template,
        responses: normalizedPayload.responses || {},
        decisionDateTime: signedAt,
        signatureHash: normalizedPayload.signatureHash || null,
        signatureImageBase64: normalizedPayload.signatureImageBase64 || null,
        collectionPlace: typeof normalizedPayload.collectionPlace === 'string'
          ? normalizedPayload.collectionPlace.trim()
          : null,
        ipAddress: normalizedPayload.ipAddress,
        userAgent: normalizedPayload.userAgent
      });

      const consent = PatientConsentModel.create({
        ...normalizedPayload,
        consentId,
        signedAt,
        consentTemplateId: consentTemplateId.toString(),
        consentVersion: template.version != null ? String(template.version) : null,
        // RF010 AC1/ELM-0095: the modality of the term signed, as it offers it.
        consentModel: template.consentModel || null,
        ...evidence,
        status: 'ACTIVE'
      });
      if (supersededConsents.length > 0) {
        consent.supersedesConsentId = consentHistory.consentKeyOf(supersededConsents[0]);
      }

      // RF010 AC3: one computable ConsentPermission per answered permission.
      const permissionRows = ConsentPermissionModel.fromAnswers({
        consentId,
        participantId,
        responses: consent.responses,
        template,
        signedAt,
      });
      const decisionActor = this.resolveDecisionActor(actor, participantId);
      const permissionsCollection = permissionRows.length > 0
        ? await getCollection(db, 'consentPermissions')
        : null;
      // #1313 (RF023 AC3): the consent, its permissions, its decision events
      // and its outbox event commit together, or none of them does.
      const recorded = await withTransactionWhereSupported(db, async (session) => {
        const sessionArg = session ? [{ session }] : [];
        const insertResult = await consentsCollection.insertOne(consent, ...sessionArg);
        if (permissionsCollection) {
          await permissionsCollection.insertMany(permissionRows, ...sessionArg);
        }
        const accepted = await consentHistory.recordAcceptance(
          db, { _id: insertResult.insertedId, ...consent }, decisionActor, session
        );
        for (const prior of supersededConsents) {
          await consentHistory.recordSupersession(db, prior, consent, decisionActor, session);
        }
        await this.recordConsentProjectionEvent(db, {
          participantId,
          consentId: insertResult.insertedId.toString(),
          status: 'ACTIVE',
          signedAt: consent.signedAt || new Date(),
        }, session);

        return accepted;
      });

      if (normalizedPayload.signatureImageBase64) {
        try {
          await consentPanel.issueInPersonPanelLink(db, participantId, template, recorded);
        } catch (linkError) {
          logger.error('Erro ao gravar o link do painel do TCLE:', linkError.message);
        }
      }
      return recorded;
    } catch (error) {
      logger.error('Erro ao criar consentimento do paciente:', error.message);
      throw error;
    }
  }

  /**
   * RF010 AC6: revoke `request.scope` (default: every use) of a consent from
   * now on, as a ConsentRevocation and its decision event. A scope naming
   * some permissions narrows what the consent permits and leaves it in
   * force; one blocking every use revokes it. A request that blocks nothing
   * still permitted returns the consent unchanged.
   */
  async revokeConsent(db, consentId, request = {}, actor = null) {
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

    // #1313 (RF023 AC3): the revocation, its decision event and, when it
    // revokes the consent, its outbox event commit together.
    const recorded = await withTransactionWhereSupported(db, async (session) => {
      const revocation = await consentHistory.recordRevocation(
        db, consent, request, this.resolveDecisionActor(actor, consent.participantId), session
      );
      if (revocation && revocation.consent.status === 'REVOKED') {
        await this.recordConsentProjectionEvent(db, {
          participantId: consent.participantId || null,
          consentId: objectId.toString(),
          status: 'REVOKED',
          signedAt: consent.signedAt || consent.createdAt || new Date(),
        }, session);
      }
      return revocation;
    });
    if (!recorded) {
      return consent;
    }
    if (recorded.consent.status !== 'REVOKED') {
      // A partial revocation leaves the consent in force: neither the staff
      // alert nor the holder's revocation confirmation below is sent for it.
      return recorded.consent;
    }

    // #650 (RF015, consentimento domain) - fire-and-forget, same shape as
    // auth.service.js's mfa_brute_force_lockout call: a missing/
    // misconfigured NotificationRule must never block or delay the
    // revocation itself. #685: explicit .catch() -- this repo has no
    // global unhandledRejection handler, so a bare `void` here would
    // crash the process on a transient notification-engine failure.
    void notificationDispatchService.dispatchNotification(db, {
      eventType: 'consent_revoked',
      sourceEventType: 'PatientConsent',
      sourceEventId: objectId,
      // RF015 AC5 (#903): linked to its purpose and to the consent revoked.
      purpose: 'consent_revocation',
      consentId: objectId.toString(),
      payload: {
        participantId: consent.participantId || null,
        consentId: objectId.toString()
      }
    }).catch((dispatchError) => {
      logger.error('[NOTIFICATION_DISPATCH] Falha ao disparar notificação de revogação de consentimento:', dispatchError.message || dispatchError);
    });

    // RF010 AC8 (LGPD art. 8 §5, art. 18 IX): the holder is told the consent
    // was revoked, from when, and its prospective effect, recorded as a
    // ConsentCommunicationEvent. The revocation is already committed; this
    // never throws, and a failed send is recorded `failed` without undoing it.
    // A term that reached validTo uses the closure notice instead, once.
    const decisionActor = this.resolveDecisionActor(actor, consent.participantId);
    if (decisionActor.channel === 'term_expiry') {
      await consentCommunication.notifyTermExpiry(db, {
        consent: recorded.consent,
        validTo: request.validTo,
      });
    } else {
      await consentCommunication.confirmRevocationToHolder(db, {
        consent: recorded.consent,
        revocation: recorded.revocation,
      });
    }

    return recorded.consent;
  }

  /** RF010 AC5: a consent's derived state with the history it derives from. */
  async findConsentById(db, consentId) {
    let objectId;
    try {
      objectId = new ObjectId(consentId);
    } catch (error) {
      const invalid = new Error('ID de consentimento inválido');
      invalid.statusCode = 400;
      throw invalid;
    }
    return (await getCollection(db, 'consents')).findOne({ _id: objectId });
  }

  async getConsentHistory(db, consentId) {
    const found = await this.findConsentById(db, consentId);
    if (!found) {
      return null;
    }
    if (found.participantId) {
      await this.expireDueConsents(db, { participantId: found.participantId });
    }
    const consent = (await this.findConsentById(db, consentId)) || found;
    const { events, revocations } = await consentHistory.getHistory(db, consent);
    const permissions = await (await getCollection(db, 'consentPermissions'))
      .find({ consentId: consentHistory.consentKeyOf(consent) }).toArray();
    const channelByEvent = new Map(events.map((event) => [event.consentDecisionEventId, event.channel]));
    let communications = [];
    try {
      communications = await (await getCollection(db, 'consentCommunicationEvents'))
        .find({ consentId: consentHistory.consentKeyOf(consent) })
        .sort({ sentAt: 1 })
        .toArray();
    } catch (error) {
      logger.error('Erro ao ler comunicações do consentimento:', error.message);
    }
    return {
      consentId: consentHistory.consentKeyOf(consent),
      permissions,
      participantId: consent.participantId || null,
      currentStateDerived: consentHistory.deriveConsentState(consent, events, revocations).currentStateDerived,
      supersededByConsentId: consent.supersededByConsentId || null,
      supersedesConsentId: consent.supersedesConsentId || null,
      decisionEvents: events,
      revocations: revocations.map((revocation) => ({
        ...revocation,
        channel: channelByEvent.get(revocation.decisionEventId) || null,
        location: revocation.location || { status: 'unavailable' },
      })),
      communications: communications.map((event) => ({
        consentCommunicationEventId: event.consentCommunicationEventId,
        participantId: event.participantId || consent.participantId || null,
        communicationType: event.communicationType,
        contentTemplateId: event.contentTemplateId,
        purpose: event.purpose || null,
        deliveryStatus: event.deliveryStatus,
        sentAt: event.sentAt,
      })),
    };
  }

  /**
   * Close every in-force consent whose term validTo has passed. A term
   * without validTo is left alone. The holder is told once, and specimens
   * follow the same quarantine as a full revocation.
   */
  async expireDueConsents(db, filter = {}) {
    const closed = { closed: 0 };
    try {
      const consentsCollection = await getCollection(db, 'consents');
      const query = { status: 'ACTIVE' };
      if (filter.participantId) query.participantId = filter.participantId;
      const rows = await consentsCollection.find(query).toArray();
      const templatesCollection = await getCollection(db, 'consentTemplates');
      const now = Date.now();
      const consentQuarantineService = require('./consentQuarantine.service');
      for (const consent of rows) {
        const template = await this.findTemplateById(templatesCollection, consent.consentTemplateId);
        if (!template || template.validTo == null || template.validTo === '') continue;
        const validTo = new Date(template.validTo);
        if (Number.isNaN(validTo.getTime()) || validTo.getTime() > now) continue;
        const updated = await this.revokeConsent(db, String(consent._id), {
          reason: 'Vencimento do termo',
          validTo,
          location: { status: 'unavailable' },
        }, {
          channel: 'term_expiry',
          signerRole: 'staff_on_behalf',
          signerId: 'system',
          authenticationLevel: 'basic',
        });
        if (!updated || updated.status !== 'REVOKED') continue;
        closed.closed += 1;
        try {
          await consentQuarantineService.quarantineForRevocation(db, consent.participantId);
        } catch (quarantineError) {
          logger.error('Erro ao quarentenar amostras no vencimento do TCLE:', quarantineError.message);
        }
      }
    } catch (error) {
      logger.error('Erro ao encerrar consentimentos vencidos:', error.message);
    }
    return closed;
  }

  async findTemplateById(templatesCollection, templateId) {
    if (templateId == null || templateId === '') return null;
    const direct = await templatesCollection.findOne({ _id: templateId });
    if (direct) return direct;
    try {
      return await templatesCollection.findOne({ _id: new ObjectId(String(templateId)) });
    } catch (error) {
      return null;
    }
  }

  async getPatientConsent(db, participantId) {
    await this.expireDueConsents(db, { participantId });
    const consentsCollection = await getCollection(db, 'consents');
    const consent = await consentsCollection
      .find({ participantId })
      .sort({ signedAt: -1, createdAt: -1 })
      .limit(1)
      .toArray();

    return consent[0] || null;
  }

  async recordConsentProjectionEvent(db, { participantId, consentId, status, signedAt }, session = null) {
    if (!db) return null;
    return this.graphProjectionService.appendConsentEvent(db, {
      participantId,
      specimenId: null,
      ethicalConsentId: consentId,
      status,
      signedAt,
      sourceService: 'consent.service'
    }, { session });
  }
}

module.exports = new ConsentService();



