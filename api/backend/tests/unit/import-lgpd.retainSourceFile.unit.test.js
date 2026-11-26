/**
 * #792 (RNF011 AC#4): the LGPD sample import deleted the uploaded source file
 * unconditionally, even when rows had just been quarantined.
 *
 * #787 made the rejected *rows* survive; the file they came from did not. The
 * two are not interchangeable. The quarantined row is the system's *parsed*
 * view, so it is worthless for exactly the failure mode where the file itself
 * is at fault -- a wrong delimiter, a bad encoding, a shifted column -- where
 * the staged row is a record of the misparse rather than of the input. It is
 * also not the artifact a compliance reviewer would ask for when
 * reconstructing what an operator actually submitted.
 *
 * Retention is keyed to the same import_batches document #787 writes, and a
 * fully-clean import still deletes its file, matching #787's own "no empty
 * batch for a clean file" decision.
 *
 * Storage: the retained file goes to the object store (#1419), keyed
 * `import-sources/<batch id>/sha256/<hex>`, NOT by the uploaded originalname
 * -- originalname is attacker-controlled and would otherwise be a
 * path-traversal vector. The original name is kept as metadata on the batch
 * instead.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs = require('fs');
const os = require('os');
const path = require('path');

const importLGPDService = require('../../src/services/import-lgpd.service');
const controller = require('../../src/controllers/import-lgpd.controller');
const { decryptFileBuffer } = require('../../src/utils/fileCrypto');
const keyRegistry = require('../../src/config/keyRegistry');
const objectStorage = require('../../src/infrastructure/objectStorage');
const logger = require('../../src/utils/logger');

/** A throwaway uploads/temp/ that mirrors multer's real layout. */
function createUploadDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bio-792-'));
  const tempDir = path.join(root, 'uploads', 'temp');
  fs.mkdirSync(tempDir, { recursive: true });
  return { root, tempDir };
}

function createUploadedFile(tempDir, contents = 'Nome,CPF\nMaria,12345678900\n') {
  const filePath = path.join(tempDir, 'upload-abc123');
  fs.writeFileSync(filePath, contents);
  return {
    path: filePath,
    originalname: 'amostras.csv',
    size: Buffer.byteLength(contents),
  };
}

const SOURCE_URI = /^objstore:\/\/import-sources\/batch-792\/sha256\/([0-9a-f]{64})$/;

describe('#792: retaining the LGPD import source file when rows were quarantined', () => {
  let root;
  let tempDir;
  let store;

  beforeEach(() => {
    ({ root, tempDir } = createUploadDir());
    // #1419: the unit env sets no STORAGE_DIR, so the default store would
    // write under the checkout; every case gets a store under its own root.
    store = objectStorage.createFilesystemObjectStore({ root: path.join(root, 'store') });
    vi.spyOn(objectStorage, 'getFileObjectStore').mockReturnValue(store);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('importLGPDService.retainSourceFileForBatch', () => {
    it('moves the upload out of temp/ into the object store and records it on the batch document', async () => {
      const file = createUploadedFile(tempDir);
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = { collection: vi.fn().mockReturnValue({ updateOne }) };

      const retained = await importLGPDService.retainSourceFileForBatch(db, file, 'batch-792');

      // Moved, not copied -- temp/ must not keep a second copy of civil data.
      expect(fs.existsSync(file.path)).toBe(false);
      expect(retained).toBeTruthy();
      // #1419: keyed by area and batch id in the object store.
      expect(retained.storageUri).toMatch(SOURCE_URI);
      const [, hex] = SOURCE_URI.exec(retained.storageUri);
      expect(retained.storageObjectVersion).toBe(`sha256:${hex}`);
      // #807: stored as ciphertext; the content survives behind the key.
      const stored = await store.getObject(retained.storageUri);
      expect(stored.toString('utf8')).not.toContain('12345678900');
      expect(decryptFileBuffer(stored, retained).toString('utf8')).toBe('Nome,CPF\nMaria,12345678900\n');

      // Never named by the uploaded originalname.
      expect(retained.storedPath).not.toContain('amostras');
      expect(retained.storageUri).not.toContain('amostras');

      expect(retained.originalName).toBe('amostras.csv');
      expect(retained.size).toBe(file.size);
      expect(retained.retainedAt).toBeInstanceOf(Date);

      expect(db.collection).toHaveBeenCalledWith('import_batches');
      const [filter, update] = updateOne.mock.calls[0];
      expect(filter).toMatchObject({ _id: 'batch-792' });
      expect(update.$set.sourceFile).toMatchObject({
        storageUri: retained.storageUri,
        originalName: 'amostras.csv',
        size: file.size,
      });
    });

    it('keeps every part of a traversal originalname out of the object key', async () => {
      const file = createUploadedFile(tempDir);
      file.originalname = '../../../../etc/passwd.csv';
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = { collection: vi.fn().mockReturnValue({ updateOne }) };

      const retained = await importLGPDService.retainSourceFileForBatch(db, file, 'batch-evil');

      expect(retained.storageUri).toMatch(/^objstore:\/\/import-sources\/batch-evil\/sha256\/[0-9a-f]{64}$/);
      for (const part of ['..', 'etc', 'passwd', '.csv']) {
        expect(retained.storageUri).not.toContain(part);
        expect(path.relative(path.join(root, 'store'), retained.storedPath)).not.toContain(part);
      }
    });

    it('returns null, logs and leaves the upload in place when the object store refuses the put', async () => {
      const file = createUploadedFile(tempDir);
      const updateOne = vi.fn();
      const db = { collection: vi.fn().mockReturnValue({ updateOne }) };
      vi.spyOn(store, 'putObject').mockRejectedValue(new Error('store down'));
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      await expect(importLGPDService.retainSourceFileForBatch(db, file, 'batch-792')).resolves.toBeNull();

      expect(fs.existsSync(file.path)).toBe(true);
      expect(updateOne).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('RNF011 AC#4'), 'store down');
    });

    // Best-effort, matching quarantineRejectedSampleRows: losing the review
    // copy must not also fail the import that already succeeded in part.
    it('returns null instead of throwing when the file cannot be retained', async () => {
      const file = { path: path.join(tempDir, 'does-not-exist'), originalname: 'x.csv', size: 0 };
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = { collection: vi.fn().mockReturnValue({ updateOne }) };

      await expect(importLGPDService.retainSourceFileForBatch(db, file, 'batch-gone')).resolves.toBeNull();
    });

    it('returns null without touching the batch when the upload has no path (#1337)', async () => {
      const db = { collection: vi.fn() };

      await expect(importLGPDService.retainSourceFileForBatch(db, { originalname: 'x.csv' }, 'batch-nopath')).resolves.toBeNull();
      expect(db.collection).not.toHaveBeenCalled();
    });

    describe('with no encryption key configured (#1337)', () => {
      const savedOptOut = process.env.ALLOW_UNENCRYPTED_FILE_STORAGE;

      beforeEach(() => {
        vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(null);
      });

      afterEach(() => {
        if (savedOptOut === undefined) delete process.env.ALLOW_UNENCRYPTED_FILE_STORAGE;
        else process.env.ALLOW_UNENCRYPTED_FILE_STORAGE = savedOptOut;
      });

      it('moves the upload as plaintext when ALLOW_UNENCRYPTED_FILE_STORAGE is "true"', async () => {
        process.env.ALLOW_UNENCRYPTED_FILE_STORAGE = 'true';
        const file = createUploadedFile(tempDir);
        const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
        const db = { collection: vi.fn().mockReturnValue({ updateOne }) };

        const retained = await importLGPDService.retainSourceFileForBatch(db, file, 'batch-plain');

        expect(fs.existsSync(file.path)).toBe(false);
        expect(retained.encrypted).toBe(false);
        expect(retained).not.toHaveProperty('encryptionAlgorithm');
        expect((await store.getObject(retained.storageUri)).toString('utf8')).toContain('12345678900');
        expect(updateOne).toHaveBeenCalledWith(
          { _id: 'batch-plain' },
          { $set: { sourceFile: retained, updatedAt: retained.retainedAt } }
        );
      });

      it('retains nothing and leaves the upload in place without the opt-out', async () => {
        delete process.env.ALLOW_UNENCRYPTED_FILE_STORAGE;
        const file = createUploadedFile(tempDir);
        const updateOne = vi.fn();
        const db = { collection: vi.fn().mockReturnValue({ updateOne }) };

        await expect(importLGPDService.retainSourceFileForBatch(db, file, 'batch-refused')).resolves.toBeNull();
        expect(fs.existsSync(file.path)).toBe(true);
        expect(fs.existsSync(path.join(root, 'store'))).toBe(false);
        expect(updateOne).not.toHaveBeenCalled();
      });
    });
  });

  describe('importSamples controller wiring', () => {
    function createRes() {
      return { status: vi.fn().mockReturnThis(), json: vi.fn() };
    }

    function createReq(file) {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      return {
        organizationScope: { scope: 'global' },
        app: { locals: { db: { collection: vi.fn().mockReturnValue({ updateOne }) } } },
        file,
        body: {},
      };
    }

    function quarantinedResult() {
      return {
        total: 2,
        success: 1,
        errors: [{ row: 2, errors: ['dup barcode'], data: { participantId: '12345678' } }],
        stagingBatchId: 'batch-792',
      };
    }

    it('retains the file rather than deleting it when rows were quarantined', async () => {
      const file = createUploadedFile(tempDir);
      const req = createReq(file);
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importSamples').mockResolvedValue(quarantinedResult());
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importSamples(req, res);

      // Retained in the store: the service removed the staging file, and the
      // controller does not remove it a second time.
      expect(fs.existsSync(file.path)).toBe(false);
      expect(cleanupSpy).not.toHaveBeenCalled();
    });

    // #1419: a null retention (the store refused the put) must not leave the
    // plaintext staging copy in temp/; the import outcome is unchanged.
    it('removes the staging file when retention returns null, with the quarantine response unchanged', async () => {
      const file = createUploadedFile(tempDir);
      const req = createReq(file);
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importSamples').mockResolvedValue(quarantinedResult());
      vi.spyOn(store, 'putObject').mockRejectedValue(new Error('store down'));
      vi.spyOn(logger, 'error').mockImplementation(() => {});
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile');

      await controller.importSamples(req, res);

      expect(cleanupSpy).toHaveBeenCalledTimes(1);
      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(fs.existsSync(file.path)).toBe(false);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0]).toMatchObject({
        success: false,
        data: { total: 2, success: 1, errors: 1, stagingBatchId: 'batch-792' },
      });
    });

    it('still deletes the file on a fully clean import', async () => {
      const file = createUploadedFile(tempDir);
      const req = createReq(file);
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importSamples').mockResolvedValue({
        total: 2,
        success: 2,
        errors: [],
        stagingBatchId: null,
      });
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importSamples(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
    });
  });

  // #806 (RNF011 AC#4): a header-level throw (missing required headers, no
  // patient identification columns) happens ABOVE importSamples' row loop --
  // quarantineRejectedSampleRows never runs, so #792's retention above never
  // had a batch to key off. This is the gap #806 closes: the file must still
  // be retained, this time against a FAILED batch the controller opens for
  // the throw itself, rather than deleted as evidence.
  describe('#806: retaining the source file when the import throws at header level', () => {
    function createRes() {
      return { status: vi.fn().mockReturnThis(), json: vi.fn() };
    }

    it('opens a FAILED batch carrying the error and retains the file against it', async () => {
      const file = createUploadedFile(tempDir);
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'batch-failed-806' });
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = { collection: vi.fn().mockReturnValue({ insertOne, updateOne }) };
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file, body: {} };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importSamples').mockRejectedValue(
        new Error('Campos obrigatórios ausentes: sampleType, sampleOrigin')
      );
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importSamples(req, res);

      // Moved out of temp/, not deleted.
      expect(cleanupSpy).not.toHaveBeenCalled();
      expect(fs.existsSync(file.path)).toBe(false);

      expect(insertOne).toHaveBeenCalledTimes(1);
      const insertedBatch = insertOne.mock.calls[0][0];
      expect(insertedBatch.status).toBe('FAILED');
      expect(insertedBatch.type).toBe('LGPD_SAMPLE_CSV');
      expect(insertedBatch.error).toContain('Campos obrigatórios ausentes');

      expect(updateOne).toHaveBeenCalledTimes(1);
      const [filter, update] = updateOne.mock.calls[0];
      expect(filter).toEqual({ _id: 'batch-failed-806' });
      expect(update.$set.sourceFile.originalName).toBe('amostras.csv');

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // #1419: the same for the FAILED batch: a null retention removes the
    // plaintext staging copy, and the batch and the response are unchanged.
    it('removes the staging file when retention against the FAILED batch returns null', async () => {
      const file = createUploadedFile(tempDir);
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'batch-failed-1419' });
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = { collection: vi.fn().mockReturnValue({ insertOne, updateOne }) };
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file, body: {} };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importSamples').mockRejectedValue(new Error('sample boom'));
      vi.spyOn(store, 'putObject').mockRejectedValue(new Error('store down'));
      vi.spyOn(logger, 'error').mockImplementation(() => {});
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile');

      await controller.importSamples(req, res);

      expect(cleanupSpy).toHaveBeenCalledTimes(1);
      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(fs.existsSync(file.path)).toBe(false);
      expect(insertOne).toHaveBeenCalledTimes(1);
      expect(insertOne.mock.calls[0][0].status).toBe('FAILED');
      expect(updateOne).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json.mock.calls[0][0].message).toBe('sample boom');
    });

    it('falls back to deleting the file when retention itself fails, and still reports the original error', async () => {
      const file = createUploadedFile(tempDir);
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'batch-failed-807' });
      const db = { collection: vi.fn().mockReturnValue({ insertOne }) };
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file, body: {} };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importSamples').mockRejectedValue(new Error('sample boom'));
      // Retention itself fails (e.g. disk full moving the file out of temp/)
      // even though the FAILED batch was created successfully above.
      vi.spyOn(importLGPDService, 'retainSourceFileForBatch').mockRejectedValue(new Error('disk full'));
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importSamples(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(500);
      const body = res.json.mock.calls[0][0];
      // The original service error reaches the client, not "disk full".
      expect(body.message).toBe('sample boom');
    });
  });
});
