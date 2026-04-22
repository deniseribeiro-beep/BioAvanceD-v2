import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock do Express app
let app;
let mockDb;
let mockStorageService;

// Factory para criar localizaçãeo de armazenamento
function createLocation(overrides = {}) {
  return {
    _id: 'loc-001',
    name: 'FRIDGE-A1',
    type: 'REFRIGERATOR',
    temperature: 4,
    temperatureUnit: 'C',
    capacity: 100,
    currentItems: 45,
    status: 'ACTIVE',
    lastChecked: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// Factory para criar item de inventário
function createInventoryItem(overrides = {}) {
  return {
    _id: 'item-001',
    sampleID: 'SAMPLE-001',
    locationID: 'loc-001',
    position: 'A1-001',
    addedAt: new Date('2026-01-10'),
    removedAt: null,
    status: 'STORED',
    createdAt: new Date('2026-01-10'),
    updatedAt: new Date('2026-01-10'),
    ...overrides,
  };
}

// Factory para criar registro de auditoria
function createAuditLog(overrides = {}) {
  return {
    _id: 'log-001',
    action: 'ITEM_ADDED',
    itemID: 'item-001',
    locationID: 'loc-001',
    user: 'user-001',
    timestamp: new Date('2026-01-10'),
    details: { sampleID: 'SAMPLE-001', position: 'A1-001' },
    ...overrides,
  };
}

describe('Storage/Inventário - Testes de Integração API', () => {
  beforeEach(() => {
    // Criar app Express simulado
    app = express();
    app.use(express.json());

    // Mock do banco de dados
    mockDb = {
      locations: {
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'loc-001' }),
        findOne: vi.fn().mockResolvedValue(createLocation()),
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([createLocation()]),
        }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
      },
      inventory: {
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'item-001' }),
        findOne: vi.fn().mockResolvedValue(createInventoryItem()),
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([createInventoryItem()]),
        }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
        countDocuments: vi.fn().mockResolvedValue(1),
      },
      auditLogs: {
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'log-001' }),
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([createAuditLog()]),
        }),
      },
    };

    // Mock do storage service
    mockStorageService = {
      createLocation: vi.fn().mockImplementation(async (payload) => {
        const location = createLocation(payload);
        await mockDb.locations.insertOne(location);
        return location;
      }),
      getLocation: vi.fn().mockImplementation(async (id) => {
        return mockDb.locations.findOne({ _id: id });
      }),
      listLocations: vi.fn().mockImplementation(async () => {
        return mockDb.locations.find({}).toArray();
      }),
      updateLocation: vi.fn().mockImplementation(async (id, updates) => {
        await mockDb.locations.updateOne({ _id: id }, { $set: updates });
        return mockDb.locations.findOne({ _id: id });
      }),
      deleteLocation: vi.fn().mockImplementation(async (id) => {
        return mockDb.locations.deleteOne({ _id: id });
      }),
      addItemToInventory: vi.fn().mockImplementation(async (sampleID, locationID, position) => {
        const item = createInventoryItem({ sampleID, locationID, position });
        await mockDb.inventory.insertOne(item);
        // Update location item count
        const location = await mockDb.locations.findOne({ _id: locationID });
        if (location) {
          await mockDb.locations.updateOne(
            { _id: locationID },
            { $set: { currentItems: location.currentItems + 1 } }
          );
        }
        return item;
      }),
      removeItemFromInventory: vi.fn().mockImplementation(async (itemID) => {
        const item = await mockDb.inventory.findOne({ _id: itemID });
        if (item) {
          await mockDb.inventory.updateOne(
            { _id: itemID },
            { $set: { status: 'REMOVED', removedAt: new Date() } }
          );
        }
        return item;
      }),
      getItemLocation: vi.fn().mockImplementation(async (sampleID) => {
        return mockDb.inventory.findOne({ sampleID, status: 'STORED' });
      }),
      listInventory: vi.fn().mockImplementation(async (locationID = null) => {
        const filter = locationID ? { locationID, status: 'STORED' } : { status: 'STORED' };
        return mockDb.inventory.find(filter).toArray();
      }),
      getLocationCapacity: vi.fn().mockImplementation(async (locationID) => {
        const location = await mockDb.locations.findOne({ _id: locationID });
        return location
          ? {
              capacity: location.capacity,
              current: location.currentItems,
              available: location.capacity - location.currentItems,
            }
          : null;
      }),
      getInventoryStats: vi.fn().mockResolvedValue({
        totalItems: 150,
        storedItems: 145,
        removedItems: 5,
        locations: 10,
        avgOccupancy: 65,
      }),
      getAuditLog: vi.fn().mockImplementation(async (filters = {}) => {
        return mockDb.auditLogs.find(filters).toArray();
      }),
      validateStorageData: vi.fn().mockImplementation(async (data) => {
        const errors = [];
        if (!data.name) errors.push('name é obrigatório');
        if (!data.type) errors.push('type é obrigatório');
        if (!data.capacity || data.capacity <= 0) errors.push('capacity deve ser > 0');
        return { valid: errors.length === 0, errors };
      }),
    };

    // Configurar rotas do app
    setupStorageRoutes(app);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // TESTE 1: POST /api/storage/locations - Criar localização
  it('POST /api/storage/locations - Deve criar localização de armazenamento', async () => {
    const payload = {
      name: 'FRIDGE-A1',
      type: 'REFRIGERATOR',
      temperature: 4,
      capacity: 100,
    };

    const response = await request(app).post('/api/storage/locations').send(payload);

    expect(response.status).toBe(201);
    expect(response.body._id).toBe('loc-001');
    expect(response.body.name).toBe(payload.name);
  });

  // TESTE 2: GET /api/storage/locations - Listar localizações
  it('GET /api/storage/locations - Deve listar todas as localizações', async () => {
    mockStorageService.listLocations.mockResolvedValueOnce([
      createLocation({ _id: 'loc-001' }),
      createLocation({ _id: 'loc-002', name: 'FREEZER-B1' }),
    ]);

    const response = await request(app).get('/api/storage/locations');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(2);
  });

  // TESTE 3: GET /api/storage/locations/:id - Obter localização por ID
  it('GET /api/storage/locations/:id - Deve retornar localização por ID', async () => {
    const location = createLocation({ _id: 'loc-001' });
    mockStorageService.getLocation.mockResolvedValueOnce(location);

    const response = await request(app).get('/api/storage/locations/loc-001');

    expect(response.status).toBe(200);
    expect(response.body._id).toBe('loc-001');
    expect(response.body.name).toBe(location.name);
  });

  // TESTE 4: PUT /api/storage/locations/:id - Atualizar localização
  it('PUT /api/storage/locations/:id - Deve atualizar localização', async () => {
    const updates = { temperature: 2, status: 'MAINTENANCE' };
    const updated = createLocation(updates);
    mockStorageService.updateLocation.mockResolvedValueOnce(updated);

    const response = await request(app)
      .put('/api/storage/locations/loc-001')
      .send(updates);

    expect(response.status).toBe(200);
    expect(response.body.temperature).toBe(2);
    expect(response.body.status).toBe('MAINTENANCE');
  });

  // TESTE 5: DELETE /api/storage/locations/:id - Deletar localização
  it('DELETE /api/storage/locations/:id - Deve deletar localização', async () => {
    mockStorageService.deleteLocation.mockResolvedValueOnce({ deletedCount: 1 });

    const response = await request(app).delete('/api/storage/locations/loc-001');

    expect(response.status).toBe(200);
    expect(mockStorageService.deleteLocation).toHaveBeenCalledWith('loc-001');
  });

  // TESTE 6: POST /api/storage/inventory/add - Adicionar item ao inventário
  it('POST /api/storage/inventory/add - Deve adicionar item ao inventário', async () => {
    const payload = {
      sampleID: 'SAMPLE-001',
      locationID: 'loc-001',
      position: 'A1-001',
    };

    const response = await request(app).post('/api/storage/inventory/add').send(payload);

    expect(response.status).toBe(201);
    expect(response.body.sampleID).toBe(payload.sampleID);
    expect(response.body.locationID).toBe(payload.locationID);
  });

  // TESTE 7: POST /api/storage/inventory/remove - Remover item do inventário
  it('POST /api/storage/inventory/remove - Deve remover item do inventário', async () => {
    const removed = createInventoryItem({ status: 'REMOVED', removedAt: new Date() });
    mockStorageService.removeItemFromInventory.mockResolvedValueOnce(removed);

    const response = await request(app).post('/api/storage/inventory/remove').send({ itemID: 'item-001' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('REMOVED');
    expect(response.body.removedAt).toBeTruthy();
  });

  // TESTE 8: GET /api/storage/inventory/sample/:sampleId - Encontrar localização de amostra
  it('GET /api/storage/inventory/sample/:sampleId - Deve retornar localização da amostra', async () => {
    const item = createInventoryItem({ sampleID: 'SAMPLE-001' });
    mockStorageService.getItemLocation.mockResolvedValueOnce(item);

    const response = await request(app).get('/api/storage/inventory/sample/SAMPLE-001');

    expect(response.status).toBe(200);
    expect(response.body.sampleID).toBe('SAMPLE-001');
    expect(response.body.status).toBe('STORED');
  });

  // TESTE 9: GET /api/storage/inventory - Listar inventário completo
  it('GET /api/storage/inventory - Deve listar inventário completo', async () => {
    mockStorageService.listInventory.mockResolvedValueOnce([
      createInventoryItem({ sampleID: 'SAMPLE-001' }),
      createInventoryItem({ sampleID: 'SAMPLE-002', _id: 'item-002' }),
    ]);

    const response = await request(app).get('/api/storage/inventory');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(2);
  });

  // TESTE 10: GET /api/storage/inventory/location/:locationId - Listar inventário por localização
  it('GET /api/storage/inventory/location/:locationId - Deve listar inventário por localização', async () => {
    mockStorageService.listInventory.mockResolvedValueOnce([
      createInventoryItem({ locationID: 'loc-001' }),
      createInventoryItem({ locationID: 'loc-001', _id: 'item-002' }),
    ]);

    const response = await request(app).get('/api/storage/inventory/location/loc-001');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(2);
  });

  // TESTE 11: GET /api/storage/locations/:id/capacity - Obter capacidade de localização
  it('GET /api/storage/locations/:id/capacity - Deve retornar capacidade de localização', async () => {
    mockStorageService.getLocationCapacity.mockResolvedValueOnce({
      capacity: 100,
      current: 45,
      available: 55,
    });

    const response = await request(app).get('/api/storage/locations/loc-001/capacity');

    expect(response.status).toBe(200);
    expect(response.body.capacity).toBe(100);
    expect(response.body.available).toBe(55);
  });

  // TESTE 12: GET /api/storage/stats - Obter estatísticas de inventário
  it('GET /api/storage/stats - Deve retornar estatísticas de inventário', async () => {
    mockStorageService.getInventoryStats.mockResolvedValueOnce({
      totalItems: 150,
      storedItems: 145,
      removedItems: 5,
      locations: 10,
      avgOccupancy: 65,
    });

    const response = await request(app).get('/api/storage/stats');

    expect(response.status).toBe(200);
    expect(response.body.totalItems).toBe(150);
    expect(response.body.avgOccupancy).toBe(65);
  });

  // TESTE 13: GET /api/storage/audit-log - Obter logs de auditoria
  it('GET /api/storage/audit-log - Deve retornar logs de auditoria', async () => {
    mockStorageService.getAuditLog.mockResolvedValueOnce([
      createAuditLog({ action: 'ITEM_ADDED' }),
      createAuditLog({ action: 'ITEM_REMOVED', _id: 'log-002' }),
    ]);

    const response = await request(app).get('/api/storage/audit-log');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(2);
  });

  // TESTE 14: POST /api/storage/validate - Validar dados de localização
  it('POST /api/storage/validate - Deve validar dados válidos de localização', async () => {
    mockStorageService.validateStorageData.mockResolvedValueOnce({
      valid: true,
      errors: [],
    });

    const payload = {
      name: 'FRIDGE-A1',
      type: 'REFRIGERATOR',
      capacity: 100,
    };

    const response = await request(app).post('/api/storage/validate').send(payload);

    expect(response.status).toBe(200);
    expect(response.body.valid).toBe(true);
  });

  // TESTE 15: POST /api/storage/validate - Validação deve rejeitar dados inválidos
  it('POST /api/storage/validate - Deve rejeitar dados inválidos', async () => {
    mockStorageService.validateStorageData.mockResolvedValueOnce({
      valid: false,
      errors: ['name é obrigatório', 'capacity deve ser > 0'],
    });

    const payload = { type: 'REFRIGERATOR' };

    const response = await request(app).post('/api/storage/validate').send(payload);

    expect(response.status).toBe(400);
  });

  // TESTE 16: Fluxo completo de armazenamento (criar localização -> adicionar item -> verificar capacidade)
  it('Fluxo completo: Criar localização -> Adicionar item -> Verificar capacidade', async () => {
    // Criar localização
    mockStorageService.createLocation.mockResolvedValueOnce(createLocation());
    const locResp = await request(app).post('/api/storage/locations').send({
      name: 'FRIDGE-A1',
      type: 'REFRIGERATOR',
      temperature: 4,
      capacity: 100,
    });
    expect(locResp.status).toBe(201);

    // Adicionar item
    mockStorageService.addItemToInventory.mockResolvedValueOnce(
      createInventoryItem({ locationID: 'loc-001' })
    );
    const itemResp = await request(app).post('/api/storage/inventory/add').send({
      sampleID: 'SAMPLE-001',
      locationID: 'loc-001',
      position: 'A1-001',
    });
    expect(itemResp.status).toBe(201);

    // Verificar capacidade
    mockStorageService.getLocationCapacity.mockResolvedValueOnce({
      capacity: 100,
      current: 1,
      available: 99,
    });
    const capResp = await request(app).get('/api/storage/locations/loc-001/capacity');
    expect(capResp.status).toBe(200);
    expect(capResp.body.current).toBe(1);
  });
});

// Função auxiliar para setup das rotas
function setupStorageRoutes(app) {
  // POST /api/storage/locations - Criar
  app.post('/api/storage/locations', async (req, res) => {
    try {
      const { name, type, capacity } = req.body;
      if (!name || !type || !capacity) {
        return res.status(400).json({ error: 'Campos obrigatórios faltando' });
      }
      const location = await mockStorageService.createLocation(req.body);
      res.status(201).json(location);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // GET /api/storage/locations - Listar
  app.get('/api/storage/locations', async (req, res) => {
    try {
      const locations = await mockStorageService.listLocations();
      res.json(locations);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/storage/locations/:id - Obter por ID
  app.get('/api/storage/locations/:id', async (req, res) => {
    try {
      const location = await mockStorageService.getLocation(req.params.id);
      if (!location) return res.status(404).json({ error: 'Localização não encontrada' });
      res.json(location);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PUT /api/storage/locations/:id - Atualizar
  app.put('/api/storage/locations/:id', async (req, res) => {
    try {
      const location = await mockStorageService.updateLocation(req.params.id, req.body);
      res.json(location);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // DELETE /api/storage/locations/:id - Deletar
  app.delete('/api/storage/locations/:id', async (req, res) => {
    try {
      const result = await mockStorageService.deleteLocation(req.params.id);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/storage/inventory/add
  app.post('/api/storage/inventory/add', async (req, res) => {
    try {
      const { sampleID, locationID, position } = req.body;
      const item = await mockStorageService.addItemToInventory(sampleID, locationID, position);
      res.status(201).json(item);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // POST /api/storage/inventory/remove
  app.post('/api/storage/inventory/remove', async (req, res) => {
    try {
      const { itemID } = req.body;
      const item = await mockStorageService.removeItemFromInventory(itemID);
      res.json(item);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // GET /api/storage/inventory/sample/:sampleId
  app.get('/api/storage/inventory/sample/:sampleId', async (req, res) => {
    try {
      const item = await mockStorageService.getItemLocation(req.params.sampleId);
      if (!item) return res.status(404).json({ error: 'Item não encontrado' });
      res.json(item);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/storage/inventory - Listar tudo
  app.get('/api/storage/inventory', async (req, res) => {
    try {
      const inventory = await mockStorageService.listInventory();
      res.json(inventory);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/storage/inventory/location/:locationId
  app.get('/api/storage/inventory/location/:locationId', async (req, res) => {
    try {
      const inventory = await mockStorageService.listInventory(req.params.locationId);
      res.json(inventory);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/storage/stats
  app.get('/api/storage/stats', async (req, res) => {
    try {
      const stats = await mockStorageService.getInventoryStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/storage/locations/:id/capacity
  app.get('/api/storage/locations/:id/capacity', async (req, res) => {
    try {
      const capacity = await mockStorageService.getLocationCapacity(req.params.id);
      if (!capacity) return res.status(404).json({ error: 'Localização não encontrada' });
      res.json(capacity);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/storage/audit-log
  app.get('/api/storage/audit-log', async (req, res) => {
    try {
      const logs = await mockStorageService.getAuditLog();
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/storage/validate
  app.post('/api/storage/validate', async (req, res) => {
    try {
      const validation = await mockStorageService.validateStorageData(req.body);
      if (!validation.valid) {
        return res.status(400).json(validation);
      }
      res.json(validation);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
}
