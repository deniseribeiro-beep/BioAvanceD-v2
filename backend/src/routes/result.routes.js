const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const logger = require('../utils/logger');
const ResultModel = require('../models/Result');

// CRUD de Resultados
router.get('/', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const resultsCollection = db.collection('results');
    const query = {};

    if (req.query.importJobID) {
      query.importJobID = req.query.importJobID;
    }

    const results = await resultsCollection.find(query).toArray();

    // Registra log de consulta
    const auditLogger = require('../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      entity: 'Result',
      result: 'success',
      severity: 'info',
      message: `Consulta de resultados - ${results.length} registros`,
      payload: { total: results.length, filters: query },
      req: req,
      module: 'Resultados'
    });

    return res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    logger.error('Erro ao listar resultados:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar resultados',
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
    const resultsCollection = db.collection('results');
    const result = await resultsCollection.findOne({ _id: new ObjectId(req.params.id) });

    if (!result) {
      // Registra tentativa de busca de resultado inexistente
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'QUERY',
        entity: 'Result',
        result: 'error',
        severity: 'warning',
        message: `Tentativa de buscar resultado inexistente: ${req.params.id}`,
        req: req,
        module: 'Resultados'
      });
      
      return res.status(404).json({
        success: false,
        error: 'Resultado não encontrado'
      });
    }

    // Registra log de busca
    const auditLogger = require('../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      entity: 'Result',
      entityID: req.params.id,
      result: 'success',
      severity: 'info',
      message: 'Resultado consultado',
      req: req,
      module: 'Resultados'
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Erro ao buscar resultado:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar resultado',
      message: error.message
    });
  }
});

router.get('/:id/download', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { ObjectId } = require('mongodb');
    const resultsCollection = db.collection('results');
    const result = await resultsCollection.findOne({ _id: new ObjectId(req.params.id) });

    if (!result) {
      // Registra tentativa de download de resultado inexistente
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'DOWNLOAD',
        entity: 'Result',
        result: 'error',
        severity: 'warning',
        message: `Tentativa de download de resultado inexistente: ${req.params.id}`,
        req: req,
        module: 'Resultados'
      });
      
      return res.status(404).json({
        success: false,
        error: 'Resultado não encontrado'
      });
    }

    // Registra log de download
    const auditLogger = require('../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'DOWNLOAD',
      entity: 'Result',
      entityID: req.params.id,
      result: 'success',
      severity: 'info',
      message: 'Download de resultado solicitado',
      req: req,
      module: 'Resultados'
    });

    // Se for URL externa, redireciona
    if (result.filePath && result.filePath.startsWith('http')) {
      return res.status(200).json({
        redirect: true,
        url: result.filePath
      });
    }

    // Se for arquivo local, retorna erro (não implementado ainda)
    return res.status(501).json({
      success: false,
      error: 'Download de arquivo local não implementado',
      message: 'Use a URL externa fornecida no resultado'
    });
  } catch (error) {
    logger.error('Erro ao fazer download:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao fazer download',
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

    const validation = ResultModel.validate(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Dados inválidos',
        message: validation.errors.join(', ')
      });
    }

    const resultsCollection = db.collection('results');
    const result = ResultModel.create(req.body);

    const insertResult = await resultsCollection.insertOne(result);

    // Registra log de criação
    if (req.user) {
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'CREATE',
        entity: 'Result',
        entityID: insertResult.insertedId.toString(),
        result: 'success',
        severity: 'info',
        message: 'Resultado criado',
        payload: { sampleID: result.sampleID || null },
        req: req,
        module: 'Resultados'
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Resultado criado com sucesso',
      data: { _id: insertResult.insertedId, ...result }
    });
  } catch (error) {
    logger.error('Erro ao criar resultado:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao criar resultado',
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

    const { ObjectId } = require('mongodb');
    const resultsCollection = db.collection('results');
    req.body.updatedAt = new Date();

    const result = await resultsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: req.body }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Resultado não encontrado'
      });
    }

    // Registra log de atualização
    if (req.user) {
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'UPDATE',
        entity: 'Result',
        entityID: req.params.id,
        result: 'success',
        severity: 'info',
        message: 'Resultado atualizado',
        req: req,
        module: 'Resultados'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Resultado atualizado com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao atualizar resultado:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao atualizar resultado',
      message: error.message
    });
  }
});

router.put('/:id/link-sample', authenticate, requirePermission('createPatient'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { sampleID } = req.body;
    if (!sampleID) {
      return res.status(400).json({
        success: false,
        error: 'sampleID é obrigatório'
      });
    }

    const { ObjectId } = require('mongodb');
    const resultsCollection = db.collection('results');

    const result = await resultsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { sampleID, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Resultado não encontrado'
      });
    }

    // Registra log de vinculação
    if (req.user) {
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'UPDATE',
        entity: 'Result',
        entityID: req.params.id,
        result: 'success',
        severity: 'info',
        message: `Resultado vinculado à amostra: ${sampleID}`,
        payload: { sampleID },
        req: req,
        module: 'Resultados'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Resultado vinculado à amostra com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao vincular resultado:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao vincular resultado',
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

    const { ObjectId } = require('mongodb');
    const resultsCollection = db.collection('results');
    const result = await resultsCollection.deleteOne({ _id: new ObjectId(req.params.id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Resultado não encontrado'
      });
    }

    // Registra log de deleção
    if (req.user) {
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'DELETE',
        entity: 'Result',
        entityID: req.params.id,
        result: 'success',
        severity: 'warning',
        message: 'Resultado deletado',
        req: req,
        module: 'Resultados'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Resultado deletado com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao deletar resultado:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao deletar resultado',
      message: error.message
    });
  }
});

module.exports = router;

