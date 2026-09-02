const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const logger = require('../../utils/logger');
const PolicyModel = require('../../models/Policy');

// CRUD de Políticas de Temperatura
router.get('/', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const policiesCollection = db.collection('policies');
    const policies = await policiesCollection.find({}).toArray();

    return res.status(200).json({
      success: true,
      data: policies
    });
  } catch (error) {
    logger.error('Erro ao listar políticas:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar políticas',
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

    const policiesCollection = db.collection('policies');
    // Tenta encontrar por policyId primeiro (busca numérica), depois por _id (MongoDB ObjectId)
    const { ObjectId } = require('mongodb');
    const id = req.params.id;
    const numId = parseInt(id, 10);
    
    let policy;
    if (!isNaN(numId)) {
      // Se é um número, busca por policyId
      policy = await policiesCollection.findOne({ policyId: numId });
    }
    
    if (!policy && ObjectId.isValid(id)) {
      // Se não encontrou e o id é um ObjectId válido, busca por _id
      policy = await policiesCollection.findOne({ _id: new ObjectId(id) });
    }

    if (!policy) {
      return res.status(404).json({
        success: false,
        error: 'Política não encontrada'
      });
    }

    return res.status(200).json({
      success: true,
      data: policy
    });
  } catch (error) {
    logger.error('Erro ao buscar política:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar política',
      message: error.message
    });
  }
});

router.get('/:id/active-limit', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const policiesCollection = db.collection('policies');
    // Tenta encontrar por policyId primeiro (busca numérica), depois por _id (MongoDB ObjectId)
    const { ObjectId } = require('mongodb');
    const id = req.params.id;
    const numId = parseInt(id, 10);
    
    let policy;
    if (!isNaN(numId)) {
      // Se é um número, busca por policyId
      policy = await policiesCollection.findOne({ policyId: numId });
    }
    
    if (!policy && ObjectId.isValid(id)) {
      // Se não encontrou e o id é um ObjectId válido, busca por _id
      policy = await policiesCollection.findOne({ _id: new ObjectId(id) });
    }

    if (!policy) {
      return res.status(404).json({
        success: false,
        error: 'Política não encontrada'
      });
    }

    const isMax = req.query.type === 'max';
    const limit = isMax ? policy.maxThreshold : policy.minThreshold;

    return res.status(200).json({
      success: true,
      data: {
        limit,
        type: isMax ? 'max' : 'min',
        unit: policy.temperatureUnit || 'C'
      }
    });
  } catch (error) {
    logger.error('Erro ao buscar limite ativo:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar limite ativo',
      message: error.message
    });
  }
});

router.post('/', authenticate, requirePermission('viewTemperature'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const validation = PolicyModel.validate(req.body);
    if (!validation.isValid) {
      return res.status(422).json({
        success: false,
        error: 'Dados inválidos',
        message: validation.errors.join(', ')
      });
    }

    const policiesCollection = db.collection('policies');
    const policy = PolicyModel.create(req.body);

    const result = await policiesCollection.insertOne(policy);

    return res.status(201).json({
      success: true,
      message: 'Política criada com sucesso',
      data: { _id: result.insertedId, ...policy }
    });
  } catch (error) {
    logger.error('Erro ao criar política:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao criar política',
      message: error.message
    });
  }
});

router.put('/:id', authenticate, requirePermission('viewTemperature'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { ObjectId } = require('mongodb');
    const policiesCollection = db.collection('policies');

    // #875: $set used to be built straight from req.body, letting a caller
    // inject arbitrary keys or overwrite fields like policyId/policyID.
    // Allowlist to PolicyModel.create()'s own fields; policyId/policyID is
    // business identity and is excluded, updatedAt is server-set here
    // (never caller-supplied).
    const ALLOWED_POLICY_UPDATE_FIELDS = [
      'minThreshold', 'maxThreshold', 'targetTemperature', 'hysteresis',
      'alertDelayMin', 'temperatureUnit', 'validFrom', 'validTo'
    ];
    const updateFields = {};
    for (const field of ALLOWED_POLICY_UPDATE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updateFields[field] = req.body[field];
      }
    }
    updateFields.updatedAt = new Date();

    const result = await policiesCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Política não encontrada'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Política atualizada com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao atualizar política:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao atualizar política',
      message: error.message
    });
  }
});

router.delete('/:id', authenticate, requirePermission('viewTemperature'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { ObjectId } = require('mongodb');
    const policiesCollection = db.collection('policies');
    const result = await policiesCollection.deleteOne({ _id: new ObjectId(req.params.id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Política não encontrada'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Política deletada com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao deletar política:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao deletar política',
      message: error.message
    });
  }
});

module.exports = router;

