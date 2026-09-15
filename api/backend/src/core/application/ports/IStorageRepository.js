/**
 * Contrato para operações de armazenamento físico canônico v2.
 */
class IStorageRepository {
  async withTransaction(_handler) {
    throw new Error('Not implemented');
  }

  /**
   * Retorna a amostra junto do read model `currentStoragePlacement`, derivado
   * exclusivamente da cadeia normalizada v2.
   */
  async findSampleById(_specimenId, _session) {
    throw new Error('Not implemented');
  }

  async findCurrentStoragePlacement(_specimenId, _session) {
    throw new Error('Not implemented');
  }

  async findBoxById(_boxId, _session) {
    throw new Error('Not implemented');
  }

  async moveSamplePosition(_input, _session) {
    throw new Error('Not implemented');
  }

  async allocateSamplePosition(_input, _session) {
    throw new Error('Not implemented');
  }

  async releaseSamplePosition(_input, _session) {
    throw new Error('Not implemented');
  }

  async validatePositionAvailability(_input) {
    throw new Error('Not implemented');
  }

  async getBoxAvailablePositions(_input) {
    throw new Error('Not implemented');
  }

  async getSamplePhysicalPlacement(_input) {
    throw new Error('Not implemented');
  }

  async searchAllocatableSampleCandidates(_input) {
    throw new Error('Not implemented');
  }
}

module.exports = IStorageRepository;
