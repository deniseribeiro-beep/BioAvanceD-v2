/**
 * Modelo de validação e estrutura para Withdrawal
 * Baseado no Diagrama de Classes
 */
class WithdrawalModel {
  static validate(data) {
    const errors = [];

    if (!data.sampleID && data.sampleID !== 0) {
      errors.push('sampleID é obrigatório');
    }

    if (!data.withdrawalType || !['Parcial', 'Total'].includes(data.withdrawalType)) {
      errors.push('withdrawalType é obrigatório e deve ser Parcial ou Total');
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
    return {
      withdrawalID: data.withdrawalID || null,
      sampleID: data.sampleID,
      withdrawalType: data.withdrawalType,
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

