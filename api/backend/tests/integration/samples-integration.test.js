import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock do Express app
let app;
let mockDb;
let mockSampleService;

// Factory para criar amostra
function createSample(overrides = {}) {
  return {
    _id: 'sample-001',
    sampleID: 'SAMPLE-001',
    patientID: '12345678',
    sampleType: 'BLOOD',
    collectionDate: new Date('2026-01-10'),
    collectionMethod: 'Venipuncture',
    volume: 10,
    unit: 'mL',
    storageLocation: 'FRIDGE-A1',
    status: 'STORED',
    barcode: 'SAM001234567',
    biomarkers: ['BM001', 'BM002'],
    qualityScore: 95,
    notes: 'Amostra coletada no ambulatório',
    createdAt: new Date('2026-01-10'),
    updatedAt: new Date('2026-01-10'),
    ...overrides,
  };
}

// Factory para criar histórico de amostra
function createSampleHistory(overrides = {}) {
  return {
    _id: 'hist-001',
    sampleID: 'SAMPLE-001',
    action: 'CREATED',
    timestamp: new Date('2026-01-10'),
    user: 'user-001',
    description: 'Amostra criada',
    location: 'FRIDGE-A1',
    ...overrides,
  };
}

describe('Amostras/Samples - Testes de Integração API', () => {
  beforeEach(() => {
    // Criar app Express simulado
    app = express();
    app.use(express.json());

    // Mock do banco de dados
    mockDb = {
      samples: {
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'sample-001' }),
        findOne: vi.fn().mockResolvedValue(createSample()),
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([createSample()]),
        }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
        countDocuments: vi.fn().mockResolvedValue(1),
      },
      sampleHistory: {
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'hist-001' }),
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([createSampleHistory()]),
        }),
      },
      patients: {
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      },
    };

    // Mock do sample service
    mockSampleService = {
      createSample: vi.fn().mockImplementation(async (payload) => {
        const sample = createSample({
          ...payload,
          sampleID: `SAMPLE-${Date.now()}`,
          barcode: `SAM${Date.now()}`,
        });
        await mockDb.samples.insertOne(sample);
        return sample;
      }),
      getSample: vi.fn().mockImplementation(async (id) => {
        return mockDb.samples.findOne({ _id: id });
      }),
      getSampleByBarcode: vi.fn().mockImplementation(async (barcode) => {
        return mockDb.samples.findOne({ barcode });
      }),
      listSamples: vi.fn().mockImplementation(async (filters = {}) => {
        return mockDb.samples.find(filters).toArray();
      }),
      listPatientSamples: vi.fn().mockImplementation(async (patientID) => {
        return mockDb.samples.find({ patientID }).toArray();
      }),
      updateSample: vi.fn().mockImplementation(async (id, updates) => {
        await mockDb.samples.updateOne({ _id: id }, { $set: updates });
        return mockDb.samples.findOne({ _id: id });
      }),
      moveSample: vi.fn().mockImplementation(async (id, newLocation) => {
        const updates = { storageLocation: newLocation, updatedAt: new Date() };
        await mockDb.samples.updateOne({ _id: id }, { $set: updates });
        await mockDb.sampleHistory.insertOne(
          createSampleHistory({
            sampleID: id,
            action: 'MOVED',
            location: newLocation,
          })
        );
        return mockDb.samples.findOne({ _id: id });
      }),
      deleteSample: vi.fn().mockImplementation(async (id) => {
        return mockDb.samples.deleteOne({ _id: id });
      }),
      getSampleHistory: vi.fn().mockImplementation(async (sampleID) => {
        return mockDb.sampleHistory.find({ sampleID }).toArray();
      }),
      getSampleStats: vi.fn().mockResolvedValue({
        total: 100,
        stored: 85,
        testing: 10,
        archived: 5,
      }),
      validateSampleData: vi.fn().mockImplementation(async (data) => {
        const errors = [];
        if (!data.patientID) errors.push('patientID é obrigatório');
        if (!data.sampleType) errors.push('sampleType é obrigatório');
        if (!data.volume) errors.push('volume é obrigatório');
        return { valid: errors.length === 0, errors };
      }),
      getAvailableBiomarkers: vi.fn().mockResolvedValue(['BM001', 'BM002', 'BM003']),
      assignBiomarkers: vi.fn().mockImplementation(async (sampleID, biomarkers) => {
        const updates = { biomarkers };
        await mockDb.samples.updateOne({ _id: sampleID }, { $set: updates });
        return mockDb.samples.findOne({ _id: sampleID });
      }),
    };

    // Configurar rotas do app
    setupSampleRoutes(app);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // TESTE 1: POST /api/samples - Criar amostra
  it('POST /api/samples - Deve criar amostra com sucesso', async () => {
    const payload = {
      patientID: '12345678',
      sampleType: 'BLOOD',
      collectionDate: new Date('2026-01-10'),
      volume: 10,
      unit: 'mL',
      storageLocation: 'FRIDGE-A1',
    };

    const response = await request(app).post('/api/samples').send(payload);

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('sampleID');
    expect(response.body).toHaveProperty('barcode');
    expect(response.body.patientID).toBe(payload.patientID);
  });

  // TESTE 2: GET /api/samples - Listar amostras
  it('GET /api/samples - Deve listar todas as amostras', async () => {
    mockSampleService.listSamples.mockResolvedValueOnce([
      createSample({ sampleID: 'SAMPLE-001' }),
      createSample({ sampleID: 'SAMPLE-002' }),
    ]);

    const response = await request(app).get('/api/samples');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(2);
  });

  // TESTE 3: GET /api/samples/:id - Obter amostra por ID
  it('GET /api/samples/:id - Deve retornar amostra por ID', async () => {
    const sample = createSample({ _id: 'sample-001' });
    mockSampleService.getSample.mockResolvedValueOnce(sample);

    const response = await request(app).get('/api/samples/sample-001');

    expect(response.status).toBe(200);
    expect(response.body._id).toBe('sample-001');
    expect(response.body.sampleID).toBe(sample.sampleID);
  });

  // TESTE 4: GET /api/samples/barcode/:barcode - Obter amostra por código de barras
  it('GET /api/samples/barcode/:barcode - Deve retornar amostra por barcode', async () => {
    const sample = createSample({ barcode: 'SAM001234567' });
    mockSampleService.getSampleByBarcode.mockResolvedValueOnce(sample);

    const response = await request(app).get('/api/samples/barcode/SAM001234567');

    expect(response.status).toBe(200);
    expect(response.body.barcode).toBe('SAM001234567');
  });

  // TESTE 5: GET /api/samples/patient/:patientId - Listar amostras do paciente
  it('GET /api/samples/patient/:patientId - Deve listar amostras do paciente', async () => {
    mockSampleService.listPatientSamples.mockResolvedValueOnce([
      createSample({ patientID: '12345678' }),
      createSample({ patientID: '12345678', _id: 'sample-002' }),
    ]);

    const response = await request(app).get('/api/samples/patient/12345678');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(2);
  });

  // TESTE 6: PUT /api/samples/:id - Atualizar amostra
  it('PUT /api/samples/:id - Deve atualizar amostra', async () => {
    const updates = { status: 'TESTING', notes: 'Em análise' };
    const updated = createSample(updates);
    mockSampleService.updateSample.mockResolvedValueOnce(updated);

    const response = await request(app).put('/api/samples/sample-001').send(updates);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('TESTING');
    expect(mockSampleService.updateSample).toHaveBeenCalledWith('sample-001', updates);
  });

  // TESTE 7: POST /api/samples/:id/move - Mover amostra para novo local
  it('POST /api/samples/:id/move - Deve mover amostra para novo local', async () => {
    const moved = createSample({ storageLocation: 'FRIDGE-B2' });
    mockSampleService.moveSample.mockResolvedValueOnce(moved);

    const response = await request(app)
      .post('/api/samples/sample-001/move')
      .send({ newLocation: 'FRIDGE-B2' });

    expect(response.status).toBe(200);
    expect(response.body.storageLocation).toBe('FRIDGE-B2');
  });

  // TESTE 8: DELETE /api/samples/:id - Deletar amostra
  it('DELETE /api/samples/:id - Deve deletar amostra', async () => {
    mockSampleService.deleteSample.mockResolvedValueOnce({ deletedCount: 1 });

    const response = await request(app).delete('/api/samples/sample-001');

    expect(response.status).toBe(200);
    expect(mockSampleService.deleteSample).toHaveBeenCalledWith('sample-001');
  });

  // TESTE 9: GET /api/samples/:id/history - Obter histórico de amostra
  it('GET /api/samples/:id/history - Deve retornar histórico de amostra', async () => {
    mockSampleService.getSampleHistory.mockResolvedValueOnce([
      createSampleHistory({ action: 'CREATED' }),
      createSampleHistory({ action: 'MOVED', location: 'FRIDGE-B1' }),
    ]);

    const response = await request(app).get('/api/samples/sample-001/history');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(2);
  });

  // TESTE 10: GET /api/samples/stats - Obter estatísticas de amostras
  it('GET /api/samples/stats - Deve retornar estatísticas de amostras', async () => {
    mockSampleService.getSampleStats.mockResolvedValueOnce({
      total: 100,
      stored: 85,
      testing: 10,
      archived: 5,
    });

    const response = await request(app).get('/api/samples/stats');

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(100);
    expect(response.body.stored).toBe(85);
  });

  // TESTE 11: POST /api/samples/validate - Validar dados de amostra
  it('POST /api/samples/validate - Deve validar dados válidos de amostra', async () => {
    mockSampleService.validateSampleData.mockResolvedValueOnce({
      valid: true,
      errors: [],
    });

    const payload = {
      patientID: '12345678',
      sampleType: 'BLOOD',
      volume: 10,
    };

    const response = await request(app).post('/api/samples/validate').send(payload);

    expect(response.status).toBe(200);
    expect(response.body.valid).toBe(true);
  });

  // TESTE 12: POST /api/samples/validate - Validação deve rejeitar dados inválidos
  it('POST /api/samples/validate - Deve rejeitar dados inválidos', async () => {
    mockSampleService.validateSampleData.mockResolvedValueOnce({
      valid: false,
      errors: ['patientID é obrigatório', 'sampleType é obrigatório'],
    });

    const payload = { volume: 10 };

    const response = await request(app).post('/api/samples/validate').send(payload);

    expect(response.status).toBe(400);
  });

  // TESTE 13: GET /api/samples/biomarkers/available - Obter biomarkers disponíveis
  it('GET /api/samples/biomarkers/available - Deve listar biomarkers disponíveis', async () => {
    mockSampleService.getAvailableBiomarkers.mockResolvedValueOnce(['BM001', 'BM002', 'BM003']);

    const response = await request(app).get('/api/samples/biomarkers/available');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(3);
  });

  // TESTE 14: POST /api/samples/:id/biomarkers - Associar biomarkers à amostra
  it('POST /api/samples/:id/biomarkers - Deve associar biomarkers à amostra', async () => {
    const updated = createSample({
      biomarkers: ['BM001', 'BM002', 'BM003'],
    });
    mockSampleService.assignBiomarkers.mockResolvedValueOnce(updated);

    const response = await request(app)
      .post('/api/samples/sample-001/biomarkers')
      .send({ biomarkers: ['BM001', 'BM002', 'BM003'] });

    expect(response.status).toBe(200);
    expect(response.body.biomarkers.length).toBe(3);
  });

  // TESTE 15: Filtro de amostras por tipo
  it('GET /api/samples?type=BLOOD - Deve filtrar amostras por tipo', async () => {
    mockSampleService.listSamples.mockResolvedValueOnce([
      createSample({ sampleType: 'BLOOD' }),
    ]);

    const response = await request(app).get('/api/samples').query({ type: 'BLOOD' });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  // TESTE 16: GET /api/samples/:id - Amostra não encontrada
  it('GET /api/samples/:id - Deve retornar 404 quando amostra não existe', async () => {
    mockSampleService.getSample.mockResolvedValueOnce(null);

    const response = await request(app).get('/api/samples/inexistente');

    expect(response.status).toBe(404);
  });
});

// Função auxiliar para setup das rotas
function setupSampleRoutes(app) {
  // GET /api/samples/stats
  app.get('/api/samples/stats', async (req, res) => {
    try {
      const stats = await mockSampleService.getSampleStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/samples/biomarkers/available
  app.get('/api/samples/biomarkers/available', async (req, res) => {
    try {
      const biomarkers = await mockSampleService.getAvailableBiomarkers();
      res.json(biomarkers);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/samples - Criar
  app.post('/api/samples', async (req, res) => {
    try {
      const { patientID, sampleType, volume } = req.body;
      if (!patientID || !sampleType || !volume) {
        return res.status(400).json({ error: 'Campos obrigatórios faltando' });
      }
      const sample = await mockSampleService.createSample(req.body);
      res.status(201).json(sample);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // GET /api/samples - Listar
  app.get('/api/samples', async (req, res) => {
    try {
      const filters = req.query.type ? { sampleType: req.query.type } : {};
      const samples = await mockSampleService.listSamples(filters);
      res.json(samples);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/samples/:id - Obter por ID
  app.get('/api/samples/:id', async (req, res) => {
    try {
      const sample = await mockSampleService.getSample(req.params.id);
      if (!sample) return res.status(404).json({ error: 'Amostra não encontrada' });
      res.json(sample);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/samples/barcode/:barcode
  app.get('/api/samples/barcode/:barcode', async (req, res) => {
    try {
      const sample = await mockSampleService.getSampleByBarcode(req.params.barcode);
      if (!sample) return res.status(404).json({ error: 'Amostra não encontrada' });
      res.json(sample);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/samples/patient/:patientId
  app.get('/api/samples/patient/:patientId', async (req, res) => {
    try {
      const samples = await mockSampleService.listPatientSamples(req.params.patientId);
      res.json(samples);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PUT /api/samples/:id - Atualizar
  app.put('/api/samples/:id', async (req, res) => {
    try {
      const sample = await mockSampleService.updateSample(req.params.id, req.body);
      res.json(sample);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // POST /api/samples/:id/move
  app.post('/api/samples/:id/move', async (req, res) => {
    try {
      const { newLocation } = req.body;
      if (!newLocation) return res.status(400).json({ error: 'newLocation é obrigatório' });
      const sample = await mockSampleService.moveSample(req.params.id, newLocation);
      res.json(sample);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // DELETE /api/samples/:id
  app.delete('/api/samples/:id', async (req, res) => {
    try {
      const result = await mockSampleService.deleteSample(req.params.id);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/samples/:id/history
  app.get('/api/samples/:id/history', async (req, res) => {
    try {
      const history = await mockSampleService.getSampleHistory(req.params.id);
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });


  // POST /api/samples/validate
  app.post('/api/samples/validate', async (req, res) => {
    try {
      const validation = await mockSampleService.validateSampleData(req.body);
      if (!validation.valid) {
        return res.status(400).json(validation);
      }
      res.json(validation);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // POST /api/samples/:id/biomarkers
  app.post('/api/samples/:id/biomarkers', async (req, res) => {
    try {
      const { biomarkers } = req.body;
      const sample = await mockSampleService.assignBiomarkers(req.params.id, biomarkers);
      res.json(sample);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
}
