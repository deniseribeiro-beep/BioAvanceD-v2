const express = require('express');
const router = express.Router();
const sampleService = require('../../services/sample.service');
const RegisterSampleUseCase = require('../../core/use-cases/RegisterSampleUseCase');
const LineageRepository = require('../../infrastructure/database/neo4j/LineageRepository');
const { getCollection } = require('../../utils/collectionResolver');
const { ObjectId } = require('mongodb');
const logService = require('../../services/log.service');
const consentValidator = require('../../services/consent.validator');
const { enforceCommercialConsent } = require('../../infrastructure/middleware/consent.enforcement');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const logger = require('../../utils/logger');

function validateCreateSamplePayload(req, res, next) {
  const payload = req.body || {};
  const errors = [];

  if (!payload.patientID || typeof payload.patientID !== 'string' || !/^\d{8}$/.test(payload.patientID)) {
    errors.push('patientID deve ser uma string com 8 dígitos');
  }

  if (!payload.sampleType || typeof payload.sampleType !== 'string') {
    errors.push('sampleType é obrigatório e deve ser string');
  }

  if (!payload.sampleOrigin || typeof payload.sampleOrigin !== 'string') {
    errors.push('sampleOrigin é obrigatório e deve ser string');
  }

  if (!payload.extractionProtocol || typeof payload.extractionProtocol !== 'string') {
    errors.push('extractionProtocol é obrigatório e deve ser string');
  }

  if (payload.quantity === undefined || payload.quantity === null || typeof payload.quantity !== 'number' || payload.quantity <= 0) {
    errors.push('quantity deve ser um número maior que zero');
  }

  if (payload.quality === undefined || payload.quality === null || typeof payload.quality !== 'number' || !Number.isInteger(payload.quality)) {
    errors.push('quality é obrigatório e deve ser inteiro');
  }

  if (!payload.linkedProject || typeof payload.linkedProject !== 'string' || payload.linkedProject.trim() === '') {
    errors.push('linkedProject é obrigatório');
  }

  if (payload.isRareDisease !== undefined && typeof payload.isRareDisease !== 'boolean') {
    errors.push('isRareDisease deve ser boolean');
  }

  if (payload.locationID === undefined || payload.locationID === null || (typeof payload.locationID !== 'number' && typeof payload.locationID !== 'string')) {
    errors.push('locationID é obrigatório');
  }

  if (!payload.registerDate && !payload.registrationDate) {
    errors.push('registerDate é obrigatório');
  }

  if (errors.length > 0) {
    return res.status(422).json({
      success: false,
      error: 'Payload inválido',
      message: errors.join(', '),
      details: errors
    });
  }

  return next();
}

// RF004 - Cadastro de Amostra
router.post('/',
  authenticate,
  requirePermission('createSample'),
  validateCreateSamplePayload,
  async (req, res) => {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: req.t('errors.databaseUnavailable') || 'Banco de dados não disponível'
        });
      }

      const sampleRepository = {
        create: async (sampleData) => sampleService.createSample(db, sampleData),
        deleteById: async (sampleId) => {
          const samplesCollection = await getCollection(db, 'samples');
          const filter = ObjectId.isValid(sampleId)
            ? { _id: new ObjectId(sampleId) }
            : { _id: sampleId };
          await samplesCollection.deleteOne(filter);
        }
      };

      const registerSampleUseCase = new RegisterSampleUseCase({
        sampleRepository,
        lineageRepository: new LineageRepository(req.app.locals.neo4jDriver || null),
        quarantineService: req.app.locals.neo4jQuarantineService || req.app.locals.topologicalQuarantine || null
      });

      const result = await registerSampleUseCase.execute({
        sampleData: req.body,
        actor: {
          userId: req.user?.id || req.user?._id?.toString() || req.user?.userID || null,
          userName: req.user?.name || req.user?.username || null,
          userRole: req.user?.roleName || req.user?.role || null,
          ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || null,
          userAgent: req.headers['user-agent'] || null
        }
      });
      const sample = result.sample;
      const operationMode = result.strictMode ? 'STRICT' : 'PERMISSIVE';
      const hasPartialSuccess = Boolean(result?.topology && !result.topology.synced && result.topology.fallbackQueued);

      // Registra log (anonimizado via auditLogger) - RF004
      if (req.user) {
        const auditLogger = require('../../utils/auditLogger');
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

      return res.status(hasPartialSuccess ? 202 : 201).json({
        success: true,
        partialSuccess: hasPartialSuccess,
        message: hasPartialSuccess
          ? (req.t('samples.createSuccess') || 'Amostra criada com sucesso') + ' (integração topológica em quarentena)'
          : req.t('samples.createSuccess') || 'Amostra criada com sucesso',
        data: {
          sampleID: sample._id.toString(),
          patientID: sample.patientID, // Apenas ID, sem dados sensíveis (LGPD)
          operationMode,
          topology: {
            synced: Boolean(result?.topology?.synced),
            fallbackQueued: Boolean(result?.topology?.fallbackQueued)
          }
        }
      });
    } catch (error) {
      const errorMessage = error?.message || 'Erro desconhecido ao criar amostra';
      logger.error('Erro ao criar amostra:', errorMessage);
      if (error.stack) {
        logger.error('Rastreamento:', error.stack);
      }

      if (error?.statusCode === 403 || error?.code === 'STRICT_MODE_BLOCKED' || String(errorMessage).includes('STRICT_MODE_BLOCKED')) {
        return res.status(403).json({
          success: false,
          error: 'STRICT_MODE_BLOCKED',
          message: errorMessage
        });
      }

      if (error.status === 409 || error.statusCode === 409) {
        return res.status(409).json({
          success: false,
          error: 'Posição ocupada',
          message: errorMessage
        });
      }

      if (error.status === 404 || error.statusCode === 404 || errorMessage.includes('não encontrado')) {
        return res.status(404).json({
          success: false,
          error: 'Recurso não encontrado',
          message: errorMessage
        });
      }
      
      // Log de erro
      if (req.user) {
        try {
          const db = req.app.locals.db;
          if (db) {
            const auditLogger = require('../../utils/auditLogger');
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

    // Enriquecer amostras com informação de consentimento
    const patientConsentsCollection = await getCollection(db, 'consents');
    const patientsCollection = await getCollection(db, 'patients');
    
    const enrichedSamples = await Promise.all(result.samples.map(async (sample) => {
      let consentValid = false;
      let consentMessage = '';
      let canUse = false;

      // Buscar paciente
      const patient = await patientsCollection.findOne({ 
        $or: [
          { patientID: sample.patientID },
          { _id: sample.patientID }
        ]
      });

      if (patient) {
        // Verificar se há consentimento ativo
        const consent = await patientConsentsCollection.findOne({
          patientId: patient._id.toString(),
          status: 'ACTIVE'
        });

        if (consent) {
          consentValid = true;
          consentMessage = 'TCLE Assinado';
          canUse = true;
        } else {
          // Verificar se o sistema de consentimento está implementado
          const consentCount = await patientConsentsCollection.countDocuments();
          if (consentCount === 0) {
            // Sistema não implementado
            consentValid = true;
            consentMessage = 'Sistema TCLE em implementação';
            canUse = true;
          } else {
            consentValid = false;
            consentMessage = 'TCLE Pendente';
            canUse = false;
          }
        }
      } else {
        // Paciente não encontrado - em desenvolvimento permitir
        consentValid = true;
        consentMessage = 'Paciente não encontrado';
        canUse = true;
      }

      return {
        ...sample,
        consentValid,
        consentMessage,
        canUse,
        // Compatibilidade com campo consentStatus existente
        consentStatus: consentValid ? 'approved' : 'pending'
      };
    }));

    // Registra log de consulta de amostras
    const auditLogger = require('../../utils/auditLogger');
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
      data: enrichedSamples,
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
      const auditLogger = require('../../utils/auditLogger');
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
    const auditLogger = require('../../utils/auditLogger');
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

      consentValidator.init(db);
      await consentValidator.validateAccess(
        req.params.id,
        req.body?.requiredScope || req.body?.consentScope || null
      );

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
        const auditLogger = require('../../utils/auditLogger');
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
      const auditLogger = require('../../utils/auditLogger');
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
      const auditLogger = require('../../utils/auditLogger');
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

// Buscar amostras por termo (barcode ou ID) - para autocomplete
router.get('/search/by-term', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const term = decodeURIComponent(req.query.q || '');
    if (!term || term.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Termo de busca deve ter no mínimo 2 caracteres'
      });
    }

    const samplesCollection = db.collection('samples');
    
    // Buscar por barcode ou ID (usando regex para busca parcial)
    const query = {
      $or: [
        { barcode: { $regex: term, $options: 'i' } },
        { _id: { $regex: term, $options: 'i' } }
      ],
      currentStatus: { $ne: 'WITHDRAWN' } // Excluir amostras retiradas
    };

    const samples = await samplesCollection
      .find(query)
      .limit(10)
      .project({
        _id: 1,
        barcode: 1,
        sampleType: 1,
        currentStatus: 1,
        quantity: 1,
        quantityUnit: 1
      })
      .toArray();

    return res.status(200).json({
      success: true,
      data: samples
    });
  } catch (error) {
    logger.error('Erro ao buscar amostras:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar amostras',
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
      const auditLogger = require('../../utils/auditLogger');
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
    const auditLogger = require('../../utils/auditLogger');
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

// Buscar arquivos de analise de uma amostra
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

    // Registra log de consulta de arquivos de analise da amostra
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      entity: 'Sample',
      entityID: req.params.id,
      result: 'success',
      severity: 'info',
      message: `Arquivos de analise da amostra consultados - ${results.length || 0} registros`,
      payload: { sampleID: req.params.id, resultsCount: results.length || 0 },
      req: req,
      module: 'Amostras'
    });

    return res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    logger.error('Erro ao buscar arquivos de analise da amostra:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar arquivos de analise',
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
      const auditLogger = require('../../utils/auditLogger');
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
const sampleFileController = require('../../controllers/sample-file.controller');

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
  enforceCommercialConsent({ resolveSampleId: (req) => req.params.sampleID }),
  sampleFileController.exportHL7v2.bind(sampleFileController)
);

// FHIR R4 JSON
router.get('/:sampleID/files/:fileID/export/fhir',
  authenticate,
  enforceCommercialConsent({ resolveSampleId: (req) => req.params.sampleID }),
  sampleFileController.exportFHIR.bind(sampleFileController)
);

// CDA XML
router.get('/:sampleID/files/:fileID/export/cda',
  authenticate,
  enforceCommercialConsent({ resolveSampleId: (req) => req.params.sampleID }),
  sampleFileController.exportCDA.bind(sampleFileController)
);

module.exports = router;

