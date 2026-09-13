import { describe, it, expect, vi, afterEach } from 'vitest';
const mongoose = require('mongoose');

const StoragePath = require('../../src/models/StoragePath');
require('../../src/models/StorageContainer');
require('../../src/models/StorageBox');
const StorageContainer = mongoose.model('StorageContainer');
const StorageBox = mongoose.model('StorageBox');

// The pre('save') hook is registered inline in the schema definition and
// isn't exported, so it can only be exercised by locating it among mongoose's
// internal 'save' hooks and invoking it directly against a plain document
// instance - calling .save() would require a live DB connection this unit
// test doesn't have (same approach as StorageContainer.model.test.js).
function getPreSaveHook() {
  const hooks = StoragePath.schema.s.hooks._pres.get('save');
  const hook = hooks.find((h) => h.fn.toString().includes('freezerId deve referenciar'));
  if (!hook) throw new Error('pre-save hook not found on StoragePath schema');
  return hook.fn;
}

async function runPreSave(doc) {
  const hook = getPreSaveHook();
  return hook.call(doc, () => {});
}

function newDoc(overrides = {}) {
  return new StoragePath({
    boxId: new mongoose.Types.ObjectId(),
    rackId: new mongoose.Types.ObjectId(),
    shelfId: new mongoose.Types.ObjectId(),
    freezerId: new mongoose.Types.ObjectId(),
    ...overrides,
  });
}

describe('StoragePath pre-save validation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejeita quando freezerId não referencia um FREEZER válido', async () => {
    vi.spyOn(StorageContainer, 'findById').mockResolvedValue(null);
    vi.spyOn(StorageBox, 'findById').mockResolvedValue({ name: 'BOX_01' });

    await expect(runPreSave(newDoc())).rejects.toThrow('freezerId deve referenciar um FREEZER válido');
  });

  it('rejeita quando freezerId referencia container de tipo errado', async () => {
    vi.spyOn(StorageContainer, 'findById').mockResolvedValue({ containerType: 'SHELF' });
    vi.spyOn(StorageBox, 'findById').mockResolvedValue({ name: 'BOX_01' });

    await expect(runPreSave(newDoc())).rejects.toThrow('freezerId deve referenciar um FREEZER válido');
  });

  it('rejeita quando shelfId não referencia uma SHELF válida', async () => {
    let call = 0;
    vi.spyOn(StorageContainer, 'findById').mockImplementation(async () => {
      call += 1;
      // order: freezer, shelf, rack
      if (call === 1) return { containerType: 'FREEZER' };
      if (call === 2) return null;
      return { containerType: 'RACK' };
    });
    vi.spyOn(StorageBox, 'findById').mockResolvedValue({ name: 'BOX_01' });

    await expect(runPreSave(newDoc())).rejects.toThrow('shelfId deve referenciar uma SHELF válida');
  });

  it('rejeita quando rackId não referencia um RACK válido', async () => {
    let call = 0;
    vi.spyOn(StorageContainer, 'findById').mockImplementation(async () => {
      call += 1;
      if (call === 1) return { containerType: 'FREEZER' };
      if (call === 2) return { containerType: 'SHELF' };
      return null;
    });
    vi.spyOn(StorageBox, 'findById').mockResolvedValue({ name: 'BOX_01' });

    await expect(runPreSave(newDoc())).rejects.toThrow('rackId deve referenciar um RACK válido');
  });

  it('rejeita quando boxId não referencia uma BOX', async () => {
    let call = 0;
    vi.spyOn(StorageContainer, 'findById').mockImplementation(async () => {
      call += 1;
      if (call === 1) return { containerType: 'FREEZER' };
      if (call === 2) return { containerType: 'SHELF' };
      return { containerType: 'RACK' };
    });
    vi.spyOn(StorageBox, 'findById').mockResolvedValue(null);

    await expect(runPreSave(newDoc())).rejects.toThrow('boxId deve referenciar uma BOX válida');
  });

  it('rejeita quando RACK não está dentro da SHELF informada', async () => {
    const shelfId = new mongoose.Types.ObjectId();
    const otherId = new mongoose.Types.ObjectId();
    let call = 0;
    vi.spyOn(StorageContainer, 'findById').mockImplementation(async () => {
      call += 1;
      if (call === 1) return { _id: new mongoose.Types.ObjectId(), containerType: 'FREEZER' };
      if (call === 2) return { _id: shelfId, containerType: 'SHELF' };
      return { containerType: 'RACK', parent_id: otherId };
    });
    vi.spyOn(StorageBox, 'findById').mockResolvedValue({ name: 'BOX_01' });

    await expect(runPreSave(newDoc({ shelfId }))).rejects.toThrow('RACK deve estar dentro da SHELF');
  });

  it('rejeita quando SHELF não está dentro do FREEZER informado', async () => {
    const freezerId = new mongoose.Types.ObjectId();
    const shelfId = new mongoose.Types.ObjectId();
    const otherId = new mongoose.Types.ObjectId();
    let call = 0;
    vi.spyOn(StorageContainer, 'findById').mockImplementation(async () => {
      call += 1;
      if (call === 1) return { _id: freezerId, containerType: 'FREEZER' };
      if (call === 2) return { _id: shelfId, containerType: 'SHELF', parent_id: otherId };
      return { containerType: 'RACK', parent_id: shelfId };
    });
    vi.spyOn(StorageBox, 'findById').mockResolvedValue({ name: 'BOX_01' });

    await expect(runPreSave(newDoc({ freezerId, shelfId }))).rejects.toThrow('SHELF deve estar dentro do FREEZER');
  });

  it('gera o path automaticamente quando não fornecido', async () => {
    const freezerId = new mongoose.Types.ObjectId();
    const shelfId = new mongoose.Types.ObjectId();
    let call = 0;
    vi.spyOn(StorageContainer, 'findById').mockImplementation(async () => {
      call += 1;
      if (call === 1) return { _id: freezerId, containerType: 'FREEZER', name: 'FREEZER_01' };
      if (call === 2) return { _id: shelfId, containerType: 'SHELF', parent_id: freezerId, name: 'SHELF_1' };
      return { containerType: 'RACK', parent_id: shelfId, name: 'RACK_A' };
    });
    vi.spyOn(StorageBox, 'findById').mockResolvedValue({ name: 'BOX_01' });

    const doc = newDoc({ freezerId, shelfId });
    await expect(runPreSave(doc)).resolves.toBeUndefined();

    expect(doc.path).toBe('FREEZER_01/SHELF_1/RACK_A/BOX_01');
  });

  it('mantém o path fornecido em vez de gerar um novo', async () => {
    const freezerId = new mongoose.Types.ObjectId();
    const shelfId = new mongoose.Types.ObjectId();
    let call = 0;
    vi.spyOn(StorageContainer, 'findById').mockImplementation(async () => {
      call += 1;
      if (call === 1) return { _id: freezerId, containerType: 'FREEZER', name: 'FREEZER_01' };
      if (call === 2) return { _id: shelfId, containerType: 'SHELF', parent_id: freezerId, name: 'SHELF_1' };
      return { containerType: 'RACK', parent_id: shelfId, name: 'RACK_A' };
    });
    vi.spyOn(StorageBox, 'findById').mockResolvedValue({ name: 'BOX_01' });

    const doc = newDoc({ freezerId, shelfId, path: 'CUSTOM_PATH' });
    await expect(runPreSave(doc)).resolves.toBeUndefined();

    expect(doc.path).toBe('CUSTOM_PATH');
  });
});

describe('StoragePath#getFullDetails', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retorna detalhes completos quando todas as referências existem', async () => {
    const freezer = { _id: new mongoose.Types.ObjectId(), name: 'FREEZER_01', temperature: -80 };
    const shelf = { _id: new mongoose.Types.ObjectId(), name: 'SHELF_1' };
    const rack = { _id: new mongoose.Types.ObjectId(), name: 'RACK_A' };
    const box = { getStats: vi.fn().mockReturnValue({ occupied: 3 }) };

    vi.spyOn(StorageContainer, 'findById').mockImplementation(async (id) => {
      if (String(id) === String(freezer._id)) return freezer;
      if (String(id) === String(shelf._id)) return shelf;
      if (String(id) === String(rack._id)) return rack;
      return null;
    });
    vi.spyOn(StorageBox, 'findById').mockResolvedValue(box);

    const doc = newDoc({ freezerId: freezer._id, shelfId: shelf._id, rackId: rack._id, path: 'A/B/C/D' });

    const details = await doc.getFullDetails();

    expect(details).toEqual({
      path: 'A/B/C/D',
      freezer: { id: freezer._id, name: 'FREEZER_01', temp: -80 },
      shelf: { id: shelf._id, name: 'SHELF_1' },
      rack: { id: rack._id, name: 'RACK_A' },
      box: { occupied: 3 },
    });
  });

  it('retorna null para cada referência não encontrada', async () => {
    vi.spyOn(StorageContainer, 'findById').mockResolvedValue(null);
    vi.spyOn(StorageBox, 'findById').mockResolvedValue(null);

    const doc = newDoc({ path: 'A/B/C/D' });

    const details = await doc.getFullDetails();

    expect(details).toEqual({
      path: 'A/B/C/D',
      freezer: null,
      shelf: null,
      rack: null,
      box: null,
    });
  });
});

describe('StoragePath.createFromBox', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lança erro quando a box não é encontrada', async () => {
    vi.spyOn(StorageBox, 'findById').mockResolvedValue(null);

    await expect(StoragePath.createFromBox(new mongoose.Types.ObjectId())).rejects.toThrow('Box não encontrada');
  });

  it('lança erro quando o rack não é encontrado ou não é RACK', async () => {
    vi.spyOn(StorageBox, 'findById').mockResolvedValue({ _id: new mongoose.Types.ObjectId(), parent_id: new mongoose.Types.ObjectId() });
    vi.spyOn(StorageContainer, 'findById').mockResolvedValue(null);

    await expect(StoragePath.createFromBox(new mongoose.Types.ObjectId())).rejects.toThrow('Rack não encontrado');
  });

  it('lança erro quando a shelf não é encontrada ou não é SHELF', async () => {
    const rackId = new mongoose.Types.ObjectId();
    vi.spyOn(StorageBox, 'findById').mockResolvedValue({ _id: new mongoose.Types.ObjectId(), parent_id: rackId });
    let call = 0;
    vi.spyOn(StorageContainer, 'findById').mockImplementation(async () => {
      call += 1;
      if (call === 1) return { _id: rackId, containerType: 'RACK', parent_id: new mongoose.Types.ObjectId() };
      return null;
    });

    await expect(StoragePath.createFromBox(new mongoose.Types.ObjectId())).rejects.toThrow('Shelf não encontrada');
  });

  it('lança erro quando o freezer não é encontrado ou não é FREEZER', async () => {
    const rackId = new mongoose.Types.ObjectId();
    const shelfId = new mongoose.Types.ObjectId();
    vi.spyOn(StorageBox, 'findById').mockResolvedValue({ _id: new mongoose.Types.ObjectId(), parent_id: rackId });
    let call = 0;
    vi.spyOn(StorageContainer, 'findById').mockImplementation(async () => {
      call += 1;
      if (call === 1) return { _id: rackId, containerType: 'RACK', parent_id: shelfId };
      if (call === 2) return { _id: shelfId, containerType: 'SHELF', parent_id: new mongoose.Types.ObjectId() };
      return null;
    });

    await expect(StoragePath.createFromBox(new mongoose.Types.ObjectId())).rejects.toThrow('Freezer não encontrado');
  });

  it('cria o StoragePath com o path montado a partir da hierarquia', async () => {
    const boxId = new mongoose.Types.ObjectId();
    const rackId = new mongoose.Types.ObjectId();
    const shelfId = new mongoose.Types.ObjectId();
    const freezerId = new mongoose.Types.ObjectId();

    const box = { _id: boxId, parent_id: rackId, name: 'BOX_01' };
    vi.spyOn(StorageBox, 'findById').mockResolvedValue(box);

    let call = 0;
    vi.spyOn(StorageContainer, 'findById').mockImplementation(async () => {
      call += 1;
      if (call === 1) return { _id: rackId, containerType: 'RACK', parent_id: shelfId, name: 'RACK_A' };
      if (call === 2) return { _id: shelfId, containerType: 'SHELF', parent_id: freezerId, name: 'SHELF_1' };
      return { _id: freezerId, containerType: 'FREEZER', name: 'FREEZER_01' };
    });

    const created = { _id: new mongoose.Types.ObjectId() };
    const createSpy = vi.spyOn(StoragePath, 'create').mockResolvedValue(created);

    const result = await StoragePath.createFromBox(boxId);

    expect(createSpy).toHaveBeenCalledWith({
      boxId,
      rackId,
      shelfId,
      freezerId,
      path: 'FREEZER_01/SHELF_1/RACK_A/BOX_01',
    });
    expect(result).toBe(created);
  });
});

describe('StoragePath.validate (static)', () => {
  it('acumula erros para cada campo obrigatório ausente', () => {
    const result = StoragePath.validate({});

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual([
      'boxId é obrigatório',
      'rackId é obrigatório',
      'shelfId é obrigatório',
      'freezerId é obrigatório',
    ]);
  });

  it('retorna isValid true quando todos os campos estão presentes', () => {
    const result = StoragePath.validate({
      boxId: new mongoose.Types.ObjectId(),
      rackId: new mongoose.Types.ObjectId(),
      shelfId: new mongoose.Types.ObjectId(),
      freezerId: new mongoose.Types.ObjectId(),
    });

    expect(result).toEqual({ isValid: true, errors: [] });
  });
});
