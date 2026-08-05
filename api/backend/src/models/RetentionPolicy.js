/**
 * Modelo de validação e estrutura para RetentionPolicy (RF014 #5/#7).
 *
 * Campos canônicos vêm de dict-02_DICIONARIO.md (P1X-0152..P1X-0155,
 * "Retenção e destino final" -> RetentionPolicy, ainda pendente de
 * consolidação formal no dicionário): triggerEvent, applicableEntityTypes,
 * postRetentionAction, effectivePeriod. BaseRecord.retentionPolicyId
 * (ELM-0021) referencia esta entidade como RetentionPolicy/uuid.
 *
 * retentionDurationDays não tem linha própria no dicionário ainda -- é o
 * complemento necessário para tornar triggerEvent+postRetentionAction
 * acionável (a janela de retenção em si), deixado como extensão de rascunho
 * Fase 1 até a consolidação formal apontada pelas próprias linhas P1X.
 *
 * Segue o padrão de versionamento de ConsentPolicy.js: um campo `version`
 * de texto e `active` para marcar a revisão vigente.
 */
const POST_RETENTION_ACTIONS = ['review', 'destroy', 'archive', 'anonymize'];

class RetentionPolicyModel {
  static validate(data) {
    const errors = [];

    if (!Array.isArray(data.applicableEntityTypes) || data.applicableEntityTypes.length === 0) {
      errors.push('applicableEntityTypes é obrigatório e deve ser um array não vazio');
    } else {
      data.applicableEntityTypes.forEach((entityType, index) => {
        if (typeof entityType !== 'string' || entityType.trim().length === 0) {
          errors.push(`applicableEntityTypes[${index}] deve ser um código de texto válido`);
        }
      });
    }

    if (!data.triggerEvent || typeof data.triggerEvent !== 'string' || data.triggerEvent.trim().length === 0) {
      errors.push('triggerEvent é obrigatório e deve ser um código de texto válido');
    }

    if (!data.postRetentionAction || !POST_RETENTION_ACTIONS.includes(data.postRetentionAction)) {
      errors.push(`postRetentionAction é obrigatório e deve ser um de: ${POST_RETENTION_ACTIONS.join(', ')}`);
    }

    if (
      data.retentionDurationDays === undefined ||
      data.retentionDurationDays === null ||
      typeof data.retentionDurationDays !== 'number' ||
      !Number.isInteger(data.retentionDurationDays) ||
      data.retentionDurationDays < 1
    ) {
      errors.push('retentionDurationDays é obrigatório e deve ser um inteiro positivo');
    }

    if (!data.version || typeof data.version !== 'string' || data.version.trim().length === 0) {
      errors.push('version é obrigatório e deve ser um texto válido');
    }

    const effectiveStart = data.effectivePeriod?.start;
    const effectiveEnd = data.effectivePeriod?.end;

    if (!effectiveStart || Number.isNaN(new Date(effectiveStart).getTime())) {
      errors.push('effectivePeriod.start é obrigatório e deve ser uma data válida');
    }

    if (effectiveEnd !== undefined && effectiveEnd !== null && Number.isNaN(new Date(effectiveEnd).getTime())) {
      errors.push('effectivePeriod.end deve ser uma data válida quando informado');
    }

    if (effectiveStart && effectiveEnd) {
      const start = new Date(effectiveStart);
      const end = new Date(effectiveEnd);
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end.getTime() < start.getTime()) {
        errors.push('effectivePeriod.end deve ser maior ou igual a effectivePeriod.start');
      }
    }

    if (data.active !== undefined && typeof data.active !== 'boolean') {
      errors.push('active deve ser booleano');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    return {
      applicableEntityTypes: [...data.applicableEntityTypes],
      triggerEvent: data.triggerEvent.trim(),
      postRetentionAction: data.postRetentionAction,
      retentionDurationDays: data.retentionDurationDays,
      version: data.version.trim(),
      description: typeof data.description === 'string' ? data.description.trim() : '',
      effectivePeriod: {
        start: new Date(data.effectivePeriod.start),
        end: data.effectivePeriod.end ? new Date(data.effectivePeriod.end) : null
      },
      active: data.active === undefined ? true : data.active,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

RetentionPolicyModel.POST_RETENTION_ACTIONS = POST_RETENTION_ACTIONS;

module.exports = RetentionPolicyModel;
