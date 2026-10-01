import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const securityService = require('../../src/services/security.service');

describe('SecurityService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve validar regras de configuração e rejeitar mfaMethod inválido', () => {
    expect(() => securityService.validateConfig({
      authentication: { mfaMethod: 'push' },
    })).toThrow(/mfaMethod/);
  });

  it('deve validar timeout de sessão dentro dos limites esperados', () => {
    expect(() => securityService.validateConfig({
      session: { timeoutMinutes: 4 },
    })).toThrow(/timeoutMinutes/);
  });

  it('deve detectar mudanças aninhadas em configuração', () => {
    const changes = securityService.detectChanges(
      { authentication: { requireMFA: true } },
      { authentication: { requireMFA: false } }
    );

    expect(changes).toEqual([
      {
        path: 'authentication.requireMFA',
        oldValue: true,
        newValue: false,
      },
    ]);
  });

  it('deve retornar severidade critical para trilhas sensíveis', () => {
    expect(securityService.getSeverityForChange('authentication.requireMFA')).toBe('critical');
    expect(securityService.getSeverityForChange('logging.retentionDays')).toBe('warning');
  });

  it('deve exportar logs em CSV com cabeçalho e conteúdo', async () => {
    const toArray = vi.fn().mockResolvedValue([
      {
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
        userID: 'admin-1',
        action: 'UPDATE',
        entity: 'SecurityConfig',
        severity: 'warning',
        module: 'Segurança',
        message: 'Atualização',
      },
    ]);

    const db = {
      collection: vi.fn(() => ({
        find: vi.fn(() => ({
          sort: vi.fn(() => ({
            limit: vi.fn(() => ({ toArray })),
          })),
        })),
      })),
    };

    const csv = await securityService.exportLogs(db, { severity: 'warning' }, 'csv');

    expect(csv).toContain('timestamp,userID,action,entity,severity,module,message');
    // #1267: the export carries the pseudonym, never the raw user id.
    expect(csv).not.toContain('admin-1');
    expect(csv).toMatch(/"USR-[^"]+"/);
  });
});
