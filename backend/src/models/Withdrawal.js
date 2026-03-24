/**
 * Modelo de validação e estrutura para Withdrawal
 * Baseado no Diagrama de Classes
 */
class WithdrawalModel {
  static WITHDRAWAL_TYPES = {
    PARTIAL: 'partial',
    TOTAL: 'total'
  };

  static WITHDRAWAL_TYPE_ALIASES = {
    parcial: 'partial',
    partial: 'partial',
    total: 'total'
  };

  static normalizeWithdrawalType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return this.WITHDRAWAL_TYPE_ALIASES[normalized] || normalized;
  }

  static validate(data) {
    const errors = [];

    if (!data.sampleID && data.sampleID !== 0) {
      errors.push('sampleID é obrigatório');
    }

    const normalizedWithdrawalType = this.normalizeWithdrawalType(data.withdrawalType);
    if (!normalizedWithdrawalType || !Object.values(this.WITHDRAWAL_TYPES).includes(normalizedWithdrawalType)) {
      errors.push('withdrawalType é obrigatório e deve ser partial ou total');
    }

    if (!data.withdrawalResponsible || typeof data.withdrawalResponsible !== 'string') {
      errors.push('withdrawalResponsible é obrigatório e deve ser string');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    const normalizedWithdrawalType = this.normalizeWithdrawalType(data.withdrawalType);

    return {
      withdrawalID: data.withdrawalID || null,
      sampleID: data.sampleID,
      withdrawalType: normalizedWithdrawalType,
      withdrawalResponsible: data.withdrawalResponsible,
      withdrawalDate: data.withdrawalDate || new Date(),
      sampleDestination: data.sampleDestination || null,
      linkedProject: data.linkedProject || null,
      quantity: data.quantity || null,
      notes: data.notes || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = WithdrawalModel;

