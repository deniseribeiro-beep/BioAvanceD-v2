const logger = require('./logger');
const { getCollection } = require('./collectionResolver');

// A colisão só acontece quando outro processo grava o mesmo número entre a
// leitura do contador e a inserção do chamador — algumas tentativas bastam.
// Antes de #775 eram exatamente duas, o que era fino até para essa corrida.
//
// #779: com o contador atômico abaixo esta janela ficou muito mais estreita
// (dois processos só colidem se um deles falhar entre incrementar e gravar),
// e `samples_barcode_unique_v1` (#936) transformou o que escapar daqui num
// E11000 alto em vez de corrupção silenciosa. O loop fica como rede.
const MAX_COLLISION_ATTEMPTS = 10;

const COUNTERS_COLLECTION = 'counters';

function counterIdForYear(year) {
  return `sample_barcode_${year}`;
}

/**
 * #779: semeia o contador do ano a partir do maior sequencial já gravado.
 *
 * Roda no máximo uma vez por ano por deployment — na primeira geração depois
 * que o contador não existe. Sem isto, um deployment que já tem
 * `BR-2026-482` recomeçaria em `BR-2026-001` e cada geração bateria no loop
 * de colisão (ou, desde #936, no índice único) 482 vezes.
 *
 * É a única vez que a varredura do ano acontece; antes ela rodava a cada
 * criação de amostra.
 */
async function seedYearCounter(db, samplesCollection, year, prefix, sequencePattern) {
  const counters = db.collection(COUNTERS_COLLECTION);
  const counterId = counterIdForYear(year);

  if (await counters.findOne({ _id: counterId })) return;

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

  // `$setOnInsert` em vez de `$set`: se dois processos semearem ao mesmo
  // tempo, ambos calculam o mesmo máximo e só a inserção vencedora conta —
  // a perdedora não pode rebaixar um contador que já avançou.
  await counters.updateOne(
    { _id: counterId },
    { $setOnInsert: { seq: highestSequence, createdAt: new Date() } },
    { upsert: true }
  );
}

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
 * #779: era O(códigos criados no ano) por amostra — uma varredura da
 * collection a cada criação, e `import-lgpd.service.js` chama isto por
 * linha, então uma importação de 5.000 linhas pagava 5.000 varreduras sobre
 * um conjunto que crescia durante a própria importação. Agora é um
 * `findOneAndUpdate` atômico sobre `counters`, o mesmo padrão que
 * `SampleMovement.generateMovementID` e `MongoAuditRepository` já usam neste
 * repo. A varredura sobrevive só como semeadura, uma vez por ano por
 * deployment.
 *
 * **Lacunas na sequência são aceitáveis, e isso é citação e não escolha.**
 * dict-02 ELM-0116 (`barcodeValue`) exige `Único` e diz "GS1/DataMatrix/
 * Code128 conforme política"; nada em ELM-0116 nem nos critérios do RF004
 * pede contiguidade. Um insert que falhe depois de incrementar queima um
 * número, e a etiqueta seguinte pula — o que o dicionário pede é unicidade,
 * não densidade.
 *
 * @param {Object} db - Instância do banco de dados MongoDB
 * @returns {Promise<string>} Código de barras único no formato BR-YYYY-NNN
 */
async function generateUniqueBarcode(db) {
  const currentYear = new Date().getFullYear();
  const prefix = `BR-${currentYear}-`;
  const sequencePattern = new RegExp(`^${prefix}([0-9]+)$`);

  const samplesCollection = await getCollection(db, 'samples');
  const counters = db.collection(COUNTERS_COLLECTION);
  const counterId = counterIdForYear(currentYear);

  await seedYearCounter(db, samplesCollection, currentYear, prefix, sequencePattern);

  for (let attempt = 0; attempt < MAX_COLLISION_ATTEMPTS; attempt++) {
    const counter = await counters.findOneAndUpdate(
      { _id: counterId },
      { $inc: { seq: 1 }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true, returnDocument: 'after' }
    );

    // #294: o driver v5+ devolve o documento direto, não `{ value: doc }`
    // (essa forma só vale com `includeResultMetadata: true`). Ler
    // `counter.value.seq` daria undefined e o contador nunca avançaria —
    // exatamente o defeito que SampleMovement.generateMovementID carregou.
    const sequenceNumber = counter?.seq;
    if (!sequenceNumber) {
      throw new Error('Não foi possível gerar um código de barras único. Tente novamente.');
    }

    // Formata o número sequencial com no mínimo 3 dígitos (001, 002, etc.)
    const barcode = `${prefix}${String(sequenceNumber).padStart(3, '0')}`;

    const existing = await samplesCollection.findOne({ barcode });

    if (!existing) {
      const suffix = attempt > 0 ? ' (após verificação de duplicidade)' : '';
      logger.info(`Código de barras gerado: ${barcode}${suffix}`);
      return barcode;
    }
  }

  throw new Error('Não foi possível gerar um código de barras único. Tente novamente.');
}

module.exports = { generateUniqueBarcode };
