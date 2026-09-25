const multer = require('multer');
const fhirImportStagingService = require('../services/fhir-import-staging.service');
const { resolveUserOrganizationScope } = require('../services/rbac-assignment.service');
const logger = require('../utils/logger');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

function parseJsonFile(file) {
  if (!file?.buffer) return null;
  try {
    return JSON.parse(file.buffer.toString('utf8'));
  } catch (_) {
    const error = new Error('Arquivo JSON FHIR inválido.');
    error.statusCode = 400;
    throw error;
  }
}

function sendError(res, error) {
  const statusCode = error?.statusCode || 500;
  return res.status(statusCode).json({
    success: false,
    message: error?.message || 'Erro no staging FHIR',
  });
}

async function resolveFhirOrganizationContext(db, req) {
  if (!req.user?.userID) {
    return { organizationScope: null, organizationId: null, organizationIds: [] };
  }
  try {
    const organizationScope = await resolveUserOrganizationScope(db, req.user.userID);
    return {
      organizationScope,
      organizationId: organizationScope?.organizationIds?.[0] || null,
      organizationIds: organizationScope?.organizationIds || [],
    };
  } catch (error) {
    logger.warn('Falha ao resolver escopo organizacional para staging FHIR:', error.message || error);
    return { organizationScope: null, organizationId: null, organizationIds: [] };
  }
}

class FhirImportStagingController {
  uploadMiddleware() {
    return upload.single('file');
  }

  async stage(req, res) {
    try {
      const db = req.app.locals.db;
      const payload = parseJsonFile(req.file) || req.body;
      const { organizationScope, organizationId, organizationIds } = await resolveFhirOrganizationContext(db, req);
      const result = await fhirImportStagingService.stageBundle(db, payload, {
        fileName: req.file?.originalname,
        userID: req.user?.userID || null,
        organizationScope,
        organizationId,
        organizationIds,
      });

      return res.status(201).json({
        success: true,
        batch: result.batch,
        records: result.records,
      });
    } catch (error) {
      return sendError(res, error);
    }
  }

  async getBatch(req, res) {
    try {
      const result = await fhirImportStagingService.getBatch(req.app.locals.db, req.params.id, {
        organizationScope: req.organizationScope,
      });
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  }

  async validate(req, res) {
    try {
      const result = await fhirImportStagingService.validateBatch(req.app.locals.db, req.params.id);
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  }

  async sendConsents(req, res) {
    try {
      const result = await fhirImportStagingService.sendConsents(req.app.locals.db, req.params.id, {
        userID: req.user?.userID || null,
      });
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  }

  async consentStatus(req, res) {
    try {
      const result = await fhirImportStagingService.getConsentStatus(req.app.locals.db, req.params.id);
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  }

  async commit(req, res) {
    try {
      const result = await fhirImportStagingService.commitBatch(req.app.locals.db, req.params.id);
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  }

  async attachExternalDocument(req, res) {
    try {
      const result = await fhirImportStagingService.attachExternalDocument(req.app.locals.db, req.params.id, req.params.recordId, {
        userID: req.user?.userID || null,
        note: req.body?.note,
      });
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  }
}

module.exports = new FhirImportStagingController();
