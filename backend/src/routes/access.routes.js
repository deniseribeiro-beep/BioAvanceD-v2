const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const logger = require('../utils/logger');
const AccessModel = require('../models/Access');

// CRUD de Access
router.get('/', authenticate, async (req, res) => {
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

router.get('/:id', authenticate, async (req, res) => {
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
      return res.status(400).json({
        success: false,
        error: 'Dados inválidos',
        message: validation.errors.join(', ')
      });
    }

    const accessCollection = db.collection('access');
    const access = AccessModel.create(req.body);

    const result = await accessCollection.insertOne(access);

    // Registra log de criação de acesso
    const auditLogger = require('../utils/auditLogger');
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
    req.body.updatedAt = new Date();

    const result = await accessCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: req.body }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Acesso não encontrado'
      });
    }

    // Registra log de atualização de acesso
    const auditLogger = require('../utils/auditLogger');
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
    const result = await accessCollection.deleteOne({ _id: new ObjectId(req.params.id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Acesso não encontrado'
      });
    }

    // Registra log de exclusão de acesso
    const auditLogger = require('../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.logDelete(req, 'Access', req.params.id);

    return res.status(200).json({
      success: true,
      message: 'Acesso deletado com sucesso'
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

