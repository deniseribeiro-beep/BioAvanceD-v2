const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { ObjectId } = require('mongodb');
const { findSampleByAnyId } = require('../utils/sampleLookup');
const SampleFileModel = require('../models/SampleFile');
const { getUserAnonId } = require('../utils/userAnonymization');
const { isRecordInOrganizationScope } = require('../services/rbac-assignment.service');
// #643: extracted to a shared module so the Assay/Dataset scientific-file
// linkage controllers reuse the exact same crypto path instead of a second
// implementation -- see fileCrypto.js for the RF007/RNF029 rationale.
const { encryptFileBuffer, decryptFileBuffer, computeChecksum, assertFileEncryptionConfigured } = require('../utils/fileCrypto');
const { STORAGE_BASE } = require('../config/uploadConfig');

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
          const sampleDir = path.join(STORAGE_BASE, 'samples', String(specimenId), 'files');
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
   * Middleware de upload.
   * multer's fileFilter/limits rejections call next(err) with no
   * downstream error-handling middleware registered anywhere in the app
   * (confirmed: no `(err, req, res, next)` handler exists) — left as-is,
   * an invalid format or oversized file crashes to Express's default HTML
   * 500 instead of RF007 AC#1/AC#2's intended clean rejection. Caught here,
   * scoped to this route only, rather than adding a global handler.
   */
  uploadMiddleware() {
    const handler = this.upload.single('file');
    return (req, res, next) => {
      handler(req, res, (err) => {
        if (err) {
          return res.status(400).json({
            success: false,
            error: err.message || (req.t ? req.t('sampleFiles.uploadError') : 'Erro ao processar upload do arquivo')
          });
        }
        next();
      });
    };
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
      const samplesCollection = db.collection('samples');
      // #1216: an _id or the canonical specimenId. The old fallback matched
      // specimenId as a Number, and the field is a string, so it never hit.
      const sample = await findSampleByAnyId(samplesCollection, specimenId);

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

      // #625: mirrors sample.routes.js's own out-of-scope 403 pattern.
      // req.organizationScope is only absent when requireOrganizationScope
      // wasn't run ahead of this handler (never true in production).
      if (req.organizationScope && !isRecordInOrganizationScope(sample, req.organizationScope, 'collectionSite')) {
        if (fs.existsSync(file.path)) {
          try {
            fs.unlinkSync(file.path);
          } catch (unlinkError) {
            logger.error('Erro ao remover arquivo após validação de escopo:', unlinkError.message);
          }
        }
        return res.status(403).json({
          success: false,
          error: req.t ? req.t('samples.accessDenied') : 'Acesso negado',
          message: 'Esta amostra pertence a outra organização'
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

      // dict-02 ELM-0317 (DataFile.fileRole) -- optional multipart field
      // (multer puts non-file fields on req.body); an explicitly-supplied
      // value must be a real pipeline-stage value, not defaulted away.
      const fileRole = req.body && req.body.fileRole ? req.body.fileRole : undefined;
      if (fileRole !== undefined && !SampleFileModel.FILE_ROLES.includes(fileRole)) {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
        return res.status(400).json({
          success: false,
          error: req.t ? req.t('sampleFiles.invalidFileRole') : 'fileRole inválido',
          details: [`fileRole deve ser um dos: ${SampleFileModel.FILE_ROLES.join(', ')}`]
        });
      }

      // RF007 AC#3/AC#4/AC#5 - checksum do conteúdo original, cifra em
      // repouso (RNF029) e URI estável de Object Storage. O conteúdo em
      // disco é substituído pelo ciphertext; o checksum é sempre calculado
      // sobre o plaintext, já que é isso que RNF029 usa para provar
      // integridade do que o cliente enviou.
      // #938: fail closed BEFORE the plaintext multer already wrote to disk
      // can be left there. This used to read `if (encryption)` as
      // "skip encryption when no key is configured", so a keyless
      // deployment stored every upload in plaintext and still returned
      // success. RNF029 AC#5 makes encryption follow the data's
      // classification, and scientific files are classified encrypted at
      // rest (#566) -- so a missing key is a refusal, not a downgrade.
      // Same shape as #734's backup guard.
      assertFileEncryptionConfigured();
      const plaintext = fs.readFileSync(file.path);
      const checksum = computeChecksum(plaintext);
      const encryption = encryptFileBuffer(plaintext);
      if (encryption) {
        fs.writeFileSync(file.path, encryption.ciphertext);
      }
      const storageUri = `objstore://samples/${sample._id.toString()}/files/${path.basename(file.path)}`;

      // Cria registro na collection sample_files
      const sampleFilesCollection = db.collection('sample_files');
      const sampleFileData = {
        sampleID: sample._id.toString(), // SampleFileModel.validate requires sampleID
        specimenId: sample._id.toString(), // Usa _id da amostra como referência principal
        fileName: file.originalname,
        fileType: fileType,
        fileRole: fileRole || 'raw',
        fileFormat: SampleFileModel.getFileFormatFromType(fileType),
        fileSize: file.size,
        storagePath: file.path,
        storageUri,
        checksum,
        checksumAlgorithm: 'sha256',
        encryptionAlgorithm: encryption ? encryption.algorithm : null,
        encryptionKeyId: encryption ? encryption.keyId : null,
        encryptionIv: encryption ? encryption.iv : null,
        encryptionTag: encryption ? encryption.tag : null,
        // Restrição de acesso vigente hoje (rbac.js/roles.min.json): leitura
        // exige apenas autenticação, upload/exclusão exigem
        // uploadSampleFiles/deleteSampleFiles (Admin/Coordenador).
        accessPolicy: { view: 'authenticated', manage: ['admin', 'coordinator'] },
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
        return res.status(422).json({
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
          resourceType: 'SampleFile',
          resourceId: insertResult.insertedId.toString(),
          status: 'success',
          severity: 'info',
          message: `Upload de arquivo de análise: ${file.originalname} (${(file.size / 1024).toFixed(2)} KB)`,
          payload: {
            fileName: file.originalname,
            fileSize: file.size,
            fileType: fileType,
            specimenId: sample._id.toString(),
            checksum,
            checksumAlgorithm: 'sha256'
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
          fileRole: sampleFile.fileRole,
          fileFormat: sampleFile.fileFormat,
          fileSize: sampleFile.fileSize,
          uploaderAnonId: sampleFile.uploaderAnonId,
          uploadDate: sampleFile.uploadDate,
          uri: sampleFile.storageUri,
          checksum: sampleFile.checksum,
          checksumAlgorithm: sampleFile.checksumAlgorithm,
          encryption: {
            encrypted: Boolean(sampleFile.encryptionAlgorithm),
            algorithm: sampleFile.encryptionAlgorithm
          },
          accessPolicy: sampleFile.accessPolicy
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

      // #938: honour an explicit statusCode. The gate above throws 500 for a
      // missing ENCRYPTION_KEY -- a server misconfiguration the uploader can
      // do nothing about -- and answering the blanket 400 would blame the
      // client for it. Everything else keeps the 400 it always had.
      return res.status(error?.statusCode || 400).json({
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
      const samplesCollection = db.collection('samples');
      // #1216: an _id or the canonical specimenId. The old fallback matched
      // specimenId as a Number, and the field is a string, so it never hit.
      const sample = await findSampleByAnyId(samplesCollection, specimenId);

      if (!sample) {
        return res.status(404).json({
          success: false,
          error: req.t ? req.t('sampleFiles.sampleNotFound') : 'Amostra não encontrada'
        });
      }

      // #625: mirrors sample.routes.js's own out-of-scope 403 pattern.
      if (req.organizationScope && !isRecordInOrganizationScope(sample, req.organizationScope, 'collectionSite')) {
        return res.status(403).json({
          success: false,
          error: req.t ? req.t('samples.accessDenied') : 'Acesso negado',
          message: 'Esta amostra pertence a outra organização'
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
        fileRole: file.fileRole,
        fileFormat: file.fileFormat,
        fileSize: file.fileSize,
        uri: file.storageUri,
        checksum: file.checksum,
        checksumAlgorithm: file.checksumAlgorithm,
        encryption: {
          encrypted: Boolean(file.encryptionAlgorithm),
          algorithm: file.encryptionAlgorithm
        },
        accessPolicy: file.accessPolicy,
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
          resourceType: 'SampleFile',
          status: 'success',
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
      // #1216: the URL may name the specimen by its specimenId, while a file
      // is keyed by the sample's _id string, so resolve the sample first and
      // compare against that. The same document serves the scope check below.
      let resolvedSample = null;
      try {
        resolvedSample = await findSampleByAnyId(db.collection('samples'), specimenId);
      } catch (_) {}
      const specimenIdString = resolvedSample
        ? resolvedSample._id.toString()
        : typeof specimenId === 'string' && ObjectId.isValid(specimenId)
          ? new ObjectId(specimenId).toString()
          : String(specimenId);
      
      if (fileRecord.specimenId !== specimenIdString) {
        return res.status(403).json({
          success: false,
          error: req.t ? req.t('sampleFiles.fileNotBelongToSample') : 'Arquivo não pertence a esta amostra'
        });
      }

      // #625: mirrors sample.routes.js's own out-of-scope 403 pattern.
      // downloadFile doesn't otherwise need the Sample document itself, so
      // fetch it only for this check; a lookup failure (bad ObjectId, or
      // the sample no longer exists) is treated as "can't determine
      // scope" and doesn't block the download on its own.
      if (req.organizationScope) {
        const sampleForScope = resolvedSample;
        if (sampleForScope && !isRecordInOrganizationScope(sampleForScope, req.organizationScope, 'collectionSite')) {
          return res.status(403).json({
            success: false,
            error: req.t ? req.t('samples.accessDenied') : 'Acesso negado',
            message: 'Esta amostra pertence a outra organização'
          });
        }
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
          resourceType: 'SampleFile',
          resourceId: fileID,
          status: 'success',
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

      // RNF029 - o conteúdo em disco é o ciphertext cifrado no upload;
      // decifra antes de servir para que o download reproduza o
      // plaintext original (round-trip prova a integridade do checksum).
      let outputBuffer;
      if (fileRecord.encryptionAlgorithm) {
        const ciphertext = fs.readFileSync(fileRecord.storagePath);
        try {
          outputBuffer = decryptFileBuffer(ciphertext, fileRecord);
        } catch (decryptError) {
          logger.error('Erro ao decifrar arquivo:', decryptError.message);
          return res.status(500).json({
            success: false,
            error: req.t ? req.t('sampleFiles.downloadError') : 'Erro ao fazer download do arquivo'
          });
        }
      } else {
        outputBuffer = fs.readFileSync(fileRecord.storagePath);
      }

      res.setHeader('Content-Disposition', `attachment; filename="${fileRecord.fileName}"`);
      return res.send(outputBuffer);
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
      // #1216: the URL may name the specimen by its specimenId, while a file
      // is keyed by the sample's _id string, so resolve the sample first and
      // compare against that. The same document serves the scope check below.
      let resolvedSample = null;
      try {
        resolvedSample = await findSampleByAnyId(db.collection('samples'), specimenId);
      } catch (_) {}
      const specimenIdString = resolvedSample
        ? resolvedSample._id.toString()
        : typeof specimenId === 'string' && ObjectId.isValid(specimenId)
          ? new ObjectId(specimenId).toString()
          : String(specimenId);
      
      if (fileRecord.specimenId !== specimenIdString) {
        return res.status(403).json({
          success: false,
          error: req.t ? req.t('sampleFiles.fileNotBelongToSample') : 'Arquivo não pertence a esta amostra'
        });
      }

      // #625: mirrors sample.routes.js's own out-of-scope 403 pattern —
      // checked before the mutation, not just before a read. See
      // downloadFile's identical check for why the lookup is scoped to
      // just this check and tolerant of a failed/missing lookup.
      if (req.organizationScope) {
        const sampleForScope = resolvedSample;
        if (sampleForScope && !isRecordInOrganizationScope(sampleForScope, req.organizationScope, 'collectionSite')) {
          return res.status(403).json({
            success: false,
            error: req.t ? req.t('samples.accessDenied') : 'Acesso negado',
            message: 'Esta amostra pertence a outra organização'
          });
        }
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
          resourceType: 'SampleFile',
          resourceId: fileID,
          status: 'success',
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
   * Substitui o conteúdo de um arquivo de análise existente.
   * PUT /api/samples/:specimenId/files/:fileID/replace
   * Permissão: Admin (4) ou Coordenador (3) apenas — mesma política de
   * upload/delete.
   * RF007 AC#7 - "substituição" é a auditoria que faltava ao lado de
   * upload/acesso/remoção lógica (#334).
   */
  async replaceFile(req, res) {
    const cleanupUploadedFile = () => {
      if (req.file && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          logger.error('Erro ao remover arquivo temporário:', unlinkError.message);
        }
      }
    };

    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: req.t ? req.t('errors.databaseUnavailable') : 'Banco de dados não disponível'
        });
      }

      const { specimenId, fileID } = req.params;
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          success: false,
          error: req.t ? req.t('sampleFiles.fileRequired') : 'Arquivo não fornecido'
        });
      }

      const sampleFilesCollection = db.collection('sample_files');
      let fileRecord;
      try {
        fileRecord = await sampleFilesCollection.findOne({ _id: new ObjectId(fileID) });
      } catch (idError) {
        cleanupUploadedFile();
        return res.status(400).json({
          success: false,
          error: req.t ? req.t('sampleFiles.invalidFileID') : 'ID de arquivo inválido'
        });
      }

      if (!fileRecord) {
        cleanupUploadedFile();
        return res.status(404).json({
          success: false,
          error: req.t ? req.t('sampleFiles.fileNotFound') : 'Arquivo não encontrado'
        });
      }

      // Verifica se o arquivo pertence à amostra correta
      // #1216: the URL may name the specimen by its specimenId, while a file
      // is keyed by the sample's _id string, so resolve the sample first and
      // compare against that. The same document serves the scope check below.
      let resolvedSample = null;
      try {
        resolvedSample = await findSampleByAnyId(db.collection('samples'), specimenId);
      } catch (_) {}
      const specimenIdString = resolvedSample
        ? resolvedSample._id.toString()
        : typeof specimenId === 'string' && ObjectId.isValid(specimenId)
          ? new ObjectId(specimenId).toString()
          : String(specimenId);

      if (fileRecord.specimenId !== specimenIdString) {
        cleanupUploadedFile();
        return res.status(403).json({
          success: false,
          error: req.t ? req.t('sampleFiles.fileNotBelongToSample') : 'Arquivo não pertence a esta amostra'
        });
      }

      // #625: mirrors sample.routes.js's own out-of-scope 403 pattern —
      // checked before the mutation, same as deleteFile.
      if (req.organizationScope) {
        const sampleForScope = resolvedSample;
        if (sampleForScope && !isRecordInOrganizationScope(sampleForScope, req.organizationScope, 'collectionSite')) {
          cleanupUploadedFile();
          return res.status(403).json({
            success: false,
            error: req.t ? req.t('samples.accessDenied') : 'Acesso negado',
            message: 'Esta amostra pertence a outra organização'
          });
        }
      }

      const fileType = SampleFileModel.getFileTypeFromExtension(file.originalname);
      if (!fileType) {
        cleanupUploadedFile();
        return res.status(400).json({
          success: false,
          error: req.t ? req.t('sampleFiles.invalidFileType') : 'Tipo de arquivo inválido'
        });
      }

      // dict-02 ELM-0317 -- substituição pode opcionalmente atualizar o
      // fileRole (ex.: um arquivo 'raw' substituído por sua versão
      // 'processed'); sem valor novo, preserva o fileRole existente.
      const fileRole = req.body && req.body.fileRole ? req.body.fileRole : undefined;
      if (fileRole !== undefined && !SampleFileModel.FILE_ROLES.includes(fileRole)) {
        cleanupUploadedFile();
        return res.status(400).json({
          success: false,
          error: req.t ? req.t('sampleFiles.invalidFileRole') : 'fileRole inválido',
          details: [`fileRole deve ser um dos: ${SampleFileModel.FILE_ROLES.join(', ')}`]
        });
      }

      // Mesmo tratamento de checksum/cifra do upload (RF007 AC#3/AC#4,
      // RNF029) aplicado ao novo conteúdo.
      // #938: fail closed BEFORE the plaintext multer already wrote to disk
      // can be left there. This used to read `if (encryption)` as
      // "skip encryption when no key is configured", so a keyless
      // deployment stored every upload in plaintext and still returned
      // success. RNF029 AC#5 makes encryption follow the data's
      // classification, and scientific files are classified encrypted at
      // rest (#566) -- so a missing key is a refusal, not a downgrade.
      // Same shape as #734's backup guard.
      assertFileEncryptionConfigured();
      const plaintext = fs.readFileSync(file.path);
      const checksum = computeChecksum(plaintext);
      const encryption = encryptFileBuffer(plaintext);
      if (encryption) {
        fs.writeFileSync(file.path, encryption.ciphertext);
      }
      const storageUri = `objstore://samples/${specimenIdString}/files/${path.basename(file.path)}`;

      const updatedFields = {
        fileName: file.originalname,
        fileType,
        fileFormat: SampleFileModel.getFileFormatFromType(fileType),
        fileSize: file.size,
        storagePath: file.path,
        storageUri,
        checksum,
        checksumAlgorithm: 'sha256',
        encryptionAlgorithm: encryption ? encryption.algorithm : null,
        encryptionKeyId: encryption ? encryption.keyId : null,
        encryptionIv: encryption ? encryption.iv : null,
        encryptionTag: encryption ? encryption.tag : null,
        updatedAt: new Date()
      };
      if (fileRole !== undefined) {
        updatedFields.fileRole = fileRole;
      }

      const validation = SampleFileModel.validate({
        ...fileRecord,
        ...updatedFields,
        sampleID: fileRecord.sampleID || fileRecord.specimenId
      });
      if (!validation.isValid) {
        cleanupUploadedFile();
        return res.status(422).json({
          success: false,
          error: req.t ? req.t('sampleFiles.validationError') : 'Erro de validação',
          details: validation.errors
        });
      }

      // Remove o arquivo físico anterior só depois que o novo já está
      // validado e gravado em disco, para que uma falha na substituição
      // nunca deixe zero cópias no sistema de arquivos.
      const previousStoragePath = fileRecord.storagePath;
      if (previousStoragePath && previousStoragePath !== file.path && fs.existsSync(previousStoragePath)) {
        try {
          fs.unlinkSync(previousStoragePath);
        } catch (unlinkError) {
          logger.error('Erro ao remover arquivo anterior após substituição:', unlinkError.message);
        }
      }

      await sampleFilesCollection.updateOne({ _id: fileRecord._id }, { $set: updatedFields });

      // RF007 AC#7 - substituição é auditada, ao lado de upload/acesso/
      // remoção lógica.
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'file_replace',
          resourceType: 'SampleFile',
          resourceId: fileRecord._id.toString(),
          status: 'success',
          severity: 'warning',
          message: `Substituição de arquivo de análise: ${fileRecord.fileName} -> ${file.originalname}`,
          payload: {
            previousFileName: fileRecord.fileName,
            previousChecksum: fileRecord.checksum,
            fileName: file.originalname,
            fileSize: file.size,
            fileType,
            specimenId: specimenIdString,
            checksum,
            checksumAlgorithm: 'sha256'
            // Não inclui dados sensíveis
          },
          req: req,
          module: 'Amostras'
        });
      }

      return res.status(200).json({
        success: true,
        message: req.t ? req.t('sampleFiles.replaceSuccess') : 'Arquivo substituído com sucesso',
        data: {
          _id: fileRecord._id,
          specimenId: specimenIdString,
          fileName: updatedFields.fileName,
          fileType: updatedFields.fileType,
          fileRole: updatedFields.fileRole !== undefined ? updatedFields.fileRole : fileRecord.fileRole,
          fileFormat: updatedFields.fileFormat,
          fileSize: updatedFields.fileSize,
          uploaderAnonId: fileRecord.uploaderAnonId,
          uploadDate: fileRecord.uploadDate,
          uri: updatedFields.storageUri,
          checksum: updatedFields.checksum,
          checksumAlgorithm: updatedFields.checksumAlgorithm,
          encryption: {
            encrypted: Boolean(updatedFields.encryptionAlgorithm),
            algorithm: updatedFields.encryptionAlgorithm
          },
          accessPolicy: fileRecord.accessPolicy
          // storagePath não é retornado por segurança
        }
      });
    } catch (error) {
      logger.error('Erro ao substituir arquivo:', error.message);
      cleanupUploadedFile();
      // #938: see the upload handler's catch -- a missing ENCRYPTION_KEY is
      // a 500, not the client's fault.
      return res.status(error?.statusCode || 400).json({
        success: false,
        error: req.t ? req.t('sampleFiles.replaceError') : 'Erro ao substituir arquivo',
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

      // Busca amostra. #1216: resolved before the link check, because the URL
      // may carry the specimenId while the file is keyed by the sample's _id.
      const samplesCollection = db.collection('samples');
      const sample = await findSampleByAnyId(samplesCollection, specimenId);

      // Valida vinculação à amostra
      const specimenIdString = sample ? sample._id.toString() : String(specimenId);
      if (String(fileRecord.specimenId) !== specimenIdString) {
        return res.status(400).json({
          success: false,
          error: req.t ? req.t('sampleFiles.sampleMismatch') : 'Arquivo não está vinculado a esta amostra'
        });
      }

      if (!sample) {
        return res.status(404).json({
          success: false,
          error: req.t ? req.t('samples.sampleNotFound') : 'Amostra não encontrada'
        });
      }

      // #625: mirrors sample.routes.js's own out-of-scope 403 pattern.
      if (req.organizationScope && !isRecordInOrganizationScope(sample, req.organizationScope, 'collectionSite')) {
        return res.status(403).json({
          success: false,
          error: req.t ? req.t('samples.accessDenied') : 'Acesso negado',
          message: 'Esta amostra pertence a outra organização'
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
          resourceType: 'SampleFile',
          resourceId: fileID,
          status: 'success',
          severity: 'info',
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

      // Busca amostra. #1216: resolved before the link check, because the URL
      // may carry the specimenId while the file is keyed by the sample's _id.
      const samplesCollection = db.collection('samples');
      const sample = await findSampleByAnyId(samplesCollection, specimenId);

      // Valida vinculação à amostra
      const specimenIdString = sample ? sample._id.toString() : String(specimenId);
      if (String(fileRecord.specimenId) !== specimenIdString) {
        return res.status(400).json({
          success: false,
          error: req.t ? req.t('sampleFiles.sampleMismatch') : 'Arquivo não está vinculado a esta amostra'
        });
      }

      if (!sample) {
        return res.status(404).json({
          success: false,
          error: req.t ? req.t('samples.sampleNotFound') : 'Amostra não encontrada'
        });
      }

      // #625: mirrors sample.routes.js's own out-of-scope 403 pattern.
      if (req.organizationScope && !isRecordInOrganizationScope(sample, req.organizationScope, 'collectionSite')) {
        return res.status(403).json({
          success: false,
          error: req.t ? req.t('samples.accessDenied') : 'Acesso negado',
          message: 'Esta amostra pertence a outra organização'
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
          resourceType: 'SampleFile',
          resourceId: fileID,
          status: 'success',
          severity: 'info',
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

      // Busca amostra. #1216: resolved before the link check, because the URL
      // may carry the specimenId while the file is keyed by the sample's _id.
      const samplesCollection = db.collection('samples');
      const sample = await findSampleByAnyId(samplesCollection, specimenId);

      // Valida vinculação à amostra
      const specimenIdString = sample ? sample._id.toString() : String(specimenId);
      if (String(fileRecord.specimenId) !== specimenIdString) {
        return res.status(400).json({
          success: false,
          error: req.t ? req.t('sampleFiles.sampleMismatch') : 'Arquivo não está vinculado a esta amostra'
        });
      }

      if (!sample) {
        return res.status(404).json({
          success: false,
          error: req.t ? req.t('samples.sampleNotFound') : 'Amostra não encontrada'
        });
      }

      // #625: mirrors sample.routes.js's own out-of-scope 403 pattern.
      if (req.organizationScope && !isRecordInOrganizationScope(sample, req.organizationScope, 'collectionSite')) {
        return res.status(403).json({
          success: false,
          error: req.t ? req.t('samples.accessDenied') : 'Acesso negado',
          message: 'Esta amostra pertence a outra organização'
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
          resourceType: 'SampleFile',
          resourceId: fileID,
          status: 'success',
          severity: 'info',
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
