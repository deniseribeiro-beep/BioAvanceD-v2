import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const createLinkedFileController = require('../../src/controllers/createLinkedFileController');
const fs = require('fs');
const { ObjectId } = require('mongodb');
// createLinkedFileController.js lazily requires auditLogger inside
// logAudit(), which itself lazily requires log.service.js at call time --
// with fs.readFileSync mocked (below), Node's own CJS loader can end up
// feeding a mocked buffer to its module compiler and crash the worker for
// any require() that isn't already cached. Mock auditLogger.log directly so
// none of that lazy-require chain executes during these tests -- audit-log
// internals aren't what's under test here.
const auditLogger = require('../../src/utils/auditLogger');
const { createMatchingCollection } = require('../factories/filter.factory');

// #643 (RF007 AC#6): generic factory used by both assay-file.routes.js and
// dataset-file.routes.js. Tested once here (parameterized with a fictional
// 'widgets' entity) since both real consumers share this exact code path --
// per-entity coverage lives in the thin wiring tests instead.

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    send: vi.fn(),
    headersSent: false
  };
}

function createDb(collections = {}) {
  const store = {};
  return {
    collection: vi.fn((name) => {
      if (!store[name]) {
        store[name] = collections[name] || {
          findOne: vi.fn().mockResolvedValue(null),
          insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
          deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
          updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) })
        };
      }
      return store[name];
    })
  };
}

function buildController(overrides = {}) {
  return createLinkedFileController({
    parentCollectionName: 'widgets',
    parentIdParam: 'widgetId',
    parentIdField: 'widgetId',
    fileCollectionName: 'widgetFiles',
    storageSubdir: 'widgets',
    resourceType: 'WidgetFile',
    moduleLabel: 'Widgets',
    ...overrides
  });
}

// #1321: a replace versions the superseded binary, so a fixture that
// reaches the version write names its storageUri and SHA-256 checksum.
const OLD_CHECKSUM = 'b'.repeat(64);

function createVersionsCollection() {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 })
  };
}

describe('createLinkedFileController', () => {
  beforeEach(() => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('uploadFile', () => {
    it('404s when the parent entity does not exist', async () => {
      const controller = buildController();
      const widgetsColl = { findOne: vi.fn().mockResolvedValue(null) };
      const db = createDb({ widgets: widgetsColl });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      const req = { app: { locals: { db } }, params: { widgetId: 'w-1' }, file: { path: '/tmp/x', originalname: 'x.csv', size: 10 } };
      const res = createRes();

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('400s when no file is provided', async () => {
      const controller = buildController();
      const db = createDb();
      const req = { app: { locals: { db } }, params: { widgetId: 'w-1' }, file: undefined };
      const res = createRes();

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('403s when the org-scope hook rejects the parent', async () => {
      const controller = buildController({
        checkOrgScope: vi.fn().mockResolvedValue(false)
      });
      const widgetsColl = { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1', organizationId: 'org-other' }) };
      const db = createDb({ widgets: widgetsColl });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      const req = {
        app: { locals: { db } },
        params: { widgetId: 'w-1' },
        organizationScope: { scope: 'org', organizationIds: ['org-mine'] },
        file: { path: '/tmp/x', originalname: 'x.csv', size: 10 }
      };
      const res = createRes();

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('creates a file record, computes checksum, and audits on success', async () => {
      const controller = buildController();
      const insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
      const widgetsColl = { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1' }) };
      const widgetFilesColl = { insertOne };
      const db = createDb({ widgets: widgetsColl, widgetFiles: widgetFilesColl });

      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('hello'));
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

      const req = {
        app: { locals: { db } },
        params: { widgetId: 'w-1' },
        user: { userID: 'u-1' },
        file: { path: '/tmp/x.csv', originalname: 'x.csv', size: 5 }
      };
      const res = createRes();

      await controller.uploadFile(req, res);

      expect(insertOne).toHaveBeenCalled();
      const insertedDoc = insertOne.mock.calls[0][0];
      expect(insertedDoc.widgetId).toBe('w-1');
      expect(insertedDoc.checksum).toBeTruthy();
      expect(insertedDoc.checksumAlgorithm).toBe('sha256');
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('listFiles', () => {
    it('404s when the parent entity does not exist', async () => {
      const controller = buildController();
      const db = createDb({ widgets: { findOne: vi.fn().mockResolvedValue(null) } });
      const req = { app: { locals: { db } }, params: { widgetId: 'w-1' } };
      const res = createRes();

      await controller.listFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns sanitized files for the parent, no storagePath', async () => {
      const controller = buildController();
      const files = [{ _id: 'f1', widgetId: 'w-1', fileName: 'a.csv', storagePath: '/secret/path' }];
      const db = createDb({
        widgets: { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1' }) },
        widgetFiles: { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(files) }) }
      });
      const req = { app: { locals: { db } }, params: { widgetId: 'w-1' } };
      const res = createRes();

      await controller.listFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const [payload] = res.json.mock.calls[0];
      expect(payload.data[0]).not.toHaveProperty('storagePath');
      expect(payload.data[0].fileName).toBe('a.csv');
    });

    // RF007 AC6 (#1321): a logically deleted file is not listed.
    it('lists only files with no deletedAt', async () => {
      const controller = buildController();
      const find = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
      const db = createDb({
        widgets: { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1' }) },
        widgetFiles: { find }
      });
      const req = { app: { locals: { db } }, params: { widgetId: 'w-1' } };
      const res = createRes();

      await controller.listFiles(req, res);

      expect(find).toHaveBeenCalledWith({ widgetId: 'w-1', deletedAt: null });
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // #1336: every parent lookup above is an identity stub, so none of them
  // could see which parent the `$or` query resolved. These seed two parents,
  // the decoy first, and reach the target by each of its two identifiers.
  describe('parent lookup resolves the requested parent, by either id', () => {
    const decoyId = new ObjectId();
    const targetId = new ObjectId();
    const parents = () => [
      { _id: decoyId, widgetId: 'w-decoy' },
      { _id: targetId, widgetId: 'w-target' }
    ];

    it.each([
      ['its business id', 'w-target'],
      ['its ObjectId', targetId.toString()]
    ])('uploadFile links the record to the parent addressed by %s', async (_label, rawId) => {
      const controller = buildController();
      const widgetFiles = createMatchingCollection([]);
      const db = createDb({ widgets: createMatchingCollection(parents()), widgetFiles });
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('hello'));
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

      const req = {
        app: { locals: { db } },
        params: { widgetId: rawId },
        user: { userID: 'u-1' },
        file: { path: '/tmp/x.csv', originalname: 'x.csv', size: 5 }
      };
      const res = createRes();

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(widgetFiles.docs).toHaveLength(1);
      expect(widgetFiles.docs[0].widgetId).toBe('w-target');
    });

    it('listFiles returns only the files of the parent addressed by ObjectId', async () => {
      const controller = buildController();
      const files = [
        { _id: new ObjectId(), widgetId: 'w-decoy', fileName: 'decoy.csv' },
        { _id: new ObjectId(), widgetId: 'w-target', fileName: 'target.csv' }
      ];
      const db = createDb({
        widgets: createMatchingCollection(parents()),
        widgetFiles: createMatchingCollection(files)
      });
      const req = { app: { locals: { db } }, params: { widgetId: targetId.toString() } };
      const res = createRes();

      await controller.listFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const [payload] = res.json.mock.calls[0];
      expect(payload.data.map((f) => f.fileName)).toEqual(['target.csv']);
    });

    it('404s for an id that names neither parent', async () => {
      const controller = buildController();
      const db = createDb({ widgets: createMatchingCollection(parents()) });
      const req = { app: { locals: { db } }, params: { widgetId: new ObjectId().toString() } };
      const res = createRes();

      await controller.listFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('downloadFile / deleteFile / replaceFile — link check', () => {
    // RF007 AC6 (#1321): findFileAndCheckLink reads a logically deleted row
    // as missing, for download, delete and replace alike.
    describe('a logically deleted file reads as missing', () => {
      function deletedFileDb(fileId, extra = {}) {
        const fileRecord = { _id: fileId, widgetId: 'w-1', fileName: 'a.csv', storagePath: '/tmp/a.csv', deletedAt: new Date() };
        return createDb({
          widgets: { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1' }) },
          widgetFiles: { findOne: vi.fn().mockResolvedValue(fileRecord), ...extra }
        });
      }

      it('downloadFile 404s on a deletedAt row', async () => {
        const controller = buildController();
        const fileId = new ObjectId();
        const db = deletedFileDb(fileId);
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('plaintext'));
        const req = { app: { locals: { db } }, params: { widgetId: 'w-1', fileID: fileId.toString() } };
        const res = createRes();

        await controller.downloadFile(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Arquivo não encontrado' });
        expect(readSpy).not.toHaveBeenCalled();
      });

      it('deleteFile 404s on a deletedAt row and writes no audit', async () => {
        const controller = buildController();
        const fileId = new ObjectId();
        const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
        const db = deletedFileDb(fileId, { updateOne });
        const req = { app: { locals: { db } }, params: { widgetId: 'w-1', fileID: fileId.toString() }, user: { userID: 'u-1' } };
        const res = createRes();

        await controller.deleteFile(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Arquivo não encontrado' });
        expect(updateOne).not.toHaveBeenCalled();
        expect(auditLogger.log).not.toHaveBeenCalled();
      });

      it('replaceFile 404s on a deletedAt row and cleans up the upload', async () => {
        const controller = buildController();
        const fileId = new ObjectId();
        const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
        const db = deletedFileDb(fileId, { updateOne });
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
        const req = {
          app: { locals: { db } },
          params: { widgetId: 'w-1', fileID: fileId.toString() },
          user: { userID: 'u-1' },
          file: { path: '/tmp/new.csv', originalname: 'new.csv', size: 11 }
        };
        const res = createRes();

        await controller.replaceFile(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Arquivo não encontrado' });
        expect(updateOne).not.toHaveBeenCalled();
        expect(unlinkSpy).toHaveBeenCalledWith('/tmp/new.csv');
      });
    });

    it('downloadFile 403s when the file belongs to a different parent', async () => {
      const controller = buildController();
      const fileId = new ObjectId();
      const db = createDb({
        widgets: { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1' }) },
        widgetFiles: { findOne: vi.fn().mockResolvedValue({ _id: fileId, widgetId: 'w-OTHER' }) }
      });
      const req = { app: { locals: { db } }, params: { widgetId: 'w-1', fileID: fileId.toString() } };
      const res = createRes();

      await controller.downloadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('downloadFile 404s when the file record does not exist', async () => {
      const controller = buildController();
      const db = createDb({ widgetFiles: { findOne: vi.fn().mockResolvedValue(null) } });
      const req = { app: { locals: { db } }, params: { widgetId: 'w-1', fileID: new ObjectId().toString() } };
      const res = createRes();

      await controller.downloadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('downloadFile decrypts and sends the plaintext', async () => {
      const controller = buildController();
      const fileId = new ObjectId();
      const fileRecord = {
        _id: fileId,
        widgetId: 'w-1',
        fileName: 'a.csv',
        storagePath: '/tmp/a.csv',
        encryptionAlgorithm: null
      };
      const db = createDb({
        widgets: { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1' }) },
        widgetFiles: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('plaintext'));

      const req = { app: { locals: { db } }, params: { widgetId: 'w-1', fileID: fileId.toString() } };
      const res = createRes();

      await controller.downloadFile(req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('a.csv'));
      expect(res.send).toHaveBeenCalledWith(Buffer.from('plaintext'));
    });

    // RF007 AC6 (#1321): a delete is logical and the binary is kept.
    it('deleteFile logically deletes: sets deletedAt and deletedByAnonId, never unlinks, audits file_delete critical with logicalDelete', async () => {
      const controller = buildController();
      const fileId = new ObjectId();
      const fileRecord = { _id: fileId, widgetId: 'w-1', fileName: 'a.csv', storagePath: '/tmp/a.csv' };
      const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
      const db = createDb({
        widgets: { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1' }) },
        widgetFiles: { findOne: vi.fn().mockResolvedValue(fileRecord), deleteOne, updateOne }
      });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      const req = { app: { locals: { db } }, params: { widgetId: 'w-1', fileID: fileId.toString() }, user: { userID: 'u-1', anonId: 'USR-ANON-1' } };
      const res = createRes();

      await controller.deleteFile(req, res);

      expect(updateOne).toHaveBeenCalledTimes(1);
      const [filter, update] = updateOne.mock.calls[0];
      expect(filter).toEqual({ _id: fileId, deletedAt: null });
      expect(update.$set.deletedAt).toBeInstanceOf(Date);
      expect(update.$set.deletedByAnonId).toBe('USR-ANON-1');
      expect(unlinkSpy).not.toHaveBeenCalled();
      expect(deleteOne).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'file_delete',
        severity: 'critical',
        message: 'Arquivo removido logicamente: a.csv',
        payload: expect.objectContaining({ logicalDelete: true, deletedAt: update.$set.deletedAt.toISOString() })
      }));
    });

    it('deleteFile 404s and writes no audit when updateOne matches nothing', async () => {
      const controller = buildController();
      const fileId = new ObjectId();
      const fileRecord = { _id: fileId, widgetId: 'w-1', fileName: 'a.csv', storagePath: '/tmp/a.csv' };
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
      const db = createDb({
        widgets: { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1' }) },
        widgetFiles: { findOne: vi.fn().mockResolvedValue(fileRecord), updateOne }
      });
      const req = { app: { locals: { db } }, params: { widgetId: 'w-1', fileID: fileId.toString() }, user: { userID: 'u-1' } };
      const res = createRes();

      await controller.deleteFile(req, res);

      expect(updateOne).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Arquivo não encontrado' });
      expect(auditLogger.log).not.toHaveBeenCalled();
    });

    it('replaceFile validates fileType, updates the record, keeps the previous file and records a DataFileVersion', async () => {
      const controller = buildController();
      const fileId = new ObjectId();
      const fileRecord = {
        _id: fileId, widgetId: 'w-1', fileName: 'old.csv', storagePath: '/tmp/old.csv',
        storageUri: 'objstore://widgets/w-1/files/old.csv', checksum: OLD_CHECKSUM
      };
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const versions = createVersionsCollection();
      const db = createDb({
        widgets: { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1' }) },
        widgetFiles: { findOne: vi.fn().mockResolvedValue(fileRecord), updateOne },
        dataFileVersions: versions
      });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('new content'));
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      const req = {
        app: { locals: { db } },
        params: { widgetId: 'w-1', fileID: fileId.toString() },
        user: { userID: 'u-1' },
        file: { path: '/tmp/new.csv', originalname: 'new.csv', size: 11 },
        body: { changeReason: '  corrected export  ' }
      };
      const res = createRes();

      await controller.replaceFile(req, res);

      expect(updateOne).toHaveBeenCalled();
      const updatedFields = updateOne.mock.calls[0][1].$set;
      expect(updatedFields.fileName).toBe('new.csv');
      expect(updatedFields.checksum).toBeTruthy();
      // RNF029 C3 (#1321): the previous binary is evidence, never unlinked.
      expect(unlinkSpy).not.toHaveBeenCalledWith('/tmp/old.csv');
      // RF007 AC4: a baseline v1 for the superseded binary, then v2.
      expect(versions.insertOne).toHaveBeenCalledTimes(2);
      const [baseline] = versions.insertOne.mock.calls[0];
      const [version] = versions.insertOne.mock.calls[1];
      expect(baseline).toMatchObject({ fileId: fileId.toString(), versionNumber: 1, checksum: OLD_CHECKSUM, changeReason: 'initial upload' });
      expect(version).toMatchObject({
        fileId: fileId.toString(),
        versionNumber: 2,
        previousVersionId: baseline.dataFileVersionId,
        checksum: updatedFields.checksum,
        objectUri: updatedFields.storageUri,
        changeReason: 'corrected export'
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].data.versionNumber).toBe(2);
      expect(auditLogger.log.mock.calls[0][0].payload).toMatchObject({ dataFileVersionId: version.dataFileVersionId, versionNumber: 2 });
    });

    it('replaceFile deletes the new DataFileVersion and cleans up the upload when the record update fails (#1321)', async () => {
      const controller = buildController();
      const fileId = new ObjectId();
      const fileRecord = {
        _id: fileId, widgetId: 'w-1', fileName: 'old.csv', storagePath: '/tmp/old.csv',
        storageUri: 'objstore://widgets/w-1/files/old.csv', checksum: OLD_CHECKSUM
      };
      const versions = createVersionsCollection();
      const db = createDb({
        widgets: { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1' }) },
        widgetFiles: { findOne: vi.fn().mockResolvedValue(fileRecord), updateOne: vi.fn().mockRejectedValue(new Error('db down')) },
        dataFileVersions: versions
      });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('new content'));
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      const req = {
        app: { locals: { db } },
        params: { widgetId: 'w-1', fileID: fileId.toString() },
        user: { userID: 'u-1' },
        file: { path: '/tmp/new.csv', originalname: 'new.csv', size: 11 }
      };
      const res = createRes();

      await controller.replaceFile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      const [version] = versions.insertOne.mock.calls[1];
      expect(versions.deleteOne).toHaveBeenCalledTimes(1);
      expect(versions.deleteOne).toHaveBeenCalledWith({ dataFileVersionId: version.dataFileVersionId });
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/new.csv');
      expect(unlinkSpy).not.toHaveBeenCalledWith('/tmp/old.csv');
    });
  });
});
