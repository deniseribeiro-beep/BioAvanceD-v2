/**
 * Motor de notificação orientado a regra (RF015, RNF026). Cada chamada a
 * dispatchNotification() resolve a NotificationRule ativa para o eventType
 * informado (AC#1), envia pelos canais habilitados registrando cada
 * tentativa (AC#2/#3), escalona quando a regra define e o canal primário
 * falha (AC#4), filtra o payload pela allowlist da regra antes de montar a
 * mensagem (AC#5), grava a ligação com o evento originador (AC#6) e mede a
 * duração de entrega contra maxDeliveryMinutes (AC#7/RNF026 AC#1).
 *
 * Canal 'email' usa NotificationService.js#sendEmail (Resend) -- no
 * ambiente de teste (compose.test.yml) a chave é um valor fictício
 * (vitest-resend-api-key), então esse canal falha de verdade lá, o que é
 * usado deliberadamente para provar o caminho de escalonamento com uma
 * falha real, não simulada. Canal 'in_app' não depende de nenhum serviço
 * externo -- persistir o documento de notificação já é a entrega.
 */
const { ObjectId } = require('mongodb');
const notificationRuleService = require('./notificationRule.service');
const { findUserAccountIdsByRoleCodes } = require('./rbac-assignment.service');
const notificationServiceV2 = require('./NotificationService');
const { getCollection } = require('../utils/collectionResolver');
const logger = require('../utils/logger');
const { getCanonicalCollectionName } = require('../config/canonicalEntityCollections.v2');

async function resolveRecipientEmails(db, rule) {
  if (!rule.recipientRoleCodes?.length) return [];
  const userIds = await findUserAccountIdsByRoleCodes(db, rule.recipientRoleCodes);
  if (!userIds.length) return [];
  // RBAC retorna o UUID canônico da conta; _id permanece físico no MongoDB.
  const usersCollection = db.collection(getCanonicalCollectionName('UserAccount'));
  const docs = await usersCollection
    .aggregate([
      { $match: { userAccountId: { $in: userIds } } },
      { $project: { email: 1 } }
    ])
    .toArray();
  return docs.map((doc) => doc.email).filter(Boolean);
}

// AC#5 - only fields the rule explicitly allows leave the engine; everything
// else in the source payload (which may carry participant/sample identifiers
// the rule's author never reviewed) is dropped before it reaches a message
// or gets persisted.
function sanitizePayload(payload, allowlist) {
  const sanitized = {};
  for (const key of allowlist || []) {
    if (payload && Object.prototype.hasOwnProperty.call(payload, key)) {
      sanitized[key] = payload[key];
    }
  }
  return sanitized;
}

async function sendViaChannel(channel, { recipients, subject, message }) {
  if (channel === 'email') {
    if (!recipients.length) {
      return { channel, success: false, reason: 'no_recipients' };
    }
    try {
      await notificationServiceV2.sendEmail({
        to: recipients.join(','),
        subject,
        html: `<p>${message}</p>`,
        text: message,
        notificationType: 'rule_notification'
      });
      return { channel, success: true };
    } catch (error) {
      return { channel, success: false, reason: error.message };
    }
  }

  if (channel === 'in_app') {
    // v1 scope: in_app persistence is broadcast (visible to anyone querying
    // GET /api/notifications), not yet targeted per recipient -- a real
    // per-user inbox is a follow-up, not something this slice claims.
    return { channel, success: true };
  }

  return { channel, success: false, reason: `unsupported_channel:${channel}` };
}

async function dispatchNotification(db, { eventType, sourceEventType, sourceEventId, payload = {} }) {
  const rule = await notificationRuleService.getActiveRuleForEventType(db, eventType);
  if (!rule) {
    logger.info(`[NOTIFICATION_DISPATCH] Nenhuma regra ativa para eventType=${eventType} -- notificação não gerada.`);
    return null;
  }

  const createdAt = new Date();
  const sanitizedPayload = sanitizePayload(payload, rule.sensitiveFieldsAllowlist);
  const recipients = await resolveRecipientEmails(db, rule);
  const subject = `[BioAvanceD] Alerta: ${eventType}`;
  const message = `Evento ${eventType} detectado. Detalhes: ${JSON.stringify(sanitizedPayload)}`;

  const attempts = [];
  let delivered = false;
  let deliveredChannel = null;

  for (const channel of rule.channels) {
    const attemptTime = new Date();
    const result = await sendViaChannel(channel, { recipients, subject, message });
    attempts.push({
      channel,
      timestamp: attemptTime,
      result: result.success ? 'success' : 'failure',
      reason: result.reason || null,
      escalation: false
    });
    if (result.success) {
      delivered = true;
      deliveredChannel = channel;
      break;
    }
  }

  let escalated = false;
  if (!delivered && rule.escalation?.enabled) {
    const failedAttempts = attempts.filter((attempt) => attempt.result === 'failure').length;
    if (failedAttempts >= rule.escalation.afterFailures) {
      escalated = true;
      const escalationTime = new Date();
      const escalationResult = await sendViaChannel(rule.escalation.channel, {
        recipients,
        subject: `[ESCALADO] ${subject}`,
        message
      });
      attempts.push({
        channel: rule.escalation.channel,
        timestamp: escalationTime,
        result: escalationResult.success ? 'success' : 'failure',
        reason: escalationResult.reason || null,
        escalation: true
      });
      if (escalationResult.success) {
        delivered = true;
        deliveredChannel = rule.escalation.channel;
      }
    }
  }

  const deliveredAt = delivered ? new Date() : null;
  const deliveryDurationMs = deliveredAt ? deliveredAt.getTime() - createdAt.getTime() : null;

  const notificationsCollection = await getCollection(db, 'notifications');
  const document = {
    ruleId: rule._id,
    ruleVersion: rule.version,
    eventType,
    sourceEventType: sourceEventType || eventType,
    sourceEventId: sourceEventId ? String(sourceEventId) : null,
    payload: sanitizedPayload,
    recipients,
    attempts,
    status: delivered ? 'delivered' : (escalated ? 'escalated_failed' : 'failed'),
    escalated,
    deliveredChannel,
    createdAt,
    deliveredAt,
    confirmedAt: null,
    deliveryDurationMs,
    maxDeliveryMinutes: rule.maxDeliveryMinutes,
    // RNF026 AC#1 - measurable against the rule's own SLA; null while
    // undelivered rather than false, since "not yet delivered" and
    // "delivered late" are different states.
    withinSla: deliveredAt ? deliveryDurationMs <= rule.maxDeliveryMinutes * 60000 : null
  };

  const result = await notificationsCollection.insertOne(document);
  return { _id: result.insertedId, ...document };
}

// AC#3 "confirmação" - an explicit read receipt, distinct from delivered
// (delivered = the engine got it to a channel; confirmed = a human
// acknowledged it). v1: not yet scoped per-recipient, same limitation
// sendViaChannel's in_app branch documents.
async function confirmNotification(db, notificationId) {
  const notificationsCollection = await getCollection(db, 'notifications');
  let objectId;
  try {
    objectId = new ObjectId(String(notificationId || '').trim());
  } catch {
    throw new Error('ID de notificação inválido');
  }
  await notificationsCollection.updateOne({ _id: objectId }, { $set: { confirmedAt: new Date() } });
  return notificationsCollection.findOne({ _id: objectId });
}

async function getNotifications(db, filters = {}) {
  const notificationsCollection = await getCollection(db, 'notifications');
  const query = {};
  if (filters.eventType) {
    query.eventType = filters.eventType;
  }
  if (filters.status) {
    query.status = filters.status;
  }
  return notificationsCollection.find(query).sort({ createdAt: -1 }).limit(filters.limit || 50).toArray();
}

module.exports = {
  dispatchNotification,
  confirmNotification,
  getNotifications,
  sanitizePayload
};
