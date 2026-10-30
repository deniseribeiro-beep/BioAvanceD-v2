/**
 * #807 (RNF020 AC#4, RNF029 AC#5): the LGPD import quarantine stored the
 * rejected spreadsheet row, and the retained source file, in plaintext. The
 * same identifiers are encrypted everywhere else they are stored, and a
 * rejected row is the one most likely to sit unattended.
 *
 * Writer: quarantineRejectedSampleRows seals row/normalized before insert.
 * Reader: getQuarantineBatch unseals, so the API and UI shape is unchanged.
 * File:   retainSourceFileForBatch writes ciphertext and records the envelope.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ObjectId } = require('mongodb');

const importLGPDService = require('../../src/services/import-lgpd.service');
const { decryptFileBuffer } = require('../../src/utils/fileCrypto');
const objectStorage = require('../../src/infrastructure/objectStorage');
const { sealStagedRecord } = require('../../src/utils/stagedRowCrypto');

const CPF = '12345678900';
const CIVIL_ROW = { Nome: 'Maria da Silva', CPF, Barcode: 'BC-1' };

describe('#807: LGPD quarantine is encrypted at rest', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('quarantineRejectedSampleRows', () => {
    function createDb() {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
      const insertMany = vi.fn().mockResolvedValue({ insertedCount: 1 });
      const db = {
        collection: vi.fn((name) => (name === 'import_batches' ? { insertOne } : { insertMany })),
      };
      return { db, insertMany };
    }

    for (const type of ['LGPD_SAMPLE_CSV', 'LGPD_PATIENT_CSV']) {
      it(`stages no civil value in plaintext (${type})`, async () => {
        const { db, insertMany } = createDb();

        await importLGPDService.quarantineRejectedSampleRows(db, {
          fileName: 'x.csv',
          rows: [CIVIL_ROW],
          results: {
            total: 1,
            success: 0,
            errors: [{ row: 2, index: 0, errors: ['CPF invalido'], data: { identityDocument: CPF } }],
          },
          type,
        });

        const [docs] = insertMany.mock.calls[0];
        expect(docs).toHaveLength(1);
        expect(JSON.stringify(docs)).not.toContain(CPF);
        expect(docs[0].row).toBeNull();
        expect(docs[0].sealedPayload).toBeTruthy();
        // The rejection reason stays readable without the key.
        expect(docs[0].errors).toEqual(['CPF invalido']);
        expect(docs[0].rowNumber).toBe(2);
      });
    }
  });

  describe('getQuarantineBatch', () => {
    it('returns the original row and normalized values to an authorised reader', async () => {
      const batchId = new ObjectId();
      const stored = sealStagedRecord({
        batchId,
        rowNumber: 2,
        status: 'ERROR',
        errors: ['CPF invalido'],
        row: CIVIL_ROW,
        normalized: { identityDocument: CPF },
      });
      const legacy = { batchId, rowNumber: 3, status: 'ERROR', errors: ['x'], row: { CPF: '999' }, normalized: null };

      const toArray = vi.fn().mockResolvedValue([stored, legacy]);
      const db = {
        collection: vi.fn((name) =>
          name === 'import_batches'
            ? { findOne: vi.fn().mockResolvedValue({ _id: batchId, type: 'LGPD_SAMPLE_CSV' }) }
            : { find: vi.fn(() => ({ sort: vi.fn(() => ({ toArray })) })) }
        ),
      };

      const { records } = await importLGPDService.getQuarantineBatch(db, String(batchId));

      expect(records[0].row).toEqual(CIVIL_ROW);
      expect(records[0].normalized).toEqual({ identityDocument: CPF });
      expect(records[0]).not.toHaveProperty('sealedPayload');
      // Control: a row staged before #807 reads back as stored.
      expect(records[1]).toEqual(legacy);
    });
  });

  describe('retainSourceFileForBatch', () => {
    let root;
    let tempDir;
    let store;

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'bio-807-'));
      tempDir = path.join(root, 'uploads', 'temp');
      fs.mkdirSync(tempDir, { recursive: true });
      // #1419: the file goes to the object store; keep it under this root.
      store = objectStorage.createFilesystemObjectStore({ root: path.join(root, 'store') });
      vi.spyOn(objectStorage, 'getFileObjectStore').mockReturnValue(store);
    });

    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('writes ciphertext to the object store and records what decrypts it', async () => {
      const contents = `Nome,CPF\nMaria da Silva,${CPF}\n`;
      const filePath = path.join(tempDir, 'upload-807');
      fs.writeFileSync(filePath, contents);
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = { collection: vi.fn().mockReturnValue({ updateOne }) };

      const retained = await importLGPDService.retainSourceFileForBatch(
        db,
        { path: filePath, originalname: 'amostras.csv', size: Buffer.byteLength(contents) },
        'batch-807'
      );

      expect(fs.existsSync(filePath)).toBe(false);
      const onDisk = await store.getObject(retained.storageUri);
      expect(onDisk.toString('utf8')).not.toContain(CPF);

      const [, update] = updateOne.mock.calls[0];
      const recorded = update.$set.sourceFile;
      expect(recorded).toMatchObject({
        encrypted: true,
        encryptionAlgorithm: 'aes-256-gcm',
        encryptionKeyId: 'vitest-key-001',
      });
      expect(decryptFileBuffer(onDisk, recorded).toString('utf8')).toBe(contents);
    });
  });
});
