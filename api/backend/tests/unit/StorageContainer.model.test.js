import { describe, it, expect, vi, afterEach } from 'vitest';
const mongoose = require('mongoose');

const StorageContainer = require('../../src/models/StorageContainer');
require('../../src/models/StorageBox');
const StorageBox = mongoose.model('StorageBox');

// The pre('save') hook is registered inline in the schema definition and
// isn't exported, so it can only be exercised by locating it among mongoose's
// internal 'save' hooks (validateBeforeSave, subdocs, sharding, ...) and
// invoking it directly against a plain document instance - calling .save()
// would require a live DB connection this unit test doesn't have.
function getPreSaveHook() {
  const hooks = StorageContainer.schema.s.hooks._pres.get('save');
  const hook = hooks.find((h) => h.fn.toString().includes('FREEZER não pode ter pai'));
  if (!hook) throw new Error('pre-save hook not found on StorageContainer schema');
  return hook.fn;
}

async function runPreSave(doc) {
  const hook = getPreSaveHook();
  return hook.call(doc, () => {});
}

describe('StorageContainer pre-save validation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejeita FREEZER com parent_id', async () => {
    const doc = new StorageContainer({
      name: 'F1',
      containerType: 'FREEZER',
      parent_id: new mongoose.Types.ObjectId(),
    });

    await expect(runPreSave(doc)).rejects.toThrow('FREEZER não pode ter pai');
  });

  it('rejeita SHELF sem parent_id', async () => {
    const doc = new StorageContainer({ name: 'S1', containerType: 'SHELF' });

    await expect(runPreSave(doc)).rejects.toThrow('SHELF deve ter um parent_id');
  });

  it('rejeita RACK sem parent_id', async () => {
    const doc = new StorageContainer({ name: 'R1', containerType: 'RACK' });

    await expect(runPreSave(doc)).rejects.toThrow('RACK deve ter um parent_id');
  });

  it('rejeita temperatura em container que não é FREEZER', async () => {
    const doc = new StorageContainer({
      name: 'S1',
      containerType: 'SHELF',
      parent_id: new mongoose.Types.ObjectId(),
      temperature: -20,
    });

    await expect(runPreSave(doc)).rejects.toThrow('Apenas FREEZER pode ter temperatura');
  });

  it('rejeita RACK cujo parent_id não existe', async () => {
    vi.spyOn(StorageContainer, 'findById').mockResolvedValue(null);

    const doc = new StorageContainer({
      name: 'R1',
      containerType: 'RACK',
      parent_id: new mongoose.Types.ObjectId(),
    });

    await expect(runPreSave(doc)).rejects.toThrow('Container pai não encontrado');
  });

  it('rejeita RACK cujo pai não é SHELF', async () => {
    vi.spyOn(StorageContainer, 'findById').mockResolvedValue({ containerType: 'FREEZER' });

    const doc = new StorageContainer({
      name: 'R1',
      containerType: 'RACK',
      parent_id: new mongoose.Types.ObjectId(),
    });

    await expect(runPreSave(doc)).rejects.toThrow('RACK só pode ter SHELF como pai');
  });

  it('aceita RACK cujo pai é SHELF e atualiza updatedAt', async () => {
    vi.spyOn(StorageContainer, 'findById').mockResolvedValue({ containerType: 'SHELF' });

    const doc = new StorageContainer({
      name: 'R1',
      containerType: 'RACK',
      parent_id: new mongoose.Types.ObjectId(),
    });
    const before = doc.updatedAt;

    await expect(runPreSave(doc)).resolves.toBeUndefined();
    expect(doc.updatedAt).not.toBe(before);
  });

  it('rejeita SHELF cujo parent_id não existe', async () => {
    vi.spyOn(StorageContainer, 'findById').mockResolvedValue(null);

    const doc = new StorageContainer({
      name: 'S1',
      containerType: 'SHELF',
      parent_id: new mongoose.Types.ObjectId(),
    });

    await expect(runPreSave(doc)).rejects.toThrow('Container pai não encontrado');
  });

  it('rejeita SHELF cujo pai não é FREEZER', async () => {
    vi.spyOn(StorageContainer, 'findById').mockResolvedValue({ containerType: 'RACK' });

    const doc = new StorageContainer({
      name: 'S1',
      containerType: 'SHELF',
      parent_id: new mongoose.Types.ObjectId(),
    });

    await expect(runPreSave(doc)).rejects.toThrow('SHELF só pode ter FREEZER como pai');
  });

  it('aceita SHELF cujo pai é FREEZER', async () => {
    vi.spyOn(StorageContainer, 'findById').mockResolvedValue({ containerType: 'FREEZER' });

    const doc = new StorageContainer({
      name: 'S1',
      containerType: 'SHELF',
      parent_id: new mongoose.Types.ObjectId(),
    });

    await expect(runPreSave(doc)).resolves.toBeUndefined();
  });

  it('aceita FREEZER válido sem parent_id nem restrições', async () => {
    const doc = new StorageContainer({
      name: 'F1',
      containerType: 'FREEZER',
      temperature: -80,
    });

    await expect(runPreSave(doc)).resolves.toBeUndefined();
  });
});

describe('StorageContainer#getFullPath', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retorna apenas o próprio nó quando não há parent_id', async () => {
    const doc = new StorageContainer({ name: 'F1', containerType: 'FREEZER' });

    const path = await doc.getFullPath();

    expect(path).toEqual([{ id: doc._id, name: 'F1', type: 'FREEZER' }]);
  });

  it('monta a cadeia FREEZER > SHELF > RACK', async () => {
    const freezerId = new mongoose.Types.ObjectId();
    const shelfId = new mongoose.Types.ObjectId();

    const freezer = { _id: freezerId, name: 'Freezer', containerType: 'FREEZER', parent_id: null };
    const shelf = { _id: shelfId, name: 'Shelf', containerType: 'SHELF', parent_id: freezerId };

    vi.spyOn(StorageContainer, 'findById').mockImplementation(async (id) => {
      if (String(id) === String(shelfId)) return shelf;
      if (String(id) === String(freezerId)) return freezer;
      return null;
    });

    const rack = new StorageContainer({ name: 'Rack', containerType: 'RACK', parent_id: shelfId });

    const path = await rack.getFullPath();

    expect(path.map((n) => n.type)).toEqual(['FREEZER', 'SHELF', 'RACK']);
    expect(path[0].name).toBe('Freezer');
    expect(path[1].name).toBe('Shelf');
    expect(path[2].name).toBe('Rack');
  });

  it('para a busca quando um parent_id referenciado não existe', async () => {
    const missingParentId = new mongoose.Types.ObjectId();
    vi.spyOn(StorageContainer, 'findById').mockResolvedValue(null);

    const doc = new StorageContainer({ name: 'Rack', containerType: 'RACK', parent_id: missingParentId });

    const path = await doc.getFullPath();

    expect(path).toEqual([{ id: doc._id, name: 'Rack', type: 'RACK' }]);
  });
});

describe('StorageContainer#getChildren', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('busca SHELFs filhos de um FREEZER', async () => {
    const findSpy = vi.spyOn(StorageContainer, 'find').mockResolvedValue(['shelf-a']);
    const doc = new StorageContainer({ name: 'F1', containerType: 'FREEZER' });

    const children = await doc.getChildren();

    expect(findSpy).toHaveBeenCalledWith({ parent_id: doc._id, containerType: 'SHELF' });
    expect(children).toEqual(['shelf-a']);
  });

  it('busca RACKs filhos de um SHELF', async () => {
    const findSpy = vi.spyOn(StorageContainer, 'find').mockResolvedValue(['rack-a']);
    const doc = new StorageContainer({ name: 'S1', containerType: 'SHELF' });

    const children = await doc.getChildren();

    expect(findSpy).toHaveBeenCalledWith({ parent_id: doc._id, containerType: 'RACK' });
    expect(children).toEqual(['rack-a']);
  });

  it('busca StorageBoxes filhos de um RACK', async () => {
    const findSpy = vi.spyOn(StorageBox, 'find').mockResolvedValue(['box-a']);
    const doc = new StorageContainer({ name: 'R1', containerType: 'RACK' });

    const children = await doc.getChildren();

    expect(findSpy).toHaveBeenCalledWith({ parent_id: doc._id });
    expect(children).toEqual(['box-a']);
  });

  it('retorna array vazio para tipos sem filhos suportados', async () => {
    const doc = new StorageContainer({ name: 'X1', containerType: 'FREEZER' });
    doc.containerType = 'UNKNOWN';

    const children = await doc.getChildren();

    expect(children).toEqual([]);
  });
});
