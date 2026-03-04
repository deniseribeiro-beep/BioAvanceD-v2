/**
 * Modelo de validação e estrutura para ConsentPolicy (versões de TCLE)
 */
class ConsentPolicyModel {
  static validate(data) {
    const errors = [];

    if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0) {
      errors.push('title é obrigatório e deve ser um texto válido');
    }

    if (!data.htmlContent || typeof data.htmlContent !== 'string' || data.htmlContent.trim().length === 0) {
      errors.push('htmlContent é obrigatório e deve ser um texto válido');
    }

    if (!data.version || typeof data.version !== 'string' || data.version.trim().length === 0) {
      errors.push('version é obrigatório e deve ser um texto válido');
    }

    if (!data.caae || typeof data.caae !== 'string' || data.caae.trim().length === 0) {
      errors.push('caae é obrigatório e deve ser um texto válido');
    }

    if (!data.validFrom || Number.isNaN(new Date(data.validFrom).getTime())) {
      errors.push('validFrom é obrigatório e deve ser uma data válida');
    }

    if (data.active !== undefined && typeof data.active !== 'boolean') {
      errors.push('active deve ser booleano');
    }

    if (!Array.isArray(data.granularPermissions)) {
      errors.push('granularPermissions deve ser um array');
    } else {
      data.granularPermissions.forEach((permission, index) => {
        if (!permission || typeof permission !== 'object') {
          errors.push(`granularPermissions[${index}] deve ser um objeto`);
          return;
        }
        if (!permission.key || typeof permission.key !== 'string') {
          errors.push(`granularPermissions[${index}].key é obrigatório e deve ser string`);
        }
        if (!permission.label || typeof permission.label !== 'string') {
          errors.push(`granularPermissions[${index}].label é obrigatório e deve ser string`);
        }
        if (permission.required !== undefined && typeof permission.required !== 'boolean') {
          errors.push(`granularPermissions[${index}].required deve ser booleano`);
        }
      });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    const validFrom = new Date(data.validFrom);
    return {
      title: data.title.trim(),
      htmlContent: data.htmlContent.trim(),
      version: data.version.trim(),
      caae: data.caae.trim(),
      validFrom: validFrom,
      active: data.active === undefined ? true : data.active,
      granularPermissions: Array.isArray(data.granularPermissions) ? data.granularPermissions : [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = ConsentPolicyModel;