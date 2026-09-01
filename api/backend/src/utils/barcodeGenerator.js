const logger = require('./logger');
const { getCollection } = require('./collectionResolver');

// A colisão só acontece quando outro processo grava o mesmo número entre a
// leitura do máximo e a inserção do chamador — algumas tentativas bastam.
// Antes de #775 eram exatamente duas, o que era fino até para essa corrida.
const MAX_COLLISION_ATTEMPTS = 10;

/**
 * Gera um código de barras único no formato BR-YYYY-NNN
 * Formato: BR-{ano}-{número sequencial de 3 dígitos}
 * Exemplo: BR-2024-001, BR-2024-002, etc.
 *
 * A partir do milésimo código do ano o número passa a ter 4 dígitos
 * (BR-2024-1000) — o padding é o mínimo, não um limite.
 *
 * #932: a collection é resolvida via collectionResolver (a mesma chave
 * 'samples' que sample.service.js e import-lgpd.service.js usam para ler e
 * gravar amostras), em vez de aceita como parâmetro — um chamador não tem
 * mais como apontar a verificação de unicidade para uma collection diferente
 * daquela em que as amostras realmente são gravadas.
 *
 * @param {Object} db - Instância do banco de dados MongoDB
 * @returns {Promise<string>} Código de barras único no formato BR-YYYY-NNN
 */
async function generateUniqueBarcode(db) {
  const currentYear = new Date().getFullYear();
  const prefix = `BR-${currentYear}-`;
  const sequencePattern = new RegExp(`^${prefix}([0-9]+)$`);

  const samplesCollection = await getCollection(db, 'samples');

  // #775: o sequencial é um número renderizado como string, então ordenar por
  // `barcode` no banco ordena lexicograficamente — 'BR-2026-999' vence
  // 'BR-2026-1000', e todo código a partir do milésimo do ano fica *abaixo*
  // do 999. Lemos os códigos do ano e tiramos o máximo numérico aqui, o que
  // continua correto qualquer que seja o número de dígitos do sequencial.
  const yearBarcodes = await samplesCollection
    .find(
      { barcode: { $regex: `^${prefix}[0-9]+$` } },
      { projection: { barcode: 1, _id: 0 } }
    )
    .toArray();

  let highestSequence = 0;

  for (const doc of yearBarcodes || []) {
    const match = String((doc && doc.barcode) || '').match(sequencePattern);

    if (match && match[1]) {
      const sequence = parseInt(match[1], 10);
      if (!isNaN(sequence) && sequence > highestSequence) {
        highestSequence = sequence;
      }
    }
  }

  let sequenceNumber = highestSequence + 1;

  // Proteção contra race conditions: se o código já existe, tenta o próximo.
  for (let attempt = 0; attempt < MAX_COLLISION_ATTEMPTS; attempt++) {
    // Formata o número sequencial com no mínimo 3 dígitos (001, 002, etc.)
    const formattedSequence = String(sequenceNumber).padStart(3, '0');
    const barcode = `${prefix}${formattedSequence}`;

    const existing = await samplesCollection.findOne({ barcode });

    if (!existing) {
      const suffix = attempt > 0 ? ' (após verificação de duplicidade)' : '';
      logger.info(`Código de barras gerado: ${barcode}${suffix}`);
      return barcode;
    }

    sequenceNumber++;
  }

  throw new Error('Não foi possível gerar um código de barras único. Tente novamente.');
}

module.exports = { generateUniqueBarcode };
