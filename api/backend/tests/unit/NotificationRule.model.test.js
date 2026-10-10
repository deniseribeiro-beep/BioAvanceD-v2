import { describe, it, expect } from 'vitest';

const NotificationRuleModel = require('../../src/models/NotificationRule');

const VALID_PAYLOAD = {
  eventType: 'environmental_excursion',
  channels: ['in_app'],
  recipientRoleCodes: ['administrator'],
  sensitiveFieldsAllowlist: ['sensorId', 'temperatureValue'],
  maxDeliveryMinutes: 2,
  version: 'v1',
};

describe('NotificationRuleModel', () => {
  it('valida um payload completo', () => {
    const result = NotificationRuleModel.validate(VALID_PAYLOAD);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejeita payload vazio com todos os campos obrigatórios apontados', () => {
    const result = NotificationRuleModel.validate({});
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'eventType é obrigatório e deve ser um código de texto válido',
      'channels é obrigatório e deve ser um array não vazio',
      'recipientRoleCodes é obrigatório e deve ser um array não vazio',
      'maxDeliveryMinutes é obrigatório e deve ser um número positivo',
      'version é obrigatório e deve ser um texto válido',
    ]));
  });

  it('rejeita um canal fora do conjunto permitido', () => {
    const result = NotificationRuleModel.validate({ ...VALID_PAYLOAD, channels: ['sms'] });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('channels[0]'))).toBe(true);
  });

  it('rejeita maxDeliveryMinutes não positivo', () => {
    expect(NotificationRuleModel.validate({ ...VALID_PAYLOAD, maxDeliveryMinutes: 0 }).isValid).toBe(false);
    expect(NotificationRuleModel.validate({ ...VALID_PAYLOAD, maxDeliveryMinutes: -5 }).isValid).toBe(false);
  });

  it('aceita sensitiveFieldsAllowlist vazia (nenhum dado do payload sai na mensagem)', () => {
    const result = NotificationRuleModel.validate({ ...VALID_PAYLOAD, sensitiveFieldsAllowlist: [] });
    expect(result.isValid).toBe(true);
  });

  describe('escalation', () => {
    it('aceita escalation desabilitado sem exigir channel/afterFailures', () => {
      const result = NotificationRuleModel.validate({ ...VALID_PAYLOAD, escalation: { enabled: false } });
      expect(result.isValid).toBe(true);
    });

    it('rejeita escalation habilitado com channel fora do conjunto permitido', () => {
      const result = NotificationRuleModel.validate({
        ...VALID_PAYLOAD,
        escalation: { enabled: true, channel: 'sms', afterFailures: 1 },
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('escalation.channel'))).toBe(true);
    });

    it('rejeita escalation habilitado com afterFailures não inteiro/positivo', () => {
      const result = NotificationRuleModel.validate({
        ...VALID_PAYLOAD,
        escalation: { enabled: true, channel: 'in_app', afterFailures: 0 },
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('escalation.afterFailures'))).toBe(true);
    });
  });

  describe('create', () => {
    it('normaliza escalation.enabled=false para o objeto padrão, mesmo se channel/afterFailures vierem preenchidos', () => {
      const rule = NotificationRuleModel.create({
        ...VALID_PAYLOAD,
        escalation: { enabled: false, channel: 'email', afterFailures: 3 },
      });
      expect(rule.escalation).toEqual({ enabled: false, afterFailures: null, channel: null });
    });

    it('preserva escalation habilitado tal como informado', () => {
      const rule = NotificationRuleModel.create({
        ...VALID_PAYLOAD,
        escalation: { enabled: true, channel: 'in_app', afterFailures: 1 },
      });
      expect(rule.escalation).toEqual({ enabled: true, afterFailures: 1, channel: 'in_app' });
    });

    it('defaults active to true and copies arrays defensively', () => {
      const rule = NotificationRuleModel.create(VALID_PAYLOAD);
      expect(rule.active).toBe(true);
      rule.channels.push('email');
      expect(VALID_PAYLOAD.channels).toEqual(['in_app']);
    });

    it('#903: defaults retry to one attempt, and keeps a configured retry', () => {
      expect(NotificationRuleModel.create(VALID_PAYLOAD).retry).toEqual({ maxAttempts: 1, backoffSeconds: 0 });
      expect(NotificationRuleModel.create({ ...VALID_PAYLOAD, retry: { maxAttempts: 3, backoffSeconds: 5 } }).retry)
        .toEqual({ maxAttempts: 3, backoffSeconds: 5 });
    });
  });

  describe('purpose (#903, RF015 AC5)', () => {
    it('keeps a purpose code, defaults it to null, and refuses an empty one', () => {
      expect(NotificationRuleModel.create({ ...VALID_PAYLOAD, purpose: ' consent_governance ' }).purpose).toBe('consent_governance');
      expect(NotificationRuleModel.create(VALID_PAYLOAD).purpose).toBeNull();
      expect(NotificationRuleModel.validate({ ...VALID_PAYLOAD, purpose: '  ' }).errors.join()).toContain('purpose');
    });
  });

  describe('retry (#903, RNF026 AC2)', () => {
    it('accepts a bounded retry and refuses one out of bounds', () => {
      expect(NotificationRuleModel.validate({ ...VALID_PAYLOAD, retry: { maxAttempts: 3, backoffSeconds: 0 } }).isValid).toBe(true);
      const errors = (retry) => NotificationRuleModel.validate({ ...VALID_PAYLOAD, retry }).errors.join(' | ');
      expect(errors({ maxAttempts: 0 })).toContain('retry.maxAttempts');
      expect(errors({ maxAttempts: 11 })).toContain('retry.maxAttempts');
      expect(errors({ maxAttempts: 2, backoffSeconds: -1 })).toContain('retry.backoffSeconds');
      expect(errors('three')).toContain('retry deve ser um objeto');
    });
  });
});
