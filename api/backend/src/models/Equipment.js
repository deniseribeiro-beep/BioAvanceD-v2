const { EQUIPMENT_STATUS } = require('./equipmentStatus');

/**
 * Modelo de validação e estrutura para Equipment
 */
class EquipmentModel {
  static EQUIPMENT_TYPES = [
    'Freezer',        // Equipamento de armazenamento (congelador)
    'Analytical',     // Equipamento analítico (PCR, NGS, etc)
    'Storage',        // Armazenamento genérico
    'Processing',     // Processamento de amostras
    'Other'           // Outros
  ];

  // #774: moved to equipmentStatus.js, which BLOCKED_EQUIPMENT_STATUSES now
  // derives from — re-exported here so EquipmentModel.EQUIPMENT_STATUS keeps
  // working for existing callers/tests.
  static EQUIPMENT_STATUS = EQUIPMENT_STATUS;

  static validate(data) {
    const errors = [];

    // equipmentID é opcional - será gerado automaticamente se não fornecido
    // Apenas valida se fornecido
    if (data.equipmentID !== undefined && data.equipmentID !== null) {
      if (typeof data.equipmentID !== 'number') {
        errors.push('equipmentID deve ser um número');
      }
    }

    if (!data.equipmentDescription || typeof data.equipmentDescription !== 'string') {
      errors.push('equipmentDescription é obrigatório e deve ser string');
    }

    // Valida name (deve ser string não-vazio)
    if (data.name !== undefined && data.name !== null) {
      if (typeof data.name !== 'string' || data.name.trim().length === 0) {
        errors.push('name deve ser uma string não-vazia');
      }
    }

    // Valida type (deve estar em EQUIPMENT_TYPES)
    if (data.type !== undefined && data.type !== null) {
      if (!this.EQUIPMENT_TYPES.includes(data.type)) {
        errors.push(`type deve ser um de: ${this.EQUIPMENT_TYPES.join(', ')}`);
      }
    }

    // Valida status (deve estar em EQUIPMENT_STATUS)
    if (data.status !== undefined && data.status !== null) {
      if (!this.EQUIPMENT_STATUS.includes(data.status)) {
        errors.push(`status deve ser um de: ${this.EQUIPMENT_STATUS.join(', ')}`);
      }
    }

    // Valida serialNumber se fornecido
    if (data.serialNumber !== undefined && data.serialNumber !== null) {
      if (typeof data.serialNumber !== 'string') {
        errors.push('serialNumber deve ser uma string');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    return {
      equipmentID: data.equipmentID,
      equipmentDescription: data.equipmentDescription,
      name: data.name || null,
      model: data.model || null,
      serialNumber: data.serialNumber || null,
      type: data.type || 'Other', // Padrão: Other
      status: data.status || 'Active', // Padrão: Active
      purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
      // #635: Organization.organizationId (UUID string), not a Mongo ref --
      // same shape as Sample.collectionSite/Patient.clinicalUnitId/
      // Sensor.organizationId (#634). No backfill for pre-existing
      // equipment (null = unscoped/legacy).
      organizationId: data.organizationId || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = EquipmentModel;

