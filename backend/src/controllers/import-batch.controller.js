const multer = require('multer');
const path = require('path');
const fs = require('fs');

const stagingImportService = require('../services/staging-import.service');
const logger = require('../utils/logger');

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
  storage,
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
      'text/plain',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/json'
    ];

    if (!allowedMimes.includes(file.mimetype)) {
      const err = new Error('Formato de arquivo não seguro');
      err.status = 400;
      return cb(err, false);
    }

    cb(null, true);
  },
  limits: { fileSize: 100 * 1024 * 1024 }
});

class ImportBatchController {
  uploadMiddleware() {
    return upload.single('file');
  }

  normalizeBatchStatus(status) {
    const normalized = String(status || '').toLowerCase();

    if (['staged', 'queued'].includes(normalized)) return 'PENDING';
    if (normalized === 'processing') return 'PROCESSING';
    if (normalized === 'completed') return 'COMPLETED';
    if (normalized === 'failed') return 'FAILED';
    return 'PENDING';
  }

  async createBatchImport(req, res) {
    try {
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'Arquivo não fornecido'
        });
      }

      const result = await stagingImportService.createBatchImportJob(file);

      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      return res.status(202).json({
        success: true,
        message: 'Arquivo recebido e job enfileirado para staging',
        data: {
          jobId: result.jobId,
          stagingImportId: result.stagingImport.jobId,
          status: result.stagingImport.status,
          fileName: result.stagingImport.fileName,
        }
      });
    } catch (error) {
      logger.error('Erro ao criar batch import:', error);

      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      return res.status(500).json({
        success: false,
        error: 'Erro ao criar batch import',
        message: error.message
      });
    }
  }

  async getBatchImportStatus(req, res) {
    try {
      const { jobId } = req.params;

      if (!jobId) {
        return res.status(400).json({
          success: false,
          error: 'jobId não fornecido'
        });
      }

      const StagingImport = require('../models/StagingImport');
      const stagingImport = await StagingImport.findOne({ jobId });

      if (!stagingImport) {
        return res.status(404).json({
          success: false,
          error: 'Lote não encontrado'
        });
      }

      const totalRows = Number(stagingImport.totalRows || 0);
      const processedRows = Number(stagingImport.processedRows || 0);
      const progress = totalRows > 0 ? Math.min(100, Math.round((processedRows / totalRows) * 100)) : 0;

      return res.status(200).json({
        success: true,
        data: {
          jobId: stagingImport.jobId,
          fileName: stagingImport.fileName,
          status: this.normalizeBatchStatus(stagingImport.status),
          rawStatus: stagingImport.status,
          totalRows,
          processedRows,
          progress,
          errors: stagingImport.errors || [],
          rawData: stagingImport.rawData || {},
          createdAt: stagingImport.createdAt,
          updatedAt: stagingImport.updatedAt,
        }
      });
    } catch (error) {
      logger.error('Erro ao obter status do batch import:', error);
      return res.status(500).json({
        success: false,
        error: 'Erro ao obter status do batch import',
        message: error.message
      });
    }
  }
}

module.exports = new ImportBatchController();