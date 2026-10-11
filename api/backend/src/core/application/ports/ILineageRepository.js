/**
 * Contrato para a trilha de cadeia de custódia (ISO 20387).
 *
 * #1312 (RF023 AC8): a trilha chega ao grafo somente pelo outbox. Nenhuma
 * implementação escreve no Neo4j nem lê consentimento da projeção.
 */
class ILineageRepository {
  /**
   * Valida, em processo e sem leitura, os campos do evento de custódia antes
   * de qualquer escrita no MongoDB.
   * @param {{ specimenId: string, barcode?: string|null, eventType: string }} input
   * @returns {Promise<boolean>}
   */
  async validateBeforePersistence(input) {
    throw new Error('Not implemented');
  }

  /**
   * Registra o evento de custódia no outbox do grafo. `options.session` é a
   * transação Mongo do agregado: o evento confirma ou aborta com ela.
   * @param {{ specimenId: string, barcode?: string|null, eventType: string, from?: { boxId?: string, position?: string }|null, to?: { boxId?: string, position?: string }|null, happenedAt?: Date|string, actorId?: string|null, reason?: string|null }} input
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<{ eventId: string|null }>}
   */
  async recordCustodyEvent(input, options) {
    throw new Error('Not implemented');
  }
}

module.exports = ILineageRepository;
