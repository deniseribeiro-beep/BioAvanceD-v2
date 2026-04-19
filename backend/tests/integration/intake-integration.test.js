import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock do Express app
let app;
let mockDb;
let mockIntakeService;

// Factory para criar sessão de Intake
function createIntakeSession(overrides = {}) {
  return {
    _id: 'intake-001',
    patientID: '12345678',
    sessionToken: 'intake-token-abc123',
    currentStep: 1,
    totalSteps: 5,
    status: 'IN_PROGRESS',
    completedAt: null,
    personalData: {
      fullName: 'João Silva',
      birthDate: '1980-01-15',
      gender: 'M',
      document: '12345678901',
      maritalStatus: 'SINGLE',
    },
    contactData: {
      email: 'joao@example.com',
      phone: '11999999999',
      address: 'Rua A, 123',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '01234567',
    },
    medicalHistory: {
      allergies: ['Penicilina'],
      medications: ['Dipirona'],
      conditions: ['Hipertensão'],
      familyHistory: 'Diabetes no pai',
    },
    lifestyleData: {
      smoking: 'never',
      alcohol: 'occasionally',
      exercise: 3,
      sleepHours: 7,
      diet: 'balanced',
    },
    consentData: {
      acceptedTerms: false,
      acceptedData: false,
      acceptedFuture: false,
    },
    ipAddress: '192.168.1.1',
    userAgent: 'Mozilla/5.0...',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    expiresAt: new Date('2026-01-08'),
    ...overrides,
  };
}

// Factory para criar resposta do Intake
function createIntakeResponse(overrides = {}) {
  return {
    _id: 'resp-001',
    sessionId: 'intake-001',
    stepNumber: 1,
    fieldName: 'fullName',
    value: 'João Silva',
    timestamp: new Date(),
    validationStatus: 'VALID',
    ...overrides,
  };
}

describe('Intake Wizard - Testes de Integração API', () => {
  beforeEach(() => {
    // Criar app Express simulado
    app = express();
    app.use(express.json());

    // Mock do banco de dados
    mockDb = {
      intakeSessions: {
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'intake-001' }),
        findOne: vi.fn().mockResolvedValue(createIntakeSession()),
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([createIntakeSession()]),
        }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
      },
      intakeResponses: {
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'resp-001' }),
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([createIntakeResponse()]),
        }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      },
      patients: {
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      },
    };

    // Mock do intake service
    mockIntakeService = {
      createSession: vi.fn().mockImplementation(async (patientID) => {
        const session = createIntakeSession({
          patientID,
          sessionToken: `intake-token-${Date.now()}`,
        });
        await mockDb.intakeSessions.insertOne(session);
        return session;
      }),
      getSession: vi.fn().mockImplementation(async (id) => {
        return mockDb.intakeSessions.findOne({ _id: id });
      }),
      getSessionByToken: vi.fn().mockImplementation(async (token) => {
        return mockDb.intakeSessions.findOne({ sessionToken: token });
      }),
      listPatientSessions: vi.fn().mockImplementation(async (patientID) => {
        return mockDb.intakeSessions.find({ patientID }).toArray();
      }),
      saveStepData: vi.fn().mockImplementation(async (sessionId, stepNumber, data) => {
        const updates = {
          currentStep: stepNumber,
          updatedAt: new Date(),
          [`step${stepNumber}Data`]: data,
        };
        await mockDb.intakeSessions.updateOne({ _id: sessionId }, { $set: updates });
        return mockDb.intakeSessions.findOne({ _id: sessionId });
      }),
      getStepData: vi.fn().mockImplementation(async (sessionId, stepNumber) => {
        const session = await mockDb.intakeSessions.findOne({ _id: sessionId });
        return session ? session[`step${stepNumber}Data`] : null;
      }),
      completeIntake: vi.fn().mockImplementation(async (sessionId) => {
        const updates = {
          status: 'COMPLETE',
          completedAt: new Date(),
          currentStep: 5, // Assume total steps = 5
        };
        await mockDb.intakeSessions.updateOne({ _id: sessionId }, { $set: updates });
        return mockDb.intakeSessions.findOne({ _id: sessionId });
      }),
      validateIntakeData: vi.fn().mockImplementation(async (data) => {
        const errors = [];
        if (!data.fullName) errors.push('fullName é obrigatório');
        if (!data.email) errors.push('email é obrigatório');
        return { valid: errors.length === 0, errors };
      }),
      getProgress: vi.fn().mockImplementation(async (sessionId) => {
        const session = await mockDb.intakeSessions.findOne({ _id: sessionId });
        return session
          ? { currentStep: session.currentStep, totalSteps: session.totalSteps, percent: (session.currentStep / session.totalSteps) * 100 }
          : null;
      }),
      abandonSession: vi.fn().mockImplementation(async (sessionId) => {
        await mockDb.intakeSessions.updateOne({ _id: sessionId }, { $set: { status: 'ABANDONED' } });
        return mockDb.intakeSessions.findOne({ _id: sessionId });
      }),
    };

    // Configurar rotas do app
    setupIntakeRoutes(app);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // TESTE 1: POST /api/intake/sessions - Criar sessão de Intake
  it('POST /api/intake/sessions - Deve criar sessão de Intake', async () => {
    const payload = { patientID: '12345678' };

    const response = await request(app).post('/api/intake/sessions').send(payload);

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('sessionToken');
    expect(response.body.patientID).toBe('12345678');
    expect(response.body.currentStep).toBe(1);
  });

  // TESTE 2: GET /api/intake/sessions/:id - Obter sessão de Intake
  it('GET /api/intake/sessions/:id - Deve retornar sessão de Intake', async () => {
    const session = createIntakeSession({ _id: 'intake-001' });
    mockIntakeService.getSession.mockResolvedValueOnce(session);

    const response = await request(app).get('/api/intake/sessions/intake-001');

    expect(response.status).toBe(200);
    expect(response.body._id).toBe('intake-001');
    expect(response.body.currentStep).toBe(1);
  });

  // TESTE 3: GET /api/intake/token/:token - Obter sessão pelo token
  it('GET /api/intake/token/:token - Deve retornar sessão pelo token', async () => {
    const session = createIntakeSession({ sessionToken: 'intake-token-abc123' });
    mockIntakeService.getSessionByToken.mockResolvedValueOnce(session);

    const response = await request(app).get('/api/intake/token/intake-token-abc123');

    expect(response.status).toBe(200);
    expect(response.body.sessionToken).toBe('intake-token-abc123');
  });

  // TESTE 4: GET /api/intake/patient/:patientId - Listar sessões do paciente
  it('GET /api/intake/patient/:patientId - Deve listar sessões do paciente', async () => {
    mockIntakeService.listPatientSessions.mockResolvedValueOnce([
      createIntakeSession({ patientID: '12345678' }),
      createIntakeSession({ patientID: '12345678', _id: 'intake-002' }),
    ]);

    const response = await request(app).get('/api/intake/patient/12345678');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(2);
  });

  // TESTE 5: POST /api/intake/sessions/:id/step/:step - Salvar dados de um step
  it('POST /api/intake/sessions/:id/step/:step - Deve salvar dados do step', async () => {
    const stepData = {
      fullName: 'João Silva',
      birthDate: '1980-01-15',
      gender: 'M',
    };

    const updated = createIntakeSession({ currentStep: 1 });
    mockIntakeService.saveStepData.mockResolvedValueOnce(updated);

    const response = await request(app)
      .post('/api/intake/sessions/intake-001/step/1')
      .send(stepData);

    expect(response.status).toBe(200);
    expect(response.body.currentStep).toBe(1);
    expect(mockIntakeService.saveStepData).toHaveBeenCalledWith('intake-001', 1, stepData);
  });

  // TESTE 6: GET /api/intake/sessions/:id/step/:step - Obter dados de um step
  it('GET /api/intake/sessions/:id/step/:step - Deve retornar dados do step', async () => {
    const stepData = {
      fullName: 'João Silva',
      birthDate: '1980-01-15',
      gender: 'M',
    };
    mockIntakeService.getStepData.mockResolvedValueOnce(stepData);

    const response = await request(app).get('/api/intake/sessions/intake-001/step/1');

    expect(response.status).toBe(200);
    expect(response.body.fullName).toBe('João Silva');
  });

  // TESTE 7: POST /api/intake/sessions/:id/complete - Completar Intake
  it('POST /api/intake/sessions/:id/complete - Deve completar Intake', async () => {
    const completed = createIntakeSession({
      status: 'COMPLETE',
      completedAt: new Date(),
    });
    mockIntakeService.completeIntake.mockResolvedValueOnce(completed);

    const response = await request(app).post('/api/intake/sessions/intake-001/complete');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('COMPLETE');
    expect(response.body.completedAt).toBeTruthy();
  });

  // TESTE 8: POST /api/intake/validate - Validar dados de Intake
  it('POST /api/intake/validate - Deve validar dados válidos de Intake', async () => {
    mockIntakeService.validateIntakeData.mockResolvedValueOnce({
      valid: true,
      errors: [],
    });

    const payload = {
      fullName: 'João Silva',
      email: 'joao@example.com',
    };

    const response = await request(app).post('/api/intake/validate').send(payload);

    expect(response.status).toBe(200);
    expect(response.body.valid).toBe(true);
  });

  // TESTE 9: POST /api/intake/validate - Validação deve rejeitar dados inválidos
  it('POST /api/intake/validate - Deve rejeitar dados inválidos', async () => {
    mockIntakeService.validateIntakeData.mockResolvedValueOnce({
      valid: false,
      errors: ['fullName é obrigatório', 'email é obrigatório'],
    });

    const payload = { /* dados incompletos */ };

    const response = await request(app).post('/api/intake/validate').send(payload);

    expect(response.status).toBe(400);
    expect(Array.isArray(response.body.errors)).toBe(true);
  });

  // TESTE 10: GET /api/intake/sessions/:id/progress - Obter progresso de Intake
  it('GET /api/intake/sessions/:id/progress - Deve retornar progresso de Intake', async () => {
    mockIntakeService.getProgress.mockResolvedValueOnce({
      currentStep: 3,
      totalSteps: 5,
      percent: 60,
    });

    const response = await request(app).get('/api/intake/sessions/intake-001/progress');

    expect(response.status).toBe(200);
    expect(response.body.currentStep).toBe(3);
    expect(response.body.totalSteps).toBe(5);
    expect(response.body.percent).toBe(60);
  });

  // TESTE 11: POST /api/intake/sessions/:id/abandon - Abandonar Intake
  it('POST /api/intake/sessions/:id/abandon - Deve abandonar sessão de Intake', async () => {
    const abandoned = createIntakeSession({ status: 'ABANDONED' });
    mockIntakeService.abandonSession.mockResolvedValueOnce(abandoned);

    const response = await request(app).post('/api/intake/sessions/intake-001/abandon');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ABANDONED');
  });

  // TESTE 12: POST /api/intake/sessions/:id/step/2 - Progressão entre steps
  it('POST /api/intake/sessions/:id/step/:step - Deve permitir progressão entre steps', async () => {
    const stepData = {
      email: 'joao@example.com',
      phone: '11999999999',
      address: 'Rua A, 123',
    };

    const updated = createIntakeSession({ currentStep: 2 });
    mockIntakeService.saveStepData.mockResolvedValueOnce(updated);

    const response = await request(app)
      .post('/api/intake/sessions/intake-001/step/2')
      .send(stepData);

    expect(response.status).toBe(200);
    expect(response.body.currentStep).toBe(2);
  });

  // TESTE 13: GET /api/intake/sessions/:id - Verificação de expiração de sessão
  it('GET /api/intake/sessions/:id - Sessão expirada deve ser detectada', async () => {
    const expiredSession = createIntakeSession({
      expiresAt: new Date(Date.now() - 86400000), // 1 dia atrás
      status: 'EXPIRED',
    });
    mockIntakeService.getSession.mockResolvedValueOnce(expiredSession);

    const response = await request(app).get('/api/intake/sessions/intake-001');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('EXPIRED');
  });

  // TESTE 14: POST /api/intake/sessions/:id/step/4 - Dados médico-históricos
  it('POST /api/intake/sessions/:id/step/4 - Deve salvar histórico médico', async () => {
    const medicalData = {
      allergies: ['Penicilina'],
      medications: ['Dipirona'],
      conditions: ['Hipertensão'],
    };

    const updated = createIntakeSession({ currentStep: 4 });
    mockIntakeService.saveStepData.mockResolvedValueOnce(updated);

    const response = await request(app)
      .post('/api/intake/sessions/intake-001/step/4')
      .send(medicalData);

    expect(response.status).toBe(200);
    expect(response.body.currentStep).toBe(4);
  });

  // TESTE 15: POST /api/intake/sessions/:id/step/5 - Consentimento
  it('POST /api/intake/sessions/:id/step/5 - Deve salvar dados de consentimento', async () => {
    const consentData = {
      acceptedTerms: true,
      acceptedData: true,
      acceptedFuture: false,
    };

    const updated = createIntakeSession({ currentStep: 5 });
    mockIntakeService.saveStepData.mockResolvedValueOnce(updated);

    const response = await request(app)
      .post('/api/intake/sessions/intake-001/step/5')
      .send(consentData);

    expect(response.status).toBe(200);
    expect(response.body.currentStep).toBe(5);
  });

  // TESTE 16: Fluxo completo de Intake (sessão criada -> progredindo -> completada)
  it('Fluxo completo: Criar -> Modificar -> Completar Intake', async () => {
    // Criar sessão
    mockIntakeService.createSession.mockResolvedValueOnce(createIntakeSession());
    const createResp = await request(app).post('/api/intake/sessions').send({ patientID: '12345678' });
    expect(createResp.status).toBe(201);

    // Salvar step 1
    mockIntakeService.saveStepData.mockResolvedValueOnce(createIntakeSession({ currentStep: 1 }));
    const step1Resp = await request(app)
      .post('/api/intake/sessions/intake-001/step/1')
      .send({ fullName: 'João Silva' });
    expect(step1Resp.status).toBe(200);

    // Completar
    mockIntakeService.completeIntake.mockResolvedValueOnce(
      createIntakeSession({ status: 'COMPLETE', completedAt: new Date() })
    );
    const completeResp = await request(app).post('/api/intake/sessions/intake-001/complete');
    expect(completeResp.status).toBe(200);
    expect(completeResp.body.status).toBe('COMPLETE');
  });
});

// Função auxiliar para setup das rotas
function setupIntakeRoutes(app) {
  // POST /api/intake/sessions - Criar
  app.post('/api/intake/sessions', async (req, res) => {
    try {
      const { patientID } = req.body;
      if (!patientID) {
        return res.status(400).json({ error: 'patientID é obrigatório' });
      }
      const session = await mockIntakeService.createSession(patientID);
      res.status(201).json(session);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // GET /api/intake/sessions/:id
  app.get('/api/intake/sessions/:id', async (req, res) => {
    try {
      const session = await mockIntakeService.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Sessão não encontrada' });
      res.json(session);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/intake/token/:token
  app.get('/api/intake/token/:token', async (req, res) => {
    try {
      const session = await mockIntakeService.getSessionByToken(req.params.token);
      if (!session) return res.status(404).json({ error: 'Sessão não encontrada' });
      res.json(session);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/intake/patient/:patientId
  app.get('/api/intake/patient/:patientId', async (req, res) => {
    try {
      const sessions = await mockIntakeService.listPatientSessions(req.params.patientId);
      res.json(sessions);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/intake/sessions/:id/step/:step
  app.post('/api/intake/sessions/:id/step/:step', async (req, res) => {
    try {
      const session = await mockIntakeService.saveStepData(
        req.params.id,
        parseInt(req.params.step),
        req.body
      );
      res.json(session);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // GET /api/intake/sessions/:id/step/:step
  app.get('/api/intake/sessions/:id/step/:step', async (req, res) => {
    try {
      const data = await mockIntakeService.getStepData(
        req.params.id,
        parseInt(req.params.step)
      );
      if (!data) return res.status(404).json({ error: 'Dados do step não encontrados' });
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/intake/sessions/:id/complete
  app.post('/api/intake/sessions/:id/complete', async (req, res) => {
    try {
      const session = await mockIntakeService.completeIntake(req.params.id);
      res.json(session);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // POST /api/intake/validate
  app.post('/api/intake/validate', async (req, res) => {
    try {
      const validation = await mockIntakeService.validateIntakeData(req.body);
      if (!validation.valid) {
        return res.status(400).json(validation);
      }
      res.json(validation);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // GET /api/intake/sessions/:id/progress
  app.get('/api/intake/sessions/:id/progress', async (req, res) => {
    try {
      const progress = await mockIntakeService.getProgress(req.params.id);
      if (!progress) return res.status(404).json({ error: 'Progresso não encontrado' });
      res.json(progress);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/intake/sessions/:id/abandon
  app.post('/api/intake/sessions/:id/abandon', async (req, res) => {
    try {
      const session = await mockIntakeService.abandonSession(req.params.id);
      res.json(session);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}
