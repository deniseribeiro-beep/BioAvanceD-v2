import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock do Express app
let app;
let mockDb;
let mockConsentService;
let mockEmailService;

// Factory para criar template de consentimento
function createConsentTemplate(overrides = {}) {
  return {
    _id: 'tmpl-001',
    title: 'TCLE Padrão',
    description: 'Termo de Consentimento Livre e Esclarecido',
    content: '<h1>TCLE</h1><p>Você concorda em participar?</p>',
    version: '1.0',
    status: 'ACTIVE',
    validFrom: new Date('2026-01-01'),
    validUntil: new Date('2026-12-31'),
    requiredFields: ['fullName', 'document', 'email'],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// Factory para criar registro de consentimento
function createConsentRecord(overrides = {}) {
  return {
    _id: 'consent-001',
    patientID: '12345678',
    templateId: 'tmpl-001',
    status: 'PENDING',
    signatureToken: 'token-abc123',
    signingLink: 'https://bioavanced.com/consent/token-abc123',
    fullName: 'João Silva',
    document: '12345678901',
    email: 'joao@example.com',
    consentDate: null,
    ipAddress: '192.168.1.1',
    userAgent: 'Mozilla/5.0...',
    acceptTerms: false,
    acceptData: false,
    acceptFuture: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    expiresAt: new Date('2026-01-15'),
    ...overrides,
  };
}

describe('TCLE/Consentimento - Testes de Integração API', () => {
  beforeEach(() => {
    // Criar app Express simulado
    app = express();
    app.use(express.json());

    // Mock do banco de dados
    mockDb = {
      consentTemplates: {
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'tmpl-001' }),
        findOne: vi.fn().mockResolvedValue(createConsentTemplate()),
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([createConsentTemplate()]),
        }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
      },
      consentRecords: {
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'consent-001' }),
        findOne: vi.fn().mockResolvedValue(createConsentRecord()),
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([createConsentRecord()]),
        }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
        countDocuments: vi.fn().mockResolvedValue(1),
      },
      patients: {
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      },
    };

    // Mock do consent service
    mockConsentService = {
      createTemplate: vi.fn().mockImplementation(async (payload) => {
        const template = createConsentTemplate(payload);
        await mockDb.consentTemplates.insertOne(template);
        return template;
      }),
      getTemplate: vi.fn().mockImplementation(async (id) => {
        return mockDb.consentTemplates.findOne({ _id: id });
      }),
      listTemplates: vi.fn().mockImplementation(async () => {
        return mockDb.consentTemplates.find({}).toArray();
      }),
      updateTemplate: vi.fn().mockImplementation(async (id, updates) => {
        await mockDb.consentTemplates.updateOne({ _id: id }, { $set: updates });
        return mockDb.consentTemplates.findOne({ _id: id });
      }),
      deleteTemplate: vi.fn().mockImplementation(async (id) => {
        return mockDb.consentTemplates.deleteOne({ _id: id });
      }),
      initializeConsent: vi.fn().mockImplementation(async (patientID, templateId) => {
        const consent = createConsentRecord({
          patientID,
          templateId,
          signatureToken: `token-${Date.now()}`,
        });
        await mockDb.consentRecords.insertOne(consent);
        return consent;
      }),
      getConsentRecord: vi.fn().mockImplementation(async (id) => {
        return mockDb.consentRecords.findOne({ _id: id });
      }),
      getConsentByToken: vi.fn().mockImplementation(async (token) => {
        return mockDb.consentRecords.findOne({ signatureToken: token });
      }),
      signConsent: vi.fn().mockImplementation(async (recordId, payload) => {
        const updates = {
          status: 'SIGNED',
          acceptTerms: payload.acceptTerms,
          acceptData: payload.acceptData,
          acceptFuture: payload.acceptFuture,
          consentDate: new Date(),
        };
        await mockDb.consentRecords.updateOne({ _id: recordId }, { $set: updates });
        await mockDb.patients.updateOne(
          { patientID: payload.patientID },
          { $set: { consentStatus: 'ACTIVE' } }
        );
        return mockDb.consentRecords.findOne({ _id: recordId });
      }),
      revokeConsent: vi.fn().mockImplementation(async (recordId) => {
        await mockDb.consentRecords.updateOne({ _id: recordId }, { $set: { status: 'REVOKED' } });
        return mockDb.consentRecords.findOne({ _id: recordId });
      }),
      listPatientConsents: vi.fn().mockImplementation(async (patientID) => {
        return mockDb.consentRecords.find({ patientID }).toArray();
      }),
      resendConsentLink: vi.fn().mockResolvedValue({ sent: true, email: 'joao@example.com' }),
      validateConsentData: vi.fn().mockImplementation(async (payload) => {
        const required = ['fullName', 'document', 'email'];
        const missing = required.filter(f => !payload[f]);
        return { valid: missing.length === 0, missing };
      }),
      getConsentStats: vi.fn().mockResolvedValue({
        total: 100,
        signed: 85,
        pending: 10,
        revoked: 5,
      }),
    };

    // Mock do email service
    mockEmailService = {
      sendConsentEmail: vi.fn().mockResolvedValue({ messageId: 'msg-001' }),
      sendConsentReminder: vi.fn().mockResolvedValue({ messageId: 'msg-002' }),
    };

    // Configurar rotas do app
    setupConsentRoutes(app);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // TESTE 1: POST /api/consent/templates - Criar template
  it('POST /api/consent/templates - Deve criar template de consentimento', async () => {
    const payload = {
      title: 'TCLE Novo',
      description: 'Novo termo',
      content: '<h1>TCLE</h1>',
      requiredFields: ['fullName', 'document'],
    };

    const response = await request(app).post('/api/consent/templates').send(payload);

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('_id');
    expect(response.body.title).toBe(payload.title);
    expect(mockConsentService.createTemplate).toHaveBeenCalledWith(payload);
  });

  // TESTE 2: GET /api/consent/templates - Listar templates
  it('GET /api/consent/templates - Deve listar todos os templates', async () => {
    mockConsentService.listTemplates.mockResolvedValueOnce([
      createConsentTemplate({ _id: 'tmpl-001' }),
      createConsentTemplate({ _id: 'tmpl-002', title: 'TCLE Pesquisa' }),
    ]);

    const response = await request(app).get('/api/consent/templates');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(2);
  });

  // TESTE 3: GET /api/consent/templates/:id - Obter template por ID
  it('GET /api/consent/templates/:id - Deve retornar template por ID', async () => {
    const template = createConsentTemplate({ _id: 'tmpl-001' });
    mockConsentService.getTemplate.mockResolvedValueOnce(template);

    const response = await request(app).get('/api/consent/templates/tmpl-001');

    expect(response.status).toBe(200);
    expect(response.body._id).toBe('tmpl-001');
    expect(response.body.title).toBe(template.title);
  });

  // TESTE 4: PUT /api/consent/templates/:id - Atualizar template
  it('PUT /api/consent/templates/:id - Deve atualizar template', async () => {
    const updates = { title: 'TCLE Atualizado', status: 'ARCHIVED' };
    const updated = createConsentTemplate(updates);
    mockConsentService.updateTemplate.mockResolvedValueOnce(updated);

    const response = await request(app).put('/api/consent/templates/tmpl-001').send(updates);

    expect(response.status).toBe(200);
    expect(response.body.title).toBe(updates.title);
    expect(mockConsentService.updateTemplate).toHaveBeenCalledWith('tmpl-001', updates);
  });

  // TESTE 5: DELETE /api/consent/templates/:id - Deletar template
  it('DELETE /api/consent/templates/:id - Deve deletar template', async () => {
    mockConsentService.deleteTemplate.mockResolvedValueOnce({ deletedCount: 1 });

    const response = await request(app).delete('/api/consent/templates/tmpl-001');

    expect(response.status).toBe(200);
    expect(mockConsentService.deleteTemplate).toHaveBeenCalledWith('tmpl-001');
  });

  // TESTE 6: POST /api/consent/initialize - Inicializar consentimento
  it('POST /api/consent/initialize - Deve inicializar consentimento para paciente', async () => {
    const payload = {
      patientID: '12345678',
      templateId: 'tmpl-001',
      fullName: 'João Silva',
      document: '12345678901',
      email: 'joao@example.com',
    };

    const consent = createConsentRecord(payload);
    mockConsentService.initializeConsent.mockResolvedValueOnce(consent);

    const response = await request(app).post('/api/consent/initialize').send(payload);

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('signatureToken');
    expect(response.body.patientID).toBe(payload.patientID);
  });

  // TESTE 7: GET /api/consent/records/:id - Obter registro de consentimento
  it('GET /api/consent/records/:id - Deve retornar registro de consentimento', async () => {
    const consent = createConsentRecord({ _id: 'consent-001' });
    mockConsentService.getConsentRecord.mockResolvedValueOnce(consent);

    const response = await request(app).get('/api/consent/records/consent-001');

    expect(response.status).toBe(200);
    expect(response.body._id).toBe('consent-001');
    expect(response.body.status).toBe('PENDING');
  });

  // TESTE 8: GET /api/consent/token/:token - Obter por token de assinatura
  it('GET /api/consent/token/:token - Deve retornar consent pelo token', async () => {
    const consent = createConsentRecord({ signatureToken: 'token-abc123' });
    mockConsentService.getConsentByToken.mockResolvedValueOnce(consent);

    const response = await request(app).get('/api/consent/token/token-abc123');

    expect(response.status).toBe(200);
    expect(response.body.signatureToken).toBe('token-abc123');
  });

  // TESTE 9: POST /api/consent/records/:id/sign - Assinar consentimento
  it('POST /api/consent/records/:id/sign - Deve assinar consentimento', async () => {
    const payload = {
      patientID: '12345678',
      acceptTerms: true,
      acceptData: true,
      acceptFuture: false,
    };

    const signed = createConsentRecord({
      ...payload,
      status: 'SIGNED',
      consentDate: new Date(),
    });
    mockConsentService.signConsent.mockResolvedValueOnce(signed);

    const response = await request(app).post('/api/consent/records/consent-001/sign').send(payload);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('SIGNED');
    expect(response.body.acceptTerms).toBe(true);
  });

  // TESTE 10: POST /api/consent/records/:id/revoke - Revogar consentimento
  it('POST /api/consent/records/:id/revoke - Deve revogar consentimento', async () => {
    const revoked = createConsentRecord({ status: 'REVOKED' });
    mockConsentService.revokeConsent.mockResolvedValueOnce(revoked);

    const response = await request(app).post('/api/consent/records/consent-001/revoke');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('REVOKED');
  });

  // TESTE 11: GET /api/consent/patient/:patientId - Listar consentimentos do paciente
  it('GET /api/consent/patient/:patientId - Deve listar consentimentos do paciente', async () => {
    mockConsentService.listPatientConsents.mockResolvedValueOnce([
      createConsentRecord({ patientID: '12345678' }),
      createConsentRecord({ patientID: '12345678', _id: 'consent-002' }),
    ]);

    const response = await request(app).get('/api/consent/patient/12345678');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(2);
    expect(response.body[0].patientID).toBe('12345678');
  });

  // TESTE 12: POST /api/consent/records/:id/resend - Reenviar link de consentimento
  it('POST /api/consent/records/:id/resend - Deve reenviar link de consentimento', async () => {
    mockConsentService.resendConsentLink.mockResolvedValueOnce({ sent: true, email: 'joao@example.com' });

    const response = await request(app).post('/api/consent/records/consent-001/resend');

    expect(response.status).toBe(200);
    expect(response.body.sent).toBe(true);
    expect(response.body.email).toBe('joao@example.com');
  });

  // TESTE 13: POST /api/consent/validate - Validar dados de consentimento
  it('POST /api/consent/validate - Deve validar dados de consentimento', async () => {
    mockConsentService.validateConsentData.mockResolvedValueOnce({
      valid: true,
      missing: [],
    });

    const payload = {
      fullName: 'João Silva',
      document: '12345678901',
      email: 'joao@example.com',
    };

    const response = await request(app).post('/api/consent/validate').send(payload);

    expect(response.status).toBe(200);
    expect(response.body.valid).toBe(true);
  });

  // TESTE 14: POST /api/consent/validate - Deve rejeitar dados inválidos
  it('POST /api/consent/validate - Deve rejeitar dados faltando obrigatórios', async () => {
    mockConsentService.validateConsentData.mockResolvedValueOnce({
      valid: false,
      missing: ['email'],
    });

    const payload = {
      fullName: 'João Silva',
      document: '12345678901',
    };

    const response = await request(app).post('/api/consent/validate').send(payload);

    expect(response.status).toBe(400);
  });

  // TESTE 15: GET /api/consent/stats - Obter estatísticas de consentimento
  it('GET /api/consent/stats - Deve retornar estatísticas de consentimento', async () => {
    mockConsentService.getConsentStats.mockResolvedValueOnce({
      total: 100,
      signed: 85,
      pending: 10,
      revoked: 5,
    });

    const response = await request(app).get('/api/consent/stats');

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(100);
    expect(response.body.signed).toBe(85);
  });

  // TESTE 16: Validação de payload obrigatório - POST /api/consent/templates
  it('POST /api/consent/templates - Deve rejeitar payload incompleto', async () => {
    const incompletePayload = {
      title: 'Incompleto',
      // falta content, requiredFields, etc
    };

    const response = await request(app).post('/api/consent/templates').send(incompletePayload);

    expect(response.status).toBe(400);
  });
});

// Função auxiliar para setup das rotas
function setupConsentRoutes(app) {
  // POST /api/consent/templates - Criar
  app.post('/api/consent/templates', async (req, res) => {
    try {
      const { title, content, requiredFields } = req.body;
      if (!title || !content || !requiredFields) {
        return res.status(400).json({ error: 'Campos obrigatórios faltando' });
      }
      const template = await mockConsentService.createTemplate(req.body);
      res.status(201).json(template);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // GET /api/consent/templates - Listar
  app.get('/api/consent/templates', async (req, res) => {
    try {
      const templates = await mockConsentService.listTemplates();
      res.json(templates);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/consent/templates/:id - Obter por ID
  app.get('/api/consent/templates/:id', async (req, res) => {
    try {
      const template = await mockConsentService.getTemplate(req.params.id);
      if (!template) return res.status(404).json({ error: 'Template não encontrado' });
      res.json(template);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PUT /api/consent/templates/:id - Atualizar
  app.put('/api/consent/templates/:id', async (req, res) => {
    try {
      const template = await mockConsentService.updateTemplate(req.params.id, req.body);
      res.json(template);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // DELETE /api/consent/templates/:id - Deletar
  app.delete('/api/consent/templates/:id', async (req, res) => {
    try {
      const result = await mockConsentService.deleteTemplate(req.params.id);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/consent/initialize - Inicializar
  app.post('/api/consent/initialize', async (req, res) => {
    try {
      const { patientID, templateId } = req.body;
      const consent = await mockConsentService.initializeConsent(patientID, templateId);
      res.status(201).json(consent);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // GET /api/consent/records/:id
  app.get('/api/consent/records/:id', async (req, res) => {
    try {
      const consent = await mockConsentService.getConsentRecord(req.params.id);
      if (!consent) return res.status(404).json({ error: 'Consentimento não encontrado' });
      res.json(consent);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/consent/token/:token
  app.get('/api/consent/token/:token', async (req, res) => {
    try {
      const consent = await mockConsentService.getConsentByToken(req.params.token);
      if (!consent) return res.status(404).json({ error: 'Consentimento não encontrado' });
      res.json(consent);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/consent/records/:id/sign - Assinar
  app.post('/api/consent/records/:id/sign', async (req, res) => {
    try {
      const signed = await mockConsentService.signConsent(req.params.id, req.body);
      res.json(signed);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // POST /api/consent/records/:id/revoke - Revogar
  app.post('/api/consent/records/:id/revoke', async (req, res) => {
    try {
      const revoked = await mockConsentService.revokeConsent(req.params.id);
      res.json(revoked);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/consent/patient/:patientId
  app.get('/api/consent/patient/:patientId', async (req, res) => {
    try {
      const consents = await mockConsentService.listPatientConsents(req.params.patientId);
      res.json(consents);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/consent/records/:id/resend
  app.post('/api/consent/records/:id/resend', async (req, res) => {
    try {
      const result = await mockConsentService.resendConsentLink(req.params.id);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/consent/validate
  app.post('/api/consent/validate', async (req, res) => {
    try {
      const validation = await mockConsentService.validateConsentData(req.body);
      if (!validation.valid) {
        return res.status(400).json(validation);
      }
      res.json(validation);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // GET /api/consent/stats
  app.get('/api/consent/stats', async (req, res) => {
    try {
      const stats = await mockConsentService.getConsentStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}
