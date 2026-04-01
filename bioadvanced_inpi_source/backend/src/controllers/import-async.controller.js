const multer = require('multer');
const path = require('path');
const fs = require('fs');
const importAsyncService = require('../services/import-async.service');
const logger = require('../utils/logger');

// Configuração do multer para upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(__dirname, '../../uploads/temp');
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
      const validation = await importAsyncService.validateFile(file, dataType);

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

      // Retorna metadata (arquivo será processado depois)
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

      const { dataType, startLocationID, autoIncrement } = req.body;
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

      if (req.body.groupFields) {
        try {
          parsedGroupFields = typeof req.body.groupFields === 'string'
            ? JSON.parse(req.body.groupFields)
            : req.body.groupFields;
        } catch (groupFieldsError) {
          importAsyncService.cleanupFile(file.path);
          return res.status(400).json({
            success: false,
            error: 'Formato inválido para groupFields. Use JSON válido.',
            message: groupFieldsError.message
          });
        }
      }

      const userID = req.user?.userID || req.user?._id?.toString() || null;

      // Cria job na fila
      const result = await importAsyncService.createImportJob(
        db,
        userID,
        file,
        dataType,
        {
          startLocationID: startLocationID ? parseInt(startLocationID) : null,
          autoIncrement: autoIncrement === 'true' || autoIncrement === true,
          groupFields: parsedGroupFields,
          fileName: file.originalname,
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

      const filters = {
        userID: req.user?.userID || req.user?._id?.toString(),
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

