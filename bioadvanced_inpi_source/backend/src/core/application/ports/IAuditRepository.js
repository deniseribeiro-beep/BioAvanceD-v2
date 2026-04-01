/**
 * Contrato de auditoria imutável para trilha ISO 20387.
 */
class IAuditRepository {
  /**
   * Registra evento imutável de movimentação.
   * @param {{
   *  sampleId: string,
   *  barcode?: string|null,
   *  eventType: string,
   *  before: object,
   *  after: object,
   *  context: object,
   *  timestamp: Date
   * }} input
   * @param {import('mongodb').ClientSession} [session]
   * @returns {Promise<{ movementID: number }>} 
   */
  async appendImmutableAudit(input, session) {
    throw new Error('Not implemented');
  }
}

module.exports = IAuditRepository;
