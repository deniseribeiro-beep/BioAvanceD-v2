/**
 * Consent communications (RF010 AC8, RF015 AC5; LGPD art. 8 §6 and art. 9
 * §2): what the biobank tells the holder of a Consent, each communication
 * recorded as a ConsentCommunicationEvent linked to that consent.
 *
 * The one communication written today is the policy change notice: when a
 * new version of a consent term is published, every consent still in force
 * under an earlier version of that term gets a plain notice of what changed
 * and how to revoke. Each event is recorded `queued` before its send and
 * given its outcome after it, so a process that dies mid-send leaves the
 * attempt. A failed send is recorded `failed` and never undoes the
 * publication.
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
      const consentId = consentHistory.consentKeyOf(consent);
      let event = null;
      try {
        event = ConsentCommunicationEventModel.create({
          consentId,
          participantId: consent.participantId || null,
          communicationType: POLICY_CHANGE_NOTICE,
          channel: 'email',
          deliveryStatus: 'queued',
          contentTemplateId: POLICY_CHANGE_NOTICE_TEMPLATE_ID,
          purpose: POLICY_CHANGE_PURPOSE,
          sourceEventType: 'ConsentTemplate',
          sourceEventId: String(newTemplateId),
        });
        const validation = ConsentCommunicationEventModel.validate(event);
        if (!validation.isValid) {
          throw new Error(validation.errors.join(', '));
        }
        // Recorded before the send: a send with no record is never made.
        await eventsCollection.insertOne(event);

        const email = await resolveHolderEmail(db, notificationService, consent.participantId);
        if (!email) {
          const missing = new Error('E-mail do participante ausente para o aviso de mudança do termo');
          missing.code = 'CONSENT_RECIPIENT_REQUIRED';
          throw missing;
        }

        const previousTemplate = lineage.get(String(consent.consentTemplateId))
          || { version: consent.consentVersion || null };
        const message = formatPolicyChangeNotice({ previousTemplate, newTemplate: newTemplateDoc });
        const result = await notificationService.sendEmail({
          to: email,
          subject: 'BioAvanceD - Atualização do Termo de Consentimento',
          text: message,
          html: message.split('\n').map((line) => `<p>${escapeHtml(line)}</p>`).join(''),
          notificationType: NOTIFICATION_TYPE,
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
        notices.delivered += 1;
      } catch (sendError) {
        notices.failed += 1;
        logger.error(
          `Falha ao enviar o aviso de mudança do termo para o consentimento ${consentId}:`,
          sendError.message
        );
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
            logger.error('Falha ao registrar a falha do aviso de mudança do termo:', recordError.message);
          }
        }
      }
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

module.exports = {
  notifyHoldersOfSupersededTerm,
  formatPolicyChangeNotice,
  POLICY_CHANGE_NOTICE,
  POLICY_CHANGE_NOTICE_TEMPLATE_ID,
  POLICY_CHANGE_PURPOSE,
};
