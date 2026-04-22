/**
 * Contrato de leitura para contexto de paciente/consentimento.
 */
class IPatientConsentReadRepository {
  /**
   * Enriquece amostras com status de consentimento e permissão de alocação.
   * @param {Array<object>} samples
   * @returns {Promise<Array<object>>}
   */
  async enrichSamplesWithConsent(samples) {
    throw new Error('Not implemented');
  }
}

module.exports = IPatientConsentReadRepository;
