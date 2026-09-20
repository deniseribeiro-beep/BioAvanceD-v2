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

describe('createLinkedFileController item 8 residual request branches', () => {
  beforeEach(() => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails closed with 503 on every public handler that requires a database', async () => {
    const controller = buildController();
    const calls = [
      ['uploadFile', { params: { widgetId: 'w-1' }, file: { path: '/tmp/x.csv', originalname: 'x.csv', size: 1 } }],
      ['listFiles', { params: { widgetId: 'w-1' } }],
      ['downloadFile', { params: { widgetId: 'w-1', fileID: new ObjectId().toString() } }],
      ['deleteFile', { params: { widgetId: 'w-1', fileID: new ObjectId().toString() } }],
      ['replaceFile', { params: { widgetId: 'w-1', fileID: new ObjectId().toString() }, file: { path: '/tmp/new.csv', originalname: 'new.csv', size: 1 } }],
    ];

    for (const [method, partialReq] of calls) {
      const req = { app: { locals: {} }, ...partialReq };
      const res = createRes();
      await controller[method](req, res);
      expect(res.status, method).toHaveBeenCalledWith(503);
    }
  });

  it('listFiles enforces the optional organization hook and never queries files after denial', async () => {
    const checkOrgScope = vi.fn().mockResolvedValue(false);
    const controller = buildController({ checkOrgScope });
    const find = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    const db = createDb({
      widgets: { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1', organizationId: 'org-b' }) },
      widgetFiles: { find },
    });
    const req = {
      app: { locals: { db } },
      params: { widgetId: 'w-1' },
      organizationScope: { scope: 'organization', organizationIds: ['org-a'] },
    };
    const res = createRes();

    await controller.listFiles(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(checkOrgScope).toHaveBeenCalledTimes(1);
    expect(find).not.toHaveBeenCalled();
  });

  it('listFiles returns 500 when file enumeration fails after the parent is resolved', async () => {
    const controller = buildController();
    const db = createDb({
      widgets: { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1' }) },
      widgetFiles: { find: vi.fn(() => ({ toArray: vi.fn().mockRejectedValue(new Error('list down')) })) },
    });
    const res = createRes();

    await controller.listFiles({ app: { locals: { db } }, params: { widgetId: 'w-1' } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'list down' }));
  });

  it('downloadFile rejects an invalid file id before parent lookup', async () => {
    const controller = buildController();
    const widgetsFindOne = vi.fn().mockResolvedValue({ widgetId: 'w-1' });
    const db = createDb({
      widgets: { findOne: widgetsFindOne },
      widgetFiles: { findOne: vi.fn() },
    });
    const res = createRes();

    await controller.downloadFile(
      { app: { locals: { db } }, params: { widgetId: 'w-1', fileID: 'not-an-object-id' } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(widgetsFindOne).not.toHaveBeenCalled();
  });

  it('downloadFile returns 404 when the linked record exists but its file is absent on disk', async () => {
    const controller = buildController();
    const fileId = new ObjectId();
    const fileRecord = { _id: fileId, widgetId: 'w-1', fileName: 'a.csv', storagePath: '/missing/a.csv' };
    const db = createDb({
      widgets: { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1' }) },
      widgetFiles: { findOne: vi.fn().mockResolvedValue(fileRecord) },
    });
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const res = createRes();

    await controller.downloadFile(
      { app: { locals: { db } }, params: { widgetId: 'w-1', fileID: fileId.toString() } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('downloadFile enforces the optional organization hook after link validation', async () => {
    const checkOrgScope = vi.fn().mockResolvedValue(false);
    const controller = buildController({ checkOrgScope });
    const fileId = new ObjectId();
    const db = createDb({
      widgets: { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1', organizationId: 'org-b' }) },
      widgetFiles: { findOne: vi.fn().mockResolvedValue({ _id: fileId, widgetId: 'w-1', storagePath: '/tmp/a.csv' }) },
    });
    const res = createRes();

    await controller.downloadFile(
      {
        app: { locals: { db } },
        params: { widgetId: 'w-1', fileID: fileId.toString() },
        organizationScope: { scope: 'organization', organizationIds: ['org-a'] },
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(checkOrgScope).toHaveBeenCalledTimes(1);
  });

  it('downloadFile returns 500 instead of corrupted bytes when encrypted content cannot be decrypted', async () => {
    const controller = buildController();
    const fileId = new ObjectId();
    const fileRecord = {
      _id: fileId,
      widgetId: 'w-1',
      fileName: 'a.csv',
      storagePath: '/tmp/a.csv',
      encryptionAlgorithm: 'aes-256-gcm',
      encryptionKeyId: 'vitest-key-001',
      encryptionIv: Buffer.alloc(12).toString('base64'),
      encryptionTag: Buffer.alloc(16).toString('base64'),
    };
    const db = createDb({
      widgets: { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1' }) },
      widgetFiles: { findOne: vi.fn().mockResolvedValue(fileRecord) },
    });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('corrupt ciphertext'));
    const res = createRes();

    await controller.downloadFile(
      { app: { locals: { db } }, params: { widgetId: 'w-1', fileID: fileId.toString() } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).not.toHaveBeenCalled();
  });

  it('deleteFile keeps the database deletion when physical cleanup fails', async () => {
    const controller = buildController();
    const fileId = new ObjectId();
    const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
    const db = createDb({
      widgets: { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1' }) },
      widgetFiles: {
        findOne: vi.fn().mockResolvedValue({ _id: fileId, widgetId: 'w-1', fileName: 'a.csv', storagePath: '/tmp/a.csv' }),
        deleteOne,
      },
    });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw new Error('locked'); });
    const res = createRes();

    await controller.deleteFile(
      { app: { locals: { db } }, params: { widgetId: 'w-1', fileID: fileId.toString() } },
      res
    );

    expect(deleteOne).toHaveBeenCalledWith({ _id: fileId });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('deleteFile returns 500 when the linked database deletion fails', async () => {
    const controller = buildController();
    const fileId = new ObjectId();
    const db = createDb({
      widgets: { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1' }) },
      widgetFiles: {
        findOne: vi.fn().mockResolvedValue({ _id: fileId, widgetId: 'w-1', fileName: 'a.csv', storagePath: '/tmp/a.csv' }),
        deleteOne: vi.fn().mockRejectedValue(new Error('delete down')),
      },
    });
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const res = createRes();

    await controller.deleteFile(
      { app: { locals: { db } }, params: { widgetId: 'w-1', fileID: fileId.toString() } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'delete down' }));
  });

  it('replaceFile rejects a missing upload before resolving the linked record', async () => {
    const controller = buildController();
    const fileFindOne = vi.fn();
    const db = createDb({ widgetFiles: { findOne: fileFindOne } });
    const res = createRes();

    await controller.replaceFile(
      { app: { locals: { db } }, params: { widgetId: 'w-1', fileID: new ObjectId().toString() } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(fileFindOne).not.toHaveBeenCalled();
  });

  it('replaceFile cleans the newly uploaded file when link validation fails', async () => {
    const controller = buildController();
    const db = createDb({ widgetFiles: { findOne: vi.fn().mockResolvedValue(null) } });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    const req = {
      app: { locals: { db } },
      params: { widgetId: 'w-1', fileID: new ObjectId().toString() },
      file: { path: '/tmp/new.csv', originalname: 'new.csv', size: 2 },
    };
    const res = createRes();

    await controller.replaceFile(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(unlink).toHaveBeenCalledWith('/tmp/new.csv');
  });

  it('replaceFile tolerates failure removing the previous version after the new encrypted file is ready', async () => {
    const controller = buildController();
    const fileId = new ObjectId();
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const db = createDb({
      widgets: { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1' }) },
      widgetFiles: {
        findOne: vi.fn().mockResolvedValue({
          _id: fileId,
          widgetId: 'w-1',
          fileName: 'old.csv',
          storagePath: '/tmp/old.csv',
          checksum: 'old-checksum',
        }),
        updateOne,
      },
    });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('new content'));
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw new Error('old file locked'); });
    const res = createRes();

    await controller.replaceFile(
      {
        app: { locals: { db } },
        params: { widgetId: 'w-1', fileID: fileId.toString() },
        file: { path: '/tmp/new.csv', originalname: 'new.csv', size: 11 },
      },
      res
    );

    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('replaceFile does not unlink when the replacement reuses the same storage path', async () => {
    const controller = buildController();
    const fileId = new ObjectId();
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const db = createDb({
      widgets: { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1' }) },
      widgetFiles: {
        findOne: vi.fn().mockResolvedValue({
          _id: fileId,
          widgetId: 'w-1',
          fileName: 'old.csv',
          storagePath: '/tmp/same.csv',
          checksum: 'old-checksum',
        }),
        updateOne,
      },
    });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('replacement content'));
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    const res = createRes();

    await controller.replaceFile(
      {
        app: { locals: { db } },
        params: { widgetId: 'w-1', fileID: fileId.toString() },
        file: { path: '/tmp/same.csv', originalname: 'same.csv', size: 19 },
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(unlink).not.toHaveBeenCalled();
  });

  it('uses the route parent identifier when the resolved parent has no canonical id field', async () => {
    const controller = buildController();
    const db = createDb({
      widgets: { findOne: vi.fn().mockResolvedValue({ _id: new ObjectId() }) },
      widgetFiles: { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) },
    });
    const res = createRes();

    await controller.listFiles(
      { app: { locals: { db } }, params: { widgetId: 'route-parent-1' } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(db.collection('widgetFiles').find).toHaveBeenCalledWith({ widgetId: 'route-parent-1' });
  });

});



describe('createLinkedFileController item 8 final residual branches', () => {
  beforeEach(() => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes the Mongo _id lookup leg when a parent identifier is a valid ObjectId', async () => {
    const controller = buildController();
    const parentId = new ObjectId().toString();
    const parentFindOne = vi.fn().mockResolvedValue({ _id: new ObjectId(parentId), widgetId: parentId });
    const fileFind = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    const db = createDb({
      widgets: { findOne: parentFindOne },
      widgetFiles: { find: fileFind },
    });
    const res = createRes();

    await controller.listFiles(
      { app: { locals: { db } }, params: { widgetId: parentId } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(parentFindOne).toHaveBeenCalledTimes(1);
    const query = parentFindOne.mock.calls[0][0];
    expect(query.$or).toEqual(expect.arrayContaining([
      { widgetId: parentId },
      { _id: expect.any(ObjectId) },
    ]));
  });

  it('uploadMiddleware returns a clean 400 for a rejected file extension', async () => {
    const express = require('express');
    const request = require('supertest');
    const controller = buildController();
    const app = express();

    app.post('/widgets/:widgetId/files', controller.uploadMiddleware(), (_req, res) => {
      res.status(204).end();
    });

    const response = await request(app)
      .post('/widgets/w-1/files')
      .attach('file', Buffer.from('not allowed'), 'payload.exe');

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toMatch(/Formato de arquivo inválido/);
  });

  it('uploadMiddleware rejects an allowed file when the required parent route param is absent', async () => {
    const express = require('express');
    const request = require('supertest');
    const controller = buildController();
    const app = express();

    app.post('/files', controller.uploadMiddleware(), (_req, res) => {
      res.status(204).end();
    });

    const response = await request(app)
      .post('/files')
      .attach('file', Buffer.from('csv-data'), 'payload.csv');

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toMatch(/widgetId é obrigatório/);
  });

  it('replaceFile rejects an unsupported extension and removes only the newly uploaded temp file', async () => {
    const controller = buildController();
    const fileId = new ObjectId();
    const db = createDb({
      widgets: { findOne: vi.fn().mockResolvedValue({ widgetId: 'w-1' }) },
      widgetFiles: {
        findOne: vi.fn().mockResolvedValue({
          _id: fileId,
          widgetId: 'w-1',
          fileName: 'old.csv',
          storagePath: '/tmp/old.csv',
        }),
      },
    });
    vi.spyOn(fs, 'existsSync').mockImplementation((candidate) => candidate === '/tmp/new.exe');
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    const res = createRes();

    await controller.replaceFile(
      {
        app: { locals: { db } },
        params: { widgetId: 'w-1', fileID: fileId.toString() },
        file: { path: '/tmp/new.exe', originalname: 'new.exe', size: 4 },
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Tipo de arquivo inválido' }));
    expect(unlink).toHaveBeenCalledWith('/tmp/new.exe');
  });
});
