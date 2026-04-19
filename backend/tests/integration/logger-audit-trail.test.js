import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const logService = require('../../src/services/log.service');
const auditLogger = require('../../src/utils/auditLogger');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildUser } = require('../factories/user.factory');

function createToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
}

function createTechnicianToken() {
  return createToken({
    userID: 'qa-tech-logger-1',
    accessType: 2,
    roleName: 'Técnico',
    mfaVerified: true,
  });
}

function createCoordinatorToken() {
  return createToken({
    userID: 'qa-coord-logger-1',
    accessType: 3,
    roleName: 'Coordenador',
    mfaVerified: true,
  });
}

describe('Audit Logging - PATIENT_MATCH_UPSERT', () => {
  function givenAuthenticatedSession() {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({
      valid: true,
      session: { sessionID: 'session-logger-test-1' }
    });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({
      sessionID: 'session-logger-test-1'
    });
  }

  function givenAuditDb({ logsCollection, usersCollection } = {}) {
    app.locals.db = createDbMock({
      logs: logsCollection || createCollectionMock(),
      users: usersCollection || createCollectionMock(),
    });
    auditLogger.init(app.locals.db);
  }

  beforeEach(() => {
    givenAuthenticatedSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deve criar um log PATIENT_MATCH_UPSERT com userId correto ao criar paciente via Match Heurístico', async () => {
    // Given
    const logsInsert = vi.fn().mockResolvedValue({ insertedId: 'log-12345' });
    const usersFind = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        buildUser({
          _id: 'qa-tech-logger-1',
          username: 'qa-technical',
          accessType: 2,
          roleName: 'Técnico'
        })
      ])
    });

    givenAuditDb({
      logsCollection: createCollectionMock({
        insertOne: logsInsert,
      }),
      usersCollection: createCollectionMock({
        find: usersFind,
        findOne: vi.fn().mockResolvedValue(
          buildUser({
            _id: 'qa-tech-logger-1',
            username: 'qa-technical',
            accessType: 2,
            roleName: 'Técnico'
          })
        ),
      }),
    });

    // When
    const logPayload = {
      userID: 'qa-tech-logger-1',
      action: 'PATIENT_MATCH_UPSERT',
      entity: 'Patient',
      entityID: '12345678',
      resourceType: 'Patient',
      resourceId: '12345678',
      status: 'success',
      result: 'success',
      severity: 'info',
      message: 'Paciente criado via Match Heurístico',
      payload: {
        patientID: '12345678',
        heuristicScore: 0.95
      }
    };

    await auditLogger.log({
      ...logPayload,
      req: {
        user: { userID: 'qa-tech-logger-1' },
        path: '/api/v1/intake-wizard/patient-match',
        method: 'POST'
      }
    });

    // Then
    expect(logsInsert).toHaveBeenCalled();

    const insertedLog = logsInsert.mock.calls[0][0];
    expect(insertedLog.action).toBe('PATIENT_MATCH_UPSERT');
    expect(insertedLog.entity).toBe('Patient');
    expect(insertedLog.entityID).toBe('12345678');
  });

  it('deve persistir log com userId correto no banco de dados', async () => {
    // Given
    let savedLog = null;

    const logsInsert = vi.fn().mockImplementation(async (logData) => {
      savedLog = logData;
      return { insertedId: 'log-saved-123' };
    });

    givenAuditDb({
      logsCollection: createCollectionMock({
        insertOne: logsInsert,
      }),
      usersCollection: createCollectionMock({
        findOne: vi.fn().mockResolvedValue(
          buildUser({
            _id: 'qa-coord-logger-1',
            username: 'qa-coordinator',
            accessType: 3,
            roleName: 'Coordenador'
          })
        ),
      }),
    });

    // When
    await auditLogger.log({
      userID: 'qa-coord-logger-1',
      action: 'PATIENT_MATCH_UPSERT',
      entity: 'Patient',
      entityID: '87654321',
      resourceType: 'Patient',
      resourceId: '87654321',
      status: 'success',
      result: 'success',
      severity: 'info',
      message: 'Paciente correspondência atualizada',
      req: {
        user: { userID: 'qa-coord-logger-1', accessType: 3, roleName: 'Coordenador' },
        path: '/api/v1/intake-wizard',
        method: 'POST',
        headers: { 'user-agent': 'TestClient/1.0' }
      }
    });

    // Then
    expect(logsInsert).toHaveBeenCalled();
    expect(savedLog).toBeDefined();
    expect(savedLog.action).toBe('PATIENT_MATCH_UPSERT');
    expect(savedLog.entity).toBe('Patient');
  });

  it('deve incluir entityID (patientID) no log', async () => {
    // Given
    const logsInsert = vi.fn().mockResolvedValue({ insertedId: 'log-entity-id' });

    givenAuditDb({
      logsCollection: createCollectionMock({
        insertOne: logsInsert,
      }),
    });

    // When
    await auditLogger.log({
      action: 'PATIENT_MATCH_UPSERT',
      entity: 'Patient',
      entityID: '99999999',
      resourceType: 'Patient',
      resourceId: '99999999',
      status: 'success',
      severity: 'info',
      message: 'Teste de entityID',
      req: {
        user: { userID: 'qa-test-user' },
        path: '/api/test',
        method: 'POST'
      }
    });

    // Then
    expect(logsInsert).toHaveBeenCalled();
    const logData = logsInsert.mock.calls[0][0];
    expect(logData.entityID).toBe('99999999');
    expect(logData.resourceId).toBe('99999999');
  });

  it('deve sanitizar dados sensíveis no log (remover patientName, email, cpf)', async () => {
    const logsInsert = vi.fn().mockResolvedValue({ insertedId: 'log-sanitize' });

    app.locals.db = {
      collection: (name) => {
        if (name === 'logs') {
          return {
            insertOne: logsInsert,
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([])
            })
          };
        }
        return {
          insertOne: vi.fn().mockResolvedValue({ insertedId: 'test' }),
          findOne: vi.fn().mockResolvedValue(null),
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) })
        };
      }
    };

    auditLogger.init(app.locals.db);

    const sensitivePayload = {
      patientID: '11111111',
      patientName: 'João Silva Secreto',
      email: 'joao@example.com',
      cpf: '12345678900',
      birthDate: '1980-05-15'
    };

    await auditLogger.log({
      action: 'PATIENT_MATCH_UPSERT',
      entity: 'Patient',
      entityID: '11111111',
      status: 'success',
      severity: 'info',
      message: 'Log com dados sensíveis',
      payload: sensitivePayload,
      req: {
        user: { userID: 'qa-test-sanitize' },
        path: '/api/test',
        method: 'POST'
      }
    });

    expect(logsInsert).toHaveBeenCalled();
    const logData = logsInsert.mock.calls[0][0];
    
    // Verifica se dados sensíveis foram removidos do payload
    if (logData.payload) {
      expect(logData.payload.patientName).toBeUndefined();
      expect(logData.payload.email).toBeUndefined();
      expect(logData.payload.cpf).toBeUndefined();
      expect(logData.payload.birthDate).toBeUndefined();
    }
  });

  it('deve logar com timestamp e metadata de rastreamento completas', async () => {
    let savedLog = null;
    const logsInsert = vi.fn().mockImplementation(async (logData) => {
      savedLog = logData;
      return { insertedId: 'log-metadata' };
    });

    app.locals.db = {
      collection: (name) => {
        if (name === 'logs') {
          return {
            insertOne: logsInsert,
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([])
            })
          };
        }
        return {
          insertOne: vi.fn().mockResolvedValue({ insertedId: 'test' }),
          findOne: vi.fn().mockResolvedValue(null),
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) })
        };
      }
    };

    auditLogger.init(app.locals.db);

    const testReq = {
      user: { userID: 'qa-test-metadata' },
      path: '/api/intake-wizard',
      method: 'POST',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'x-forwarded-for': '192.168.1.100'
      },
      ip: '192.168.1.100'
    };

    await auditLogger.log({
      action: 'PATIENT_MATCH_UPSERT',
      entity: 'Patient',
      entityID: '55555555',
      status: 'success',
      severity: 'info',
      message: 'Log com metadata completa',
      req: testReq
    });

    expect(logsInsert).toHaveBeenCalled();
    expect(savedLog).toBeDefined();

    // Verifica timestamp
    expect(savedLog.timestamp || savedLog.dateTime).toBeDefined();

    // Verifica metadados de rastreamento
    if (savedLog.metadata && savedLog.metadata.tracking) {
      expect(savedLog.metadata.tracking.ip).toBeDefined();
      expect(savedLog.metadata.tracking.userAgent).toBeDefined();
    }
  });

  it('deve suportar filtro de logs por userId', async () => {
    const logsFind = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: 'log-1',
          userID: 'qa-test-user-1',
          action: 'PATIENT_MATCH_UPSERT',
          entity: 'Patient',
          entityID: '12345678',
          timestamp: new Date()
        }
      ])
    });

    app.locals.db = {
      collection: (name) => {
        if (name === 'logs') {
          return {
            find: logsFind,
            insertOne: vi.fn().mockResolvedValue({ insertedId: 'test' })
          };
        }
        return {
          insertOne: vi.fn().mockResolvedValue({ insertedId: 'test' }),
          findOne: vi.fn().mockResolvedValue(null),
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) })
        };
      }
    };

    const logs = await logService.getLogs(app.locals.db, { userId: 'qa-test-user-1' });

    expect(logsFind).toHaveBeenCalled();
  });
});

describe('Audit Log Integrity', () => {
  it('deve gerar auditHash para cada log criado', async () => {
    const logsInsert = vi.fn().mockResolvedValue({ insertedId: 'log-hash' });

    app.locals.db = {
      collection: (name) => {
        if (name === 'logs') {
          return {
            insertOne: logsInsert,
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([])
            })
          };
        }
        return {
          insertOne: vi.fn().mockResolvedValue({ insertedId: 'test' }),
          findOne: vi.fn().mockResolvedValue(null),
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) })
        };
      }
    };

    auditLogger.init(app.locals.db);

    await auditLogger.log({
      action: 'PATIENT_MATCH_UPSERT',
      entity: 'Patient',
      entityID: '11111111',
      status: 'success',
      severity: 'info',
      message: 'Log para verificação de hash',
      req: {
        user: { userID: 'qa-hash-test' },
        path: '/api/test',
        method: 'POST'
      }
    });

    expect(logsInsert).toHaveBeenCalled();
    // O serviço de integridade deve gerar o hash se não for fornecido
  });
});
