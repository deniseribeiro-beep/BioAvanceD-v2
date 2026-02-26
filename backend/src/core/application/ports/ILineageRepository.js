/**
 * Contrato para persistência de linhagem e cadeia de custódia.
 */
class ILineageRepository {
  /**
   * Registra no grafo a movimentação da amostra.
   * @param {{ sampleId: string, barcode?: string|null, from: { boxId: string, position: string }, to: { boxId: string, position: string }, movedAt: Date, movedBy?: string|null, reason?: string|null }} input
   * @returns {Promise<void>}
   */
  async registerSampleMove(input) {
    throw new Error('Not implemented');
  }
}

module.exports = ILineageRepository;
