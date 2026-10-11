/**
 * ConsentCommunicationEvent (RF010 AC8, RF015 AC5; dict v2.0.0
 * V2E-0151..0158): one communication sent to the holder of a Consent, linked
 * to that consent, to its purpose and to the event that caused it. It is
 * written before the send, as `queued`, and given its outcome after it
 * (`delivered` or `failed`), so a process that dies mid-send still leaves
 * the attempt.
 */
const crypto = require('crypto');
const { isNonEmptyString } = require('./ConsentDecisionEvent');

// The dictionary marks each vocabulary "internal governed" and names one
// value or example per field: V2E-0153 `notice`/`policy_change_notice`,
// V2E-0154 `email`/`portal`, V2E-0156 `queued`/`delivered`. `failed` is the
// outcome of a send the channel refused.
const COMMUNICATION_TYPES = ['notice', 'policy_change_notice'];
const CHANNELS = ['email', 'portal'];
const DELIVERY_STATUSES = ['queued', 'delivered', 'failed'];

const isDate = (value) => value instanceof Date && !Number.isNaN(value.getTime());

class ConsentCommunicationEventModel {
  /** The canonical element names, for the catalog conformance test. */
  static fieldsOf(data = {}) {
    return {
      consentCommunicationEventId: data.consentCommunicationEventId,
      consentId: data.consentId,
      communicationType: data.communicationType,
      channel: data.channel,
      sentAt: data.sentAt,
      deliveryStatus: data.deliveryStatus,
      contentTemplateId: data.contentTemplateId,
      evidenceUri: data.evidenceUri,
    };
  }

  static validate(data = {}) {
    const errors = [];
    if (!isNonEmptyString(data.consentId)) errors.push('consentId é obrigatório');
    if (!COMMUNICATION_TYPES.includes(data.communicationType)) {
      errors.push(`communicationType deve ser um de: ${COMMUNICATION_TYPES.join(', ')}`);
    }
    if (!CHANNELS.includes(data.channel)) {
      errors.push(`channel deve ser um de: ${CHANNELS.join(', ')}`);
    }
    if (data.deliveryStatus !== undefined && !DELIVERY_STATUSES.includes(data.deliveryStatus)) {
      errors.push(`deliveryStatus deve ser um de: ${DELIVERY_STATUSES.join(', ')}`);
    }
    if (!isNonEmptyString(data.contentTemplateId)) errors.push('contentTemplateId é obrigatório');
    if (data.evidenceUri !== undefined && data.evidenceUri !== null && !isNonEmptyString(data.evidenceUri)) {
      errors.push('evidenceUri deve ser uma URI');
    }
    return { isValid: errors.length === 0, errors };
  }

  /**
   * The event as written before the send. `sentAt` (1..1) is the instant
   * the send is issued; the outcome update replaces it with the instant the
   * channel answered.
   */
  static create(data = {}) {
    return {
      consentCommunicationEventId: data.consentCommunicationEventId || crypto.randomUUID(),
      consentId: data.consentId,
      participantId: data.participantId ?? null,
      communicationType: data.communicationType,
      channel: data.channel,
      sentAt: isDate(data.sentAt) ? data.sentAt : new Date(),
      deliveryStatus: data.deliveryStatus || 'queued',
      contentTemplateId: data.contentTemplateId,
      evidenceUri: isNonEmptyString(data.evidenceUri) ? data.evidenceUri : null,
      // RF015 AC5: the purpose of the communication and the event that caused it.
      purpose: data.purpose ?? null,
      sourceEventType: data.sourceEventType ?? null,
      sourceEventId: data.sourceEventId ?? null,
      failureReason: null,
      recordedAt: new Date(),
    };
  }
}

module.exports = ConsentCommunicationEventModel;
module.exports.COMMUNICATION_TYPES = COMMUNICATION_TYPES;
module.exports.CHANNELS = CHANNELS;
module.exports.DELIVERY_STATUSES = DELIVERY_STATUSES;
