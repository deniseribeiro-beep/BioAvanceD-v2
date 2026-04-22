/**
 * Contrato de leitura para topologia de armazenamento (freezers/racks/árvore).
 */
class IStorageTopologyReadRepository {
  /**
   * Lista freezers operacionais.
   * @returns {Promise<object[]>}
   */
  async listOperationalFreezers() {
    throw new Error('Not implemented');
  }

  /**
   * Obtém estatísticas de ocupação de freezer.
   * @param {{ freezerId: string }} input
   * @returns {Promise<{ stats: object|null, error?: string, message?: string }>}
   */
  async getFreezerOccupancyStats(input) {
    throw new Error('Not implemented');
  }

  /**
   * Obtém árvore hierárquica de um freezer.
   * @param {{ freezerId: string }} input
   * @returns {Promise<object|null>}
   */
  async getFreezerTree(input) {
    throw new Error('Not implemented');
  }

  /**
   * Verifica integridade de ocupação de caixa.
   * @param {{ boxId: string }} input
   * @returns {Promise<{ valid: boolean, errors?: string[], stats?: object, error?: string, message?: string }>}
   */
  async checkBoxIntegrity(input) {
    throw new Error('Not implemented');
  }
}

module.exports = IStorageTopologyReadRepository;
