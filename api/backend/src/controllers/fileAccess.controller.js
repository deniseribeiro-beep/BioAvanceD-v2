const fs = require('fs');
const { ObjectId } = require('mongodb');
const logger = require('../utils/logger');
const { decryptFileBuffer } = require('../utils/fileCrypto');
const objectStorage = require('../infrastructure/objectStorage');
const { verifyFileAccessToken, FILE_ACCESS_COLLECTIONS } = require('../services/dataFileAccessToken.service');

// RNF029 C5 (#1321): serves one DataFile binary for a file access token the
// download handlers issued after their own checks. The token is the
// credential, so it is never written to an audit row, a log line or an
// error body: a refusal records only its reason and, once the MAC verified,
// the file id and tokenId.
const REFUSAL_BODY = 'Link de download inválido ou expirado';
const DOWNLOAD_ERROR = 'Erro ao fazer download do arquivo';

async function audit(db, req, { action, status, severity, resourceType, resourceId, message, payload }) {
  const auditLogger = require('../utils/auditLogger');
  auditLogger.init(db);
  await auditLogger.log({
    action,
    resourceType,
    resourceId,
    status,
    severity,
    message,
    payload,
    req,
    module: 'Arquivos'
  });
}

function refuse(db, req, reason, verified) {
  const payload = verified ? { reason, tokenId: verified.j } : { reason };
  return audit(db, req, {
    action: 'file_access_token_refused',
    status: 'error',
    severity: 'warning',
    resourceType: verified ? FILE_ACCESS_COLLECTIONS[verified.c] : 'DataFile',
    resourceId: verified ? verified.f : null,
    message: `Token de acesso a arquivo recusado: ${reason}`,
    payload
  });
}

async function readStoredBytes(row) {
  if (row.storageObjectVersion) {
    try {
      return await objectStorage.getFileObjectStore().getObject(row.storageUri);
    } catch (error) {
      if (error && error.code === 'ENOENT') return { missing: true };
      throw error;
    }
  }
  if (!row.storagePath || !fs.existsSync(row.storagePath)) return { missing: true };
  return fs.readFileSync(row.storagePath);
}

async function serveFileByAccessToken(req, res) {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const verification = verifyFileAccessToken(req.query && req.query.token);
    if (!verification.ok) {
      await refuse(db, req, verification.reason, null);
      return res.status(403).json({
        success: false,
        error: REFUSAL_BODY,
        code: verification.reason === 'expired' ? 'FILE_ACCESS_TOKEN_EXPIRED' : 'FILE_ACCESS_TOKEN_INVALID'
      });
    }
    const { payload } = verification;

    const row = await db.collection(payload.c).findOne({ _id: new ObjectId(payload.f) });
    if (!row || row.deletedAt) {
      await refuse(db, req, 'not_found', payload);
      return res.status(404).json({ success: false, error: 'Arquivo não encontrado' });
    }
    if ((row.storageUri || null) !== payload.u) {
      await refuse(db, req, 'superseded', payload);
      return res.status(403).json({ success: false, error: REFUSAL_BODY, code: 'FILE_ACCESS_TOKEN_INVALID' });
    }

    let stored;
    try {
      stored = await readStoredBytes(row);
    } catch (readError) {
      logger.error(`Erro ao ler o objeto do arquivo ${payload.f}:`, readError.code || readError.message);
      return res.status(500).json({ success: false, error: DOWNLOAD_ERROR });
    }
    if (!Buffer.isBuffer(stored)) {
      logger.error(`Arquivo não encontrado no armazenamento: ${payload.f}`);
      return res.status(404).json({ success: false, error: 'Arquivo não encontrado no sistema de arquivos' });
    }

    let outputBuffer = stored;
    if (row.encryptionAlgorithm) {
      try {
        outputBuffer = decryptFileBuffer(stored, row);
      } catch (decryptError) {
        logger.error('Erro ao decifrar arquivo:', decryptError.message);
        return res.status(500).json({ success: false, error: DOWNLOAD_ERROR });
      }
    }

    await audit(db, req, {
      action: 'file_access_token_used',
      status: 'success',
      severity: 'info',
      resourceType: FILE_ACCESS_COLLECTIONS[payload.c],
      resourceId: payload.f,
      message: `Download de arquivo por token de acesso: ${row.fileName}`,
      payload: { tokenId: payload.j }
    });

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${row.fileName}"`);
    return res.send(outputBuffer);
  } catch (error) {
    logger.error('Erro ao servir arquivo por token de acesso:', error.message);
    return res.status(500).json({ success: false, error: DOWNLOAD_ERROR });
  }
}

module.exports = { serveFileByAccessToken };
