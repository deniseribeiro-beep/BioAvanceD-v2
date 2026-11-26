/**
 * G13 — Product legal documents and acceptance (Terms / Privacy).
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole } = require('../../infrastructure/middleware/rbac');
const productLegal = require('../../services/productLegal.service');
const logger = require('../../utils/logger');

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
}

router.get('/status', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados indisponível' });
    }

    await productLegal.ensureIndexes(db);
    await productLegal.seedDefaults(db);

    const users = db.collection('users');
    const { ObjectId } = require('mongodb');
    const user = await users.findOne({ _id: new ObjectId(req.user.userID) });
    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }

    const status = await productLegal.listPendingForUser(db, user, req.user.userID);
    return res.status(200).json({
      success: true,
      data: {
        ...status,
        requiresAcceptance: status.pending.length > 0,
      },
    });
  } catch (error) {
    logger.error('[PRODUCT_LEGAL] status:', error.message);
    return res.status(error.status || 500).json({
      success: false,
      error: error.message || 'Erro ao consultar aceite legal',
    });
  }
});

router.get('/documents/:docType', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    await productLegal.ensureIndexes(db);
    await productLegal.seedDefaults(db);

    const doc = await productLegal.getPublishedDocument(db, req.params.docType);
    if (!doc) {
      return res.status(404).json({ success: false, error: 'Documento não publicado' });
    }

    return res.status(200).json({
      success: true,
      data: {
        docType: doc.docType,
        docVersion: doc.docVersion,
        title: doc.title,
        body: doc.body,
        publishedAt: doc.publishedAt,
      },
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      error: error.message || 'Erro ao ler documento',
    });
  }
});

router.post('/accept', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { docType, docVersion } = req.body || {};
    if (!docType || !docVersion) {
      return res.status(400).json({ success: false, error: 'docType e docVersion são obrigatórios' });
    }

    const users = db.collection('users');
    const { ObjectId } = require('mongodb');
    const user = await users.findOne({ _id: new ObjectId(req.user.userID) });
    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }

    const record = await productLegal.recordAcceptance(db, {
      user,
      userId: req.user.userID,
      docType,
      docVersion,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });

    return res.status(200).json({ success: true, data: record });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      error: error.message || 'Erro ao registrar aceite',
    });
  }
});

router.put('/documents/:docType/publish', authenticate, requireRole(4), async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { docVersion, title, body } = req.body || {};
    const published = await productLegal.publishDocument(db, {
      docType: req.params.docType,
      docVersion,
      title,
      body,
      publishedBy: req.user?.userID || 'admin',
    });
    return res.status(200).json({ success: true, data: published, message: 'Nova versão publicada; usuários deverão reaceitar.' });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      error: error.message || 'Erro ao publicar documento',
    });
  }
});

module.exports = router;