const crypto = require('crypto');
const logger = require('./logger');
const env = require('../config/env');

const DEFAULT_PARTICIPANT_COLLECTION = env.COLL_PATIENTS || 'patients';

async function generateUniqueParticipantId(db, collectionName = DEFAULT_PARTICIPANT_COLLECTION) {
  const maxAttempts = 100;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const firstDigit = crypto.randomInt(1, 10);
    const remainingDigits = Array.from({ length: 7 }, () => crypto.randomInt(0, 10));
    const participantId = `${firstDigit}${remainingDigits.join('')}`;
    const participants = db.collection(collectionName);
    const existing = await participants.findOne({ participantId });
    if (!existing) {
      return participantId;
    }
  }
  throw new Error('Não foi possível gerar um participantId único após múltiplas tentativas.');
}

async function validateParticipantId(db, participantId, collectionName = DEFAULT_PARTICIPANT_COLLECTION) {
  try {
    if (!participantId || typeof participantId !== 'string' || !/^\d{8}$/.test(participantId)) return false;
    const participants = db.collection(collectionName);
    const participant = await participants.findOne({ participantId }, { projection: { participantId: 1, _id: 0 } });
    return !!participant;
  } catch (error) {
    logger.error('Erro ao validar participantId:', error.message);
    return false;
  }
}

function sanitizePatientForLogs(participant) {
  if (!participant) return { participantId: null };
  return { participantId: participant.participantId || null };
}

module.exports = {
  generateUniqueParticipantId,
  validateParticipantId,
  sanitizePatientForLogs
};
