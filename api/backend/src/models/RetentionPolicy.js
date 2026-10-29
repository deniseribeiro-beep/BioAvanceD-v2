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
 *
 * #1286: which obligation a deployment can cite for audit logs, from the
 * primary texts as read on 2026-10-06. RF026 AC#1 binds a policy to its
 * jurisdiction, basis, period and starting event; these are the bases.
 * - Resolução CNS nº 441/2011, item 11, I: every five years from its
 *   constitution, or whenever CONEP asks, the institution responsible for a
 *   biobank reports to CEP/CONEP the number of research subjects included in
 *   the period and the research that used stored samples. The audit rows
 *   evidencing sample inclusion and use are what that report rests on, so an
 *   archive policy for them can cite this item with archiveRetentionPeriod
 *   "P5Y". The resolution sets a reporting period, not a log-retention
 *   period, so P5Y is the floor it implies, and citing it is the deployment's
 *   call.
 * - Lei nº 12.965/2014 (Marco Civil da Internet), art. 15: six months of
 *   application access records ("P6M"), but only for a provider that is a
 *   legal entity acting "profissionalmente e com fins econômicos". CNS 441's
 *   item 1, I defines a biobank as "sem fins comerciais", so a biobank's
 *   operator cites it only if it is in fact such a provider. Its §1 and §2
 *   (a court order, or an authority's request, to keep specific records) are
 *   holds on named records, not a standing period.
 * - Health-record retention (Lei nº 13.787/2018, CFM resolutions) was not
 *   checked: it binds a patient record, and this audit trail is not one.
 */
const { isValidISO8601Duration, iso8601DurationToMs } = require('../utils/iso8601Duration');
const { DISPOSITION_ACTIONS } = require('./DispositionAction');

const POST_RETENTION_ACTIONS = ['review', 'destroy', 'archive', 'anonymize'];

// #1315 (RF026 AC1/AC2): v2.0.0's jurisdiction (V2E-0486), retentionBasis
// (ELM-0409), legalHoldRules (V2E-0487) and reviewRequired (V2E-0488), each
// required. A legal-hold rule names the condition and the disposition it
// blocks, as the catalog's example {"when":"legalHold=true","block":"destroy"}.
// The one condition the system evaluates is an active legal hold, so `when`
// accepts that value only: a rule on a condition nothing checks would read
// as enforced and never be.
const LEGAL_HOLD_RULE_CONDITIONS = ['legalHold=true'];

function isRetentionBasisEntry(entry) {
  if (typeof entry === 'string') return entry.trim().length > 0;
  if (!entry || typeof entry !== 'object') return false;
  return (typeof entry.text === 'string' && entry.text.trim().length > 0)
    || (Array.isArray(entry.coding) && entry.coding.length > 0);
}

class RetentionPolicyModel {
  static validate(data) {
    const errors = [];

    if (typeof data.jurisdiction !== 'string' || data.jurisdiction.trim().length === 0) {
      errors.push('jurisdiction é obrigatório e deve ser um código de texto válido (ex.: "BR")');
    }

    if (!Array.isArray(data.retentionBasis) || data.retentionBasis.length === 0) {
      errors.push('retentionBasis é obrigatório e deve ser um array não vazio');
    } else if (!data.retentionBasis.every(isRetentionBasisEntry)) {
      errors.push('retentionBasis deve conter um texto ou um conceito codificado ({ text } ou { coding }) por item');
    }

    if (!Array.isArray(data.legalHoldRules) || data.legalHoldRules.length === 0) {
      errors.push('legalHoldRules é obrigatório e deve ser um array não vazio');
    } else {
      data.legalHoldRules.forEach((rule, index) => {
        if (!rule || typeof rule !== 'object' || !LEGAL_HOLD_RULE_CONDITIONS.includes(rule.when)) {
          errors.push(`legalHoldRules[${index}].when deve ser um de: ${LEGAL_HOLD_RULE_CONDITIONS.join(', ')}`);
        }
        if (!rule || !DISPOSITION_ACTIONS.includes(rule.block)) {
          errors.push(`legalHoldRules[${index}].block deve ser um de: ${DISPOSITION_ACTIONS.join(', ')}`);
        }
      });
    }

    if (typeof data.reviewRequired !== 'boolean') {
      errors.push('reviewRequired é obrigatório e deve ser booleano');
    }

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
      jurisdiction: data.jurisdiction.trim(),
      retentionBasis: data.retentionBasis.map((entry) => (typeof entry === 'string' ? entry.trim() : entry)),
      legalHoldRules: data.legalHoldRules.map(({ when, block }) => ({ when, block })),
      reviewRequired: data.reviewRequired,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

RetentionPolicyModel.POST_RETENTION_ACTIONS = POST_RETENTION_ACTIONS;
RetentionPolicyModel.LEGAL_HOLD_RULE_CONDITIONS = LEGAL_HOLD_RULE_CONDITIONS;

module.exports = RetentionPolicyModel;
