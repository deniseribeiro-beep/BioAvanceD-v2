/**
 * Modelo de validação e estrutura para Location (Localização/Freezer)
 */
class LocationModel {
  static validate(data) {
    const errors = [];

    // equipmentType é obrigatório
    if (data.equipmentType === undefined || data.equipmentType === null) {
      errors.push('equipmentType é obrigatório');
    } else if (typeof data.equipmentType !== 'number') {
      errors.push('equipmentType deve ser number');
    }

    if (data.equipmentID !== undefined && data.equipmentID !== null) {
      if (typeof data.equipmentID !== 'number') {
        errors.push('equipmentID deve ser number');
      }
    }

    if (data.block !== undefined && data.block !== null) {
      if (typeof data.block !== 'number') {
        errors.push('block deve ser number');
      }
    }

    if (data.rack !== undefined && data.rack !== null) {
      if (typeof data.rack !== 'number') {
        errors.push('rack deve ser number');
      }
    }

    if (data.drawer !== undefined && data.drawer !== null) {
      if (typeof data.drawer !== 'number') {
        errors.push('drawer deve ser number');
      }
    }

    if (data.box !== undefined && data.box !== null) {
      if (typeof data.box !== 'number') {
        errors.push('box deve ser number');
      }
    }

    // wellPosition pode ser string (ex: "A1") ou null
    if (data.wellPosition !== undefined && data.wellPosition !== null) {
      if (typeof data.wellPosition !== 'string') {
        errors.push('wellPosition deve ser string');
      }
    }

    // eppendorfWell como array é aceito mas será convertido para wellPosition
    if (data.eppendorfWell !== undefined && data.eppendorfWell !== null) {
      if (!Array.isArray(data.eppendorfWell) && typeof data.eppendorfWell !== 'string') {
        errors.push('eppendorfWell deve ser array [M, N] ou string');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    // Converte eppendorfWell para wellPosition se necessário
    let wellPosition = null;
    if (data.wellPosition) {
      wellPosition = String(data.wellPosition);
    } else if (data.eppendorfWell) {
      if (Array.isArray(data.eppendorfWell)) {
        // Se for array [M, N], converte para string "MxN"
        wellPosition = `${data.eppendorfWell[0]}x${data.eppendorfWell[1]}`;
      } else if (typeof data.eppendorfWell === 'string') {
        // Se for string, usa diretamente
        wellPosition = data.eppendorfWell;
      }
    }

    return {
      locationID: data.locationID !== undefined ? Number(data.locationID) : undefined, // Será gerado se não fornecido
      equipmentType: data.equipmentType !== undefined ? Number(data.equipmentType) : null,
      equipmentID: data.equipmentID !== undefined ? Number(data.equipmentID) : undefined,
      block: data.block !== undefined ? Number(data.block) : null,
      rack: data.rack !== undefined ? Number(data.rack) : null,
      drawer: data.drawer !== undefined ? Number(data.drawer) : null,
      box: data.box !== undefined ? Number(data.box) : null,
      wellPosition: wellPosition,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  /**
   * Gera string de localização hierárquica
   */
  static getLocationString(location) {
    const parts = [];
    if (location.equipmentType) parts.push(`Equip:${location.equipmentType}`);
    if (location.block !== null) parts.push(`Bloco:${location.block}`);
    if (location.rack !== null) parts.push(`Rack:${location.rack}`);
    if (location.drawer !== null) parts.push(`Gaveta:${location.drawer}`);
    if (location.box !== null) parts.push(`Caixa:${location.box}`);
    if (location.eppendorfWell) parts.push(`Poco:${location.eppendorfWell[0]}x${location.eppendorfWell[1]}`);
    return parts.join(' | ');
  }
}

module.exports = LocationModel;

