import { describe, it, expect, vi, beforeEach } from 'vitest';

const securityServiceModule = await import('../../src/services/security.service');
const securityService = securityServiceModule.default || securityServiceModule;

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
    expect(csv).toContain('"admin-1"');
  });

  it('deve atualizar permissões e auditar mudanças', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const db = {
      collection: vi.fn((name) => {
        if (name === 'security_permissions') {
          return { updateOne };
        }

        if (name === 'logs') {
          return {
            insertOne: vi.fn().mockResolvedValue({ insertedId: 'log-1' }),
          };
        }

        return {
          updateOne: vi.fn(),
          insertOne: vi.fn().mockResolvedValue({ insertedId: 'generic-1' }),
        };
      }),
    };

    const currentPermissions = {
      '4': { manageSecurity: true, viewReports: true },
    };

    const newPermissions = {
      '4': { manageSecurity: false, viewReports: true },
    };

    const req = {
      user: { userID: 'admin-1' },
      headers: {
        'x-forwarded-for': '127.0.0.1',
        'user-agent': 'vitest',
      },
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
      t: (key) => key,
    };
    const result = await securityService.updatePermissions(db, newPermissions, currentPermissions, req);

    expect(result['4'].manageSecurity).toBe(false);
    expect(updateOne).toHaveBeenCalled();
  });

  it('deve rejeitar permissões com perfil inválido', () => {
    expect(() => securityService.validatePermissions({
      '9': { viewReports: true },
    })).toThrow(/Perfil inválido/);
  });
});
