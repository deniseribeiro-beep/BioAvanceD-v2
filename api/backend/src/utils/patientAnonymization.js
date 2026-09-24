const crypto = require('crypto');
const logger = require('./logger');
const { getCanonicalCollection } = require('../config/canonicalEntityCollections.v2');

async function generateUniqueParticipantId(db) {
  const maxAttempts = 100;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const firstDigit = crypto.randomInt(1, 10);
    const remainingDigits = Array.from({ length: 7 }, () => crypto.randomInt(0, 10));
    const participantId = `${firstDigit}${remainingDigits.join('')}`;
    const participants = getCanonicalCollection(db, 'Participant');
    const existing = await participants.findOne({ participantId });
    if (!existing) {
      return participantId;
    }
  }
  throw new Error('Não foi possível gerar um participantId único após múltiplas tentativas.');
}

const generateUniqueparticipantId = generateUniqueParticipantId;

async function validateParticipantId(db, participantId) {
  try {
    if (!participantId || typeof participantId !== 'string' || !/^\d{8}$/.test(participantId)) return false;
    const participants = getCanonicalCollection(db, 'Participant');
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
  generateUniqueparticipantId,
  validateParticipantId,
  sanitizePatientForLogs
};
