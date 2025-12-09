const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const logger = require('../utils/logger');
const QualityDescriptionModel = require('../models/QualityDescription');
const { generateUniqueQualityID } = require('../utils/qualityIDGenerator');

// CRUD de Quality Descriptions
router.get('/', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const qualityCollection = db.collection('qualityDescriptions');
    const qualities = await qualityCollection.find({}).toArray();

    return res.status(200).json({
      success: true,
      data: qualities
    });
  } catch (error) {
    logger.error('Erro ao listar descrições de qualidade:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar descrições de qualidade',
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

    const qualityID = parseInt(req.params.id);
    const qualityCollection = db.collection('qualityDescriptions');
    const quality = await qualityCollection.findOne({ qualityID });

    if (!quality) {
      return res.status(404).json({
        success: false,
        error: 'Descrição de qualidade não encontrada'
      });
    }

    return res.status(200).json({
      success: true,
      data: quality
    });
  } catch (error) {
    logger.error('Erro ao buscar descrição de qualidade:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar descrição de qualidade',
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

    const validation = QualityDescriptionModel.validate(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Dados inválidos',
        message: validation.errors.join(', ')
      });
    }

    // Prepara os dados
    const qualityData = { ...req.body };
    const qualityCollection = db.collection('qualityDescriptions');
    
    // Gera qualityID automaticamente se não fornecido
    if (!qualityData.qualityID) {
      qualityData.qualityID = await generateUniqueQualityID(db, 'qualityDescriptions');
      logger.info(`QualityID gerado automaticamente: ${qualityData.qualityID}`);
    } else {
      // Verifica se o qualityID fornecido já existe
      const existing = await qualityCollection.findOne({ qualityID: qualityData.qualityID });
      if (existing) {
        return res.status(400).json({
          success: false,
          error: 'Já existe uma descrição de qualidade com este ID',
          message: `O qualityID ${qualityData.qualityID} já está em uso`
        });
      }
    }
    const quality = QualityDescriptionModel.create(qualityData);

    const result = await qualityCollection.insertOne(quality);

    return res.status(201).json({
      success: true,
      message: 'Descrição de qualidade criada com sucesso',
      data: { _id: result.insertedId, ...quality }
    });
  } catch (error) {
    logger.error('Erro ao criar descrição de qualidade:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao criar descrição de qualidade',
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

    const qualityID = parseInt(req.params.id);
    const qualityCollection = db.collection('qualityDescriptions');
    req.body.updatedAt = new Date();

    const result = await qualityCollection.updateOne(
      { qualityID },
      { $set: req.body }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Descrição de qualidade não encontrada'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Descrição de qualidade atualizada com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao atualizar descrição de qualidade:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao atualizar descrição de qualidade',
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

    const qualityID = parseInt(req.params.id);
    const qualityCollection = db.collection('qualityDescriptions');
    const result = await qualityCollection.deleteOne({ qualityID });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Descrição de qualidade não encontrada'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Descrição de qualidade deletada com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao deletar descrição de qualidade:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao deletar descrição de qualidade',
      message: error.message
    });
  }
});

module.exports = router;

