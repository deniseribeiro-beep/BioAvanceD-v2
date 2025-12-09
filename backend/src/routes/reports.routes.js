const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const logger = require('../utils/logger');
const ReportsModel = require('../models/Reports');

// CRUD de Relatórios
router.get('/', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const reportsCollection = db.collection('reports');
    const reports = await reportsCollection.find({}).sort({ generatedAt: -1 }).toArray();

    return res.status(200).json({
      success: true,
      data: reports
    });
  } catch (error) {
    logger.error('Erro ao listar relatórios:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar relatórios',
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
    const reportsCollection = db.collection('reports');
    const report = await reportsCollection.findOne({ _id: new ObjectId(req.params.id) });

    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Relatório não encontrado'
      });
    }

    return res.status(200).json({
      success: true,
      data: report
    });
  } catch (error) {
    logger.error('Erro ao buscar relatório:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar relatório',
      message: error.message
    });
  }
});

router.post('/generate', authenticate, requirePermission('viewReports'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { reportType, filters } = req.body;

    if (!reportType) {
      return res.status(400).json({
        success: false,
        error: 'reportType é obrigatório'
      });
    }

    if (!ReportsModel.validateReportType(reportType)) {
      return res.status(400).json({
        success: false,
        error: 'Tipo de relatório inválido'
      });
    }

    const reportsCollection = db.collection('reports');
    const report = ReportsModel.create({
      reportType,
      filters: filters || {},
      generatedBy: req.user?.userID || null,
      status: 'pending'
    });

    const result = await reportsCollection.insertOne(report);

    // Registra log de geração de relatório
    const auditLogger = require('../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'CREATE',
      entity: 'Report',
      entityID: result.insertedId.toString(),
      result: 'success',
      severity: 'info',
      message: `Relatório ${reportType} gerado`,
      payload: { reportType, filters: filters || {} },
      req: req,
      module: 'Relatórios'
    });

    return res.status(201).json({
      success: true,
      message: 'Relatório gerado com sucesso',
      data: { _id: result.insertedId, ...report }
    });
  } catch (error) {
    logger.error('Erro ao gerar relatório:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao gerar relatório',
      message: error.message
    });
  }
});

router.get('/:type/filters', authenticate, async (req, res) => {
  try {
    // Retorna filtros disponíveis para o tipo de relatório
    const filters = {
      patients: ['clinicalUnit', 'sex', 'dateRange'],
      samples: ['sampleType', 'currentStatus', 'dateRange'],
      withdrawals: ['withdrawalType', 'dateRange'],
      temperature: ['sensorId', 'dateRange'],
      sensors: ['maintenanceStatus', 'locationId'],
      quality: ['qualityID', 'dateRange'],
      inventory: ['equipmentType', 'locationId'],
      audit: ['userId', 'action', 'dateRange']
    };

    return res.status(200).json({
      success: true,
      data: {
        filters: filters[req.params.type] || []
      }
    });
  } catch (error) {
    logger.error('Erro ao buscar filtros:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar filtros',
      message: error.message
    });
  }
});

router.post('/:type/preview', authenticate, requirePermission('viewReports'), async (req, res) => {
  try {
    // Preview do relatório (estrutura básica)
    return res.status(200).json({
      success: true,
      data: {
        type: req.params.type,
        filters: req.body.filters || {},
        preview: 'Preview será implementado em breve'
      }
    });
  } catch (error) {
    logger.error('Erro ao gerar preview:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao gerar preview',
      message: error.message
    });
  }
});

router.get('/:type/export', authenticate, requirePermission('viewReports'), async (req, res) => {
  try {
    // Export CSV (estrutura básica)
    return res.status(200).json({
      success: true,
      message: 'Export CSV será implementado em breve',
      data: []
    });
  } catch (error) {
    logger.error('Erro ao exportar relatório:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao exportar relatório',
      message: error.message
    });
  }
});

router.get('/:type/export/pdf', authenticate, requirePermission('viewReports'), async (req, res) => {
  try {
    // Export PDF (estrutura básica)
    return res.status(200).json({
      success: true,
      message: 'Export PDF será implementado em breve',
      data: null
    });
  } catch (error) {
    logger.error('Erro ao exportar PDF:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao exportar PDF',
      message: error.message
    });
  }
});

router.delete('/:id', authenticate, requirePermission('viewReports'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { ObjectId } = require('mongodb');
    const reportsCollection = db.collection('reports');
    const result = await reportsCollection.deleteOne({ _id: new ObjectId(req.params.id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Relatório não encontrado'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Relatório deletado com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao deletar relatório:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao deletar relatório',
      message: error.message
    });
  }
});

module.exports = router;

