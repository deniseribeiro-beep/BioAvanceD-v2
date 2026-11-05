/**
 * Consent communications (RF010 AC8, RF015 AC5; LGPD art. 8 §6 and art. 9
 * §2): what the biobank tells the holder of a Consent, each communication
 * recorded as a ConsentCommunicationEvent linked to that consent.
 *
 * Two communications are written:
 * - the policy change notice: when a new version of a consent term is
 *   published, every consent still in force under an earlier version of that
 *   term gets a plain notice of what changed and how to revoke;
 * - the revocation confirmation (LGPD art. 8 §5, art. 18 IX): when a consent
 *   is revoked as a whole, its holder is told it was revoked, from when, and
 *   that the revocation acts from then on (Requisitos RF010 AC6).
 * Each event is recorded `queued` before its send and given its outcome
 * after it, so a process that dies mid-send leaves the attempt. A failed
 * send is recorded `failed` and never undoes the act that caused it.
 */
const ConsentCommunicationEventModel = require('../models/ConsentCommunicationEvent');
const consentHistory = require('./consentHistory.service');
const participantIdentityService = require('./participantIdentity.service');
const { getCollection } = require('../utils/collectionResolver');
const logger = require('../utils/logger');

const POLICY_CHANGE_NOTICE = 'policy_change_notice';
// The message template this notice is built from; a change of wording is a
// new version of this id, so each event names the text it carried.
const POLICY_CHANGE_NOTICE_TEMPLATE_ID = 'consent.policy_change_notice.v1';
const POLICY_CHANGE_PURPOSE = 'consent_policy_change';
const NOTIFICATION_TYPE = 'RF_CONSENT_POLICY_CHANGE_NOTICE';

const REVOCATION_CONFIRMATION = 'notice';
const REVOCATION_CONFIRMATION_TEMPLATE_ID = 'consent.revocation_confirmation.v1';
const REVOCATION_PURPOSE = 'consent_revocation';
const REVOCATION_NOTIFICATION_TYPE = 'RF_CONSENT_REVOCATION_CONFIRMATION';

const TERM_EXPIRY_NOTICE = 'notice';
const TERM_EXPIRY_TEMPLATE_ID = 'consent.term_expiry.v1';
const TERM_EXPIRY_PURPOSE = 'consent_term_expiry';
const TERM_EXPIRY_NOTIFICATION_TYPE = 'RF_CONSENT_TERM_EXPIRY';

function permissionLabelsByKey(template) {
  const labels = new Map();
  for (const permission of Array.isArray(template?.permissions) ? template.permissions : []) {
    if (permission && permission.key) labels.set(String(permission.key), String(permission.label || permission.key));
  }
  return labels;
}

/**
 * The notice text, in plain pt-BR. It names the term and both versions,
 * lists the permissions the new version adds or drops, and says how to
 * revoke. RF015 AC4: it carries no personal data, not even a name.
 */
function formatPolicyChangeNotice({ previousTemplate, newTemplate }) {
  const title = String(newTemplate?.title || previousTemplate?.title || 'Termo de Consentimento').trim();
  const previousVersion = previousTemplate?.version ? String(previousTemplate.version) : 'anterior';
  const newVersion = newTemplate?.version ? String(newTemplate.version) : 'nova';

  const before = permissionLabelsByKey(previousTemplate);
  const after = permissionLabelsByKey(newTemplate);
  const added = [...after.keys()].filter((key) => !before.has(key)).map((key) => after.get(key));
  const removed = [...before.keys()].filter((key) => !after.has(key)).map((key) => before.get(key));

  const changes = [];
  if (added.length > 0) changes.push(`Permissões incluídas: ${added.join('; ')}.`);
  if (removed.length > 0) changes.push(`Permissões retiradas: ${removed.join('; ')}.`);
  if (changes.length === 0) changes.push('O texto do termo foi revisado.');

  return [
    `BioAvanceD: o termo de consentimento "${title}" que você aceitou (versão ${previousVersion}) foi substituído pela versão ${newVersion}.`,
    ...changes,
    'Seu consentimento continua valendo nos termos que você aceitou.',
    'Se não concordar com a mudança, você pode revogar seu consentimento a qualquer momento, sem custo, pedindo a revogação à equipe do biobanco que acompanha sua participação. A revogação vale a partir do pedido e não afeta o que foi feito antes dela.',
  ].join('\n');
}

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** The email address of a consent's holder, from their ParticipantIdentity. */
async function resolveHolderEmail(db, notificationService, participantId) {
  if (!participantId) return null;
  const identityCollection = await getCollection(db, 'participantIdentities');
  const rawIdentity = await identityCollection.findOne({ participantId });
  const identity = rawIdentity ? participantIdentityService.decryptIdentity(rawIdentity) : null;
  const contact = participantIdentityService.withIdentityContact({ participantId }, identity);
  return notificationService.resolvePatientEmail(contact);
}

const htmlOf = (message) => message.split('\n').map((line) => `<p>${escapeHtml(line)}</p>`).join('');

/**
 * The revocation confirmation text, in plain pt-BR: that the consent was
 * revoked, from when, and that the revocation acts from then on without
 * undoing past uses or the records the law requires to be kept (RF010 AC6).
 * RF015 AC4: it carries no personal data, not even a name.
 */
function formatRevocationConfirmation({ effectiveAt }) {
  const when = effectiveAt instanceof Date && !Number.isNaN(effectiveAt.getTime()) ? effectiveAt : new Date();
  const formatted = when.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });
  return [
    `BioAvanceD: confirmamos a revogação do seu consentimento, válida a partir de ${formatted} (horário de Brasília).`,
    'A partir dessa data, nada mais será feito com base nesse consentimento.',
    'A revogação não desfaz o que foi feito antes dela, e os registros que a lei obriga a guardar continuam guardados pelo prazo legal.',
  ].join('\n');
}

/**
 * One recorded communication to one consent's holder: the event is written
 * `queued`, the holder's email is resolved, the message is sent, and the
 * event is set `delivered` or `failed`. Never throws; returns the outcome.
 */
async function sendRecordedEmail(db, {
  eventsCollection,
  notificationService,
  consent,
  communicationType,
  contentTemplateId,
  purpose,
  sourceEventType,
  sourceEventId,
  subject,
  notificationType,
  composeMessage,
  label,
}) {
  const consentId = consentHistory.consentKeyOf(consent);
  let event = null;
  try {
    event = ConsentCommunicationEventModel.create({
      consentId,
      participantId: consent.participantId || null,
      communicationType,
      channel: 'email',
      deliveryStatus: 'queued',
      contentTemplateId,
      purpose,
      sourceEventType,
      sourceEventId: sourceEventId == null ? null : String(sourceEventId),
    });
    const validation = ConsentCommunicationEventModel.validate(event);
    if (!validation.isValid) {
      throw new Error(validation.errors.join(', '));
    }
    // Recorded before the send: a send with no record is never made.
    await eventsCollection.insertOne(event);

    const email = await resolveHolderEmail(db, notificationService, consent.participantId);
    if (!email) {
      const missing = new Error(`E-mail do participante ausente para ${label}`);
      missing.code = 'CONSENT_RECIPIENT_REQUIRED';
      throw missing;
    }

    const message = composeMessage();
    const result = await notificationService.sendEmail({
      to: email,
      subject,
      text: message,
      html: htmlOf(message),
      notificationType,
      metadata: {
        participantId: consent.participantId || null,
        consentId,
        consentCommunicationEventId: event.consentCommunicationEventId,
      },
    });

    await eventsCollection.updateOne(
      { consentCommunicationEventId: event.consentCommunicationEventId },
      {
        $set: {
          deliveryStatus: 'delivered',
          sentAt: new Date(),
          evidenceUri: result?.messageId
            ? `urn:bioavanced:email:${result.provider || 'email'}:${result.messageId}`
            : null,
        },
      }
    );
    return 'delivered';
  } catch (sendError) {
    logger.error(`Falha ao enviar ${label} para o consentimento ${consentId}:`, sendError.message);
    if (event) {
      try {
        await eventsCollection.updateOne(
          { consentCommunicationEventId: event.consentCommunicationEventId },
          {
            $set: {
              deliveryStatus: 'failed',
              sentAt: new Date(),
              failureReason: sendError.code || sendError.message || 'send_failed',
            },
          }
        );
      } catch (recordError) {
        logger.error(`Falha ao registrar a falha no envio (${label}):`, recordError.message);
      }
    }
    return 'failed';
  }
}

/**
 * Notify the holders of every consent still in force under an earlier
 * version of the term `newTemplate` supersedes. Earlier versions are the
 * immediate predecessor plus the rest of the term's versionGroupId lineage;
 * a consent in force is one whose derived status is ACTIVE (a revoked or
 * superseded consent is REVOKED). Never throws; the counts say what reached
 * whom.
 */
async function notifyHoldersOfSupersededTerm(db, { newTemplateId, newTemplate, previousPolicyId = null, versionGroupId = null }) {
  const notices = { total: 0, delivered: 0, failed: 0 };
  try {
    if (!newTemplate || newTemplate.active !== true) {
      // An inactive version supersedes nothing; its publication is a draft.
      return notices;
    }
    const templatesCollection = await getCollection(db, 'consentTemplates');
    const lineage = new Map();
    // Guard: `find({ versionGroupId: undefined })` matches every document
    // missing the field, which would notify holders of unrelated terms.
    if (versionGroupId) {
      const rows = await templatesCollection.find({ versionGroupId, _id: { $ne: newTemplateId } }).toArray();
      for (const row of rows) lineage.set(String(row._id), row);
    }
    if (previousPolicyId && !lineage.has(String(previousPolicyId))) {
      lineage.set(String(previousPolicyId), null);
    }
    lineage.delete(String(newTemplateId));
    if (lineage.size === 0) {
      return notices;
    }

    const consentsCollection = await getCollection(db, 'consents');
    const holders = await consentsCollection.find({
      status: 'ACTIVE',
      consentTemplateId: { $in: [...lineage.keys()] },
    }).toArray();
    notices.total = holders.length;
    if (holders.length === 0) {
      return notices;
    }

    const eventsCollection = await getCollection(db, 'consentCommunicationEvents');
    const notificationService = require('./notification.service');
    const newTemplateDoc = { _id: newTemplateId, ...newTemplate };

    for (const consent of holders) {
      const outcome = await sendRecordedEmail(db, {
        eventsCollection,
        notificationService,
        consent,
        communicationType: POLICY_CHANGE_NOTICE,
        contentTemplateId: POLICY_CHANGE_NOTICE_TEMPLATE_ID,
        purpose: POLICY_CHANGE_PURPOSE,
        sourceEventType: 'ConsentTemplate',
        sourceEventId: newTemplateId,
        subject: 'BioAvanceD - Atualização do Termo de Consentimento',
        notificationType: NOTIFICATION_TYPE,
        composeMessage: () => formatPolicyChangeNotice({
          previousTemplate: lineage.get(String(consent.consentTemplateId))
            || { version: consent.consentVersion || null },
          newTemplate: newTemplateDoc,
        }),
        label: 'o aviso de mudança do termo',
      });
      notices[outcome] += 1;
    }

    if (notices.failed > 0) {
      logger.error(
        `Aviso de mudança do termo parcial: ${notices.delivered}/${notices.total} titulares avisados, ${notices.failed} falha(s).`
      );
    }
  } catch (error) {
    // The sweep's own setup (resolving collections, the finds) failed.
    logger.error('Erro ao avisar os titulares do termo substituído:', error.message);
  }
  return notices;
}

/**
 * Confirm to the holder of `consent` that it was revoked as a whole by
 * `revocation` (its ConsentRevocation). Only a revocation that ends the
 * consent is confirmed here; one that narrows a consent left in force is
 * not. Never throws; returns the event's outcome (`delivered` or
 * `failed`), or null when not even the event could be written.
 */
function formatTermExpiryNotice({ validTo }) {
  const when = validTo instanceof Date && !Number.isNaN(validTo.getTime()) ? validTo : new Date();
  const formatted = when.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });
  return [
    `BioAvanceD: o seu termo de consentimento encerrou em ${formatted} (horário de Brasília).`,
    'A partir dessa data, nada mais será feito com base nesse consentimento.',
    'O encerramento não desfaz o que foi feito antes dele, e os registros que a lei obriga a guardar continuam guardados pelo prazo legal.',
  ].join('\n');
}

/**
 * Tell the holder, once, that the term's own validTo has closed the consent.
 * A second pass finds the communication already recorded and sends nothing.
 */
async function notifyTermExpiry(db, { consent, validTo }) {
  try {
    const eventsCollection = await getCollection(db, 'consentCommunicationEvents');
    const consentId = consentHistory.consentKeyOf(consent);
    const existing = await eventsCollection.findOne({
      consentId,
      contentTemplateId: TERM_EXPIRY_TEMPLATE_ID,
    });
    if (existing) return existing.deliveryStatus || 'delivered';
    const notificationService = require('./notification.service');
    return await sendRecordedEmail(db, {
      eventsCollection,
      notificationService,
      consent,
      communicationType: TERM_EXPIRY_NOTICE,
      contentTemplateId: TERM_EXPIRY_TEMPLATE_ID,
      purpose: TERM_EXPIRY_PURPOSE,
      sourceEventType: 'Consent',
      sourceEventId: consentId,
      subject: 'BioAvanceD - Encerramento do termo de consentimento',
      notificationType: TERM_EXPIRY_NOTIFICATION_TYPE,
      composeMessage: () => formatTermExpiryNotice({ validTo }),
      label: 'o aviso de encerramento do termo',
    });
  } catch (error) {
    logger.error('Erro ao avisar o titular do encerramento do termo:', error.message);
    return null;
  }
}

async function confirmRevocationToHolder(db, { consent, revocation }) {
  try {
    const eventsCollection = await getCollection(db, 'consentCommunicationEvents');
    const notificationService = require('./notification.service');
    return await sendRecordedEmail(db, {
      eventsCollection,
      notificationService,
      consent,
      communicationType: REVOCATION_CONFIRMATION,
      contentTemplateId: REVOCATION_CONFIRMATION_TEMPLATE_ID,
      purpose: REVOCATION_PURPOSE,
      sourceEventType: 'ConsentRevocation',
      sourceEventId: revocation?.consentRevocationId ?? null,
      subject: 'BioAvanceD - Confirmação de revogação do consentimento',
      notificationType: REVOCATION_NOTIFICATION_TYPE,
      composeMessage: () => formatRevocationConfirmation({ effectiveAt: revocation?.effectiveAt }),
      label: 'a confirmação de revogação',
    });
  } catch (error) {
    logger.error('Erro ao confirmar a revogação ao titular:', error.message);
    return null;
  }
}

module.exports = {
  notifyHoldersOfSupersededTerm,
  confirmRevocationToHolder,
  notifyTermExpiry,
  formatPolicyChangeNotice,
  formatRevocationConfirmation,
  formatTermExpiryNotice,
  TERM_EXPIRY_TEMPLATE_ID,
  POLICY_CHANGE_NOTICE,
  POLICY_CHANGE_NOTICE_TEMPLATE_ID,
  POLICY_CHANGE_PURPOSE,
  REVOCATION_CONFIRMATION,
  REVOCATION_CONFIRMATION_TEMPLATE_ID,
  REVOCATION_PURPOSE,
};
