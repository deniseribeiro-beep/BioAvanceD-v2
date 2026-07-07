const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const { upload, UPLOAD_ROOT } = require('../config/uploadConfig');
const analysisValidationService = require('../services/analysisValidation.service');

const getRelativePath = (absolutePath) => {
  const basePath = path.join(__dirname, '../../uploads');
  const relative = path.relative(basePath, absolutePath);
  return relative.split(path.sep).join('/');
};

class UploadController {
  uploadMiddleware() {
    return upload.single('file');
  }

  async uploadAnalysisFile(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const file = req.file;
      const sampleId = req.body.sampleId || req.body.sampleID || null;

      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'Arquivo não fornecido'
        });
      }

      if (!sampleId) {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
        return res.status(400).json({
          success: false,
          error: 'sampleId é obrigatório'
        });
      }

      // VALIDAÇÃO: Amostra existe + Paciente tem consentimento
      const validationResult = await analysisValidationService.validateUploadEligibility(db, String(sampleId));
      if (!validationResult.success) {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
        return res.status(validationResult.patientStatus ? 409 : 400).json({
          success: false,
          error: validationResult.error,
          code: validationResult.patientStatus ? 'CONSENT_PENDING' : 'SAMPLE_NOT_FOUND'
        });
      }

      const uploadedBy = req.user?.id || req.user?._id?.toString() || null;
      const storedPath = getRelativePath(file.path);

      const payload = {
        originalName: file.originalname,
        storedPath,
        mimeType: file.mimetype,
        size: file.size,
        sampleId: validationResult.sample._id, // Usa o _id da amostra validada
        sampleIdentifier: String(sampleId), // Mantém o identificador original para auditoria
        patientID: validationResult.sample.patientID,
        uploadedBy,
        createdAt: new Date()
      };

      const analysisCollection = db.collection('AnalysisFile');
      const insertResult = await analysisCollection.insertOne(payload);

      logger.info(`Upload de análise registrado: Sample ${validationResult.sample.sampleID}, File: ${file.originalname}`);

      return res.status(201).json({
        success: true,
        message: 'Arquivo enviado com sucesso',
        data: { 
          _id: insertResult.insertedId,
          sampleID: validationResult.sample.sampleID,
          barcode: validationResult.sample.barcode,
          fileName: file.originalname,
          fileSize: file.size,
          uploadedAt: payload.createdAt
        }
      });
    } catch (error) {
      logger.error('Erro ao fazer upload de arquivo de análise:', error.message);
      if (req.file && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          logger.error('Erro ao remover arquivo temporário:', unlinkError.message);
        }
      }
      return res.status(400).json({
        success: false,
        error: 'Erro ao fazer upload de arquivo de análise',
        message: error.message
      });
    }
  }
}

module.exports = new UploadController();
