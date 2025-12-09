const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const logger = require('../utils/logger');
const SampleOriginModel = require('../models/SampleOrigin');
const { generateUniqueOriginID } = require('../utils/originIDGenerator');

// CRUD de Sample Origins
router.get('/', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const originCollection = db.collection('sampleOrigins');
    const origins = await originCollection.find({}).toArray();

    return res.status(200).json({
      success: true,
      data: origins
    });
  } catch (error) {
    logger.error('Erro ao listar origens de amostra:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar origens de amostra',
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

    const validation = SampleOriginModel.validate(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Dados inválidos',
        message: validation.errors.join(', ')
      });
    }

    const originData = { ...req.body };
    const originCollection = db.collection('sampleOrigins');
    
    if (!originData.originID) {
      originData.originID = await generateUniqueOriginID(db, 'sampleOrigins');
      logger.info(`OriginID gerado automaticamente: ${originData.originID}`);
    } else {
      const existing = await originCollection.findOne({ originID: originData.originID });
      if (existing) {
        return res.status(400).json({
          success: false,
          error: 'Já existe uma origem de amostra com este ID',
          message: `O originID ${originData.originID} já está em uso`
        });
      }
    }
    
    const origin = SampleOriginModel.create(originData);
    const result = await originCollection.insertOne(origin);

    return res.status(201).json({
      success: true,
      message: 'Origem de amostra criada com sucesso',
      data: { _id: result.insertedId, ...origin }
    });
  } catch (error) {
    logger.error('Erro ao criar origem de amostra:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao criar origem de amostra',
      message: error.message
    });
  }
});

module.exports = router;

