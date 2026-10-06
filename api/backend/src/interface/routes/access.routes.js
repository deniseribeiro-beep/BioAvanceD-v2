const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const logger = require('../../utils/logger');
const AccessModel = require('../../models/Access');

// CRUD de Access
// #1202: the two reads share the writes' permission code, the one GET
// /api/users also reads under; they were authenticate-only before.
router.get('/', authenticate, requirePermission('createUser'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const accessCollection = db.collection('access');
    const access = await accessCollection.find({}).toArray();

    return res.status(200).json({
      success: true,
      data: access
    });
  } catch (error) {
    logger.error('Erro ao listar acessos:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar acessos',
      message: error.message
    });
  }
});

router.get('/:id', authenticate, requirePermission('createUser'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { ObjectId } = require('mongodb');
    const accessCollection = db.collection('access');
    const access = await accessCollection.findOne({ _id: new ObjectId(req.params.id) });

    if (!access) {
      return res.status(404).json({
        success: false,
        error: 'Acesso não encontrado'
      });
    }

    return res.status(200).json({
      success: true,
      data: access
    });
  } catch (error) {
    logger.error('Erro ao buscar acesso:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar acesso',
      message: error.message
    });
  }
});

router.post('/', authenticate, requirePermission('createUser'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const validation = AccessModel.validate(req.body);
    if (!validation.isValid) {
      return res.status(422).json({
        success: false,
        error: 'Dados inválidos',
        message: validation.errors.join(', '),
        details: validation.errors
      });
    }

    const accessCollection = db.collection('access');
    const access = AccessModel.create(req.body, { grantedBy: req.user?.userID || null });

    const result = await accessCollection.insertOne(access);

    // Registra log de criação de acesso
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.logCreate(req, 'Access', result.insertedId.toString());

    return res.status(201).json({
      success: true,
      message: 'Acesso criado com sucesso',
      data: { _id: result.insertedId, ...access }
    });
  } catch (error) {
    logger.error('Erro ao criar acesso:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao criar acesso',
      message: error.message
    });
  }
});

router.put('/:id', authenticate, requirePermission('createUser'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { ObjectId } = require('mongodb');
    const accessCollection = db.collection('access');

    // #875: $set used to be built straight from req.body, letting a caller
    // inject arbitrary keys or overwrite fields like accessID. Allowlist to
    // AccessModel.create()'s own fields; accessID is business identity and
    // is excluded, updatedAt is server-set here (never caller-supplied).
    const ALLOWED_ACCESS_UPDATE_FIELDS = ['reportID', 'reportType', 'accessType', 'userId', 'grantedAt', 'expiresAt'];
    const updateFields = {};
    for (const field of ALLOWED_ACCESS_UPDATE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updateFields[field] = req.body[field];
      }
    }
    if (Object.prototype.hasOwnProperty.call(updateFields, 'reportID')) {
      updateFields.resourceId = updateFields.reportID;
    }
    updateFields.updatedAt = new Date();

    const result = await accessCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Acesso não encontrado'
      });
    }

    // Registra log de atualização de acesso
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.logUpdate(req, 'Access', req.params.id);

    return res.status(200).json({
      success: true,
      message: 'Acesso atualizado com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao atualizar acesso:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao atualizar acesso',
      message: error.message
    });
  }
});

router.delete('/:id', authenticate, requirePermission('createUser'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { ObjectId } = require('mongodb');
    const accessCollection = db.collection('access');
    // #1202: AccessGrant has grantStatus 'revoked' + revokedAt (P1X-0248,
    // P1X-0249), so a revocation is a state change that keeps the grant's
    // history rather than a hard delete. Revoking twice is a 404, as the
    // delete was.
    const now = new Date();
    const reason = typeof req.body?.revocationReason === 'string' && req.body.revocationReason.trim()
      ? req.body.revocationReason.trim()
      : null;
    const result = await accessCollection.updateOne(
      { _id: new ObjectId(req.params.id), grantStatus: { $ne: 'revoked' } },
      { $set: { grantStatus: 'revoked', revokedAt: now, revocationReason: reason, updatedAt: now } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Acesso não encontrado'
      });
    }

    // Registra log de exclusão de acesso
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.logDelete(req, 'Access', req.params.id);

    return res.status(200).json({
      success: true,
      message: 'Acesso revogado com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao deletar acesso:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao deletar acesso',
      message: error.message
    });
  }
});

module.exports = router;

