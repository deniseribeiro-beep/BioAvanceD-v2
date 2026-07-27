import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const scriptPath = require.resolve('../../src/scripts/seedDiseaseValidationRules');

const realMongo = require('../../src/database/mongo');
const originalConnectDB = realMongo.connectDB;
const originalCloseConnection = realMongo.closeConnection;

// The script has no `require.main === module` guard: it calls run()
// unconditionally at require time and only chains .catch/.finally on the
// resulting promise (never awaited by the module itself). closeConnection
// is the only signal available to know the script's async work settled.
function loadScript({ connectDB, closeConnection }) {
  realMongo.connectDB = connectDB;
  realMongo.closeConnection = closeConnection;
  delete require.cache[scriptPath];
  require('../../src/scripts/seedDiseaseValidationRules');
}

function mockDb({ orphanetRows = [], bulkWriteImpl, createIndexImpl } = {}) {
  const toArray = vi.fn().mockResolvedValue(orphanetRows);
  const find = vi.fn().mockReturnValue({ toArray });
  const bulkWrite = bulkWriteImpl || vi.fn().mockResolvedValue({ ok: 1 });
  const createIndex = createIndexImpl || vi.fn().mockResolvedValue(undefined);

  const orphanetCollection = { find };
  const diseaseCollection = { bulkWrite, createIndex };

  const collection = vi.fn((name) => {
    if (name === 'orphanet_diseases') return orphanetCollection;
    if (name === 'disease_dictionary') return diseaseCollection;
    throw new Error(`unexpected collection: ${name}`);
  });

  const db = { collection };
  return { db, find, toArray, bulkWrite, createIndex, collection };
}

describe('scripts/seedDiseaseValidationRules', () => {
  afterEach(() => {
    realMongo.connectDB = originalConnectDB;
    realMongo.closeConnection = originalCloseConnection;
    delete require.cache[scriptPath];
    vi.restoreAllMocks();
  });

  it('seeds the built-in DISEASE_RULES entries even with no orphanet rows, and closes the connection', async () => {
    const { db, bulkWrite, createIndex } = mockDb({ orphanetRows: [] });
    const connectDB = vi.fn().mockResolvedValue(db);
    const closeConnection = vi.fn().mockResolvedValue(undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    loadScript({ connectDB, closeConnection });

    await vi.waitFor(() => expect(closeConnection).toHaveBeenCalledTimes(1));

    expect(bulkWrite).toHaveBeenCalledTimes(1);
    const [operations, options] = bulkWrite.mock.calls[0];
    expect(options).toEqual({ ordered: false });
    expect(operations).toHaveLength(3);

    const gaucher = operations.find(
      (op) => op.updateOne.filter.orpha_code === '79258',
    );
    expect(gaucher.updateOne.update.$set).toMatchObject({
      name: 'Doenca de Gaucher',
      disease_category: 'Erros Inatos do Metabolismo',
      drug_classes: ['enzyme_replacement_therapy', 'substrate_reduction_therapy'],
      active: true,
    });
    expect(gaucher.updateOne.update.$set.validation_requirements.biomarkers).toEqual({
      required: ['GLUCOSYLCERAMIDE'],
      recommended: ['CHITOTRIOSIDASE', 'LYSO_GB1'],
    });
    expect(gaucher.updateOne.update.$setOnInsert.createdAt).toBeInstanceOf(Date);
    expect(gaucher.updateOne.upsert).toBe(true);

    expect(createIndex).toHaveBeenCalledTimes(3);
    expect(createIndex).toHaveBeenNthCalledWith(
      1,
      { orpha_code: 1 },
      { unique: true, name: 'orpha_code_unique' },
    );
    expect(createIndex).toHaveBeenNthCalledWith(
      2,
      { disease_category: 1 },
      { name: 'disease_category_idx' },
    );
    expect(createIndex).toHaveBeenNthCalledWith(
      3,
      { active: 1 },
      { name: 'disease_active_idx' },
    );
    expect(logSpy).toHaveBeenCalledWith('DiseaseDictionary seeded: 3 operations');
  });

  it('skips an orphanet row whose code normalizes to empty', async () => {
    const { db, bulkWrite } = mockDb({
      orphanetRows: [{ code: '   ' }, { orphaCode: '', ORPHA: '' }],
    });
    const connectDB = vi.fn().mockResolvedValue(db);
    const closeConnection = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    loadScript({ connectDB, closeConnection });
    await vi.waitFor(() => expect(closeConnection).toHaveBeenCalledTimes(1));

    // Only the 3 built-in DISEASE_RULES operations, both blank rows skipped.
    expect(bulkWrite.mock.calls[0][0]).toHaveLength(3);
  });

  it('strips an ORPHA: prefix and trailing whitespace when normalizing a code', async () => {
    const { db, bulkWrite } = mockDb({
      orphanetRows: [{ code: 'orpha:324  ', name: 'ignored explicit name' }],
    });
    const connectDB = vi.fn().mockResolvedValue(db);
    const closeConnection = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    loadScript({ connectDB, closeConnection });
    await vi.waitFor(() => expect(closeConnection).toHaveBeenCalledTimes(1));

    const operations = bulkWrite.mock.calls[0][0];
    // The orphanet row for '324' merges with (and is overridden by) the
    // explicit DISEASE_RULES entry, plus the 3 built-in entries = 4 total.
    expect(operations).toHaveLength(4);
    const explicitOverride = operations.filter(
      (op) => op.updateOne.filter.orpha_code === '324',
    );
    expect(explicitOverride).toHaveLength(2);
    // Both the orphanet-row-derived op and the built-in-loop op use the
    // explicit name, not the row's own name field.
    for (const op of explicitOverride) {
      expect(op.updateOne.update.$set.name).toBe('Doenca lisossomica');
    }
  });

  it('falls back through row name fields, then ORPHA:<code>, for a non-explicit disease', async () => {
    const { db, bulkWrite } = mockDb({
      orphanetRows: [
        { code: '999001' },
        { code: '999002', nome: 'Nome PT' },
        { code: '999003', name: 'Name EN', nome: 'Nome PT' },
      ],
    });
    const connectDB = vi.fn().mockResolvedValue(db);
    const closeConnection = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    loadScript({ connectDB, closeConnection });
    await vi.waitFor(() => expect(closeConnection).toHaveBeenCalledTimes(1));

    const operations = bulkWrite.mock.calls[0][0];
    const byCode = (code) =>
      operations.find((op) => op.updateOne.filter.orpha_code === code).updateOne.update.$set;

    expect(byCode('999001').name).toBe('ORPHA:999001');
    expect(byCode('999002').name).toBe('Nome PT');
    expect(byCode('999003').name).toBe('Name EN');
  });

  it('derives disease_category from an explicit category field before falling back to keyword matching', async () => {
    const { db, bulkWrite } = mockDb({
      orphanetRows: [
        { code: '999010', classification: 'Explicit Category' },
        { code: '999011', description: 'sindrome metabolica rara' },
        { code: '999012', Descricao: 'distrofia muscular progressiva' },
        { code: '999013', name: 'anemia hemolitica hereditaria' },
        { code: '999014', name: 'condicao sem palavra-chave conhecida' },
      ],
    });
    const connectDB = vi.fn().mockResolvedValue(db);
    const closeConnection = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    loadScript({ connectDB, closeConnection });
    await vi.waitFor(() => expect(closeConnection).toHaveBeenCalledTimes(1));

    const operations = bulkWrite.mock.calls[0][0];
    const byCode = (code) =>
      operations.find((op) => op.updateOne.filter.orpha_code === code).updateOne.update.$set;

    expect(byCode('999010').disease_category).toBe('Explicit Category');
    expect(byCode('999011').disease_category).toBe('Erros Inatos do Metabolismo');
    expect(byCode('999012').disease_category).toBe('Doencas Neurologicas');
    expect(byCode('999013').disease_category).toBe('Doencas Hematologicas');
    expect(byCode('999014').disease_category).toBe('Outras Doencas Raras');
  });

  it('defaults validation_requirements and drug_classes for a non-explicit disease', async () => {
    const { db, bulkWrite } = mockDb({
      orphanetRows: [{ code: '999020', name: 'Non explicit disease' }],
    });
    const connectDB = vi.fn().mockResolvedValue(db);
    const closeConnection = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    loadScript({ connectDB, closeConnection });
    await vi.waitFor(() => expect(closeConnection).toHaveBeenCalledTimes(1));

    const operations = bulkWrite.mock.calls[0][0];
    const op = operations.find((o) => o.updateOne.filter.orpha_code === '999020').updateOne.update.$set;

    expect(op.drug_classes).toEqual([]);
    expect(op.validation_requirements).toMatchObject({
      miabis: { requireTreatmentStatus: true },
      biomarkers: { required: [], recommended: [] },
      pharmacology: {
        required: ['treatment_status'],
        recommended: ['medication_name', 'last_dose_date'],
        treatmentStatuses: ['NAIVE', 'TREATED', 'WASHOUT'],
      },
    });
  });

  it('logs and sets a non-zero exitCode, still closing the connection, when connectDB rejects', async () => {
    const connectError = new Error('mongo unreachable');
    const connectDB = vi.fn().mockRejectedValue(connectError);
    const closeConnection = vi.fn().mockResolvedValue(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      loadScript({ connectDB, closeConnection });
      await vi.waitFor(() => expect(closeConnection).toHaveBeenCalledTimes(1));

      expect(errorSpy).toHaveBeenCalledWith(
        'Erro ao semear regras de validacao clinica:',
        'mongo unreachable',
      );
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it('logs and sets a non-zero exitCode, still closing the connection, when bulkWrite rejects', async () => {
    const bulkWriteError = new Error('bulk write failed');
    const { db } = mockDb({
      orphanetRows: [],
      bulkWriteImpl: vi.fn().mockRejectedValue(bulkWriteError),
    });
    const connectDB = vi.fn().mockResolvedValue(db);
    const closeConnection = vi.fn().mockResolvedValue(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      loadScript({ connectDB, closeConnection });
      await vi.waitFor(() => expect(closeConnection).toHaveBeenCalledTimes(1));

      expect(errorSpy).toHaveBeenCalledWith(
        'Erro ao semear regras de validacao clinica:',
        'bulk write failed',
      );
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = originalExitCode;
    }
  });
});
