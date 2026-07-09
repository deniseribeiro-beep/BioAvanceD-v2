/**
 * Contrato para persistência de linhagem e cadeia de custódia.
 */
class ILineageRepository {
  /**
   * Valida pré-condições de linhagem/ética antes de persistir no MongoDB.
   * @param {{ specimenId: string, barcode?: string|null, eventType: string, requireEthicalConsent?: boolean }} input
   * @returns {Promise<boolean>}
   */
  async validateBeforePersistence(input) {
    throw new Error('Not implemented');
  }

  /**
   * Registra evento de cadeia de custódia no Neo4j.
   * @param {{ specimenId: string, barcode?: string|null, eventType: string, from?: { boxId?: string, position?: string }|null, to?: { boxId?: string, position?: string }|null, happenedAt?: Date, actorId?: string|null, reason?: string|null }} input
   * @returns {Promise<{ eventId: string }>}
   */
  async recordCustodyEvent(input) {
    throw new Error('Not implemented');
  }

  /**
   * Compensa evento de cadeia de custódia quando a transação principal falha.
   * @param {{ eventId: string, specimenId?: string, reason?: string }} input
   * @returns {Promise<{ compensated: boolean, eventId: string, cleanedPositions?: number }>}
   */
  async compensateCustodyEvent(input) {
    throw new Error('Not implemented');
  }
}

module.exports = ILineageRepository;
