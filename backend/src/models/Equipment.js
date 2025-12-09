/**
 * Modelo de validação e estrutura para Equipment
 */
class EquipmentModel {
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

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    return {
      equipmentID: data.equipmentID,
      equipmentDescription: data.equipmentDescription,
      model: data.model || null,
      serialNumber: data.serialNumber || null,
      purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = EquipmentModel;

