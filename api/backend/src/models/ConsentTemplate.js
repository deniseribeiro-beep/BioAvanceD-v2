/**
 * Modelo de validação e estrutura para ConsentTemplate
 */
class ConsentTemplateModel {
  static validate(data) {
    const errors = [];

    if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0) {
      errors.push('title é obrigatório e deve ser um texto válido');
    }

    const contentValue = data.content || data.htmlContent;
    if (!contentValue || typeof contentValue !== 'string' || contentValue.trim().length === 0) {
      errors.push('content é obrigatório e deve ser um texto válido');
    }

    if (data.version !== undefined && (typeof data.version !== 'string' || data.version.trim().length === 0)) {
      errors.push('version deve ser um texto válido');
    }

    if (data.caae !== undefined && (typeof data.caae !== 'string' || data.caae.trim().length === 0)) {
      errors.push('caae deve ser um texto válido');
    }

    if (data.active !== undefined && typeof data.active !== 'boolean') {
      errors.push('active deve ser booleano');
    }

    if (data.permissions !== undefined) {
      if (!Array.isArray(data.permissions)) {
        errors.push('permissions deve ser um array');
      } else {
        data.permissions.forEach((permission, index) => {
          if (!permission || typeof permission !== 'object') {
            errors.push(`permissions[${index}] deve ser um objeto`);
            return;
          }
          if (!permission.key || typeof permission.key !== 'string') {
            errors.push(`permissions[${index}].key é obrigatório e deve ser string`);
          }
          if (!permission.label || typeof permission.label !== 'string') {
            errors.push(`permissions[${index}].label é obrigatório e deve ser string`);
          }
          if (permission.required !== undefined && typeof permission.required !== 'boolean') {
            errors.push(`permissions[${index}].required deve ser booleano`);
          }
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    return {
      title: data.title.trim(),
      content: (data.content || data.htmlContent).trim(),
      htmlContent: data.htmlContent ? data.htmlContent.trim() : (data.content || '').trim(),
      version: typeof data.version === 'string' && data.version.trim().length > 0 ? data.version.trim() : 'v1',
      versionGroupId: typeof data.versionGroupId === 'string' && data.versionGroupId.trim().length > 0 ? data.versionGroupId.trim() : undefined,
      previousTemplateId: typeof data.previousTemplateId === 'string' && data.previousTemplateId.trim().length > 0 ? data.previousTemplateId.trim() : undefined,
      // #824: RF010 AC#1's lineage fields, as the policy path writes them, so
      // the publication sweep can resolve a builder-published revision.
      previousPolicyId: typeof data.previousPolicyId === 'string' && data.previousPolicyId.trim().length > 0 ? data.previousPolicyId.trim() : null,
      revisionType: data.revisionType === 'update' ? 'update' : 'create',
      // #824: the builder sends a validity period and createPatientConsent
      // enforces one, but this dropped both -- a builder-published term was
      // valid forever whatever the operator entered.
      validFrom: data.validFrom ? new Date(data.validFrom) : null,
      validTo: data.validTo ? new Date(data.validTo) : null,
      caae: typeof data.caae === 'string' ? data.caae.trim() : '',
      active: data.active === undefined ? true : data.active,
      permissions: Array.isArray(data.permissions) ? data.permissions : [],
      createdAt: new Date()
    };
  }
}

module.exports = ConsentTemplateModel;
