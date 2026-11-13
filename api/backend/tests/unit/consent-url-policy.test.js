import { afterEach, describe, expect, it } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

function createService({ nodeEnv, frontendUrl }) {
  process.env.NODE_ENV = nodeEnv;
  process.env.FRONTEND_URL = frontendUrl;
  const { NotificationService } = require('../../src/services/NotificationService');
  return new NotificationService();
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('consent frontend URL policy', () => {
  it.each(['localhost', '127.0.0.1', '[::1]'])('permite HTTP local em desenvolvimento: %s', (host) => {
    const service = createService({ nodeEnv: 'development', frontendUrl: `http://${host}:5173` });
    expect(service.buildConsentLink({ participantId: '00000001' }, 'token')).toContain('/patients/00000001/consent');
  }, 20_000);

  it('bloqueia convite remoto em HTTP local antes do provedor', () => {
    const service = createService({ nodeEnv: 'development', frontendUrl: 'http://localhost:5173' });
    expect(() => service.validateFrontendUrl({ remote: true })).toThrowError(
      expect.objectContaining({ code: 'CONSENT_REMOTE_HTTPS_REQUIRED' })
    );
  });

  it('bloqueia HTTP não local em desenvolvimento', () => {
    const service = createService({ nodeEnv: 'development', frontendUrl: 'http://consent.example.test' });
    expect(() => service.validateFrontendUrl()).toThrowError(
      expect.objectContaining({ code: 'CONSENT_FRONTEND_HTTPS_REQUIRED' })
    );
  });

  it('bloqueia HTTP em produção', () => {
    const service = createService({ nodeEnv: 'production', frontendUrl: 'http://localhost:5173' });
    expect(() => service.validateFrontendUrl()).toThrowError(
      expect.objectContaining({ code: 'CONSENT_FRONTEND_HTTPS_REQUIRED' })
    );
  });

  it('permite URL HTTPS externamente acessível para convite remoto', () => {
    const service = createService({ nodeEnv: 'production', frontendUrl: 'https://consent.example.test' });
    expect(service.validateFrontendUrl({ remote: true }).protocol).toBe('https:');
  });
});
