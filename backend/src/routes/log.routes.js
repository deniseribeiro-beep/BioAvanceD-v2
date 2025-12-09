const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const logService = require('../services/log.service');
const logger = require('../utils/logger');
const { serializeLogSimple } = require('../utils/logSerializer');

// Listar todos os logs
router.get('/all', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const result = await logService.getLogs(db, req.query);

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Erro ao listar logs:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar logs',
      message: error.message
    });
  }
});

// Buscar logs com filtros (GET)
router.get('/', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const result = await logService.getLogs(db, req.query);

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Erro ao buscar logs:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar logs',
      message: error.message
    });
  }
});

// Buscar log por ID
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
    const logsCollection = db.collection('logs');
    const log = await logsCollection.findOne({ _id: new ObjectId(req.params.id) });

    if (!log) {
      return res.status(404).json({
        success: false,
        error: 'Log não encontrado'
      });
    }

    // Aplica anonimização LGPD
    const { anonymizeLogUser } = require('../utils/userAnonymization');
    const anonymizedLog = await anonymizeLogUser(log, db);

    // Serializa o log para converter tipos especiais do MongoDB
    const serializedLog = serializeLogSimple(anonymizedLog);

    return res.status(200).json({
      success: true,
      data: serializedLog
    });
  } catch (error) {
    logger.error('Erro ao buscar log:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar log',
      message: error.message
    });
  }
});

// Query de logs (POST com body)
router.post('/query', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const result = await logService.getLogs(db, req.body);

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Erro ao consultar logs:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao consultar logs',
      message: error.message
    });
  }
});

// Registrar evento
router.post('/register', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const log = await logService.createLog(db, req.body, req);

    return res.status(201).json({
      success: true,
      message: 'Log registrado com sucesso',
      data: log
    });
  } catch (error) {
    logger.error('Erro ao registrar log:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao registrar log',
      message: error.message
    });
  }
});

// Exportar logs para CSV
router.get('/export/csv', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const csvContent = await logService.exportLogsToCSV(db, req.query);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="logs_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvContent);
  } catch (error) {
    logger.error('Erro ao exportar logs:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao exportar logs',
      message: error.message
    });
  }
});

// Exportar logs para Excel
router.get('/export/xlsx', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const buffer = await logService.exportLogsToExcel(db, req.query);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="logs_${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    logger.error('Erro ao exportar logs:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao exportar logs',
      message: error.message
    });
  }
});

module.exports = router;

