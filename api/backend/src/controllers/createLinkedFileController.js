const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const logger = require('../utils/logger');
const { getUserAnonId } = require('../utils/userAnonymization');
const { encryptFileBuffer, decryptFileBuffer, computeChecksum, assertFileEncryptionConfigured } = require('../utils/fileCrypto');
const { STORAGE_BASE } = require('../config/uploadConfig');

// #643 (RF007 AC#6/gate F3-G05): generalizes sample-file.controller.js's
// upload/list/download/delete/replace + checksum/encryption/audit shape to
// entities other than Sample -- Assay and Dataset don't share Sample's
// numeric-legacy-id fallback or SampleFileModel's HL7-specific fields, so
// this is a fresh, parameterized implementation rather than a literal reuse
// of SampleFileController, sharing only the crypto primitives (fileCrypto.js)
// and the audit-logging shape. Export (HL7/FHIR/CDA) is deliberately not
// included -- those are lab-result-specific formats #643's own scope never
// named for Assay/Dataset scientific files.
const ALLOWED_EXTENSIONS = [
  '.raw', '.zip', '.csv', '.tsv', '.xls', '.xlsx', '.pdf', '.txt', '.json',
  '.fastq', '.fastq.gz', '.bam', '.sam', '.vcf', '.vcf.gz', '.h5'
];

function extensionOf(fileName) {
  const lower = String(fileName || '').toLowerCase();
  return ALLOWED_EXTENSIONS.find((ext) => lower.endsWith(ext)) || null;
}

function buildParentIdQuery(parentIdField, rawId) {
  return {
    $or: [
      ...(ObjectId.isValid(rawId) ? [{ _id: new ObjectId(rawId) }] : []),
      { [parentIdField]: rawId }
    ]
  };
}

/**
 * @param {object} opts
 * @param {string} opts.parentCollectionName - e.g. 'assays'
 * @param {string} opts.parentIdParam - route param name, e.g. 'assayId'
 * @param {string} opts.parentIdField - the parent document's own id field, e.g. 'assayId'
 * @param {string} opts.fileCollectionName - e.g. 'assayFiles'
 * @param {string} opts.storageSubdir - e.g. 'assays' -> storage/<storageSubdir>/<parentId>/files/
 * @param {string} opts.resourceType - audit resourceType, e.g. 'AssayFile'
 * @param {string} opts.moduleLabel - audit module label, e.g. 'Ensaios'
 * @param {(parentDoc: object, req: import('express').Request) => Promise<boolean>} [opts.checkOrgScope]
 *   Optional: resolve+check organization scope against the parent document.
 *   Returns true if allowed. Omit when the parent entity has no
 *   organization concept (e.g. Dataset).
 */
function createLinkedFileController(opts) {
  const {
    parentCollectionName,
    parentIdParam,
    parentIdField,
    fileCollectionName,
    storageSubdir,
    resourceType,
    moduleLabel,
    checkOrgScope
  } = opts;

  const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        const parentId = req.params[parentIdParam];
        if (!parentId) {
          return cb(new Error(`${parentIdParam} é obrigatório`), null);
        }

        const dir = path.join(STORAGE_BASE, storageSubdir, String(parentId), 'files');
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (error) {
        cb(error, null);
      }
    },
    filename: (req, file, cb) => {
      const uniqueId = crypto.randomBytes(16).toString('hex');
      const sanitizedName = String(file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${sanitizedName}____${uniqueId}${path.extname(sanitizedName)}`);
    }
  });

  const fileFilter = (req, file, cb) => {
    if (extensionOf(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error(`Formato de arquivo inválido. Permitidos: ${ALLOWED_EXTENSIONS.join(', ')}`), false);
    }
  };

  const upload = multer({ storage, fileFilter, limits: { fileSize: 500 * 1024 * 1024 } });

  function uploadMiddleware() {
    const handler = upload.single('file');
    return (req, res, next) => {
      handler(req, res, (err) => {
        if (err) {
          return res.status(400).json({ success: false, error: err.message || 'Erro ao processar upload do arquivo' });
        }
        next();
      });
    };
  }

  async function findParent(db, rawId) {
    const collection = db.collection(parentCollectionName);
    return collection.findOne(buildParentIdQuery(parentIdField, rawId));
  }

  function cleanupUploadedFile(req) {
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        logger.error('Erro ao remover arquivo temporário:', unlinkError.message);
      }
    }
  }

  async function logAudit(db, req, { action, resourceId, severity, message, payload }) {
    if (!req.user) return;
    const auditLogger = require('../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action,
      resourceType,
      resourceId,
      status: 'success',
      severity: severity || 'info',
      message,
      payload,
      req,
      module: moduleLabel
    });
  }

  async function uploadFile(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const parentId = req.params[parentIdParam];
      const file = req.file;
      if (!file) {
        return res.status(400).json({ success: false, error: 'Arquivo não fornecido' });
      }

      const parent = await findParent(db, String(parentId));
      if (!parent) {
        cleanupUploadedFile(req);
        return res.status(404).json({ success: false, error: `${parentIdParam} não encontrado` });
      }

      if (checkOrgScope && req.organizationScope) {
        const allowed = await checkOrgScope(parent, req);
        if (!allowed) {
          cleanupUploadedFile(req);
          return res.status(403).json({ success: false, error: 'Acesso negado', message: 'Este registro pertence a outra organização' });
        }
      }

      const fileType = (extensionOf(file.originalname) || '').replace(/^\./, '').toUpperCase();

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
      const parentIdValue = parent[parentIdField] || parentId;
      const storageUri = `objstore://${storageSubdir}/${parentIdValue}/files/${path.basename(file.path)}`;
      const uploaderAnonId = await getUserAnonId(req.user, db);

      const fileDoc = {
        [parentIdField]: parentIdValue,
        fileName: file.originalname,
        fileType,
        fileSize: file.size,
        storagePath: file.path,
        storageUri,
        checksum,
        checksumAlgorithm: 'sha256',
        encryptionAlgorithm: encryption ? encryption.algorithm : null,
        encryptionKeyId: encryption ? encryption.keyId : null,
        encryptionIv: encryption ? encryption.iv : null,
        encryptionTag: encryption ? encryption.tag : null,
        accessPolicy: { view: 'authenticated', manage: ['administrator', 'coordinator'] },
        uploaderAnonId,
        uploadDate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const collection = db.collection(fileCollectionName);
      const insertResult = await collection.insertOne(fileDoc);

      await logAudit(db, req, {
        action: 'file_upload',
        resourceId: insertResult.insertedId.toString(),
        message: `Upload de arquivo: ${file.originalname} (${(file.size / 1024).toFixed(2)} KB)`,
        payload: { fileName: file.originalname, fileSize: file.size, fileType, [parentIdField]: parentIdValue, checksum, checksumAlgorithm: 'sha256' }
      });

      return res.status(201).json({
        success: true,
        message: 'Arquivo enviado com sucesso',
        data: {
          _id: insertResult.insertedId,
          [parentIdField]: parentIdValue,
          fileName: fileDoc.fileName,
          fileType: fileDoc.fileType,
          fileSize: fileDoc.fileSize,
          uploaderAnonId: fileDoc.uploaderAnonId,
          uploadDate: fileDoc.uploadDate,
          uri: fileDoc.storageUri,
          checksum: fileDoc.checksum,
          checksumAlgorithm: fileDoc.checksumAlgorithm,
          encryption: { encrypted: Boolean(fileDoc.encryptionAlgorithm), algorithm: fileDoc.encryptionAlgorithm },
          accessPolicy: fileDoc.accessPolicy
        }
      });
    } catch (error) {
      logger.error('Erro ao fazer upload de arquivo:', error.message);
      cleanupUploadedFile(req);
      // #938: a missing ENCRYPTION_KEY is a 500 (server misconfiguration),
      // not the uploader's fault. Everything else keeps its 400.
      return res.status(error?.statusCode || 400).json({ success: false, error: 'Erro ao fazer upload de arquivo', message: error.message });
    }
  }

  async function listFiles(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const parentId = req.params[parentIdParam];
      const parent = await findParent(db, String(parentId));
      if (!parent) {
        return res.status(404).json({ success: false, error: `${parentIdParam} não encontrado` });
      }

      if (checkOrgScope && req.organizationScope) {
        const allowed = await checkOrgScope(parent, req);
        if (!allowed) {
          return res.status(403).json({ success: false, error: 'Acesso negado', message: 'Este registro pertence a outra organização' });
        }
      }

      const parentIdValue = parent[parentIdField] || parentId;
      const collection = db.collection(fileCollectionName);
      const files = await collection.find({ [parentIdField]: parentIdValue }).toArray();

      const sanitized = files.map((file) => ({
        _id: file._id,
        [parentIdField]: file[parentIdField],
        fileName: file.fileName,
        fileType: file.fileType,
        fileSize: file.fileSize,
        uri: file.storageUri,
        checksum: file.checksum,
        checksumAlgorithm: file.checksumAlgorithm,
        encryption: { encrypted: Boolean(file.encryptionAlgorithm), algorithm: file.encryptionAlgorithm },
        accessPolicy: file.accessPolicy,
        uploaderAnonId: file.uploaderAnonId,
        uploadDate: file.uploadDate,
        createdAt: file.createdAt
      }));

      await logAudit(db, req, {
        action: 'QUERY',
        message: `Consulta de arquivos - ${parentIdParam}: ${parentIdValue}, Total: ${files.length}`,
        payload: { [parentIdField]: parentIdValue, filesCount: files.length }
      });

      return res.status(200).json({ success: true, data: sanitized });
    } catch (error) {
      logger.error('Erro ao listar arquivos:', error.message);
      return res.status(500).json({ success: false, error: 'Erro ao listar arquivos', message: error.message });
    }
  }

  async function findFileAndCheckLink(db, req, res) {
    const parentId = req.params[parentIdParam];
    const { fileID } = req.params;

    const collection = db.collection(fileCollectionName);
    let fileRecord;
    try {
      fileRecord = await collection.findOne({ _id: new ObjectId(fileID) });
    } catch (idError) {
      res.status(400).json({ success: false, error: 'ID de arquivo inválido' });
      return null;
    }

    if (!fileRecord) {
      res.status(404).json({ success: false, error: 'Arquivo não encontrado' });
      return null;
    }

    const parent = await findParent(db, String(parentId));
    const parentIdValue = parent ? (parent[parentIdField] || parentId) : String(parentId);

    if (String(fileRecord[parentIdField]) !== String(parentIdValue)) {
      res.status(403).json({ success: false, error: `Arquivo não pertence a este ${parentIdParam}` });
      return null;
    }

    if (checkOrgScope && req.organizationScope && parent) {
      const allowed = await checkOrgScope(parent, req);
      if (!allowed) {
        res.status(403).json({ success: false, error: 'Acesso negado', message: 'Este registro pertence a outra organização' });
        return null;
      }
    }

    return { fileRecord, collection, parentIdValue };
  }

  async function downloadFile(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const linked = await findFileAndCheckLink(db, req, res);
      if (!linked) return;
      const { fileRecord } = linked;

      if (!fs.existsSync(fileRecord.storagePath)) {
        logger.error(`Arquivo não encontrado no sistema de arquivos: ${fileRecord.storagePath}`);
        return res.status(404).json({ success: false, error: 'Arquivo não encontrado no sistema de arquivos' });
      }

      await logAudit(db, req, {
        action: 'file_download',
        resourceId: fileRecord._id.toString(),
        message: `Download de arquivo: ${fileRecord.fileName}`,
        payload: { fileName: fileRecord.fileName, fileType: fileRecord.fileType, fileSize: fileRecord.fileSize, [parentIdField]: linked.parentIdValue }
      });

      let outputBuffer;
      if (fileRecord.encryptionAlgorithm) {
        const ciphertext = fs.readFileSync(fileRecord.storagePath);
        try {
          outputBuffer = decryptFileBuffer(ciphertext, fileRecord);
        } catch (decryptError) {
          logger.error('Erro ao decifrar arquivo:', decryptError.message);
          return res.status(500).json({ success: false, error: 'Erro ao fazer download do arquivo' });
        }
      } else {
        outputBuffer = fs.readFileSync(fileRecord.storagePath);
      }

      res.setHeader('Content-Disposition', `attachment; filename="${fileRecord.fileName}"`);
      return res.send(outputBuffer);
    } catch (error) {
      logger.error('Erro ao fazer download de arquivo:', error.message);
      return res.status(500).json({ success: false, error: 'Erro ao fazer download de arquivo', message: error.message });
    }
  }

  async function deleteFile(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const linked = await findFileAndCheckLink(db, req, res);
      if (!linked) return;
      const { fileRecord, collection } = linked;

      if (fs.existsSync(fileRecord.storagePath)) {
        try {
          fs.unlinkSync(fileRecord.storagePath);
        } catch (unlinkError) {
          logger.error('Erro ao remover arquivo físico:', unlinkError.message);
        }
      }

      await collection.deleteOne({ _id: fileRecord._id });

      await logAudit(db, req, {
        action: 'file_delete',
        resourceId: fileRecord._id.toString(),
        severity: 'critical',
        message: `Arquivo excluído: ${fileRecord.fileName}`,
        payload: { fileName: fileRecord.fileName, fileType: fileRecord.fileType, fileSize: fileRecord.fileSize, [parentIdField]: linked.parentIdValue }
      });

      return res.status(200).json({ success: true, message: 'Arquivo excluído com sucesso' });
    } catch (error) {
      logger.error('Erro ao deletar arquivo:', error.message);
      return res.status(500).json({ success: false, error: 'Erro ao deletar arquivo', message: error.message });
    }
  }

  async function replaceFile(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({ success: false, error: 'Arquivo não fornecido' });
      }

      const linked = await findFileAndCheckLink(db, req, res);
      if (!linked) {
        cleanupUploadedFile(req);
        return;
      }
      const { fileRecord, collection, parentIdValue } = linked;

      const fileType = (extensionOf(file.originalname) || '').replace(/^\./, '').toUpperCase();
      if (!fileType) {
        cleanupUploadedFile(req);
        return res.status(400).json({ success: false, error: 'Tipo de arquivo inválido' });
      }

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
      const storageUri = `objstore://${storageSubdir}/${parentIdValue}/files/${path.basename(file.path)}`;

      const updatedFields = {
        fileName: file.originalname,
        fileType,
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

      const previousStoragePath = fileRecord.storagePath;
      if (previousStoragePath && previousStoragePath !== file.path && fs.existsSync(previousStoragePath)) {
        try {
          fs.unlinkSync(previousStoragePath);
        } catch (unlinkError) {
          logger.error('Erro ao remover arquivo anterior após substituição:', unlinkError.message);
        }
      }

      await collection.updateOne({ _id: fileRecord._id }, { $set: updatedFields });

      await logAudit(db, req, {
        action: 'file_replace',
        resourceId: fileRecord._id.toString(),
        severity: 'warning',
        message: `Substituição de arquivo: ${fileRecord.fileName} -> ${file.originalname}`,
        payload: {
          previousFileName: fileRecord.fileName,
          previousChecksum: fileRecord.checksum,
          fileName: file.originalname,
          fileSize: file.size,
          fileType,
          [parentIdField]: parentIdValue,
          checksum,
          checksumAlgorithm: 'sha256'
        }
      });

      return res.status(200).json({
        success: true,
        message: 'Arquivo substituído com sucesso',
        data: {
          _id: fileRecord._id,
          [parentIdField]: parentIdValue,
          fileName: updatedFields.fileName,
          fileType: updatedFields.fileType,
          fileSize: updatedFields.fileSize,
          uploaderAnonId: fileRecord.uploaderAnonId,
          uploadDate: fileRecord.uploadDate,
          uri: updatedFields.storageUri,
          checksum: updatedFields.checksum,
          checksumAlgorithm: updatedFields.checksumAlgorithm,
          encryption: { encrypted: Boolean(updatedFields.encryptionAlgorithm), algorithm: updatedFields.encryptionAlgorithm },
          accessPolicy: fileRecord.accessPolicy
        }
      });
    } catch (error) {
      logger.error('Erro ao substituir arquivo:', error.message);
      cleanupUploadedFile(req);
      // #938: as above.
      return res.status(error?.statusCode || 400).json({ success: false, error: 'Erro ao substituir arquivo', message: error.message });
    }
  }

  return { uploadMiddleware, uploadFile, listFiles, downloadFile, deleteFile, replaceFile };
}

module.exports = createLinkedFileController;
