import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const controller = require('../../src/controllers/sample-file.controller');
const SampleFileModel = require('../../src/models/SampleFile');
const hl7Service = require('../../src/services/hl7.service');
const auditLogger = require('../../src/utils/auditLogger');
const fs = require('fs');
const { ObjectId } = require('mongodb');

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    send: vi.fn(),
    download: vi.fn(),
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
          insertOne: vi.fn().mockResolvedValue({ insertedId: 'new-id' }),
          deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) })
        };
      }
      return store[name];
    })
  };
}

describe('sample-file.controller', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('uploadFile', () => {
    it('returns 503 when db is missing', async () => {
      const req = { app: { locals: {} }, params: { sampleID: '1' }, file: null };
      const res = createRes();

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 when no file provided', async () => {
      const db = createDb();
      const req = { app: { locals: { db } }, params: { sampleID: '1' }, file: null };
      const res = createRes();

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('returns 404 and cleans up file when sample not found', async () => {
      const sampleID = new ObjectId().toString();
      const db = createDb({
        amostras: { findOne: vi.fn().mockResolvedValue(null) }
      });
      const req = {
        app: { locals: { db } },
        params: { sampleID },
        file: { path: '/tmp/file.csv', originalname: 'file.csv', size: 100 }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/file.csv');
    });

    it('returns 400 and cleans up file when file type invalid', async () => {
      const sampleID = new ObjectId().toString();
      const sample = { _id: new ObjectId(sampleID) };
      const db = createDb({
        amostras: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = {
        app: { locals: { db } },
        params: { sampleID },
        file: { path: '/tmp/file.xyz', originalname: 'file.xyz', size: 100 }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue(null);

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/file.xyz');
    });

    it('returns 400 and cleans up file when validation fails', async () => {
      const sampleID = new ObjectId().toString();
      const sample = { _id: new ObjectId(sampleID) };
      const db = createDb({
        amostras: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = {
        app: { locals: { db } },
        params: { sampleID },
        file: { path: '/tmp/file.csv', originalname: 'file.csv', size: 100 }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('CSV');
      vi.spyOn(SampleFileModel, 'validate').mockReturnValue({ isValid: false, errors: ['bad'] });

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/file.csv');
    });

    it('happy path: creates sample file record and returns sanitized data', async () => {
      const sampleID = new ObjectId().toString();
      const sample = { _id: new ObjectId(sampleID) };
      const insertedId = new ObjectId();
      const sampleFilesCollection = {
        insertOne: vi.fn().mockResolvedValue({ insertedId })
      };
      const db = createDb({
        amostras: { findOne: vi.fn().mockResolvedValue(sample) },
        sample_files: sampleFilesCollection
      });
      const req = {
        app: { locals: { db } },
        params: { sampleID },
        file: { path: '/tmp/file.csv', originalname: 'file.csv', size: 100 },
        user: null
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('CSV');
      vi.spyOn(SampleFileModel, 'validate').mockReturnValue({ isValid: true, errors: [] });

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(true);
      expect(body.data.fileName).toBe('file.csv');
      expect(body.data.storagePath).toBeUndefined();
      expect(sampleFilesCollection.insertOne).toHaveBeenCalled();
    });
  });

  describe('listFiles', () => {
    it('returns 503 when db missing', async () => {
      const req = { app: { locals: {} }, params: { sampleID: '1' } };
      const res = createRes();

      await controller.listFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 404 when sample not found', async () => {
      const db = createDb({
        amostras: { findOne: vi.fn().mockResolvedValue(null) }
      });
      const req = { app: { locals: { db } }, params: { sampleID: '999' } };
      const res = createRes();

      await controller.listFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns sanitized files without storagePath', async () => {
      const sampleID = new ObjectId().toString();
      const sample = { _id: new ObjectId(sampleID) };
      const rawFiles = [
        {
          _id: new ObjectId(),
          sampleID: sample._id.toString(),
          fileName: 'a.csv',
          fileType: 'CSV',
          fileSize: 10,
          uploaderAnonId: 'USR-ABC',
          uploadDate: new Date(),
          createdAt: new Date(),
          storagePath: '/secret/path/a.csv'
        }
      ];
      const sampleFilesCollection = {
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(rawFiles) })
      };
      const db = createDb({
        amostras: { findOne: vi.fn().mockResolvedValue(sample) },
        sample_files: sampleFilesCollection
      });
      const req = { app: { locals: { db } }, params: { sampleID }, user: null };
      const res = createRes();

      await controller.listFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.data).toHaveLength(1);
      expect(body.data[0].storagePath).toBeUndefined();
      expect(body.data[0].fileName).toBe('a.csv');
    });
  });

  describe('downloadFile', () => {
    it('returns 503 when db missing', async () => {
      const req = { app: { locals: {} }, params: { sampleID: '1', fileID: '2' } };
      const res = createRes();

      await controller.downloadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 when fileID is invalid ObjectId', async () => {
      const db = createDb();
      const req = { app: { locals: { db } }, params: { sampleID: '1', fileID: 'not-an-id' } };
      const res = createRes();

      await controller.downloadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when file record not found', async () => {
      const fileID = new ObjectId().toString();
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(null) }
      });
      const req = { app: { locals: { db } }, params: { sampleID: '1', fileID } };
      const res = createRes();

      await controller.downloadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 403 when file does not belong to sample (ownership mismatch)', async () => {
      const fileID = new ObjectId().toString();
      const otherSampleID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), sampleID: otherSampleID, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const wrongSampleID = new ObjectId().toString();
      const req = { app: { locals: { db } }, params: { sampleID: wrongSampleID, fileID } };
      const res = createRes();

      await controller.downloadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 404 when file missing on disk', async () => {
      const fileID = new ObjectId().toString();
      const sampleID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), sampleID, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const req = { app: { locals: { db } }, params: { sampleID, fileID } };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      await controller.downloadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('happy path: calls res.download with storagePath and fileName', async () => {
      const fileID = new ObjectId().toString();
      const sampleID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), sampleID, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const req = { app: { locals: { db } }, params: { sampleID, fileID }, user: null };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      await controller.downloadFile(req, res);

      expect(res.download).toHaveBeenCalledWith('/x/a.csv', 'a.csv', expect.any(Function));
    });
  });

  describe('deleteFile', () => {
    it('returns 403 when file does not belong to sample', async () => {
      const fileID = new ObjectId().toString();
      const otherSampleID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), sampleID: otherSampleID, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const wrongSampleID = new ObjectId().toString();
      const req = { app: { locals: { db } }, params: { sampleID: wrongSampleID, fileID } };
      const res = createRes();

      await controller.deleteFile(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('happy path: removes file from disk and db, returns 200', async () => {
      const fileID = new ObjectId().toString();
      const sampleID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), sampleID, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), deleteOne }
      });
      const req = { app: { locals: { db } }, params: { sampleID, fileID }, user: null };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      await controller.deleteFile(req, res);

      expect(unlinkSpy).toHaveBeenCalledWith('/x/a.csv');
      expect(deleteOne).toHaveBeenCalledWith({ _id: fileRecord._id });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('exportHL7v2', () => {
    it('returns 400 when file is not linked to the given sample', async () => {
      const fileID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), sampleID: 'some-other-sample', fileName: 'a.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const req = { app: { locals: { db } }, params: { sampleID: 'sample-1', fileID } };
      const res = createRes();

      await controller.exportHL7v2(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('happy path: generates HL7 message and sets headers', async () => {
      const fileID = new ObjectId().toString();
      const sampleID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), sampleID, fileName: 'a.csv', fileType: 'CSV' };
      const sample = { _id: new ObjectId(sampleID), patientID: '12345678' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = { app: { locals: { db } }, params: { sampleID, fileID }, user: null };
      const res = createRes();
      vi.spyOn(hl7Service, 'generateHL7v2Message').mockResolvedValue('MSH|^~\\&|...');

      await controller.exportHL7v2(req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain; charset=utf-8');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', `attachment; filename="hl7_${fileID}.hl7"`);
      expect(res.send).toHaveBeenCalledWith('MSH|^~\\&|...');
    });
  });

  describe('exportFHIR', () => {
    it('happy path: generates FHIR bundle and sets headers', async () => {
      const fileID = new ObjectId().toString();
      const sampleID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), sampleID, fileName: 'a.csv', fileType: 'CSV' };
      const sample = { _id: new ObjectId(sampleID), patientID: '12345678' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = { app: { locals: { db } }, params: { sampleID, fileID }, user: null };
      const res = createRes();
      const bundle = { resourceType: 'Bundle' };
      vi.spyOn(hl7Service, 'generateFHIRResource').mockResolvedValue(bundle);

      await controller.exportFHIR(req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json; charset=utf-8');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', `attachment; filename="fhir_${fileID}.json"`);
      expect(res.json).toHaveBeenCalledWith(bundle);
    });

    it('returns 400 when file is not linked to the given sample', async () => {
      const fileID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), sampleID: 'other-sample', fileName: 'a.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const req = { app: { locals: { db } }, params: { sampleID: 'sample-1', fileID } };
      const res = createRes();

      await controller.exportFHIR(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 503 when db is unavailable', async () => {
      const req = { app: { locals: { db: null } }, params: { sampleID: 's1', fileID: 'f1' } };
      const res = createRes();

      await controller.exportFHIR(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 404 when the file record is not found', async () => {
      const db = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(null) } });
      const req = { app: { locals: { db } }, params: { sampleID: 's1', fileID: new ObjectId().toString() } };
      const res = createRes();

      await controller.exportFHIR(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 404 when the sample is not found', async () => {
      const fileID = new ObjectId().toString();
      const sampleID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), sampleID, fileName: 'a.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(null) }
      });
      const req = { app: { locals: { db } }, params: { sampleID, fileID } };
      const res = createRes();

      await controller.exportFHIR(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('logs the export when req.user is present', async () => {
      const fileID = new ObjectId().toString();
      const sampleID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), sampleID, fileName: 'a.csv', fileType: 'CSV' };
      const sample = { _id: new ObjectId(sampleID), patientID: '12345678' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = { app: { locals: { db } }, params: { sampleID, fileID }, user: { id: 'u1' } };
      const res = createRes();
      vi.spyOn(hl7Service, 'generateFHIRResource').mockResolvedValue({ resourceType: 'Bundle' });
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});

      await controller.exportFHIR(req, res);

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'file_export_fhir', entityID: fileID })
      );
    });

    it('returns 500 when the FHIR generator throws', async () => {
      const fileID = new ObjectId().toString();
      const sampleID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), sampleID, fileName: 'a.csv' };
      const sample = { _id: new ObjectId(sampleID), patientID: '12345678' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = { app: { locals: { db } }, params: { sampleID, fileID }, user: null };
      const res = createRes();
      vi.spyOn(hl7Service, 'generateFHIRResource').mockRejectedValue(new Error('boom'));

      await controller.exportFHIR(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('exportCDA', () => {
    it('returns 503 when db is unavailable', async () => {
      const req = { app: { locals: { db: null } }, params: { sampleID: 's1', fileID: 'f1' } };
      const res = createRes();

      await controller.exportCDA(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 404 when the file record is not found', async () => {
      const db = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(null) } });
      const req = { app: { locals: { db } }, params: { sampleID: 's1', fileID: new ObjectId().toString() } };
      const res = createRes();

      await controller.exportCDA(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 400 when file is not linked to the given sample', async () => {
      const fileID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), sampleID: 'other-sample', fileName: 'a.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const req = { app: { locals: { db } }, params: { sampleID: 'sample-1', fileID } };
      const res = createRes();

      await controller.exportCDA(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when the sample is not found', async () => {
      const fileID = new ObjectId().toString();
      const sampleID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), sampleID, fileName: 'a.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(null) }
      });
      const req = { app: { locals: { db } }, params: { sampleID, fileID } };
      const res = createRes();

      await controller.exportCDA(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('happy path: generates CDA document and sets headers', async () => {
      const fileID = new ObjectId().toString();
      const sampleID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), sampleID, fileName: 'a.csv', fileType: 'CSV' };
      const sample = { _id: new ObjectId(sampleID), patientID: '12345678' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = { app: { locals: { db } }, params: { sampleID, fileID }, user: null };
      const res = createRes();
      vi.spyOn(hl7Service, 'generateCDA').mockResolvedValue('<ClinicalDocument/>');

      await controller.exportCDA(req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/xml; charset=utf-8');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', `attachment; filename="cda_${fileID}.xml"`);
      expect(res.send).toHaveBeenCalledWith('<ClinicalDocument/>');
    });

    it('logs the export when req.user is present', async () => {
      const fileID = new ObjectId().toString();
      const sampleID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), sampleID, fileName: 'a.csv', fileType: 'CSV' };
      const sample = { _id: new ObjectId(sampleID), patientID: '12345678' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = { app: { locals: { db } }, params: { sampleID, fileID }, user: { id: 'u1' } };
      const res = createRes();
      vi.spyOn(hl7Service, 'generateCDA').mockResolvedValue('<ClinicalDocument/>');
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});

      await controller.exportCDA(req, res);

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'file_export_cda', entityID: fileID })
      );
    });

    it('returns 500 when the CDA generator throws', async () => {
      const fileID = new ObjectId().toString();
      const sampleID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), sampleID, fileName: 'a.csv' };
      const sample = { _id: new ObjectId(sampleID), patientID: '12345678' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = { app: { locals: { db } }, params: { sampleID, fileID }, user: null };
      const res = createRes();
      vi.spyOn(hl7Service, 'generateCDA').mockRejectedValue(new Error('boom'));

      await controller.exportCDA(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
