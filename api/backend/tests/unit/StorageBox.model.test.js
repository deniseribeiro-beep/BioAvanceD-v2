import { describe, it, expect, vi, afterEach } from 'vitest';
const mongoose = require('mongoose');

const StorageBox = require('../../src/models/StorageBox');
const StorageContainer = require('../../src/models/StorageContainer');

// The pre('save') hook is registered inline in the schema definition and
// isn't exported, so it can only be exercised by locating it among mongoose's
// internal 'save' hooks (validateBeforeSave, subdocs, sharding, ...) and
// invoking it directly against a plain document instance - calling .save()
// would require a live DB connection this unit test doesn't have. Same
// pattern as StorageContainer.model.test.js.
function getPreSaveHook() {
  const hooks = StorageBox.schema.s.hooks._pres.get('save');
  const hook = hooks.find((h) => h.fn.toString().includes('Rack pai não encontrado'));
  if (!hook) throw new Error('pre-save hook not found on StorageBox schema');
  return hook.fn;
}

async function runPreSave(doc) {
  const hook = getPreSaveHook();
  return hook.call(doc, () => {});
}

function makeBox(overrides = {}) {
  return new StorageBox({
    name: 'Box A1-01',
    parent_id: new mongoose.Types.ObjectId(),
    dimension: { rows: 2, cols: 2 },
    occupancyGrid: new Map(),
    ...overrides,
  });
}

describe('StorageBox pre-save validation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejeita dimension.rows ausente', async () => {
    const doc = makeBox({ dimension: { cols: 2 } });

    await expect(runPreSave(doc)).rejects.toThrow('dimension.rows e dimension.cols são obrigatórios');
  });

  it('rejeita rows fora do intervalo permitido', async () => {
    const doc = makeBox({ dimension: { rows: 27, cols: 2 } });

    await expect(runPreSave(doc)).rejects.toThrow('rows deve estar entre 1 e 26');
  });

  it('rejeita cols fora do intervalo permitido', async () => {
    const doc = makeBox({ dimension: { rows: 2, cols: 101 } });

    await expect(runPreSave(doc)).rejects.toThrow('cols deve estar entre 1 e 100');
  });

  it('rejeita quando o rack pai não é encontrado', async () => {
    vi.spyOn(StorageContainer, 'findById').mockResolvedValue(null);
    const doc = makeBox();

    await expect(runPreSave(doc)).rejects.toThrow('Rack pai não encontrado');
  });

  it('rejeita quando parent_id não referencia um RACK ou DRAWER', async () => {
    vi.spyOn(StorageContainer, 'findById').mockResolvedValue({ containerType: 'SHELF' });
    const doc = makeBox();

    await expect(runPreSave(doc)).rejects.toThrow('parent_id deve referenciar um RACK ou DRAWER');
  });

  it('aceita quando parent_id referencia um DRAWER', async () => {
    vi.spyOn(StorageContainer, 'findById').mockResolvedValue({ containerType: 'DRAWER' });
    const doc = makeBox();

    await expect(runPreSave(doc)).resolves.toBeUndefined();
  });

  it('sincroniza currentOccupancy a partir do occupancyGrid', async () => {
    vi.spyOn(StorageContainer, 'findById').mockResolvedValue({ containerType: 'RACK' });
    const specimenObjectId = new mongoose.Types.ObjectId();
    const doc = makeBox({
      dimension: { rows: 2, cols: 2 },
      occupancyGrid: new Map([['A1', specimenObjectId], ['A2', null]]),
    });

    await runPreSave(doc);

    expect(doc.currentOccupancy).toBe(1);
    expect(doc.status).toBe('ACTIVE');
  });

  it('marca status FULL quando currentOccupancy atinge a capacidade', async () => {
    vi.spyOn(StorageContainer, 'findById').mockResolvedValue({ containerType: 'RACK' });
    const s1 = new mongoose.Types.ObjectId();
    const s2 = new mongoose.Types.ObjectId();
    const doc = makeBox({
      dimension: { rows: 1, cols: 2 },
      occupancyGrid: new Map([['A1', s1], ['A2', s2]]),
    });

    await runPreSave(doc);

    expect(doc.currentOccupancy).toBe(2);
    expect(doc.status).toBe('FULL');
  });

  it('reverte status FULL para ACTIVE quando a ocupação cai abaixo da capacidade', async () => {
    vi.spyOn(StorageContainer, 'findById').mockResolvedValue({ containerType: 'RACK' });
    const s1 = new mongoose.Types.ObjectId();
    const doc = makeBox({
      dimension: { rows: 1, cols: 2 },
      occupancyGrid: new Map([['A1', s1], ['A2', null]]),
      status: 'FULL',
    });

    await runPreSave(doc);

    expect(doc.currentOccupancy).toBe(1);
    expect(doc.status).toBe('ACTIVE');
  });

  it('atualiza updatedAt e lastModified', async () => {
    vi.spyOn(StorageContainer, 'findById').mockResolvedValue({ containerType: 'RACK' });
    const doc = makeBox();
    const beforeUpdated = doc.updatedAt;
    const beforeModified = doc.lastModified;

    await runPreSave(doc);

    expect(doc.updatedAt).not.toBe(beforeUpdated);
    expect(doc.lastModified).not.toBe(beforeModified);
  });
});

describe('StorageBox#addSample / #removeSample', () => {
  it('adiciona amostra em posição vazia e incrementa currentOccupancy', () => {
    const box = makeBox({ dimension: { rows: 2, cols: 2 } });
    const specimenObjectId = new mongoose.Types.ObjectId();

    const result = box.addSample('A1', specimenObjectId);

    expect(result).toEqual({ success: true });
    expect(String(box.occupancyGrid.get('A1'))).toBe(String(specimenObjectId));
    expect(box.currentOccupancy).toBe(1);
  });

  it('rejeita adicionar amostra em posição inválida', () => {
    const box = makeBox({ dimension: { rows: 2, cols: 2 } });

    const result = box.addSample('Z9', new mongoose.Types.ObjectId());

    expect(result).toEqual({ success: false, error: 'INVALID_POSITION' });
  });

  it('rejeita adicionar amostra em posição já ocupada', () => {
    const existingSampleId = new mongoose.Types.ObjectId();
    const box = makeBox({
      dimension: { rows: 2, cols: 2 },
      occupancyGrid: new Map([['A1', existingSampleId]]),
    });

    const result = box.addSample('A1', new mongoose.Types.ObjectId());

    expect(result.success).toBe(false);
    expect(result.error).toBe('POSITION_OCCUPIED');
    expect(String(result.specimenObjectId)).toBe(String(existingSampleId));
  });

  it('remove amostra de posição ocupada e decrementa currentOccupancy', () => {
    const specimenObjectId = new mongoose.Types.ObjectId();
    const box = makeBox({
      dimension: { rows: 2, cols: 2 },
      occupancyGrid: new Map([['A1', specimenObjectId]]),
      currentOccupancy: 1,
    });

    const result = box.removeSample('A1');

    expect(result.success).toBe(true);
    expect(String(result.specimenObjectId)).toBe(String(specimenObjectId));
    expect(box.occupancyGrid.get('A1')).toBeUndefined();
    expect(box.currentOccupancy).toBe(0);
  });

  it('rejeita remover de posição inválida', () => {
    const box = makeBox({ dimension: { rows: 2, cols: 2 } });

    const result = box.removeSample('Z9');

    expect(result).toEqual({ success: false, error: 'INVALID_POSITION' });
  });

  it('rejeita remover de posição já vazia', () => {
    const box = makeBox({ dimension: { rows: 2, cols: 2 } });

    const result = box.removeSample('A1');

    expect(result).toEqual({ success: false, error: 'POSITION_EMPTY' });
  });
});

describe('StorageBox#getAvailablePositions / #getStats', () => {
  it('retorna apenas as posições vazias', () => {
    const box = makeBox({
      dimension: { rows: 1, cols: 2 },
      occupancyGrid: new Map([['A1', new mongoose.Types.ObjectId()]]),
    });

    expect(box.getAvailablePositions()).toEqual(['A2']);
  });

  it('calcula estatísticas de ocupação', () => {
    const box = makeBox({
      name: 'Box Stats',
      dimension: { rows: 2, cols: 2 },
      occupancyGrid: new Map([['A1', new mongoose.Types.ObjectId()]]),
      currentOccupancy: 1,
    });

    const stats = box.getStats();

    expect(stats).toMatchObject({
      name: 'Box Stats',
      capacity: 4,
      occupied: 1,
      available: 3,
      occupancyPercent: 25,
      status: 'ACTIVE',
    });
  });
});

describe('StorageBox.validate (static)', () => {
  it('aceita payload mínimo válido', () => {
    const result = StorageBox.validate({
      name: 'Box A',
      parent_id: new mongoose.Types.ObjectId(),
      dimension: { rows: 2, cols: 2 },
    });

    expect(result).toEqual({ isValid: true, errors: [] });
  });

  it('acumula erros para campos obrigatórios ausentes', () => {
    const result = StorageBox.validate({});

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'name é obrigatório',
      'parent_id é obrigatório',
      'dimension.rows é obrigatório',
      'dimension.cols é obrigatório',
    ]));
  });

  it('rejeita rows/cols fora do intervalo permitido', () => {
    const result = StorageBox.validate({
      name: 'Box A',
      parent_id: new mongoose.Types.ObjectId(),
      dimension: { rows: 27, cols: 101 },
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'rows deve estar entre 1 e 26',
      'cols deve estar entre 1 e 100',
    ]));
  });
});
