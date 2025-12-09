const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const logger = require('../utils/logger');
const SampleTypeModel = require('../models/SampleType');
const { generateUniqueSampleTypeID } = require('../utils/sampleTypeIDGenerator');

// CRUD de Sample Types
router.get('/', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const sampleTypeCollection = db.collection('sampleTypes');
    const sampleTypes = await sampleTypeCollection.find({}).toArray();

    return res.status(200).json({
      success: true,
      data: sampleTypes
    });
  } catch (error) {
    logger.error('Erro ao listar tipos de amostra:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar tipos de amostra',
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

    const validation = SampleTypeModel.validate(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Dados inválidos',
        message: validation.errors.join(', ')
      });
    }

    const sampleTypeData = { ...req.body };
    const sampleTypeCollection = db.collection('sampleTypes');
    
    if (!sampleTypeData.sampleTypeID) {
      sampleTypeData.sampleTypeID = await generateUniqueSampleTypeID(db, 'sampleTypes');
      logger.info(`SampleTypeID gerado automaticamente: ${sampleTypeData.sampleTypeID}`);
    } else {
      const existing = await sampleTypeCollection.findOne({ sampleTypeID: sampleTypeData.sampleTypeID });
      if (existing) {
        return res.status(400).json({
          success: false,
          error: 'Já existe um tipo de amostra com este ID',
          message: `O sampleTypeID ${sampleTypeData.sampleTypeID} já está em uso`
        });
      }
    }
    
    const sampleType = SampleTypeModel.create(sampleTypeData);
    const result = await sampleTypeCollection.insertOne(sampleType);

    return res.status(201).json({
      success: true,
      message: 'Tipo de amostra criado com sucesso',
      data: { _id: result.insertedId, ...sampleType }
    });
  } catch (error) {
    logger.error('Erro ao criar tipo de amostra:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao criar tipo de amostra',
      message: error.message
    });
  }
});

module.exports = router;

