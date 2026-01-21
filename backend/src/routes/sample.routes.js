const express = require('express');
const router = express.Router();
const sampleService = require('../services/sample.service');
const logService = require('../services/log.service');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const logger = require('../utils/logger');

// RF004 - Cadastro de Amostra
router.post('/',
  authenticate,
  requirePermission('createSample'),
  async (req, res) => {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: req.t('errors.databaseUnavailable') || 'Banco de dados não disponível'
        });
      }

      const sample = await sampleService.createSample(db, req.body);

      // Registra log (anonimizado via auditLogger) - RF004
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'sample_create',
          entity: 'Sample',
          entityID: sample._id.toString(),
          result: 'success',
          severity: 'info',
          message: `Amostra criada - Paciente ID: ${sample.patientID}`, // Apenas ID, sem dados sensíveis
          payload: {
            sampleID: sample._id.toString(),
            patientID: sample.patientID, // Apenas ID anonimizado
            sampleType: sample.sampleType,
            barcode: sample.barcode,
            quality: sample.quality !== undefined && sample.quality !== null ? sample.quality : null // Apenas valor numérico MIABIS (0, 1, 2)
          },
          req: req,
          module: 'Samples'
        });
      }

      return res.status(201).json({
        success: true,
        message: req.t('samples.createSuccess') || 'Amostra criada com sucesso',
        data: {
          sampleID: sample._id.toString(),
          patientID: sample.patientID // Apenas ID, sem dados sensíveis (LGPD)
        }
      });
    } catch (error) {
      const errorMessage = error?.message || 'Erro desconhecido ao criar amostra';
      logger.error('Erro ao criar amostra:', errorMessage);
      if (error.stack) {
        logger.error('Stack trace:', error.stack);
      }

      if (error.status === 409) {
        return res.status(409).json({
          success: false,
          error: 'Posição ocupada',
          message: errorMessage
        });
      }
      
      // Log de erro
      if (req.user) {
        try {
          const db = req.app.locals.db;
          if (db) {
            const auditLogger = require('../utils/auditLogger');
            auditLogger.init(db);
            await auditLogger.logError(req, 'Sample', error, {
              action: 'sample_create',
              errorMessage: errorMessage
            });
          }
        } catch (logError) {
          logger.error('Erro ao registrar log de auditoria:', logError.message || logError);
        }
      }
      
      // Retorna status 400 para erros de validação, 500 para erros inesperados
      const statusCode = error.name === 'ValidationError' || error.message?.includes('obrigatório') || error.message?.includes('inválido') 
        ? 400 
        : 500;
      
      return res.status(statusCode).json({
        success: false,
        error: req.t?.('samples.createError') || 'Erro ao criar amostra',
        message: errorMessage
      });
    }
  }
);

router.get('/', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const filters = {
      patientID: req.query.patientID,
      currentStatus: req.query.currentStatus,
      sampleType: req.query.sampleType,
      limit: parseInt(req.query.limit) || 50,
      skip: parseInt(req.query.skip) || 0
    };

    const result = await sampleService.listSamples(db, filters);

    // Registra log de consulta de amostras
    const auditLogger = require('../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      entity: 'Sample',
      result: 'success',
      severity: 'info',
      message: `Consulta de amostras - ${result.total || 0} registros`,
      payload: { total: result.total || 0, filters },
      req: req,
      module: 'Amostras'
    });

    return res.status(200).json({
      success: true,
      data: result.samples,
      total: result.total
    });
  } catch (error) {
    logger.error('Erro ao listar amostras:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar amostras',
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
    const sample = await sampleService.getSample(db, new ObjectId(req.params.id));

    if (!sample) {
      // Registra tentativa de busca de amostra inexistente
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'QUERY',
        entity: 'Sample',
        result: 'error',
        severity: 'warning',
        message: `Tentativa de buscar amostra inexistente: ${req.params.id}`,
        req: req,
        module: 'Amostras'
      });
      
      return res.status(404).json({
        success: false,
        error: 'Amostra não encontrada'
      });
    }

    // Registra log de busca de amostra
    const auditLogger = require('../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      entity: 'Sample',
      entityID: req.params.id,
      result: 'success',
      severity: 'info',
      message: 'Amostra consultada',
      req: req,
      module: 'Amostras'
    });

    return res.status(200).json({
      success: true,
      data: sample
    });
  } catch (error) {
    logger.error('Erro ao buscar amostra:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar amostra',
      message: error.message
    });
  }
});

// RF006 - Retirada de Amostra
router.post('/:id/withdraw',
  authenticate,
  requirePermission('withdrawSample'),
  async (req, res) => {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { ObjectId } = require('mongodb');
      
      // Preparar informações de auditoria
      const auditInfo = {
        userId: req.user?.id || req.user?._id?.toString(),
        userName: req.user?.name || req.user?.username,
        userRole: req.user?.roleName || req.user?.role,
        ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
        userAgent: req.headers['user-agent']
      };
      
      const result = await sampleService.withdrawSample(db, new ObjectId(req.params.id), req.body, auditInfo);

      // Registra log de alta severidade (RF006)
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'WITHDRAW',
          entity: 'Sample',
          entityID: req.params.id,
          result: 'success',
          severity: 'high',
          message: `Amostra retirada - Tipo: ${req.body.withdrawalType}, Responsável: ${req.body.withdrawalResponsible}, Qtd: ${result.withdrawnQuantity}`,
          payload: {
            withdrawalType: req.body.withdrawalType,
            withdrawalResponsible: req.body.withdrawalResponsible,
            sampleDestination: req.body.sampleDestination,
            linkedProject: req.body.linkedProject,
            withdrawnQuantity: result.withdrawnQuantity,
            remainingQuantity: result.remainingQuantity,
            movementID: result.movementID
          },
          req: req,
          module: 'Amostras'
        });
      }

      return res.status(200).json({
        success: true,
        message: req.t?.('samples.withdrawSuccess') || 'Retirada registrada com sucesso',
        data: result
      });
    } catch (error) {
      logger.error('Erro ao retirar amostra:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Erro ao retirar amostra',
        message: error.message
      });
    }
  }
);

// Atualizar amostra
router.put('/:id', authenticate, requirePermission('editSample'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { ObjectId } = require('mongodb');
    const result = await sampleService.updateSample(db, new ObjectId(req.params.id), req.body);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Amostra não encontrada'
      });
    }

    // Registra log (anonimizado via auditLogger)
    if (req.user) {
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'UPDATE',
        entity: 'Sample',
        entityID: req.params.id,
        result: 'success',
        severity: 'info',
        message: 'Amostra atualizada',
        req: req
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Amostra atualizada com sucesso',
      data: result
    });
  } catch (error) {
    logger.error('Erro ao atualizar amostra:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao atualizar amostra',
      message: error.message
    });
  }
});

// Deletar amostra
router.delete('/:id', authenticate, requirePermission('deleteSample'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { ObjectId } = require('mongodb');
    const result = await sampleService.deleteSample(db, new ObjectId(req.params.id));

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Amostra não encontrada'
      });
    }

    // Registra log (anonimizado via auditLogger)
    if (req.user) {
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'DELETE',
        entity: 'Sample',
        entityID: req.params.id,
        result: 'success',
        severity: 'warning',
        message: 'Amostra deletada',
        req: req
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Amostra deletada com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao deletar amostra:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao deletar amostra',
      message: error.message
    });
  }
});

// Buscar amostra por código de barras
router.get('/by-barcode/:barcode', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const barcode = decodeURIComponent(req.params.barcode);
    const result = await sampleService.getSampleByBarcode(db, barcode);

    if (!result.sample) {
      // Registra tentativa de busca por código de barras inexistente
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'QUERY',
        entity: 'Sample',
        result: 'error',
        severity: 'warning',
        message: `Tentativa de buscar amostra por código de barras inexistente: ${barcode}`,
        payload: { barcode },
        req: req,
        module: 'Amostras'
      });
      
      return res.status(404).json({
        success: false,
        error: `Amostra não encontrada com código de barras: ${barcode}`
      });
    }

    // Registra log de busca por código de barras
    const auditLogger = require('../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      entity: 'Sample',
      entityID: result.sample._id?.toString(),
      result: 'success',
      severity: 'info',
      message: `Amostra consultada por código de barras: ${barcode}`,
      payload: { barcode },
      req: req,
      module: 'Amostras'
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Erro ao buscar amostra por código de barras:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar amostra',
      message: error.message
    });
  }
});

// Buscar resultados de uma amostra
router.get('/:id/results', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { ObjectId } = require('mongodb');
    const results = await sampleService.getSampleResults(db, new ObjectId(req.params.id));

    // Registra log de consulta de resultados da amostra
    const auditLogger = require('../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      entity: 'Sample',
      entityID: req.params.id,
      result: 'success',
      severity: 'info',
      message: `Resultados da amostra consultados - ${results.length || 0} registros`,
      payload: { sampleID: req.params.id, resultsCount: results.length || 0 },
      req: req,
      module: 'Amostras'
    });

    return res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    logger.error('Erro ao buscar resultados da amostra:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar resultados',
      message: error.message
    });
  }
});

// Retornar amostra
router.post('/:id/return', authenticate, requirePermission('withdrawSample'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { ObjectId } = require('mongodb');
    
    // Preparar informações de auditoria
    const auditInfo = {
      userId: req.user?.id || req.user?._id?.toString(),
      userName: req.user?.name || req.user?.username,
      userRole: req.user?.roleName || req.user?.role,
      ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
      userAgent: req.headers['user-agent']
    };
    
    const result = await sampleService.returnSample(db, new ObjectId(req.params.id), req.body, auditInfo);

    // Registra log (anonimizado via auditLogger)
    if (req.user) {
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'RETURN',
        entity: 'Sample',
        entityID: req.params.id,
        result: 'success',
        severity: 'high',
        message: `Amostra devolvida - Qtd: ${result.returnedQuantity}, Condição: ${result.condition}`,
        payload: {
          returnedQuantity: result.returnedQuantity,
          condition: result.condition,
          returnResponsible: req.body.returnResponsible,
          newAvailableQuantity: result.newAvailableQuantity,
          movementID: result.movementID
        },
        req: req,
        module: 'Amostras'
      });
    }

    return res.status(200).json({
      success: true,
      message: req.t?.('samples.returnSuccess') || 'Devolução registrada com sucesso',
      data: result
    });
  } catch (error) {
    logger.error('Erro ao retornar amostra:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao retornar amostra',
      message: error.message
    });
  }
});

// Obter movimentações de uma amostra
router.get('/:id/movements', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const movements = await sampleService.getSampleMovements(db, req.params.id);

    return res.status(200).json({
      success: true,
      data: movements
    });
  } catch (error) {
    logger.error('Erro ao buscar movimentações:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar movimentações',
      message: error.message
    });
  }
});

// RF007 - Upload de Arquivos de Análise
const sampleFileController = require('../controllers/sample-file.controller');

// Upload de arquivo - Apenas Admin e Coordenador
router.post('/:sampleID/files/upload',
  authenticate,
  requirePermission('uploadSampleFiles'),
  sampleFileController.uploadMiddleware(),
  sampleFileController.uploadFile.bind(sampleFileController)
);

// Lista arquivos - Todos os perfis autenticados
router.get('/:sampleID/files',
  authenticate,
  sampleFileController.listFiles.bind(sampleFileController)
);

// Download de arquivo - Todos os perfis autenticados
router.get('/:sampleID/files/:fileID/download',
  authenticate,
  sampleFileController.downloadFile.bind(sampleFileController)
);

// Deletar arquivo - Apenas Admin e Coordenador
router.delete('/:sampleID/files/:fileID',
  authenticate,
  requirePermission('deleteSampleFiles'),
  sampleFileController.deleteFile.bind(sampleFileController)
);

// Exportação HL7 - Todos os perfis autenticados podem exportar (não contém dados sensíveis, apenas patientID anonimizado)
// HL7 v2.x
router.get('/:sampleID/files/:fileID/export/hl7',
  authenticate,
  sampleFileController.exportHL7v2.bind(sampleFileController)
);

// FHIR R4 JSON
router.get('/:sampleID/files/:fileID/export/fhir',
  authenticate,
  sampleFileController.exportFHIR.bind(sampleFileController)
);

// CDA XML
router.get('/:sampleID/files/:fileID/export/cda',
  authenticate,
  sampleFileController.exportCDA.bind(sampleFileController)
);

module.exports = router;

