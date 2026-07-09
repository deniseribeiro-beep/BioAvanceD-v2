const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { ObjectId } = require('mongodb');
const SampleFileModel = require('../models/SampleFile');
const { getUserAnonId } = require('../utils/userAnonymization');

/**
 * Controller de Upload de Arquivos de Análise de Amostras
 * RF007 - Upload de Arquivos da Análise
 * 
 * Permissões:
 * - Upload/Delete: Admin (4) e Coordenador (3)
 * - View/Download: Todos os perfis autenticados
 */
class SampleFileController {
  constructor() {
    // Configuração do multer para upload de arquivos de análise
    // Organiza arquivos por specimenId: storage/samples/<specimenId>/files/
    this.storage = multer.diskStorage({
      destination: async (req, file, cb) => {
        try {
          const { specimenId } = req.params;
          if (!specimenId) {
            return cb(new Error('specimenId é obrigatório'), null);
          }

          // Cria diretório organizado por specimenId
          const sampleDir = path.join(__dirname, '../../storage/samples', String(specimenId), 'files');
          if (!fs.existsSync(sampleDir)) {
            fs.mkdirSync(sampleDir, { recursive: true });
          }
          cb(null, sampleDir);
        } catch (error) {
          cb(error, null);
        }
      },
      filename: (req, file, cb) => {
        try {
          // Nome do arquivo: originalName_UUID.ext
          const ext = path.extname(file.originalname);
          const baseName = path.basename(file.originalname, ext);
          const sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_');
          // Gera UUID único usando crypto (built-in, não precisa de pacote externo)
          const uniqueId = crypto.randomBytes(16).toString('hex');
          const finalFileName = `${sanitizedBaseName}_${uniqueId}${ext}`;
          cb(null, finalFileName);
        } catch (error) {
          cb(error, null);
        }
      }
    });

    // Validação de tipos de arquivo permitidos
    this.fileFilter = (req, file, cb) => {
      const allowedExtensions = ['.raw', '.zip', '.csv', '.xls', '.xlsx', '.pdf', '.txt'];
      const ext = path.extname(file.originalname).toLowerCase();

      if (allowedExtensions.includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error(`Formato de arquivo inválido. Apenas ${allowedExtensions.join(', ')} são permitidos.`), false);
      }
    };

    this.upload = multer({
      storage: this.storage,
      fileFilter: this.fileFilter,
      limits: { fileSize: 100 * 1024 * 1024 } // 100MB
    });
  }

  /**
   * Middleware de upload
   */
  uploadMiddleware() {
    return this.upload.single('file');
  }

  /**
   * Upload de arquivo de análise para uma amostra
   * POST /api/samples/:specimenId/files/upload
   * Permissão: Admin (4) ou Coordenador (3)
   */
  async uploadFile(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: req.t ? req.t('errors.databaseUnavailable') : 'Banco de dados não disponível'
        });
      }

      const { specimenId } = req.params;
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          success: false,
          error: req.t ? req.t('sampleFiles.fileRequired') : 'Arquivo não fornecido'
        });
      }

      // Valida se a amostra existe
      const samplesCollection = db.collection('amostras');
      let sample;
      try {
        // Tenta buscar por ObjectId primeiro
        sample = await samplesCollection.findOne({ _id: new ObjectId(specimenId) });
      } catch (idError) {
        // Se não for ObjectId válido, tenta buscar por specimenId numérico
        sample = await samplesCollection.findOne({ specimenId: Number(specimenId) });
      }

      if (!sample) {
        // Remove arquivo se amostra não existe
        if (fs.existsSync(file.path)) {
          try {
            fs.unlinkSync(file.path);
          } catch (unlinkError) {
            logger.error('Erro ao remover arquivo após validação:', unlinkError.message);
          }
        }
        return res.status(404).json({
          success: false,
          error: req.t ? req.t('sampleFiles.sampleNotFound') : 'Amostra não encontrada'
        });
      }

      // Obtém ID anonimizado do uploader (LGPD)
      const uploaderAnonId = await getUserAnonId(req.user, db);

      // Determina tipo de arquivo
      const fileType = SampleFileModel.getFileTypeFromExtension(file.originalname);
      if (!fileType) {
        // Remove arquivo se tipo inválido
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
        return res.status(400).json({
          success: false,
          error: req.t ? req.t('sampleFiles.invalidFileType') : 'Tipo de arquivo inválido'
        });
      }

      // Cria registro na collection sample_files
      const sampleFilesCollection = db.collection('sample_files');
      const sampleFileData = {
        specimenId: sample._id.toString(), // Usa _id da amostra como referência principal
        fileName: file.originalname,
        fileType: fileType,
        fileSize: file.size,
        storagePath: file.path,
        uploaderAnonId: uploaderAnonId,
        uploadDate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const validation = SampleFileModel.validate(sampleFileData);
      if (!validation.isValid) {
        // Remove arquivo se validação falhar
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
        return res.status(400).json({
          success: false,
          error: req.t ? req.t('sampleFiles.validationError') : 'Erro de validação',
          details: validation.errors
        });
      }

      const sampleFile = SampleFileModel.create(sampleFileData);
      const insertResult = await sampleFilesCollection.insertOne(sampleFile);

      // Registra log de auditoria (LGPD - com userAnonId)
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'file_upload',
          entity: 'SampleFile',
          entityID: insertResult.insertedId.toString(),
          result: 'success',
          severity: 'info',
          message: `Upload de arquivo de análise: ${file.originalname} (${(file.size / 1024).toFixed(2)} KB)`,
          payload: {
            fileName: file.originalname,
            fileSize: file.size,
            fileType: fileType,
            specimenId: sample._id.toString()
            // Não inclui dados sensíveis
          },
          req: req,
          module: 'Amostras'
        });
      }

      // Retorna dados sanitizados (sem storagePath)
      return res.status(201).json({
        success: true,
        message: req.t ? req.t('sampleFiles.uploadSuccess') : 'Arquivo enviado com sucesso',
        data: {
          _id: insertResult.insertedId,
          specimenId: sampleFile.specimenId,
          fileName: sampleFile.fileName,
          fileType: sampleFile.fileType,
          fileSize: sampleFile.fileSize,
          uploaderAnonId: sampleFile.uploaderAnonId,
          uploadDate: sampleFile.uploadDate
          // storagePath não é retornado por segurança
        }
      });
    } catch (error) {
      logger.error('Erro ao fazer upload de arquivo:', error.message);
      
      // Remove arquivo em caso de erro
      if (req.file && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          logger.error('Erro ao remover arquivo temporário:', unlinkError.message);
        }
      }

      return res.status(400).json({
        success: false,
        error: req.t ? req.t('sampleFiles.uploadError') : 'Erro ao fazer upload de arquivo',
        message: error.message
      });
    }
  }

  /**
   * Lista arquivos de análise de uma amostra
   * GET /api/samples/:specimenId/files
   * Permissão: Todos os perfis autenticados
   */
  async listFiles(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: req.t ? req.t('errors.databaseUnavailable') : 'Banco de dados não disponível'
        });
      }

      const { specimenId } = req.params;

      // Valida se a amostra existe
      const samplesCollection = db.collection('amostras');
      let sample;
      try {
        sample = await samplesCollection.findOne({ _id: new ObjectId(specimenId) });
      } catch (idError) {
        sample = await samplesCollection.findOne({ specimenId: Number(specimenId) });
      }

      if (!sample) {
        return res.status(404).json({
          success: false,
          error: req.t ? req.t('sampleFiles.sampleNotFound') : 'Amostra não encontrada'
        });
      }

      // Busca arquivos da amostra
      const sampleFilesCollection = db.collection('sample_files');
      const specimenIdString = sample._id.toString();
      const files = await sampleFilesCollection.find({ specimenId: specimenIdString }).toArray();

      // Remove caminhos sensíveis da resposta (LGPD)
      const sanitizedFiles = files.map(file => ({
        _id: file._id,
        specimenId: file.specimenId,
        fileName: file.fileName,
        fileType: file.fileType,
        fileSize: file.fileSize,
        uploaderAnonId: file.uploaderAnonId, // Apenas ID anonimizado
        uploadDate: file.uploadDate,
        createdAt: file.createdAt
        // storagePath não é retornado por segurança
      }));

      // Registra log de consulta
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'QUERY',
          entity: 'SampleFile',
          result: 'success',
          severity: 'info',
          message: `Consulta de arquivos de análise - Amostra: ${specimenId}, Total: ${files.length}`,
          payload: {
            specimenId: specimenIdString,
            filesCount: files.length
          },
          req: req,
          module: 'Amostras'
        });
      }

      return res.status(200).json({
        success: true,
        data: sanitizedFiles
      });
    } catch (error) {
      logger.error('Erro ao listar arquivos:', error.message);
      return res.status(500).json({
        success: false,
        error: req.t ? req.t('sampleFiles.listError') : 'Erro ao listar arquivos',
        message: error.message
      });
    }
  }

  /**
   * Download de arquivo de análise
   * GET /api/samples/:specimenId/files/:fileID/download
   * Permissão: Todos os perfis autenticados
   */
  async downloadFile(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: req.t ? req.t('errors.databaseUnavailable') : 'Banco de dados não disponível'
        });
      }

      const { specimenId, fileID } = req.params;

      // Busca registro do arquivo
      const sampleFilesCollection = db.collection('sample_files');
      let fileRecord;
      try {
        fileRecord = await sampleFilesCollection.findOne({ _id: new ObjectId(fileID) });
      } catch (idError) {
        return res.status(400).json({
          success: false,
          error: req.t ? req.t('sampleFiles.invalidFileID') : 'ID de arquivo inválido'
        });
      }

      if (!fileRecord) {
        return res.status(404).json({
          success: false,
          error: req.t ? req.t('sampleFiles.fileNotFound') : 'Arquivo não encontrado'
        });
      }

      // Verifica se o arquivo pertence à amostra correta
      const specimenIdString = typeof specimenId === 'string' && ObjectId.isValid(specimenId) 
        ? new ObjectId(specimenId).toString()
        : String(specimenId);
      
      if (fileRecord.specimenId !== specimenIdString) {
        return res.status(403).json({
          success: false,
          error: req.t ? req.t('sampleFiles.fileNotBelongToSample') : 'Arquivo não pertence a esta amostra'
        });
      }

      // Verifica se o arquivo existe no sistema de arquivos
      if (!fs.existsSync(fileRecord.storagePath)) {
        logger.error(`Arquivo não encontrado no sistema de arquivos: ${fileRecord.storagePath}`);
        return res.status(404).json({
          success: false,
          error: req.t ? req.t('sampleFiles.fileNotFoundOnDisk') : 'Arquivo não encontrado no sistema de arquivos'
        });
      }

      // Registra log de download (LGPD)
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'file_download',
          entity: 'SampleFile',
          entityID: fileID,
          result: 'success',
          severity: 'info',
          message: `Download de arquivo: ${fileRecord.fileName}`,
          payload: {
            fileName: fileRecord.fileName,
            fileType: fileRecord.fileType,
            fileSize: fileRecord.fileSize,
            specimenId: specimenIdString
            // Não inclui dados sensíveis
          },
          req: req,
          module: 'Amostras'
        });
      }

      // Faz download do arquivo
      return res.download(fileRecord.storagePath, fileRecord.fileName, (err) => {
        if (err) {
          logger.error('Erro ao fazer download do arquivo:', err.message);
          if (!res.headersSent) {
            return res.status(500).json({
              success: false,
              error: req.t ? req.t('sampleFiles.downloadError') : 'Erro ao fazer download do arquivo'
            });
          }
        }
      });
    } catch (error) {
      logger.error('Erro ao fazer download de arquivo:', error.message);
      return res.status(500).json({
        success: false,
        error: req.t ? req.t('sampleFiles.downloadError') : 'Erro ao fazer download de arquivo',
        message: error.message
      });
    }
  }

  /**
   * Deleta arquivo de análise
   * DELETE /api/samples/:specimenId/files/:fileID
   * Permissão: Admin (4) ou Coordenador (3) apenas
   */
  async deleteFile(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: req.t ? req.t('errors.databaseUnavailable') : 'Banco de dados não disponível'
        });
      }

      const { specimenId, fileID } = req.params;

      // Busca registro do arquivo
      const sampleFilesCollection = db.collection('sample_files');
      let fileRecord;
      try {
        fileRecord = await sampleFilesCollection.findOne({ _id: new ObjectId(fileID) });
      } catch (idError) {
        return res.status(400).json({
          success: false,
          error: req.t ? req.t('sampleFiles.invalidFileID') : 'ID de arquivo inválido'
        });
      }

      if (!fileRecord) {
        return res.status(404).json({
          success: false,
          error: req.t ? req.t('sampleFiles.fileNotFound') : 'Arquivo não encontrado'
        });
      }

      // Verifica se o arquivo pertence à amostra correta
      const specimenIdString = typeof specimenId === 'string' && ObjectId.isValid(specimenId) 
        ? new ObjectId(specimenId).toString()
        : String(specimenId);
      
      if (fileRecord.specimenId !== specimenIdString) {
        return res.status(403).json({
          success: false,
          error: req.t ? req.t('sampleFiles.fileNotBelongToSample') : 'Arquivo não pertence a esta amostra'
        });
      }

      // Remove arquivo físico do sistema de arquivos
      if (fs.existsSync(fileRecord.storagePath)) {
        try {
          fs.unlinkSync(fileRecord.storagePath);
          logger.info(`Arquivo removido do sistema de arquivos: ${fileRecord.storagePath}`);
        } catch (unlinkError) {
          logger.error('Erro ao remover arquivo físico:', unlinkError.message);
          // Continua mesmo se houver erro ao remover arquivo físico
        }
      }

      // Remove registro do banco de dados
      await sampleFilesCollection.deleteOne({ _id: new ObjectId(fileID) });

      // Registra log de exclusão (alta severidade - LGPD)
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'file_delete',
          entity: 'SampleFile',
          entityID: fileID,
          result: 'success',
          severity: 'critical', // Alta severidade para exclusão
          message: `Arquivo excluído: ${fileRecord.fileName}`,
          payload: {
            fileName: fileRecord.fileName,
            fileType: fileRecord.fileType,
            fileSize: fileRecord.fileSize,
            specimenId: specimenIdString
            // Não inclui dados sensíveis
          },
          req: req,
          module: 'Amostras'
        });
      }

      return res.status(200).json({
        success: true,
        message: req.t ? req.t('sampleFiles.deleteSuccess') : 'Arquivo excluído com sucesso'
      });
    } catch (error) {
      logger.error('Erro ao deletar arquivo:', error.message);
      return res.status(500).json({
        success: false,
        error: req.t ? req.t('sampleFiles.deleteError') : 'Erro ao deletar arquivo',
        message: error.message
      });
    }
  }

  /**
   * Exporta arquivo em formato HL7 v2.x
   * GET /api/samples/:specimenId/files/:fileID/export/hl7
   */
  async exportHL7v2(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: req.t ? req.t('errors.databaseUnavailable') : 'Banco de dados não disponível'
        });
      }

      const { specimenId, fileID } = req.params;

      // Busca arquivo
      const sampleFilesCollection = db.collection('sample_files');
      const fileRecord = await sampleFilesCollection.findOne({ _id: new ObjectId(fileID) });

      if (!fileRecord) {
        return res.status(404).json({
          success: false,
          error: req.t ? req.t('sampleFiles.fileNotFound') : 'Arquivo não encontrado'
        });
      }

      // Valida vinculação à amostra
      const specimenIdString = String(specimenId);
      if (String(fileRecord.specimenId) !== specimenIdString) {
        return res.status(400).json({
          success: false,
          error: req.t ? req.t('sampleFiles.sampleMismatch') : 'Arquivo não está vinculado a esta amostra'
        });
      }

      // Busca amostra
      const samplesCollection = db.collection('samples');
      const sample = await samplesCollection.findOne({ _id: new ObjectId(specimenId) });

      if (!sample) {
        return res.status(404).json({
          success: false,
          error: req.t ? req.t('samples.sampleNotFound') : 'Amostra não encontrada'
        });
      }

      // LGPD: Usa apenas participantId anonimizado (8 dígitos)
      const participantId = String(sample.participantId || '');

      // Gera mensagem HL7 v2.x
      const hl7Service = require('../services/hl7.service');
      const hl7Message = await hl7Service.generateHL7v2Message(db, fileRecord, sample, participantId);

      // Registra log de exportação
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        const userAnonId = await getUserAnonId(req.user, db);
        await auditLogger.log({
          action: 'file_export_hl7',
          entity: 'SampleFile',
          entityID: fileID,
          result: 'success',
          severity: 'medium',
          message: `Exportação HL7 v2.x do arquivo: ${fileRecord.fileName}`,
          payload: {
            fileName: fileRecord.fileName,
            fileType: fileRecord.fileType,
            specimenId: specimenIdString,
            exportFormat: 'HL7v2.x'
          },
          req: req,
          module: 'Amostras'
        });
      }

      // Retorna mensagem HL7 como texto
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="hl7_${fileID}.hl7"`);
      return res.send(hl7Message);

    } catch (error) {
      logger.error('Erro ao exportar arquivo em HL7 v2.x:', error.message);
      return res.status(500).json({
        success: false,
        error: req.t ? req.t('sampleFiles.exportError') : 'Erro ao exportar arquivo',
        message: error.message
      });
    }
  }

  /**
   * Exporta arquivo em formato FHIR R4 JSON
   * GET /api/samples/:specimenId/files/:fileID/export/fhir
   */
  async exportFHIR(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: req.t ? req.t('errors.databaseUnavailable') : 'Banco de dados não disponível'
        });
      }

      const { specimenId, fileID } = req.params;

      // Busca arquivo
      const sampleFilesCollection = db.collection('sample_files');
      const fileRecord = await sampleFilesCollection.findOne({ _id: new ObjectId(fileID) });

      if (!fileRecord) {
        return res.status(404).json({
          success: false,
          error: req.t ? req.t('sampleFiles.fileNotFound') : 'Arquivo não encontrado'
        });
      }

      // Valida vinculação à amostra
      const specimenIdString = String(specimenId);
      if (String(fileRecord.specimenId) !== specimenIdString) {
        return res.status(400).json({
          success: false,
          error: req.t ? req.t('sampleFiles.sampleMismatch') : 'Arquivo não está vinculado a esta amostra'
        });
      }

      // Busca amostra
      const samplesCollection = db.collection('samples');
      const sample = await samplesCollection.findOne({ _id: new ObjectId(specimenId) });

      if (!sample) {
        return res.status(404).json({
          success: false,
          error: req.t ? req.t('samples.sampleNotFound') : 'Amostra não encontrada'
        });
      }

      // LGPD: Usa apenas participantId anonimizado (8 dígitos)
      const participantId = String(sample.participantId || '');

      // Gera resource FHIR
      const hl7Service = require('../services/hl7.service');
      const fhirBundle = await hl7Service.generateFHIRResource(db, fileRecord, sample, participantId);

      // Registra log de exportação
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'file_export_fhir',
          entity: 'SampleFile',
          entityID: fileID,
          result: 'success',
          severity: 'medium',
          message: `Exportação FHIR do arquivo: ${fileRecord.fileName}`,
          payload: {
            fileName: fileRecord.fileName,
            fileType: fileRecord.fileType,
            specimenId: specimenIdString,
            exportFormat: 'FHIR R4'
          },
          req: req,
          module: 'Amostras'
        });
      }

      // Retorna bundle FHIR como JSON
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="fhir_${fileID}.json"`);
      return res.json(fhirBundle);

    } catch (error) {
      logger.error('Erro ao exportar arquivo em FHIR:', error.message);
      return res.status(500).json({
        success: false,
        error: req.t ? req.t('sampleFiles.exportError') : 'Erro ao exportar arquivo',
        message: error.message
      });
    }
  }

  /**
   * Exporta arquivo em formato CDA (Clinical Document Architecture)
   * GET /api/samples/:specimenId/files/:fileID/export/cda
   */
  async exportCDA(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: req.t ? req.t('errors.databaseUnavailable') : 'Banco de dados não disponível'
        });
      }

      const { specimenId, fileID } = req.params;

      // Busca arquivo
      const sampleFilesCollection = db.collection('sample_files');
      const fileRecord = await sampleFilesCollection.findOne({ _id: new ObjectId(fileID) });

      if (!fileRecord) {
        return res.status(404).json({
          success: false,
          error: req.t ? req.t('sampleFiles.fileNotFound') : 'Arquivo não encontrado'
        });
      }

      // Valida vinculação à amostra
      const specimenIdString = String(specimenId);
      if (String(fileRecord.specimenId) !== specimenIdString) {
        return res.status(400).json({
          success: false,
          error: req.t ? req.t('sampleFiles.sampleMismatch') : 'Arquivo não está vinculado a esta amostra'
        });
      }

      // Busca amostra
      const samplesCollection = db.collection('samples');
      const sample = await samplesCollection.findOne({ _id: new ObjectId(specimenId) });

      if (!sample) {
        return res.status(404).json({
          success: false,
          error: req.t ? req.t('samples.sampleNotFound') : 'Amostra não encontrada'
        });
      }

      // LGPD: Usa apenas participantId anonimizado (8 dígitos)
      const participantId = String(sample.participantId || '');

      // Gera documento CDA
      const hl7Service = require('../services/hl7.service');
      const cdaDocument = await hl7Service.generateCDA(db, fileRecord, sample, participantId);

      // Registra log de exportação
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'file_export_cda',
          entity: 'SampleFile',
          entityID: fileID,
          result: 'success',
          severity: 'medium',
          message: `Exportação CDA do arquivo: ${fileRecord.fileName}`,
          payload: {
            fileName: fileRecord.fileName,
            fileType: fileRecord.fileType,
            specimenId: specimenIdString,
            exportFormat: 'CDA'
          },
          req: req,
          module: 'Amostras'
        });
      }

      // Retorna documento CDA como XML
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="cda_${fileID}.xml"`);
      return res.send(cdaDocument);

    } catch (error) {
      logger.error('Erro ao exportar arquivo em CDA:', error.message);
      return res.status(500).json({
        success: false,
        error: req.t ? req.t('sampleFiles.exportError') : 'Erro ao exportar arquivo',
        message: error.message
      });
    }
  }
}

module.exports = new SampleFileController();
