import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const uploadController = require('../../src/controllers/upload.controller');
const fs = require('fs');
const logger = require('../../src/utils/logger');
const analysisValidationService = require('../../src/services/analysisValidation.service');

const buildRes = () => ({
  status: vi.fn().mockReturnThis(),
  json: vi.fn()
});

describe('upload.controller - uploadAnalysisFile', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 503 when req.app.locals.db is missing', async () => {
    const req = { app: { locals: {} }, body: {} };
    const res = buildRes();

    await uploadController.uploadAnalysisFile(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Banco de dados não disponível'
    });
  });

  it('returns 400 when req.file is missing', async () => {
    const req = { app: { locals: { db: {} } }, body: {} };
    const res = buildRes();

    await uploadController.uploadAnalysisFile(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Arquivo não fornecido'
    });
  });

  it('returns 400 and cleans up temp file when specimenId is missing', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

    const req = {
      app: { locals: { db: {} } },
      body: {},
      file: { path: '/tmp/fake-file.txt' }
    };
    const res = buildRes();

    await uploadController.uploadAnalysisFile(req, res);

    expect(unlinkSpy).toHaveBeenCalledWith('/tmp/fake-file.txt');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'specimenId é obrigatório'
    });
  });

  it('accepts specimenId when present, skipping the missing-specimenId branch', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(analysisValidationService, 'validateUploadEligibility').mockResolvedValue({
      success: false,
      error: 'Sample not found',
      patientStatus: null
    });

    const req = {
      app: { locals: { db: {} } },
      body: { specimenId: 'S-123' },
      file: { path: '/tmp/fake-file.txt' }
    };
    const res = buildRes();

    await uploadController.uploadAnalysisFile(req, res);

    expect(analysisValidationService.validateUploadEligibility).toHaveBeenCalledWith({}, 'S-123');
    // Confirms it did NOT hit the "specimenId é obrigatório" branch
    expect(res.json).not.toHaveBeenCalledWith(
      expect.objectContaining({ error: 'specimenId é obrigatório' })
    );
  });

  it('returns 409 with CONSENT_PENDING when validation fails due to pending consent, and cleans up temp file', async () => {
    // patientStatus holds the patient's real status value (e.g. 'PENDING'), never the
    // literal string 'PENDING_CONSENT' - see analysisValidation.service.js#validatePatientConsent.
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    vi.spyOn(analysisValidationService, 'validateUploadEligibility').mockResolvedValue({
      success: false,
      error: 'Consentimento pendente',
      patientStatus: 'PENDING'
    });

    const req = {
      app: { locals: { db: {} } },
      body: { specimenId: 'S-1' },
      file: { path: '/tmp/pending.txt' }
    };
    const res = buildRes();

    await uploadController.uploadAnalysisFile(req, res);

    expect(unlinkSpy).toHaveBeenCalledWith('/tmp/pending.txt');
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Consentimento pendente',
      code: 'CONSENT_PENDING'
    });
  });

  it('returns 400 with SAMPLE_NOT_FOUND when validation fails for another reason, and cleans up temp file', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    vi.spyOn(analysisValidationService, 'validateUploadEligibility').mockResolvedValue({
      success: false,
      error: 'Amostra não encontrada',
      patientStatus: null
    });

    const req = {
      app: { locals: { db: {} } },
      body: { specimenId: 'S-404' },
      file: { path: '/tmp/notfound.txt' }
    };
    const res = buildRes();

    await uploadController.uploadAnalysisFile(req, res);

    expect(unlinkSpy).toHaveBeenCalledWith('/tmp/notfound.txt');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Amostra não encontrada',
      code: 'SAMPLE_NOT_FOUND'
    });
  });

  it('does not attempt to unlink temp file on validation failure when the file no longer exists', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    vi.spyOn(analysisValidationService, 'validateUploadEligibility').mockResolvedValue({
      success: false,
      error: 'Amostra não encontrada',
      patientStatus: null
    });

    const req = {
      app: { locals: { db: {} } },
      body: { specimenId: 'S-404' },
      file: { path: '/tmp/gone.txt' }
    };
    const res = buildRes();

    await uploadController.uploadAnalysisFile(req, res);

    expect(unlinkSpy).not.toHaveBeenCalled();
  });

  it('happy path: inserts payload, returns 201 with expected data, uploadedBy from req.user.id', async () => {
    vi.spyOn(analysisValidationService, 'validateUploadEligibility').mockResolvedValue({
      success: true,
      sample: {
        _id: 'sample-object-id',
        specimenId: 'SMP-001',
        barcode: 'BC-001',
        participantId: 'PAT-001'
      }
    });

    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'inserted-id-1' });
    const collection = vi.fn().mockReturnValue({ insertOne });

    const req = {
      app: { locals: { db: { collection } } },
      body: { specimenId: 'SMP-001' },
      user: { id: 'user-123' },
      file: {
        path: '/whatever/uploads/2026/07/file.txt',
        originalname: 'analysis.pdf',
        mimetype: 'application/pdf',
        size: 1024
      }
    };
    const res = buildRes();

    await uploadController.uploadAnalysisFile(req, res);

    expect(collection).toHaveBeenCalledWith('AnalysisFile');
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        originalName: 'analysis.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        specimenId: 'SMP-001',
        specimenIdentifier: 'SMP-001',
        participantId: 'PAT-001',
        uploadedBy: 'user-123'
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: 'Arquivo enviado com sucesso',
        data: expect.objectContaining({
          _id: 'inserted-id-1',
          specimenId: 'SMP-001',
          barcode: 'BC-001',
          fileName: 'analysis.pdf',
          fileSize: 1024
        })
      })
    );
  });

  it('happy path: uploadedBy falls back to req.user._id.toString() when req.user.id is absent', async () => {
    vi.spyOn(analysisValidationService, 'validateUploadEligibility').mockResolvedValue({
      success: true,
      sample: {
        _id: 'sample-object-id-2',
        specimenId: 'SMP-002',
        barcode: 'BC-002',
        participantId: 'PAT-002'
      }
    });

    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'inserted-id-2' });
    const collection = vi.fn().mockReturnValue({ insertOne });

    const req = {
      app: { locals: { db: { collection } } },
      body: { specimenId: 'SMP-002' },
      user: { _id: { toString: () => 'mongo-object-id-string' } },
      file: {
        path: '/whatever/uploads/2026/07/file2.txt',
        originalname: 'analysis2.pdf',
        mimetype: 'application/pdf',
        size: 2048
      }
    };
    const res = buildRes();

    await uploadController.uploadAnalysisFile(req, res);

    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ uploadedBy: 'mongo-object-id-string' })
    );
  });

  it('happy path: uploadedBy is null when req.user is absent', async () => {
    vi.spyOn(analysisValidationService, 'validateUploadEligibility').mockResolvedValue({
      success: true,
      sample: {
        _id: 'sample-object-id-3',
        specimenId: 'SMP-003',
        barcode: 'BC-003',
        participantId: 'PAT-003'
      }
    });

    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'inserted-id-3' });
    const collection = vi.fn().mockReturnValue({ insertOne });

    const req = {
      app: { locals: { db: { collection } } },
      body: { specimenId: 'SMP-003' },
      file: {
        path: '/whatever/uploads/2026/07/file3.txt',
        originalname: 'analysis3.pdf',
        mimetype: 'application/pdf',
        size: 512
      }
    };
    const res = buildRes();

    await uploadController.uploadAnalysisFile(req, res);

    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ uploadedBy: null })
    );
  });

  it('catch-all: returns 400 with the thrown error message when db.collection throws', async () => {
    vi.spyOn(analysisValidationService, 'validateUploadEligibility').mockResolvedValue({
      success: true,
      sample: {
        _id: 'sample-object-id-4',
        specimenId: 'SMP-004',
        barcode: 'BC-004',
        participantId: 'PAT-004'
      }
    });
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const collection = vi.fn().mockImplementation(() => {
      throw new Error('Mongo connection lost');
    });

    const req = {
      app: { locals: { db: { collection } } },
      body: { specimenId: 'SMP-004' },
      file: {
        path: '/whatever/uploads/2026/07/file4.txt',
        originalname: 'analysis4.pdf',
        mimetype: 'application/pdf',
        size: 256
      }
    };
    const res = buildRes();

    await uploadController.uploadAnalysisFile(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao fazer upload de arquivo de análise',
      message: 'Mongo connection lost'
    });
  });

  it('catch-all: unlinks the temp file when the insert throws and the file still exists', async () => {
    vi.spyOn(analysisValidationService, 'validateUploadEligibility').mockResolvedValue({
      success: true,
      sample: {
        _id: 'sample-object-id-5',
        specimenId: 'SMP-005',
        barcode: 'BC-005',
        participantId: 'PAT-005'
      }
    });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

    const collection = vi.fn().mockImplementation(() => {
      throw new Error('boom');
    });

    const req = {
      app: { locals: { db: { collection } } },
      body: { specimenId: 'SMP-005' },
      file: {
        path: '/whatever/uploads/2026/07/file5.txt',
        originalname: 'analysis5.pdf',
        mimetype: 'application/pdf',
        size: 256
      }
    };
    const res = buildRes();

    await uploadController.uploadAnalysisFile(req, res);

    expect(unlinkSpy).toHaveBeenCalledWith('/whatever/uploads/2026/07/file5.txt');
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('catch-all: swallows a nested unlink failure (logs it) instead of crashing the request', async () => {
    vi.spyOn(analysisValidationService, 'validateUploadEligibility').mockResolvedValue({
      success: true,
      sample: {
        _id: 'sample-object-id-6',
        specimenId: 'SMP-006',
        barcode: 'BC-006',
        participantId: 'PAT-006'
      }
    });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {
      throw new Error('EPERM: file locked');
    });

    const collection = vi.fn().mockImplementation(() => {
      throw new Error('insert failed');
    });

    const req = {
      app: { locals: { db: { collection } } },
      body: { specimenId: 'SMP-006' },
      file: {
        path: '/whatever/uploads/2026/07/file6.txt',
        originalname: 'analysis6.pdf',
        mimetype: 'application/pdf',
        size: 256
      }
    };
    const res = buildRes();

    // Should not throw despite the nested unlink failure.
    await expect(uploadController.uploadAnalysisFile(req, res)).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      'Erro ao remover arquivo temporário:',
      'EPERM: file locked'
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao fazer upload de arquivo de análise',
      message: 'insert failed'
    });
  });
});
