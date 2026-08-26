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
 * Storage: the retained file is named by batch id, NOT by the uploaded
 * originalname -- originalname is attacker-controlled and would otherwise be
 * a path-traversal vector into the quarantine directory. The original name is
 * kept as metadata on the batch instead.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs = require('fs');
const os = require('os');
const path = require('path');

const importLGPDService = require('../../src/services/import-lgpd.service');
const controller = require('../../src/controllers/import-lgpd.controller');

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

describe('#792: retaining the LGPD import source file when rows were quarantined', () => {
  let root;
  let tempDir;

  beforeEach(() => {
    ({ root, tempDir } = createUploadDir());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('importLGPDService.retainSourceFileForBatch', () => {
    it('moves the upload out of temp/ and records it on the batch document', async () => {
      const file = createUploadedFile(tempDir);
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = { collection: vi.fn().mockReturnValue({ updateOne }) };

      const retained = await importLGPDService.retainSourceFileForBatch(db, file, 'batch-792');

      // Moved, not copied -- temp/ must not keep a second copy of civil data.
      expect(fs.existsSync(file.path)).toBe(false);
      expect(retained).toBeTruthy();
      expect(fs.existsSync(retained.storedPath)).toBe(true);
      expect(fs.readFileSync(retained.storedPath, 'utf8')).toContain('12345678900');

      // Named by batch id, never by the uploaded originalname.
      expect(path.basename(retained.storedPath)).toBe('batch-792.csv');
      expect(retained.storedPath).not.toContain('amostras');

      expect(retained.originalName).toBe('amostras.csv');
      expect(retained.size).toBe(file.size);
      expect(retained.retainedAt).toBeInstanceOf(Date);

      expect(db.collection).toHaveBeenCalledWith('import_batches');
      const [filter, update] = updateOne.mock.calls[0];
      expect(filter).toMatchObject({ _id: 'batch-792' });
      expect(update.$set.sourceFile).toMatchObject({
        originalName: 'amostras.csv',
        size: file.size,
      });
    });

    it('does not let an originalname containing traversal escape the quarantine directory', async () => {
      const file = createUploadedFile(tempDir);
      file.originalname = '../../../../etc/passwd.csv';
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = { collection: vi.fn().mockReturnValue({ updateOne }) };

      const retained = await importLGPDService.retainSourceFileForBatch(db, file, 'batch-evil');

      expect(path.basename(retained.storedPath)).toBe('batch-evil.csv');
      expect(path.dirname(retained.storedPath)).toBe(path.join(root, 'uploads', 'quarantine'));
    });

    // Best-effort, matching quarantineRejectedSampleRows: losing the review
    // copy must not also fail the import that already succeeded in part.
    it('returns null instead of throwing when the file cannot be retained', async () => {
      const file = { path: path.join(tempDir, 'does-not-exist'), originalname: 'x.csv', size: 0 };
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = { collection: vi.fn().mockReturnValue({ updateOne }) };

      await expect(importLGPDService.retainSourceFileForBatch(db, file, 'batch-gone')).resolves.toBeNull();
    });
  });

  describe('importSamples controller wiring', () => {
    function createRes() {
      return { status: vi.fn().mockReturnThis(), json: vi.fn() };
    }

    function createReq(file) {
      return {
        app: { locals: { db: { collection: vi.fn() } } },
        file,
        body: {},
      };
    }

    it('retains the file rather than deleting it when rows were quarantined', async () => {
      const file = createUploadedFile(tempDir);
      const req = createReq(file);
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importSamples').mockResolvedValue({
        total: 2,
        success: 1,
        errors: [{ row: 2, errors: ['dup barcode'], data: { participantId: '12345678' } }],
        stagingBatchId: 'batch-792',
      });
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importSamples(req, res);

      expect(cleanupSpy).not.toHaveBeenCalled();
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
});
