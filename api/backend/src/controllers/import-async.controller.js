const multer = require('multer');
const path = require('path');
const fs = require('fs');
const importAsyncService = require('../services/import-async.service');
const callerCreateOrganization = require('../services/callerCreateOrganization.service');
const logger = require('../utils/logger');
const { parseGroupFields, groupFieldsErrorBody } = require('../utils/importGroupFields');
const { UPLOADS_BASE } = require('../config/uploadConfig');

// Configuração do multer para upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(UPLOADS_BASE, 'temp');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const blockedExts = ['.exe', '.sh', '.bat'];

    if (blockedExts.includes(ext)) {
      const err = new Error('Formato de arquivo não seguro');
      err.status = 400;
      return cb(err, false);
    }

    const allowedMimes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/json',
      'application/zip',
      'application/x-zip-compressed'
    ];

    if (!allowedMimes.includes(file.mimetype)) {
      const err = new Error('Formato de arquivo não seguro');
      err.status = 400;
      return cb(err, false);
    }

    cb(null, true);
  },
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

/**
 * Controller de Importação Assíncrona
 * Implementa fluxo assíncrono completo conforme auditoria
 */
class ImportAsyncController {
  /**
   * Middleware de upload
   */
  uploadMiddleware() {
    return upload.single('file');
  }

  /**
   * Valida arquivo (endpoint separado)
   */
  async validate(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { dataType } = req.body;
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'Arquivo não fornecido'
        });
      }

      if (!dataType) {
        importAsyncService.validateFile(file, 'patients').then(() => {
          importAsyncService.cleanupFile(file.path);
        }).catch(() => {});
        return res.status(400).json({
          success: false,
          error: 'Tipo de dados (dataType) não fornecido'
        });
      }

      // Valida arquivo
      const validation = await importAsyncService.validateFile(file, dataType, { db });

      if (!validation.valid) {
        // Limpa arquivo se validação falhar
        importAsyncService.cleanupFile(file.path);
        return res.status(400).json({
          success: false,
          error: 'Validação falhou',
          errors: validation.errors,
          metadata: validation.metadata,
          operationOutcome: validation.metadata?.operationOutcome
        });
      }

      // Nenhuma etapa posterior lê este upload: a resposta leva só os metadados (#1556)
      importAsyncService.cleanupFile(file.path);
      return res.status(200).json({
        success: true,
        message: 'Arquivo validado com sucesso',
        metadata: validation.metadata
      });
    } catch (error) {
      logger.error('Erro ao validar arquivo:', error);
      
      if (req.file) {
        importAsyncService.cleanupFile(req.file.path);
      }

      return res.status(500).json({
        success: false,
        error: 'Erro ao validar arquivo',
        message: error.message
      });
    }
  }

  /**
   * Cria job de importação (endpoint de processamento)
   */
  async createImportJob(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { dataType, startBoxId, autoIncrement } = req.body;
      let parsedGroupFields = {};
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'Arquivo não fornecido'
        });
      }

      if (!dataType) {
        importAsyncService.cleanupFile(file.path);
        return res.status(400).json({
          success: false,
          error: 'Tipo de dados (dataType) não fornecido'
        });
      }

      // #1376: a samples job stamps the uploader's organization. It is
      // resolved here, at upload, because the worker has no request.
      let organizationOptions = {};
      if (String(dataType).trim().toLowerCase() === 'samples') {
        try {
          organizationOptions = await callerCreateOrganization.resolveCallerCreateOrganization(db, {
            userId: req.user?.userID,
            organizationScope: req.organizationScope,
            requested: typeof req.body?.organizationId === 'string' ? req.body.organizationId.trim() : undefined
          });
        } catch (error) {
          importAsyncService.cleanupFile(file.path);
          return res.status(error.statusCode || 403).json({ success: false, error: error.message });
        }
      }

      if (req.body.groupFields) {
        const parsed = parseGroupFields(req.body.groupFields);
        if (!parsed.ok) {
          importAsyncService.cleanupFile(file.path);
          return res.status(400).json(groupFieldsErrorBody(parsed.reason));
        }
        parsedGroupFields = parsed.value;
      }

      const userID = req.user?.userID || req.user?._id?.toString() || null;

      // Cria job na fila
      const result = await importAsyncService.createImportJob(
        db,
        userID,
        file,
        dataType,
        {
          startBoxId: startBoxId || null,
          autoIncrement: autoIncrement === 'true' || autoIncrement === true,
          groupFields: parsedGroupFields,
          fileName: file.originalname,
          ...organizationOptions,
        }
      );

      // Registra no AuditLog
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        const entityName = mapDataTypeToEntity(dataType);
        await auditLogger.logImport(
          req,
          entityName,
          'pending',
          0,
          0,
          0,
          { jobID: result.jobID }
        );
      }

      return res.status(202).json({
        success: true,
        message: 'Job de importação criado com sucesso',
        data: result
      });
    } catch (error) {
      logger.error('Erro ao criar job de importação:', error);

      if (req.file) {
        importAsyncService.cleanupFile(req.file.path);
      }

      return res.status(500).json({
        success: false,
        error: 'Erro ao criar job de importação',
        message: error.message
      });
    }
  }

  async createSampleImportJob(req, res) {
    req.body = {
      ...(req.body || {}),
      dataType: 'samples'
    };
    return this.createImportJob(req, res);
  }

  /**
   * #1384: an import job belongs to its uploader (importJobs.userID), so a
   * job route answers only that user. Sends the 404/403 and returns false
   * unless the caller's id positively matches the job's; it runs before the
   * service, so a non-owner never triggers getJobStatus's status write.
   */
  async ensureJobOwner(db, req, res, jobID) {
    const job = await db.collection('importJobs').findOne({ jobID }, { projection: { userID: 1 } });
    if (!job) {
      res.status(404).json({ success: false, error: 'Job não encontrado' });
      return false;
    }
    const callerID = req.user?.userID || req.user?._id?.toString();
    if (!callerID || job.userID == null || String(job.userID) !== String(callerID)) {
      res.status(403).json({ success: false, error: 'Acesso negado', message: 'Este job pertence a outro usuário' });
      return false;
    }
    return true;
  }

  /**
   * Obtém status do job
   */
  async getJobStatus(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { jobID } = req.params;
      if (!(await this.ensureJobOwner(db, req, res, jobID))) return;
      const job = await importAsyncService.getJobStatus(db, jobID);

      return res.status(200).json({
        success: true,
        data: job
      });
    } catch (error) {
      logger.error('Erro ao obter status do job:', error);
      return res.status(500).json({
        success: false,
        error: 'Erro ao obter status do job',
        message: error.message
      });
    }
  }

  /**
   * Lista jobs
   */
  async listJobs(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      // #1384: the service drops the userID filter when it is empty, which
      // would list every user's jobs.
      const callerID = req.user?.userID || req.user?._id?.toString();
      if (!callerID) {
        return res.status(403).json({ success: false, error: 'Acesso negado', message: 'Este job pertence a outro usuário' });
      }

      const filters = {
        userID: callerID,
        dataType: req.query.dataType,
        status: req.query.status,
        limit: req.query.limit,
        skip: req.query.skip,
      };

      const result = await importAsyncService.listJobs(db, filters);

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Erro ao listar jobs:', error);
      return res.status(500).json({
        success: false,
        error: 'Erro ao listar jobs',
        message: error.message
      });
    }
  }

  /**
   * Cancela job
   */
  async cancelJob(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { jobID } = req.params;
      if (!(await this.ensureJobOwner(db, req, res, jobID))) return;
      const result = await importAsyncService.cancelJob(db, jobID);

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Erro ao cancelar job:', error);
      return res.status(500).json({
        success: false,
        error: 'Erro ao cancelar job',
        message: error.message
      });
    }
  }

  /**
   * Obtém relatório do job
   */
  async getJobReport(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { jobID } = req.params;
      if (!(await this.ensureJobOwner(db, req, res, jobID))) return;
      const report = await importAsyncService.getJobReport(db, jobID);

      return res.status(200).json({
        success: true,
        data: report
      });
    } catch (error) {
      logger.error('Erro ao obter relatório do job:', error);
      return res.status(500).json({
        success: false,
        error: 'Erro ao obter relatório do job',
        message: error.message
      });
    }
  }
}

function mapDataTypeToEntity(dataType) {
  const s = (dataType || '').toString().toLowerCase();
  if (s.includes('sample')) return 'Sample';
  if (s.includes('patient')) return 'Patient';
  if (s.includes('result')) return 'Result';
  if (s.includes('temper')) return 'Temperature';
  return 'Import';
}

module.exports = new ImportAsyncController();

