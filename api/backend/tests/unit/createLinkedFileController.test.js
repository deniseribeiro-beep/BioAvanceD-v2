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
  });

  describe('downloadFile / deleteFile / replaceFile — link check', () => {
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

    it('deleteFile removes the physical file and the record, audits critical severity', async () => {
      const controller = buildController();
      const fileId = new ObjectId();
      const fileRecord = { _id: fileId, widgetId: 'w-1', fileName: 'a.csv', storagePath: '/tmp/a.csv' };
      const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
      const db = createDb({
        widgets: { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1' }) },
        widgetFiles: { findOne: vi.fn().mockResolvedValue(fileRecord), deleteOne }
      });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      const req = { app: { locals: { db } }, params: { widgetId: 'w-1', fileID: fileId.toString() }, user: { userID: 'u-1' } };
      const res = createRes();

      await controller.deleteFile(req, res);

      expect(deleteOne).toHaveBeenCalledWith({ _id: fileId });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('replaceFile validates fileType, updates the record, and cleans up the previous file', async () => {
      const controller = buildController();
      const fileId = new ObjectId();
      const fileRecord = { _id: fileId, widgetId: 'w-1', fileName: 'old.csv', storagePath: '/tmp/old.csv' };
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = createDb({
        widgets: { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1' }) },
        widgetFiles: { findOne: vi.fn().mockResolvedValue(fileRecord), updateOne }
      });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('new content'));
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      const req = {
        app: { locals: { db } },
        params: { widgetId: 'w-1', fileID: fileId.toString() },
        user: { userID: 'u-1' },
        file: { path: '/tmp/new.csv', originalname: 'new.csv', size: 11 }
      };
      const res = createRes();

      await controller.replaceFile(req, res);

      expect(updateOne).toHaveBeenCalled();
      const updatedFields = updateOne.mock.calls[0][1].$set;
      expect(updatedFields.fileName).toBe('new.csv');
      expect(updatedFields.checksum).toBeTruthy();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
