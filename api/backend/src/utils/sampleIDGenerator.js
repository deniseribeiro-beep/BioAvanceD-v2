const crypto = require('crypto');
const logger = require('./logger');

async function generateUniqueSpecimenId(db, collectionName = 'samples') {
  const maxAttempts = 100;
  let attempts = 0;

  while (attempts < maxAttempts) {
    const specimenId = crypto.randomInt(1000000, 9999999);
    const collection = db.collection(collectionName);
    const existing = await collection.findOne({ specimenId });
    if (!existing) {
      logger.info(`ID único de espécime gerado: ${specimenId} (tentativa ${attempts + 1})`);
      return specimenId;
    }
    attempts += 1;
  }

  throw new Error('Não foi possível gerar um ID único de espécime após múltiplas tentativas.');
}

module.exports = { generateUniqueSpecimenId };
