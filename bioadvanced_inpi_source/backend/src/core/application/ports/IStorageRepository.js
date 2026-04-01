/**
 * Contrato para operações de armazenamento físico de amostras.
 */
class IStorageRepository {
  /**
   * Executa uma função dentro de transação Mongo.
   * @param {(session: import('mongodb').ClientSession) => Promise<any>} handler
   * @returns {Promise<any>}
   */
  async withTransaction(handler) {
    throw new Error('Not implemented');
  }

  /**
   * Busca uma amostra por ID.
   * @param {string} sampleId
   * @param {import('mongodb').ClientSession} [session]
   * @returns {Promise<object|null>}
   */
  async findSampleById(sampleId, session) {
    throw new Error('Not implemented');
  }

  /**
   * Busca uma caixa por ID.
   * @param {string} boxId
   * @param {import('mongodb').ClientSession} [session]
   * @returns {Promise<object|null>}
   */
  async findBoxById(boxId, session) {
    throw new Error('Not implemented');
  }

  /**
   * Move a amostra entre posições físicas (origem -> destino).
   * @param {{ sampleId: string, fromBoxId: string, fromPosition: string, toBoxId: string, toPosition: string }} input
   * @param {import('mongodb').ClientSession} session
   * @returns {Promise<void>}
   */
  async moveSamplePosition(input, session) {
    throw new Error('Not implemented');
  }

  /**
   * Aloca uma amostra em posição física.
   * @param {{ sampleId: string, boxId: string, position: string }} input
   * @param {import('mongodb').ClientSession} session
   * @returns {Promise<void>}
   */
  async allocateSamplePosition(input, session) {
    throw new Error('Not implemented');
  }

  /**
   * Libera a posição física atual de uma amostra.
   * @param {{ sampleId: string }} input
   * @param {import('mongodb').ClientSession} session
   * @returns {Promise<{ from: { boxId: string, position: string }, barcode?: string|null, quantity?: number|null, unit?: string|null }>}
   */
  async releaseSamplePosition(input, session) {
    throw new Error('Not implemented');
  }

  /**
   * Valida disponibilidade de posição em caixa.
   * @param {{ boxId: string, position: string }} input
   * @returns {Promise<{ available: boolean, error?: string, message?: string, occupiedBySampleId?: string, boxData?: object }>}
   */
  async validatePositionAvailability(input) {
    throw new Error('Not implemented');
  }

  /**
   * Lista posições disponíveis de uma caixa.
   * @param {{ boxId: string }} input
   * @returns {Promise<object|null>}
   */
  async getBoxAvailablePositions(input) {
    throw new Error('Not implemented');
  }

  /**
   * Obtém localização de armazenamento da amostra.
   * @param {{ sampleId: string }} input
   * @returns {Promise<{ found: boolean, location?: object, error?: string, message?: string }>}
   */
  async getSampleStorageLocation(input) {
    throw new Error('Not implemented');
  }

  /**
   * Busca amostras candidatas para alocação (sem enriquecimento de consentimento).
   * @param {{ query: string }} input
   * @returns {Promise<object[]>}
   */
  async searchAllocatableSampleCandidates(input) {
    throw new Error('Not implemented');
  }

}

module.exports = IStorageRepository;
