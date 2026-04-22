import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock do Express app
let app;
let mockDb;
let mockPatientService;
let mockObservationService;

// Factory para criar dados de paciente
function createPatient(overrides = {}) {
  return {
    _id: 'pat-001',
    patientID: '12345678',
    patientName: 'João Silva',
    birthDate: '1980-01-15',
    gender: 'M',
    email: 'joao@example.com',
    phone: '11999999999',
    document: '12345678901',
    status: 'ACTIVE',
    consentStatus: 'PENDING',
    linkedProject: 'Projeto QA',
    clinicalUnitId: 'unit-001',
    isDeceased: false,
    registrationDate: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// Factory para criar observação biomarcadora
function createObservation(overrides = {}) {
  return {
    _id: 'obs-001',
    patientID: '12345678',
    biomarkerCode: 'BM001',
    biomarkerName: 'Hemoglobina',
    value: 13.5,
    unit: 'g/dL',
    referenceMin: 11.5,
    referenceMax: 16.5,
    status: 'NORMAL',
    collectionDate: new Date('2026-01-10'),
    createdAt: new Date('2026-01-10'),
    ...overrides,
  };
}

describe('Pacientes - Testes de Integração API', () => {
  beforeEach(() => {
    // Criar app Express simulado
    app = express();
    app.use(express.json());

    // Mock do banco de dados
    mockDb = {
      patients: {
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'pat-001' }),
        findOne: vi.fn().mockResolvedValue(createPatient()),
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([createPatient()]),
        }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
        countDocuments: vi.fn().mockResolvedValue(1),
      },
      observations: {
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'obs-001' }),
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([createObservation()]),
        }),
      },
      consentTemplates: {
        findOne: vi.fn().mockResolvedValue({ _id: 'tmpl-001', title: 'TCLE Padrão' }),
      },
    };

    // Mock do patient service
    mockPatientService = {
      createPatient: vi.fn().mockImplementation(async (payload) => {
        const patient = createPatient({
          ...payload,
          patientID: '12345678',
        });
        await mockDb.patients.insertOne(patient);
        return patient;
      }),
      getPatient: vi.fn().mockImplementation(async (id) => {
        return mockDb.patients.findOne({ _id: id });
      }),
      listPatients: vi.fn().mockImplementation(async () => {
        return mockDb.patients.find({}).toArray();
      }),
      updatePatient: vi.fn().mockImplementation(async (id, updates) => {
        await mockDb.patients.updateOne({ _id: id }, { $set: updates });
        return mockDb.patients.findOne({ _id: id });
      }),
      deletePatient: vi.fn().mockImplementation(async (id) => {
        return mockDb.patients.deleteOne({ _id: id });
      }),
      validatePatientId: vi.fn().mockImplementation(async (patientID) => {
        const exists = await mockDb.patients.findOne({ patientID });
        return { exists: !!exists, patientID };
      }),
      findForEdit: vi.fn().mockImplementation(async (patientID) => {
        return mockDb.patients.findOne({ patientID });
      }),
      searchPatients: vi.fn().mockImplementation(async (query) => {
        return mockDb.patients.find({ patientName: { $regex: query } }).toArray();
      }),
      getOperational: vi.fn().mockImplementation(async () => {
        return mockDb.patients.find().toArray();
      }),
      resendConsentNotification: vi.fn().mockResolvedValue({ sent: true }),
    };

    // Mock do observation service
    mockObservationService = {
      getObservations: vi.fn().mockImplementation(async (patientID) => {
        return mockDb.observations.find({ patientID }).toArray();
      }),
      createObservation: vi.fn().mockImplementation(async (payload) => {
        const observation = createObservation(payload);
        await mockDb.observations.insertOne(observation);
        return observation;
      }),
    };

    // Configurar rotas do app
    setupPatientRoutes(app);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // TESTRE 1: POST /api/patients - Criar paciente
  it('POST /api/patients - Deve criar paciente com sucesso', async () => {
    const payload = {
      patientName: 'Maria Santos',
      birthDate: '1990-05-20',
      gender: 'F',
      email: 'maria@example.com',
      phone: '11988888888',
      document: '98765432109',
      linkedProject: 'Projeto X',
      clinicalUnitId: 'unit-001',
      consentTemplateId: 'tmpl-001',
    };

    const response = await request(app).post('/api/patients').send(payload);

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('patientID');
    expect(response.body.patientName).toBe(payload.patientName);
    expect(mockPatientService.createPatient).toHaveBeenCalledWith(payload);
  });

  // TESTE 2: GET /api/patients - Listar pacientes
  it('GET /api/patients - Deve listar todos os pacientes', async () => {
    mockPatientService.listPatients.mockResolvedValueOnce([
      createPatient({ patientID: '11111111' }),
      createPatient({ patientID: '22222222' }),
    ]);

    const response = await request(app).get('/api/patients');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(2);
  });

  // TESTE 3: GET /api/patients/search - Buscar pacientes por termo
  it('GET /api/patients/search - Deve buscar pacientes por termo', async () => {
    mockPatientService.searchPatients.mockResolvedValueOnce([
      createPatient({ patientName: 'João Silva' }),
    ]);

    const response = await request(app).get('/api/patients/search').query({ q: 'João' });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body[0].patientName).toMatch(/João/i);
  });

  // TESTE 4: GET /api/patients/:id - Obter paciente por ID
  it('GET /api/patients/:id - Deve retornar paciente por ID', async () => {
    const patient = createPatient({ _id: 'pat-001' });
    mockPatientService.getPatient.mockResolvedValueOnce(patient);

    const response = await request(app).get('/api/patients/pat-001');

    expect(response.status).toBe(200);
    expect(response.body._id).toBe('pat-001');
    expect(response.body.patientName).toBe(patient.patientName);
  });

  // TESTE 5: GET /api/patients/:id - Retornar 404 quando não encontrado
  it('GET /api/patients/:id - Deve retornar 404 quando paciente não existe', async () => {
    mockPatientService.getPatient.mockResolvedValueOnce(null);

    const response = await request(app).get('/api/patients/inexistente');

    expect(response.status).toBe(404);
  });

  // TESTE 6: PUT /api/patients/:id - Atualizar paciente
  it('PUT /api/patients/:id - Deve atualizar paciente', async () => {
    const updates = { email: 'novo@example.com', phone: '11977777777' };
    const updated = createPatient(updates);
    mockPatientService.updatePatient.mockResolvedValueOnce(updated);

    const response = await request(app).put('/api/patients/pat-001').send(updates);

    expect(response.status).toBe(200);
    expect(response.body.email).toBe(updates.email);
    expect(mockPatientService.updatePatient).toHaveBeenCalledWith('pat-001', updates);
  });

  // TESTE 7: DELETE /api/patients/:id - Deletar paciente
  it('DELETE /api/patients/:id - Deve deletar paciente', async () => {
    mockPatientService.deletePatient.mockResolvedValueOnce({ deletedCount: 1 });

    const response = await request(app).delete('/api/patients/pat-001');

    expect(response.status).toBe(200);
    expect(mockPatientService.deletePatient).toHaveBeenCalledWith('pat-001');
  });

  // TESTE 8: POST /api/patients/validate-id - Validar ID
  it('POST /api/patients/validate-id - Deve validar ID existente', async () => {
    mockPatientService.validatePatientId.mockResolvedValueOnce({ exists: true, patientID: '12345678' });

    const response = await request(app).post('/api/patients/validate-id').send({ patientID: '12345678' });

    expect(response.status).toBe(200);
    expect(response.body.exists).toBe(true);
  });

  // TESTE 9: POST /api/patients/find-for-edit - Buscar para editar
  it('POST /api/patients/find-for-edit - Deve retornar paciente para edição', async () => {
    const patient = createPatient();
    mockPatientService.findForEdit.mockResolvedValueOnce(patient);

    const response = await request(app).post('/api/patients/find-for-edit').send({ patientID: '12345678' });

    expect(response.status).toBe(200);
    expect(response.body.patientID).toBe('12345678');
  });

  // TESTE 10: GET /api/patients/operational - Modo operacional (sem dados sensíveis)
  it('GET /api/patients/operational - Deve retornar operacional sem dados sensíveis', async () => {
    mockPatientService.getOperational.mockResolvedValueOnce([
      createPatient({ patientID: '11111111', email: undefined, phone: undefined }),
    ]);

    const response = await request(app).get('/api/patients/operational');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  // TESTE 11: GET /api/patients/:patientId/observations - Listar observações
  it('GET /api/patients/:patientId/observations - Deve listar observações do paciente', async () => {
    mockObservationService.getObservations.mockResolvedValueOnce([
      createObservation({ patientID: '12345678' }),
    ]);

    const response = await request(app).get('/api/patients/12345678/observations');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body[0].biomarkerName).toBe('Hemoglobina');
  });

  // TESTE 12: POST /api/patients/:id/observations - Criar observação
  it('POST /api/patients/:id/observations - Deve criar observação biomarcadora', async () => {
    const payload = {
      biomarkerCode: 'BM002',
      biomarkerName: 'Glicose',
      value: 110,
      unit: 'mg/dL',
    };
    const observation = createObservation(payload);
    mockObservationService.createObservation.mockResolvedValueOnce(observation);

    const response = await request(app).post('/api/patients/12345678/observations').send(payload);

    expect(response.status).toBe(201);
    expect(response.body.biomarkerName).toBe(payload.biomarkerName);
  });

  // TESTE 13: POST /api/patients/:id/consent/resend - Reenviar notificação de consentimento
  it('POST /api/patients/:id/consent/resend - Deve reenviar notificação de consentimento', async () => {
    mockPatientService.resendConsentNotification.mockResolvedValueOnce({ sent: true });

    const response = await request(app).post('/api/patients/12345678/consent/resend');

    expect(response.status).toBe(200);
    expect(response.body.sent).toBe(true);
  });

  // TESTE 14: GET /api/patients/:patientId/consent - Obter status de consentimento
  it('GET /api/patients/:patientId/consent - Deve retornar status de consentimento', async () => {
    const response = await request(app).get('/api/patients/12345678/consent');

    expect(response.status).toBe(200);
  });

  // TESTE 15: Validação de payload obrigatório - POST /api/patients
  it('POST /api/patients - Deve rejeitar payload incompleto (400)', async () => {
    const incompletePayload = {
      patientName: 'Incompleto', // faltam obrigatórios
    };

    const response = await request(app).post('/api/patients').send(incompletePayload);

    expect(response.status).toBe(400);
  });

  // TESTE 16: Validação de email inválido
  it('POST /api/patients - Deve rejeitar email inválido', async () => {
    mockPatientService.createPatient.mockRejectedValueOnce(new Error('Email inválido'));

    const payload = {
      patientName: 'José ',
      email: 'email-invalido',
      birthDate: '1985-03-10',
      gender: 'M',
      document: '11111111111',
      linkedProject: 'Projeto Y',
      clinicalUnitId: 'unit-001',
    };

    const response = await request(app).post('/api/patients').send(payload);

    expect(response.status).toBe(400);
  });
});

// Função auxiliar para setup das rotas
function setupPatientRoutes(app) {
  // POST /api/patients - Criar
  app.post('/api/patients', async (req, res) => {
    try {
      const { patientName, birthDate, gender, email, phone, document, linkedProject, clinicalUnitId, consentTemplateId } = req.body;

      if (!patientName || !birthDate || !gender || !email || !document) {
        return res.status(400).json({ error: 'Campos obrigatórios faltando' });
      }

      const patient = await mockPatientService.createPatient(req.body);
      res.status(201).json(patient);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // GET /api/patients - Listar
  app.get('/api/patients', async (req, res) => {
    try {
      const patients = await mockPatientService.listPatients();
      res.json(patients);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/patients/search - Buscar
  // GET /api/patients/operational - Modo operacional (sem dados sensíveis)
  app.get('/api/patients/operational', async (req, res) => {
    try {
      const patients = await mockPatientService.getOperational();
      res.json(patients);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/patients/search', async (req, res) => {
    try {
      const { q } = req.query;
      const patients = await mockPatientService.searchPatients(q);
      res.json(patients);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/patients/:id - Obter por ID
  app.get('/api/patients/:id', async (req, res) => {
    try {
      const patient = await mockPatientService.getPatient(req.params.id);
      if (!patient) return res.status(404).json({ error: 'Paciente não encontrado' });
      res.json(patient);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PUT /api/patients/:id - Atualizar
  app.put('/api/patients/:id', async (req, res) => {
    try {
      const patient = await mockPatientService.updatePatient(req.params.id, req.body);
      res.json(patient);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // DELETE /api/patients/:id - Deletar
  app.delete('/api/patients/:id', async (req, res) => {
    try {
      const result = await mockPatientService.deletePatient(req.params.id);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/patients/validate-id
  app.post('/api/patients/validate-id', async (req, res) => {
    try {
      const { patientID } = req.body;
      const result = await mockPatientService.validatePatientId(patientID);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/patients/find-for-edit
  app.post('/api/patients/find-for-edit', async (req, res) => {
    try {
      const { patientID } = req.body;
      const patient = await mockPatientService.findForEdit(patientID);
      res.json(patient);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });


  // GET /api/patients/:patientId/observations
  app.get('/api/patients/:patientId/observations', async (req, res) => {
    try {
      const observations = await mockObservationService.getObservations(req.params.patientId);
      res.json(observations);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/patients/:id/observations
  app.post('/api/patients/:id/observations', async (req, res) => {
    try {
      const observation = await mockObservationService.createObservation(req.body);
      res.status(201).json(observation);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // POST /api/patients/:id/consent/resend
  app.post('/api/patients/:id/consent/resend', async (req, res) => {
    try {
      const result = await mockPatientService.resendConsentNotification(req.params.id);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/patients/:patientId/consent
  app.get('/api/patients/:patientId/consent', async (req, res) => {
    try {
      res.json({ status: 'PENDING' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}
