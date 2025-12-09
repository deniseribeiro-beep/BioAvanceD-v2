const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const logger = require('../utils/logger');
const ExtractionProtocolModel = require('../models/ExtractionProtocol');
const { generateUniqueProtocolID } = require('../utils/protocolIDGenerator');

// CRUD de Extraction Protocols
router.get('/', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const protocolCollection = db.collection('extractionProtocols');
    const protocols = await protocolCollection.find({}).toArray();

    return res.status(200).json({
      success: true,
      data: protocols
    });
  } catch (error) {
    logger.error('Erro ao listar protocolos de extração:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar protocolos de extração',
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

    const validation = ExtractionProtocolModel.validate(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Dados inválidos',
        message: validation.errors.join(', ')
      });
    }

    const protocolData = { ...req.body };
    const protocolCollection = db.collection('extractionProtocols');
    
    if (!protocolData.protocolID) {
      protocolData.protocolID = await generateUniqueProtocolID(db, 'extractionProtocols');
      logger.info(`ProtocolID gerado automaticamente: ${protocolData.protocolID}`);
    } else {
      const existing = await protocolCollection.findOne({ protocolID: protocolData.protocolID });
      if (existing) {
        return res.status(400).json({
          success: false,
          error: 'Já existe um protocolo de extração com este ID',
          message: `O protocolID ${protocolData.protocolID} já está em uso`
        });
      }
    }
    
    const protocol = ExtractionProtocolModel.create(protocolData);
    const result = await protocolCollection.insertOne(protocol);

    return res.status(201).json({
      success: true,
      message: 'Protocolo de extração criado com sucesso',
      data: { _id: result.insertedId, ...protocol }
    });
  } catch (error) {
    logger.error('Erro ao criar protocolo de extração:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao criar protocolo de extração',
      message: error.message
    });
  }
});

module.exports = router;

