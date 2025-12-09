const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const logger = require('../utils/logger');
const MeasurementUnitModel = require('../models/MeasurementUnit');

// CRUD de Measurement Units
router.get('/', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const unitsCollection = db.collection('measurementUnits');
    const units = await unitsCollection.find({}).toArray();

    return res.status(200).json({
      success: true,
      data: units
    });
  } catch (error) {
    logger.error('Erro ao listar unidades de medida:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar unidades de medida',
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

    const unitID = parseInt(req.params.id);
    const unitsCollection = db.collection('measurementUnits');
    const unit = await unitsCollection.findOne({ unitID });

    if (!unit) {
      return res.status(404).json({
        success: false,
        error: 'Unidade de medida não encontrada'
      });
    }

    return res.status(200).json({
      success: true,
      data: unit
    });
  } catch (error) {
    logger.error('Erro ao buscar unidade de medida:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar unidade de medida',
      message: error.message
    });
  }
});

router.post('/', authenticate, requirePermission('createPatient'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const validation = MeasurementUnitModel.validate(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Dados inválidos',
        message: validation.errors.join(', ')
      });
    }

    const unitsCollection = db.collection('measurementUnits');
    const unit = MeasurementUnitModel.create(req.body);

    const result = await unitsCollection.insertOne(unit);

    return res.status(201).json({
      success: true,
      message: 'Unidade de medida criada com sucesso',
      data: { _id: result.insertedId, ...unit }
    });
  } catch (error) {
    logger.error('Erro ao criar unidade de medida:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao criar unidade de medida',
      message: error.message
    });
  }
});

router.put('/:id', authenticate, requirePermission('createPatient'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const unitID = parseInt(req.params.id);
    const unitsCollection = db.collection('measurementUnits');
    req.body.updatedAt = new Date();

    const result = await unitsCollection.updateOne(
      { unitID },
      { $set: req.body }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Unidade de medida não encontrada'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Unidade de medida atualizada com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao atualizar unidade de medida:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao atualizar unidade de medida',
      message: error.message
    });
  }
});

router.delete('/:id', authenticate, requirePermission('createPatient'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const unitID = parseInt(req.params.id);
    const unitsCollection = db.collection('measurementUnits');
    const result = await unitsCollection.deleteOne({ unitID });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Unidade de medida não encontrada'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Unidade de medida deletada com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao deletar unidade de medida:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao deletar unidade de medida',
      message: error.message
    });
  }
});

module.exports = router;

