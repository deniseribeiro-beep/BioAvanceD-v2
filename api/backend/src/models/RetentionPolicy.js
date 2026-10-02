/**
 * Modelo de validação e estrutura para RetentionPolicy (RF014 #5/#7).
 *
 * Campos canônicos vêm de dict-02_DICIONARIO.md (P1X-0152..P1X-0155,
 * "Retenção e destino final" -> RetentionPolicy, ainda pendente de
 * consolidação formal no dicionário): triggerEvent, applicableEntityTypes,
 * postRetentionAction, effectivePeriod. BaseRecord.retentionPolicyId
 * (ELM-0021) referencia esta entidade como RetentionPolicy/uuid.
 *
 * retentionPeriod (#444) é o campo canônico ELM-0410 ("Prazo e evento
 * inicial de contagem", BackboneElement, formato ISO 8601, mapeia para
 * Consent.provision.period) -- uma duração ISO 8601 (ex.: "P365D") que,
 * combinada com triggerEvent (o evento inicial de contagem, P1X-0152),
 * define a janela de retenção. Substitui o rascunho Fase 1
 * `retentionDurationDays` (inteiro de dias), que não tinha linha própria
 * no dicionário.
 *
 * #1271: archiveRetentionPeriod and archiveRetentionBasis, optional and only
 * with postRetentionAction 'archive'. Archived rows still carry pseudonymised
 * personal data, and LGPD art. 16 ends their treatment when its purpose ends
 * unless one of its four grounds applies; for audit logs only I ("cumprimento
 * de obrigação legal ou regulatória pelo controlador") can. So the archive keeps
 * a row only for the period of an obligation the deployment cites: the period
 * mirrors ELM-0410 retentionPeriod (ISO 8601, counted from the row's own
 * createdAt, so never shorter than retentionPeriod), and the basis mirrors
 * ELM-0409 retentionBasis ("Base ética, legal, contratual ou científica").
 * The two come together or not at all. Without them the sweep deletes instead
 * of archiving (retentionSweep.service).
 */
const { isValidISO8601Duration, iso8601DurationToMs } = require('../utils/iso8601Duration');

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

    if (!isValidISO8601Duration(data.retentionPeriod)) {
      errors.push('retentionPeriod é obrigatório e deve ser uma duração ISO 8601 válida (ex.: "P365D")');
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

    // #1271: the archive's own period and the obligation it rests on.
    const hasArchivePeriod = data.archiveRetentionPeriod !== undefined && data.archiveRetentionPeriod !== null;
    const hasArchiveBasis = data.archiveRetentionBasis !== undefined && data.archiveRetentionBasis !== null;
    if (hasArchivePeriod || hasArchiveBasis) {
      if (data.postRetentionAction !== 'archive') {
        errors.push('archiveRetentionPeriod e archiveRetentionBasis só se aplicam a postRetentionAction "archive"');
      }
      if (!hasArchivePeriod || !hasArchiveBasis) {
        errors.push('archiveRetentionPeriod e archiveRetentionBasis vêm juntos: o prazo do arquivo é o da obrigação legal ou regulatória citada');
      }
      if (hasArchiveBasis && (typeof data.archiveRetentionBasis !== 'string' || data.archiveRetentionBasis.trim().length === 0)) {
        errors.push('archiveRetentionBasis deve citar a obrigação legal ou regulatória (texto não vazio)');
      }
      if (hasArchivePeriod) {
        if (!isValidISO8601Duration(data.archiveRetentionPeriod)) {
          errors.push('archiveRetentionPeriod deve ser uma duração ISO 8601 válida (ex.: "P5Y")');
        } else if (isValidISO8601Duration(data.retentionPeriod)
          && iso8601DurationToMs(data.archiveRetentionPeriod) < iso8601DurationToMs(data.retentionPeriod)) {
          errors.push('archiveRetentionPeriod não pode ser menor que retentionPeriod: ambos contam a partir do registro');
        }
      }
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
      retentionPeriod: data.retentionPeriod,
      version: data.version.trim(),
      description: typeof data.description === 'string' ? data.description.trim() : '',
      effectivePeriod: {
        start: new Date(data.effectivePeriod.start),
        end: data.effectivePeriod.end ? new Date(data.effectivePeriod.end) : null
      },
      active: data.active === undefined ? true : data.active,
      archiveRetentionPeriod: data.archiveRetentionPeriod || null,
      archiveRetentionBasis: typeof data.archiveRetentionBasis === 'string' ? data.archiveRetentionBasis.trim() : null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

RetentionPolicyModel.POST_RETENTION_ACTIONS = POST_RETENTION_ACTIONS;

module.exports = RetentionPolicyModel;
