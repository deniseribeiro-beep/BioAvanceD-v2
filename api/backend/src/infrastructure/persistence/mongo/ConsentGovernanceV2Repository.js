const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { getCollection } = require('../../../utils/collectionResolver');
const { GraphProjectionService } = require('../../../services/graphProjection.service');

const AUTHORIZATION_DECISIONS = new Set(['permit', 'deny', 'review_required']);

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeDate(value, fallback = null) {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

class ConsentGovernanceV2Repository {
  constructor(db, options = {}) {
    if (!db || typeof db.collection !== 'function') {
      throw new Error('[CONSENT_V2] MongoDB obrigatório');
    }
    this.db = db;
    this.graphProjectionService = options.graphProjectionService || new GraphProjectionService();
  }

  collection(key) {
    return getCollection(this.db, key);
  }

  async ensureIndexes() {
    const definitions = [
      ['consents', { consentId: 1 }, { unique: true, name: 'ux_consent_id' }],
      ['consents', { participantId: 1, createdAt: -1 }, { name: 'ix_consent_participant_created' }],
      ['consentPermissions', { consentPermissionId: 1 }, { unique: true, name: 'ux_consent_permission_id' }],
      ['consentPermissions', { consentId: 1, permissionCode: 1 }, { name: 'ix_permission_consent_code' }],
      ['consentDecisionEvents', { consentDecisionEventId: 1 }, { unique: true, name: 'ux_consent_decision_event_id' }],
      ['consentRevocations', { consentRevocationId: 1 }, { unique: true, name: 'ux_consent_revocation_id' }],
      ['consentRevocations', { consentId: 1, effectiveAt: -1 }, { name: 'ix_consent_revocation_consent' }],
      ['consentAuthorizationDecisions', { consentAuthorizationDecisionId: 1 }, { unique: true, name: 'ux_consent_auth_decision_id' }],
      ['consentCommunicationEvents', { consentCommunicationEventId: 1 }, { unique: true, name: 'ux_consent_communication_event_id' }]
    ];

    for (const [key, spec, options] of definitions) {
      const collection = this.collection(key);
      if (typeof collection.createIndex === 'function') {
        await collection.createIndex(spec, options);
      }
    }
  }

  toObjectId(value) {
    if (value instanceof ObjectId) return value;
    return typeof value === 'string' && ObjectId.isValid(value) ? new ObjectId(value) : null;
  }

  consentIdFilter(consentId) {
    const normalized = normalizeText(consentId);
    const objectId = this.toObjectId(normalized);
    return objectId
      ? { $or: [{ consentId: normalized }, { _id: objectId }] }
      : { consentId: normalized };
  }

  normalizePermissionDecision(value) {
    if (typeof value === 'boolean') return value ? 'permit' : 'deny';
    const normalized = normalizeText(value).toLowerCase();
    if (AUTHORIZATION_DECISIONS.has(normalized)) return normalized;
    return 'review_required';
  }

  buildPermissionDocuments({ consentId, template, responses, createdAt }) {
    const templatePermissions = Array.isArray(template?.permissions)
      ? template.permissions
      : Array.isArray(template?.granularPermissions)
        ? template.granularPermissions
        : [];

    return templatePermissions.map((permission) => {
      const permissionCode = normalizeText(permission.permissionCode || permission.key);
      const responseValue = responses?.[permissionCode];
      const decision = this.normalizePermissionDecision(responseValue);
      const purpose = permission.purpose && typeof permission.purpose === 'object'
        ? permission.purpose
        : { code: normalizeText(permission.purposeCode || permissionCode) || 'unspecified' };

      return {
        consentPermissionId: `consent-permission:${crypto.randomUUID()}`,
        consentId,
        permissionCode,
        purpose,
        decision,
        policyVersion: normalizeText(template.version || template.templateVersion || '1.0.0'),
        required: Boolean(permission.required),
        createdAt,
        updatedAt: createdAt
      };
    }).filter((permission) => permission.permissionCode);
  }

  async createConsent(input, session) {
    if (!session) {
      throw new Error('[CONSENT_V2] Consentimento, permissões, eventos e outbox devem compartilhar a transação MongoDB');
    }

    const participantId = normalizeText(input.participantId);
    if (!participantId) throw new Error('[CONSENT_V2] participantId obrigatório');
    if (!input.template) throw new Error('[CONSENT_V2] ConsentTemplate obrigatório');

    await this.ensureIndexes();

    const now = normalizeDate(input.signedAt, new Date());
    const consentId = normalizeText(input.consentId) || `consent:${crypto.randomUUID()}`;
    const templateVersionId = normalizeText(input.templateVersionId || input.template._id || input.template.version);
    const consentModel = normalizeText(input.consentModel || input.template.consentModel || 'specific').toLowerCase();
    const effectiveEnd = normalizeDate(input.effectiveEnd || input.template.validTo, null);

    const previous = await this.findActiveConsent(participantId, session, now);
    if (previous) {
      await this.revokeConsent(previous.consentId, {
        reasonCode: 'superseded_by_new_consent',
        effectiveAt: now,
        actorId: input.actorId || null,
        communicationRequired: false
      }, session);
    }

    const consent = {
      consentId,
      participantId,
      consentModel,
      templateVersionId,
      currentStateDerived: 'active',
      effectivePeriod: {
        start: now,
        end: effectiveEnd
      },
      studyId: normalizeText(input.studyId) || null,
      signerDisplayName: normalizeText(input.signatureName) || null,
      signatureHash: normalizeText(input.signatureHash) || null,
      signatureMimeType: normalizeText(input.signatureMimeType) || null,
      signatureImageBase64: normalizeText(input.signatureImageBase64) || null,
      createdAt: now,
      updatedAt: now
    };

    const consents = this.collection('consents');
    await consents.insertOne(consent, { session });

    const permissionDocs = this.buildPermissionDocuments({
      consentId,
      template: input.template,
      responses: input.responses || {},
      createdAt: now
    });
    if (permissionDocs.length) {
      await this.collection('consentPermissions').insertMany(permissionDocs, { session });
    }

    const decisionEvents = permissionDocs.map((permission) => ({
      consentDecisionEventId: `consent-decision:${crypto.randomUUID()}`,
      consentId,
      consentPermissionId: permission.consentPermissionId,
      permissionCode: permission.permissionCode,
      purpose: permission.purpose,
      decision: permission.decision,
      eventType: 'permission_decided',
      actorId: input.actorId || null,
      occurredAt: now,
      createdAt: now
    }));
    if (decisionEvents.length) {
      await this.collection('consentDecisionEvents').insertMany(decisionEvents, { session });
    }

    await this.graphProjectionService.appendConsentEvent(this.db, {
      participantId,
      ethicalConsentId: consentId,
      consentTemplateId: templateVersionId,
      status: 'ACTIVE',
      signedAt: now,
      sourceService: 'consent-governance-v2'
    }, { session });

    return { ...consent, permissions: permissionDocs };
  }

  async getConsentById(consentId, session) {
    const normalized = normalizeText(consentId);
    if (!normalized) return null;
    return this.collection('consents').findOne(this.consentIdFilter(normalized), { session });
  }

  async findActiveConsent(participantId, session, at = new Date()) {
    const normalizedParticipantId = normalizeText(participantId);
    if (!normalizedParticipantId) return null;

    const rows = await this.collection('consents').find({
      participantId: normalizedParticipantId,
      currentStateDerived: 'active',
      'effectivePeriod.start': { $lte: at },
      $or: [
        { 'effectivePeriod.end': null },
        { 'effectivePeriod.end': { $gte: at } }
      ]
    }, { session }).sort({ createdAt: -1 }).limit(5).toArray();

    for (const consent of rows) {
      const revoked = await this.collection('consentRevocations').findOne({
        consentId: consent.consentId,
        effectiveAt: { $lte: at }
      }, { session });
      if (!revoked) return consent;
    }
    return null;
  }

  async revokeConsent(consentId, input = {}, session) {
    if (!session) {
      throw new Error('[CONSENT_V2] Revogação e outbox devem compartilhar a transação MongoDB');
    }

    const consent = await this.getConsentById(consentId, session);
    if (!consent) return null;

    const effectiveAt = normalizeDate(input.effectiveAt, new Date());
    const existingRevocation = await this.collection('consentRevocations').findOne({
      consentId: consent.consentId,
      effectiveAt: { $lte: effectiveAt }
    }, { session });
    if (existingRevocation) {
      return { consent, revocation: existingRevocation, alreadyRevoked: true };
    }

    const revocation = {
      consentRevocationId: `consent-revocation:${crypto.randomUUID()}`,
      consentId: consent.consentId,
      participantId: consent.participantId,
      reasonCode: normalizeText(input.reasonCode || 'participant_request'),
      actorId: input.actorId || null,
      effectiveAt,
      createdAt: new Date()
    };
    await this.collection('consentRevocations').insertOne(revocation, { session });

    await this.collection('consents').updateOne(
      { consentId: consent.consentId },
      { $set: { currentStateDerived: 'revoked', updatedAt: new Date() } },
      { session }
    );

    await this.collection('consentDecisionEvents').insertOne({
      consentDecisionEventId: `consent-decision:${crypto.randomUUID()}`,
      consentId: consent.consentId,
      eventType: 'consent_revoked',
      decision: 'deny',
      actorId: input.actorId || null,
      reasonCode: revocation.reasonCode,
      occurredAt: effectiveAt,
      createdAt: new Date()
    }, { session });

    if (input.communicationRequired !== false) {
      await this.collection('consentCommunicationEvents').insertOne({
        consentCommunicationEventId: `consent-communication:${crypto.randomUUID()}`,
        consentId: consent.consentId,
        participantId: consent.participantId,
        communicationType: 'revocation_recorded',
        status: 'pending',
        occurredAt: effectiveAt,
        createdAt: new Date()
      }, { session });
    }

    await this.graphProjectionService.appendConsentEvent(this.db, {
      participantId: consent.participantId,
      ethicalConsentId: consent.consentId,
      consentTemplateId: consent.templateVersionId || null,
      status: 'REVOKED',
      signedAt: consent.effectivePeriod?.start || consent.createdAt,
      revokedAt: effectiveAt,
      sourceService: 'consent-governance-v2'
    }, { session });

    return { consent: { ...consent, currentStateDerived: 'revoked' }, revocation, alreadyRevoked: false };
  }

  async authorize(input, session) {
    const participantId = normalizeText(input?.participantId);
    const permissionCode = normalizeText(input?.permissionCode);
    const purposeCode = normalizeText(input?.purposeCode);
    const evaluatedAt = normalizeDate(input?.evaluatedAt, new Date());

    let decision = 'review_required';
    let consent = null;
    let permission = null;
    let reasonCode = 'no_active_consent';

    if (participantId) {
      consent = await this.findActiveConsent(participantId, session, evaluatedAt);
    }

    if (consent && permissionCode) {
      const filter = { consentId: consent.consentId, permissionCode };
      if (purposeCode) filter['purpose.code'] = purposeCode;
      permission = await this.collection('consentPermissions').findOne(filter, { session });
      if (!permission && purposeCode) {
        permission = await this.collection('consentPermissions').findOne({
          consentId: consent.consentId,
          permissionCode
        }, { session });
      }

      if (permission) {
        decision = this.normalizePermissionDecision(permission.decision);
        reasonCode = `permission_${decision}`;
      } else {
        reasonCode = 'permission_not_declared';
      }
    } else if (consent && !permissionCode) {
      decision = 'permit';
      reasonCode = 'active_consent_exists';
    }

    const authorizationDecision = {
      consentAuthorizationDecisionId: `consent-authorization:${crypto.randomUUID()}`,
      participantId: participantId || null,
      consentId: consent?.consentId || null,
      consentPermissionId: permission?.consentPermissionId || null,
      permissionCode: permissionCode || null,
      purposeCode: purposeCode || null,
      decision,
      reasonCode,
      evaluatedAt,
      createdAt: new Date()
    };

    const collection = this.collection('consentAuthorizationDecisions');
    await collection.insertOne(authorizationDecision, session ? { session } : {});
    return authorizationDecision;
  }

  async listPermissions(consentId, session) {
    return this.collection('consentPermissions')
      .find({ consentId: normalizeText(consentId) }, { session })
      .sort({ createdAt: 1 })
      .toArray();
  }

  async getLegacyViewForParticipant(participantId, session) {
    const consent = await this.findActiveConsent(participantId, session);
    if (!consent) {
      const latest = await this.collection('consents')
        .find({ participantId: normalizeText(participantId) }, { session })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();
      if (!latest[0]) return null;
      return this.toLegacyView(latest[0], await this.listPermissions(latest[0].consentId, session));
    }
    return this.toLegacyView(consent, await this.listPermissions(consent.consentId, session));
  }

  toLegacyView(consent, permissions = []) {
    if (!consent) return null;
    const responses = {};
    for (const permission of permissions) {
      responses[permission.permissionCode] = permission.decision === 'permit';
    }
    return {
      _id: consent._id,
      consentId: consent.consentId,
      participantId: consent.participantId,
      consentTemplateId: consent.templateVersionId,
      status: consent.currentStateDerived === 'revoked' ? 'REVOKED' : 'ACTIVE',
      responses,
      signatureName: consent.signerDisplayName || undefined,
      signatureHash: consent.signatureHash || undefined,
      signatureMimeType: consent.signatureMimeType || undefined,
      signatureImageBase64: consent.signatureImageBase64 || undefined,
      studyId: consent.studyId || undefined,
      signedAt: consent.effectivePeriod?.start || consent.createdAt,
      revokedAt: consent.currentStateDerived === 'revoked' ? consent.updatedAt : undefined,
      createdAt: consent.createdAt,
      updatedAt: consent.updatedAt
    };
  }
}

module.exports = ConsentGovernanceV2Repository;
