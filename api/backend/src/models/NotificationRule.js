/**
 * Modelo de validação e estrutura para NotificationRule (RF015 AC#1/#5,
 * RNF026). Sem linha própria em dict-02_DICIONARIO.md ainda -- RF015 não é
 * um item RED (dict-07/dict-08 não o cita), mas também não tem entidade
 * documentada; este é o desenho Fase-1 desta sessão, versionado do mesmo
 * jeito que RetentionPolicy.js (RF014, #440) para manter o padrão do
 * repositório: cada update cria uma nova versão em vez de mutar a atual.
 */
const ALLOWED_CHANNELS = ['email', 'in_app'];

class NotificationRuleModel {
  static validate(data) {
    const errors = [];

    if (!data.eventType || typeof data.eventType !== 'string' || data.eventType.trim().length === 0) {
      errors.push('eventType é obrigatório e deve ser um código de texto válido');
    }

    if (!Array.isArray(data.channels) || data.channels.length === 0) {
      errors.push('channels é obrigatório e deve ser um array não vazio');
    } else {
      data.channels.forEach((channel, index) => {
        if (!ALLOWED_CHANNELS.includes(channel)) {
          errors.push(`channels[${index}] deve ser um de: ${ALLOWED_CHANNELS.join(', ')}`);
        }
      });
    }

    if (!Array.isArray(data.recipientRoleCodes) || data.recipientRoleCodes.length === 0) {
      errors.push('recipientRoleCodes é obrigatório e deve ser um array não vazio');
    }

    // AC#5 - allowlist explícita do que pode sair na mensagem; vazio é
    // válido (nenhum dado do payload é incluído, apenas o eventType).
    if (data.sensitiveFieldsAllowlist !== undefined && !Array.isArray(data.sensitiveFieldsAllowlist)) {
      errors.push('sensitiveFieldsAllowlist deve ser um array quando informado');
    }

    if (data.escalation !== undefined && data.escalation !== null) {
      if (typeof data.escalation !== 'object') {
        errors.push('escalation deve ser um objeto quando informado');
      } else if (data.escalation.enabled) {
        if (!ALLOWED_CHANNELS.includes(data.escalation.channel)) {
          errors.push(`escalation.channel deve ser um de: ${ALLOWED_CHANNELS.join(', ')}`);
        }
        if (!Number.isInteger(data.escalation.afterFailures) || data.escalation.afterFailures < 1) {
          errors.push('escalation.afterFailures deve ser um inteiro >= 1');
        }
      }
    }

    // RNF026 AC#1 - alertas críticos em até 2 minutos p95; maxDeliveryMinutes
    // é o valor da regra que a proof de SLA (AC#7) compara contra a duração
    // real de entrega. Sem teto arbitrário além de positivo -- regras
    // não-críticas podem legitimamente aceitar uma janela maior.
    if (!Number.isFinite(data.maxDeliveryMinutes) || data.maxDeliveryMinutes <= 0) {
      errors.push('maxDeliveryMinutes é obrigatório e deve ser um número positivo');
    }

    if (!data.version || typeof data.version !== 'string' || data.version.trim().length === 0) {
      errors.push('version é obrigatório e deve ser um texto válido');
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
      eventType: data.eventType.trim(),
      channels: [...data.channels],
      recipientRoleCodes: [...data.recipientRoleCodes],
      sensitiveFieldsAllowlist: Array.isArray(data.sensitiveFieldsAllowlist) ? [...data.sensitiveFieldsAllowlist] : [],
      escalation: data.escalation && data.escalation.enabled
        ? { enabled: true, afterFailures: data.escalation.afterFailures, channel: data.escalation.channel }
        : { enabled: false, afterFailures: null, channel: null },
      maxDeliveryMinutes: data.maxDeliveryMinutes,
      version: data.version.trim(),
      description: typeof data.description === 'string' ? data.description.trim() : '',
      active: data.active === undefined ? true : data.active,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

NotificationRuleModel.ALLOWED_CHANNELS = ALLOWED_CHANNELS;

module.exports = NotificationRuleModel;
