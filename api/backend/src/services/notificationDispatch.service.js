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

async function resolveRecipientEmails(db, rule) {
  if (!rule.recipientRoleCodes?.length) return [];
  const userIds = await findUserAccountIdsByRoleCodes(db, rule.recipientRoleCodes);
  if (!userIds.length) return [];
  // userAccountId (rbac-assignment.service.js) is user._id.toString() --
  // match on _id, not a separate userID field the users collection doesn't
  // have. This runs against two different db connections depending on the
  // caller (app.locals.db's native MongoClient for the admin routes,
  // vs. iot.controller.js's mongoose connection() for the telemetry
  // trigger path) -- constructing an ObjectId from the top-level `mongodb`
  // package and handing it to a query executed on a mongoose-sourced
  // collection throws "Unsupported BSON version" (the two packages' bson
  // codecs don't recognize each other's instances). $toString sidesteps
  // it entirely by never constructing an ObjectId at all.
  const usersCollection = db.collection('users');
  const docs = await usersCollection
    .aggregate([
      { $match: { $expr: { $in: [{ $toString: '$_id' }, userIds] } } },
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

async function dispatchNotification(db, { eventType, sourceEventType, sourceEventId, payload = {}, purpose = null, consentId = null }) {
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

  // #903 (RF015 AC3 "tentativas", AC1): the notification is stored before
  // any send, naming its rule and the ConfigurationRelease in force, and each
  // attempt is written as `attempted` before its channel is called, then
  // given its result. A process that dies mid-send leaves the attempt.
  const notificationsCollection = await getCollection(db, 'notifications');
  const attempts = [];
  const document = {
    ruleId: rule._id,
    ruleVersion: rule.version,
    configurationReleaseId: await activeConfigurationReleaseId(db),
    eventType,
    sourceEventType: sourceEventType || eventType,
    sourceEventId: sourceEventId ? String(sourceEventId) : null,
    // RF015 AC5 (#903): the communication's purpose (the caller's, else the
    // rule's) and the consent it concerns, when it concerns one. Recorded on
    // the row only: the payload allowlist still decides what the message says.
    purpose: purpose || rule.purpose || null,
    consentId: consentId ? String(consentId) : null,
    payload: sanitizedPayload,
    recipients,
    attempts: [],
    status: 'dispatching',
    escalated: false,
    deliveredChannel: null,
    createdAt,
    deliveredAt: null,
    confirmedAt: null,
    deliveryDurationMs: null,
    maxDeliveryMinutes: rule.maxDeliveryMinutes,
    withinSla: null,
    slaBreached: false
  };
  const { insertedId } = await notificationsCollection.insertOne(document);
  // Each write carries copies of the attempts, never the array this loop edits.
  const record = (set) => notificationsCollection.updateOne(
    { _id: insertedId },
    { $set: { ...set, attempts: attempts.map((entry) => ({ ...entry })) } }
  );
  const attempt = async (channel, escalation, send) => {
    const entry = { channel, timestamp: new Date(), result: 'attempted', reason: null, escalation };
    attempts.push(entry);
    await record({ attempts });
    const result = await send();
    entry.result = result.success ? 'success' : 'failure';
    entry.reason = result.reason || null;
    await record({ attempts });
    return result;
  };

  let delivered = false;
  let deliveredChannel = null;

  // #903 (RNF026 AC2, RF015 AC6): each channel is retried as the rule
  // configures, only inside its delivery window. [inference] Once the
  // window closes undelivered, retrying stops and the escalation runs at
  // once, whatever its failure count: the window is the rule's own maximum.
  const maxAttempts = Math.max(1, rule.retry?.maxAttempts || 1);
  const backoffMs = Math.max(0, (rule.retry?.backoffSeconds || 0) * 1000);
  const deadline = createdAt.getTime() + rule.maxDeliveryMinutes * 60000;
  const windowClosed = () => Date.now() >= deadline;
  let windowLapsed = false;

  channels: for (const channel of rule.channels) {
    for (let n = 1; n <= maxAttempts; n += 1) {
      if (attempts.length > 0 && windowClosed()) {
        windowLapsed = true;
        break channels;
      }
      if (n > 1 && backoffMs > 0) await sleep(backoffMs);
      const result = await attempt(channel, false, () => sendViaChannel(channel, { recipients, subject, message }));
      if (result.success) {
        delivered = true;
        deliveredChannel = channel;
        break channels;
      }
    }
  }
  if (!delivered && windowClosed()) windowLapsed = true;

  let escalated = false;
  if (!delivered && rule.escalation?.enabled) {
    const failedAttempts = attempts.filter((attempt) => attempt.result === 'failure').length;
    if (windowLapsed || failedAttempts >= rule.escalation.afterFailures) {
      escalated = true;
      const escalationResult = await attempt(rule.escalation.channel, true, () => sendViaChannel(rule.escalation.channel, {
        recipients,
        subject: `[ESCALADO] ${subject}`,
        message
      }));
      if (escalationResult.success) {
        delivered = true;
        deliveredChannel = rule.escalation.channel;
      }
    }
  }

  const deliveredAt = delivered ? new Date() : null;
  const deliveryDurationMs = deliveredAt ? deliveredAt.getTime() - createdAt.getTime() : null;

  const outcome = {
    attempts,
    status: delivered ? 'delivered' : (escalated ? 'escalated_failed' : 'failed'),
    escalated,
    deliveredChannel,
    deliveredAt,
    deliveryDurationMs,
    // RNF026 AC#1 - measurable against the rule's own SLA; null while
    // undelivered rather than false, since "not yet delivered" and
    // "delivered late" are different states.
    withinSla: deliveredAt ? deliveryDurationMs <= rule.maxDeliveryMinutes * 60000 : null,
    // RF015 AC6: the window closed before delivery, so retrying stopped.
    slaBreached: windowLapsed
  };
  await record(outcome);
  return { _id: insertedId, ...document, ...outcome };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// CFG-004 ("Toda execução ou decisão registra configurationReleaseId"): the
// ConfigurationRelease the stored configuration names, or null before any.
async function activeConfigurationReleaseId(db) {
  const config = await db.collection('security_config').findOne({ _id: 'main' });
  return config?.configurationReleaseId || null;
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
