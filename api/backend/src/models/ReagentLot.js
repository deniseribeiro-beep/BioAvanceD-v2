const { randomUUID } = require('crypto');

/**
 * Modelo de validação e estrutura para ReagentLot (RF025 AC#2, dict-02
 * ELM-0298..0304, "Ensaios e experimentos", todos Fase 1/Condicional).
 */
class ReagentLotModel {
  static validate(data = {}) {
    const errors = [];

    if (!data.reagentName || typeof data.reagentName !== 'string' || data.reagentName.trim() === '') {
      errors.push('reagentName é obrigatório');
    }

    if (!data.lotNumber || typeof data.lotNumber !== 'string' || data.lotNumber.trim() === '') {
      errors.push('lotNumber é obrigatório');
    }

    if (data.manufacturer !== undefined && data.manufacturer !== null && typeof data.manufacturer !== 'string') {
      errors.push('manufacturer deve ser string');
    }

    if (data.catalogNumber !== undefined && data.catalogNumber !== null && typeof data.catalogNumber !== 'string') {
      errors.push('catalogNumber deve ser string');
    }

    if (data.expirationDate !== undefined && data.expirationDate !== null) {
      const expirationDate = new Date(data.expirationDate);
      if (Number.isNaN(expirationDate.getTime())) {
        errors.push('expirationDate deve ser uma data válida quando informada');
      }
    }

    if (data.storageCondition !== undefined && data.storageCondition !== null && typeof data.storageCondition !== 'string') {
      errors.push('storageCondition deve ser string');
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    return {
      reagentId: data.reagentId || randomUUID(),
      reagentName: data.reagentName,
      manufacturer: data.manufacturer || null,
      catalogNumber: data.catalogNumber || null,
      lotNumber: data.lotNumber,
      expirationDate: data.expirationDate ? new Date(data.expirationDate) : null,
      storageCondition: data.storageCondition || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = ReagentLotModel;
