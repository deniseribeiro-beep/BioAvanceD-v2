const logger = require('../utils/logger');
const { getCollection } = require('../utils/collectionResolver');
const { hashConsentToken } = require('../utils/consentTokenHash');
const ConsentCommunicationEventModel = require('../models/ConsentCommunicationEvent');
const consentHistory = require('./consentHistory.service');

const PANEL_LINK_TEMPLATE_ID = 'consent.panel_link.v1';
const PANEL_LINK_PURPOSE = 'consent_panel_link';

/** The panel link lasts until the term's own validTo. A term with no end
 *  date keeps the link for as long as the consent is in force. */
function consentPanelExpiresAt(template) {
  if (!template || template.validTo == null || template.validTo === '') return null;
  const date = new Date(template.validTo);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function recordPanelLinkCommunication(db, consent, deliveryStatus) {
  if (!db || !consent) return;
  try {
    const events = await getCollection(db, 'consentCommunicationEvents');
    const consentId = consentHistory.consentKeyOf(consent);
    const event = ConsentCommunicationEventModel.create({
      consentId,
      participantId: consent.participantId || null,
      communicationType: 'notice',
      channel: 'email',
      deliveryStatus,
      contentTemplateId: PANEL_LINK_TEMPLATE_ID,
      purpose: PANEL_LINK_PURPOSE,
      sourceEventType: 'Consent',
      sourceEventId: consentId,
    });
    const validation = ConsentCommunicationEventModel.validate(event);
    if (!validation.isValid) {
      logger.error('Comunicação do link do painel inválida:', validation.errors.join(', '));
      return;
    }
    await events.insertOne(event);
  } catch (error) {
    logger.error('Erro ao registrar o link do painel:', error.message);
  }
}

/**
 * In-person collection has no invitation token yet. Mint the same panel
 * link the e-mail invitation carries, store its hash on the participant,
 * and send it with the term.
 */
async function issueInPersonPanelLink(db, participantId, template, consent) {
  const notificationService = require('./notification.service');
  const metadata = notificationService.buildConsentMetadata();
  const patients = await getCollection(db, 'patients');
  await patients.updateOne(
    { participantId },
    {
      $set: {
        consentTokenHash: hashConsentToken(metadata.token),
        consentTokenCreatedAt: metadata.createdAt,
        consentTokenExpiresAt: consentPanelExpiresAt(template),
        updatedAt: new Date(),
      },
    }
  );
  const link = notificationService.buildConsentLink({ participantId }, metadata.token);
  try {
    await notificationService.enqueueConsentNotification({ participantId }, link);
    await recordPanelLinkCommunication(db, consent, 'delivered');
  } catch (error) {
    logger.error('Erro ao enviar o link do painel do TCLE:', error.message);
    try {
      await recordPanelLinkCommunication(db, consent, 'failed');
    } catch (recordError) {
      logger.error('Erro ao registrar o envio do link do painel:', recordError.message);
    }
  }
}

module.exports = {
  PANEL_LINK_TEMPLATE_ID,
  consentPanelExpiresAt,
  recordPanelLinkCommunication,
  issueInPersonPanelLink,
};
