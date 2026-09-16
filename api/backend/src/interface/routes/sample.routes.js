const express = require('express');
const router = express.Router();
// MIABIS Compliance Validator
const { validateMiabisCompliance } = require('../../services/miabisValidator.service');
const SampleGraphValidator = require('../../services/SampleGraphValidator');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireOrganizationScope } = require('../../infrastructure/middleware/rbac');
const { isRecordInOrganizationScope } = require('../../services/rbac-assignment.service');
const sampleService = require('../../services/sample.service');

// GET /api/samples/:id/miabis-compliance - MIABIS compliance check for a sample
router.get('/:id/miabis-compliance', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const sampleId = req.params.id;
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const sampleForScope = await sampleService.getSample(db, sampleId);
    if (sampleForScope && !isRecordInOrganizationScope(sampleForScope, req.organizationScope, 'collectionSite')) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
      });
    }

    const result = await validateMiabisCompliance(sampleId, db);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Erro ao validar compliance MIABIS',
      message: error.message
    });
  }
});

router.get('/:id/compliance-graph', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const sampleForScope = await sampleService.getSample(db, req.params.id);
    if (sampleForScope && !isRecordInOrganizationScope(sampleForScope, req.organizationScope, 'collectionSite')) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
      });
    }

    const validator = new SampleGraphValidator(db);
    const report = await validator.validateSampleCompliance(req.params.id);

    return res.status(200).json({
      success: true,
      data: report,
    });
  } catch (error) {
    logger.error('[SAMPLE_GRAPH_VALIDATOR] Falha ao validar amostra:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao validar grafo de conformidade da amostra',
      message: error.message,
    });
  }
});
const RegisterSampleUseCase = require('../../core/use-cases/RegisterSampleUseCase');
const MongoLineageRepository = require('../../infrastructure/persistence/mongo/MongoLineageRepository');
const MongoStorageRepository = require('../../infrastructure/persistence/mongo/MongoStorageRepository');
const { getCollection } = require('../../utils/collectionResolver');
const { ObjectId } = require('mongodb');
const logService = require('../../services/log.service');
const consentValidator = require('../../services/consent.validator');
const { enforceCommercialConsent } = require('../../infrastructure/middleware/consent.enforcement');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const logger = require('../../utils/logger');
const {
  SPECIMEN_TYPE_IDS,
  SAMPLE_ORIGIN_IDS,
  EXTRACTION_PROTOCOL_IDS,
  MIABIS_QUALITY_IDS,
} = require('../../config/constants/specimen.constants');

const NON_CANONICAL_SAMPLE_ALIASES = Object.freeze([
  'patientID',
  'sampleID',
  'sampleId',
  'registerDate',
  'registrationDate',
  'currentStatus',
  'merkle_root',
]);

const RECOGNIZED_SAMPLE_QUERY_KEYS = Object.freeze([
  'participantId',
  'sampleType',
  'limit',
  'skip',
]);

function findNonCanonicalAliases(source) {
  const bag = source || {};
  return NON_CANONICAL_SAMPLE_ALIASES.filter((alias) =>
    Object.prototype.hasOwnProperty.call(bag, alias)
  );
}

function validateCreateSamplePayload(req, res, next) {
  const payload = req.body || {};
  const errors = [];
  const aliasFields = [];

  aliasFields.push(...findNonCanonicalAliases(payload));

  if (aliasFields.length > 0) {
    return res.status(422).json({
      success: false,
      error: 'NON_CANONICAL_FIELD',
      fields: [...new Set(aliasFields)]
    });
  }

  if (!payload.participantId || typeof payload.participantId !== 'string' || !/^\d{8}$/.test(payload.participantId)) {
    errors.push('participantId deve ser uma string com 8 dígitos');
  }

  if (!payload.sampleType || typeof payload.sampleType !== 'string') {
    errors.push('sampleType é obrigatório e deve ser string');
  } else if (!SPECIMEN_TYPE_IDS.includes(payload.sampleType)) {
    errors.push('sampleType inválido conforme MIABIS');
  }

  if (!payload.sampleOrigin || typeof payload.sampleOrigin !== 'string') {
    errors.push('sampleOrigin é obrigatório e deve ser string');
  } else if (!SAMPLE_ORIGIN_IDS.includes(payload.sampleOrigin)) {
    errors.push('sampleOrigin inválido conforme MIABIS');
  }

  if (!payload.extractionProtocol || typeof payload.extractionProtocol !== 'string') {
    errors.push('extractionProtocol é obrigatório e deve ser string');
  } else if (!EXTRACTION_PROTOCOL_IDS.includes(payload.extractionProtocol)) {
    errors.push('extractionProtocol inválido conforme MIABIS');
  }

  if (payload.quantity === undefined || payload.quantity === null || typeof payload.quantity !== 'number' || payload.quantity <= 0) {
    errors.push('quantity deve ser um número maior que zero');
  }

  if (payload.quality === undefined || payload.quality === null || typeof payload.quality !== 'string' || payload.quality.trim() === '') {
    errors.push('quality é obrigatório e deve ser string');
  } else if (!MIABIS_QUALITY_IDS.includes(payload.quality.trim())) {
    errors.push('quality inválido conforme MIABIS');
  }

  if (!payload.linkedProject || typeof payload.linkedProject !== 'string' || payload.linkedProject.trim() === '') {
    errors.push('linkedProject é obrigatório');
  }

  if (payload.isRareDisease !== undefined && typeof payload.isRareDisease !== 'boolean') {
    errors.push('isRareDisease deve ser boolean');
  }

  if (payload.boxId === undefined || payload.boxId === null || payload.boxId === '') {
    errors.push('Localização física obrigatória para cadastro de amostra');
  } else if (typeof payload.boxId !== 'string' || !ObjectId.isValid(payload.boxId)) {
    errors.push('Localização física obrigatória para cadastro de amostra: boxId deve ser um identificador válido');
  }

  if (payload.positionCode === undefined || payload.positionCode === null || String(payload.positionCode).trim() === '') {
    errors.push('Localização física obrigatória para cadastro de amostra: positionCode é obrigatório');
  }

  if (!payload.registeredAt) {
    errors.push('registeredAt é obrigatório');
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

function buildActiveConsentQuery(patient) {
  const participantId = String(patient?.participantId ?? '').trim();
  if (!participantId) return null;

  return {
    participantId,
    status: 'ACTIVE'
  };
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeZpl(value) {
  return String(value ?? '').trim().replace(/[\^~]/g, '');
}

function buildLocationLineFromPlacement(placement) {
  const box = placement?.box || {};
  const canonical = placement?.canonicalPlacement || placement || {};
  const boxLabel = box.boxName || box.boxId || canonical.boxId || null;
  const position = box.position || canonical.positionCode || null;
  const parts = [
    boxLabel ? `Box ${boxLabel}` : null,
    position ? `Pos ${position}` : null,
  ].filter(Boolean);
  return parts.join(' / ') || null;
}

function buildZplPrintJob({ specimenId, barcode, location }) {
  const safeSpecimenId = escapeZpl(specimenId);
  const safeBarcode = escapeZpl(barcode);
  const safeLocation = location ? escapeZpl(location).slice(0, 44) : '';

  return [
    '^XA',
    '^CI28',
    '^PW600',
    '^LL320',
    '^FO35,28^A0N,30,30^FDBioAvanceD^FS',
    `^FO35,70^A0N,28,28^FDAmostra: ${safeSpecimenId}^FS`,
    `^FO35,110^BCN,80,Y,N,N^FD${safeBarcode}^FS`,
    safeLocation ? `^FO35,220^A0N,24,24^FD${safeLocation}^FS` : null,
    '^XZ',
  ].filter(Boolean).join('\n');
}

async function recordLabelGeneration(db, { sample, formats, req }) {
  const { getUserAnonId } = require('../../utils/userAnonymization');
  const labelGenerationsCollection = await getCollection(db, 'labelGenerations');
  const specimenId = String(sample.specimenId || sample._id);

  const priorGeneration = await labelGenerationsCollection.findOne({ specimenId });
  const isReprint = Boolean(priorGeneration);

  await labelGenerationsCollection.insertOne({
    specimenId,
    barcode: sample.barcode || null,
    formats,
    reprint: isReprint,
    generatedAt: new Date()
  });

  if (req.user) {
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    const generatedByAnonId = await getUserAnonId(req.user, db);
    await auditLogger.log({
      action: isReprint ? 'REPRINT' : 'GENERATE',
      resourceType: 'SampleLabel',
      resourceId: sampleId,
      status: 'success',
      severity: 'info',
      message: isReprint
        ? `Etiqueta reimpressa para amostra ${specimenId} (${formats.join(', ')})`
        : `Etiqueta gerada para amostra ${specimenId} (${formats.join(', ')})`,
      payload: { specimenId, barcode: sample.barcode || null, formats, reprint: isReprint, generatedByAnonId },
      req,
      module: 'Amostras'
    });
  }

  return { reprint: isReprint };
}

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
        create: async (sampleData, options = {}) => sampleService.createSample(db, sampleData, options),
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
        lineageRepository: new MongoLineageRepository(db),
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

      if (req.user) {
        const auditLogger = require('../../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'sample_create',
          resourceType: 'Sample',
          resourceId: sample._id.toString(),
          status: 'success',
          severity: 'info',
          message: `Amostra criada - Participante ID: ${sample.participantId}`,
          payload: {
            sampleID: sample._id.toString(),
            participantId: sample.participantId,
            sampleType: sample.sampleType,
            barcode: sample.barcode,
            quality: sample.quality !== undefined && sample.quality !== null ? sample.quality : null
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
          participantId: sample.participantId,
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

      if ([400, 422].includes(error.status || error.statusCode)) {
        return res.status(error.status || error.statusCode).json({
          success: false,
          error: req.t?.('samples.createError') || 'Erro ao criar amostra',
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

router.get('/', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const queryAliases = findNonCanonicalAliases(req.query);
    if (queryAliases.length > 0) {
      return res.status(422).json({
        success: false,
        error: 'NON_CANONICAL_FIELD',
        fields: [...new Set(queryAliases)]
      });
    }

    const ignoredQueryParams = Object.keys(req.query || {}).filter(
      (key) => !RECOGNIZED_SAMPLE_QUERY_KEYS.includes(key)
    );
    if (ignoredQueryParams.length > 0) {
      logger.warn(
        `[SAMPLES] Parâmetros de consulta não reconhecidos, ignorados: ${ignoredQueryParams.join(', ')}`
      );
    }

    const filters = {
      participantId: req.query.participantId,
      sampleType: req.query.sampleType,
      limit: parseInt(req.query.limit) || 50,
      skip: parseInt(req.query.skip) || 0,
      organizationScope: req.organizationScope
    };

    const result = await sampleService.listSamples(db, filters);

    const specimenPreanalyticsService = require('../../services/specimen-preanalytics.service');
    const storageRepository = new MongoStorageRepository(db);
    const [currentStoragePlacementsBySampleId, currentProfilesBySpecimenId] = await Promise.all([
      storageRepository.resolvePhysicalPlacementsForSamples(result.samples),
      specimenPreanalyticsService.getCurrentProfilesForSpecimens(db, result.samples)
    ]);

    const patientConsentsCollection = await getCollection(db, 'consents');
    const patientsCollection = await getCollection(db, 'patients');

    const enrichedSamples = await Promise.all(result.samples.map(async (sample) => {
      let consentValid = false;
      let consentMessage = '';
      let canUse = false;

      const participantId = String(sample?.participantId ?? '').trim();
      const patient = participantId
        ? await patientsCollection.findOne({ participantId })
        : null;

      if (patient) {
        const consentQuery = buildActiveConsentQuery(patient);
        const consent = consentQuery ? await patientConsentsCollection.findOne(consentQuery) : null;

        if (consent) {
          consentValid = true;
          consentMessage = 'TCLE Assinado';
          canUse = true;
        } else {
          consentValid = false;
          consentMessage = 'TCLE Pendente';
          canUse = false;
        }
      } else {
        consentValid = false;
        consentMessage = 'Paciente não encontrado';
        canUse = false;
      }

      return {
        ...sample,
        consentValid,
        consentMessage,
        canUse,
        consentReasonCode: patient ? (consentValid ? null : 'NO_ACTIVE_CONSENT') : 'PATIENT_NOT_FOUND',
        consentStatus: consentValid ? 'CONSENT_ACTIVE' : 'CONSENT_PENDING',
        currentStoragePlacement: currentStoragePlacementsBySampleId.get(String(sample._id)) || null,
        currentSpecimenPreanalytics: currentProfilesBySpecimenId.get(String(sample.specimenId || '')) || null
      };
    }));

    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      resourceType: 'Sample',
      status: 'success',
      severity: 'info',
      message: `Consulta de amostras - ${result.total || 0} registros`,
      payload: { total: result.total || 0, filters },
      req: req,
      module: 'Amostras'
    });

    return res.status(200).json({
      success: true,
      data: enrichedSamples,
      total: result.total,
      appliedFilters: {
        participantId: filters.participantId ?? null,
        sampleType: filters.sampleType ?? null,
        limit: filters.limit,
        skip: filters.skip
      },
      ignoredQueryParams
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

router.get('/:id/label', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const samplesCollection = await getCollection(db, 'samples');
    const rawId = String(req.params.id);
    const sample = await samplesCollection.findOne({
      $or: [
        ...(ObjectId.isValid(rawId) ? [{ _id: new ObjectId(rawId) }] : []),
        { specimenId: rawId },
        { barcode: rawId },
      ],
    });
    if (!sample) {
      return res.status(404).json({
        success: false,
        error: 'Amostra não encontrada'
      });
    }

    if (!isRecordInOrganizationScope(sample, req.organizationScope, 'collectionSite')) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
      });
    }

    const sampleIdentifier = escapeXml(String(sample.specimenId || sample._id || req.params.id));
    const barcode = escapeXml(String(sample.barcode || sampleIdentifier));
    const title = escapeXml(String(sample.sampleType || 'AMOSTRA').slice(0, 32));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="378" height="189" viewBox="0 0 378 189">
  <rect width="378" height="189" fill="#fff" stroke="#111" stroke-width="2"/>
  <text x="189" y="34" font-family="Arial, sans-serif" font-size="20" font-weight="700" text-anchor="middle">${title}</text>
  <text x="189" y="92" font-family="Arial, sans-serif" font-size="24" font-weight="700" text-anchor="middle">${barcode}</text>
  <text x="189" y="150" font-family="Arial, sans-serif" font-size="18" text-anchor="middle">${sampleIdentifier}</text>
</svg>`;

    const { reprint } = await recordLabelGeneration(db, { sample, formats: ['svg'], req });

    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="sample-label-${sampleIdentifier}.svg"`);
    res.setHeader('X-Label-Reprint', String(reprint));
    return res.status(200).send(svg);
  } catch (error) {
    logger.error('Erro ao gerar etiqueta da amostra:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao gerar etiqueta da amostra',
      message: error.message
    });
  }
});

router.get('/:id/label/print-job', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const samplesCollection = await getCollection(db, 'samples');
    const rawId = String(req.params.id);
    const sample = await samplesCollection.findOne({
      $or: [
        ...(ObjectId.isValid(rawId) ? [{ _id: new ObjectId(rawId) }] : []),
        { specimenId: rawId },
        { barcode: rawId },
      ],
    });
    if (!sample) {
      return res.status(404).json({
        success: false,
        error: 'Amostra não encontrada'
      });
    }

    if (!isRecordInOrganizationScope(sample, req.organizationScope, 'collectionSite')) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
      });
    }

    if (!sample.barcode) {
      return res.status(409).json({
        success: false,
        error: 'Amostra não possui barcode gerado'
      });
    }

    const sampleIdentifier = String(sample.specimenId ?? sample._id);
    const storageRepository = new MongoStorageRepository(db);
    const placementResult = await storageRepository.getSamplePhysicalPlacement({
      specimenId: sample.specimenId || sample._id
    });
    const location = buildLocationLineFromPlacement(placementResult.found ? placementResult.placement : null);
    const zpl = buildZplPrintJob({ specimenId: sampleIdentifier, barcode: sample.barcode, location });

    const { reprint } = await recordLabelGeneration(db, { sample, formats: ['zpl'], req });

    return res.status(200).json({
      success: true,
      data: {
        specimenId: sampleIdentifier,
        barcode: sample.barcode,
        format: 'zpl',
        printerLanguage: 'ZPL',
        location,
        reprint,
        zpl
      }
    });
  } catch (error) {
    logger.error('Erro ao preparar job de impressão da etiqueta:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao preparar job de impressão da etiqueta',
      message: error.message
    });
  }
});

router.post('/labels/batch', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const specimenIds = Array.isArray(req.body?.specimenIds) ? req.body.specimenIds : [];
    if (specimenIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'specimenIds é obrigatório e deve ser um array não vazio'
      });
    }

    const samplesCollection = await getCollection(db, 'samples');
    const results = await Promise.all(specimenIds.map(async (rawId) => {
      const id = String(rawId);
      try {
        const sample = await samplesCollection.findOne({
          $or: [
            ...(ObjectId.isValid(id) ? [{ _id: new ObjectId(id) }] : []),
            { specimenId: id },
            { barcode: id },
          ],
        });

        if (!sample) {
          return { specimenId: id, success: false, error: 'Amostra não encontrada' };
        }

        if (!isRecordInOrganizationScope(sample, req.organizationScope, 'collectionSite')) {
          return { specimenId: id, success: false, error: 'Acesso negado', status: 403 };
        }

        if (!sample.barcode) {
          return { specimenId: id, success: false, error: 'Amostra não possui barcode gerado' };
        }

        const assets = await sampleService.getBarcodeIndustrialAssets(sample.barcode, { includePayload: false });
        const { reprint } = await recordLabelGeneration(db, {
          sample,
          formats: ['code128', 'dataMatrix', 'qr'],
          req
        });

        return {
          specimenId: id,
          success: true,
          barcode: assets.canonicalValue,
          reprint,
          code128: assets.code128,
          dataMatrix: assets.dataMatrix,
          qr: assets.qr
        };
      } catch (error) {
        return { specimenId: id, success: false, error: error.message };
      }
    }));

    return res.status(200).json({
      success: true,
      data: {
        total: results.length,
        generated: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        results
      }
    });
  } catch (error) {
    logger.error('Erro ao gerar lote de etiquetas:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao gerar artefatos de barcode',
      message: error.message
    });
  }
});

router.get('/:id', authenticate, requireOrganizationScope, async (req, res) => {
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

    if (sample && !isRecordInOrganizationScope(sample, req.organizationScope, 'collectionSite')) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
      });
    }

    if (!sample) {
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'QUERY',
        resourceType: 'Sample',
        status: 'error',
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

    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      resourceType: 'Sample',
      resourceId: req.params.id,
      status: 'success',
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

router.post('/:id/withdraw',
  authenticate,
  requirePermission('withdrawSample', 'UPDATE'),
  requireOrganizationScope,
  async (req, res) => {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const sampleForScope = await sampleService.getSample(db, req.params.id);
      if (sampleForScope && !isRecordInOrganizationScope(sampleForScope, req.organizationScope, 'collectionSite')) {
        return res.status(403).json({
          success: false,
          error: 'Acesso negado',
          message: 'Esta amostra pertence a outra organização'
        });
      }

      consentValidator.init(db);
      await consentValidator.validateAccess(
        req.params.id,
        req.body?.requiredScope || req.body?.consentScope || null
      );

      const { ObjectId } = require('mongodb');
      const auditInfo = {
        userId: req.user?.id || req.user?._id?.toString(),
        userName: req.user?.name || req.user?.username,
        userRole: req.user?.roleName || req.user?.role,
        ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
        userAgent: req.headers['user-agent']
      };

      const result = await sampleService.withdrawSample(db, new ObjectId(req.params.id), req.body, auditInfo);

      if (req.user) {
        const auditLogger = require('../../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'WITHDRAW',
          resourceType: 'Sample',
          resourceId: req.params.id,
          status: 'success',
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

router.put('/:id', authenticate, requirePermission('editSample'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const sampleForScope = await sampleService.getSample(db, req.params.id);
    if (sampleForScope && !isRecordInOrganizationScope(sampleForScope, req.organizationScope, 'collectionSite')) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
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

    if (req.user) {
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'UPDATE',
        resourceType: 'Sample',
        resourceId: req.params.id,
        status: 'success',
        severity: 'info',
        message: 'Amostra atualizada',
        req: req
      });

      const releaseRequested = String(req.body?.specimenStatus || '').toLowerCase() === 'available'
        || String(req.body?.consentStatus || '').toUpperCase() === 'EXTERNAL_ATTACHED'
        || String(req.body?.consentStatus || '').toUpperCase() === 'SIGNED';

      if (releaseRequested) {
        await auditLogger.log({
          action: 'sample_release',
          resourceType: 'Sample',
          resourceId: req.params.id,
          status: 'success',
          severity: 'info',
          message: 'Amostra liberada após validação ética',
          payload: {
            consentStatus: req.body?.consentStatus || null,
            specimenStatus: req.body?.specimenStatus || null,
            quarantineReason: req.body?.quarantineReason || null,
          },
          req: req
        });
      }
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

router.delete('/:id', authenticate, requirePermission('deleteSample'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const sampleForScope = await sampleService.getSample(db, req.params.id);
    if (sampleForScope && !isRecordInOrganizationScope(sampleForScope, req.organizationScope, 'collectionSite')) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
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

    if (req.user) {
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'DELETE',
        resourceType: 'Sample',
        resourceId: req.params.id,
        status: 'success',
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
    const query = {
      $or: [
        { barcode: { $regex: term, $options: 'i' } },
        { _id: { $regex: term, $options: 'i' } }
      ],
      withdrawnAt: null
    };

    const samples = await samplesCollection
      .find(query)
      .limit(10)
      .project({
        _id: 1,
        barcode: 1,
        sampleType: 1,
        specimenStatus: 1,
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
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'QUERY',
        resourceType: 'Sample',
        status: 'error',
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

    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      resourceType: 'Sample',
      resourceId: result.sample._id?.toString(),
      status: 'success',
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

router.get('/by-barcode/:barcode/symbology-assets', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const barcode = decodeURIComponent(req.params.barcode);
    const lookup = await sampleService.getSampleByBarcode(db, barcode);
    if (!lookup.sample) {
      return res.status(404).json({
        success: false,
        error: `Amostra não encontrada com código de barras: ${barcode}`
      });
    }

    if (!isRecordInOrganizationScope(lookup.sample, req.organizationScope, 'collectionSite')) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
      });
    }

    const includePayload = String(req.query.includePayload || 'false').toLowerCase() === 'true';
    const assets = await sampleService.getBarcodeIndustrialAssets(barcode, { includePayload });

    const { reprint } = await recordLabelGeneration(db, {
      sample: lookup.sample,
      formats: ['code128', 'dataMatrix', 'qr'],
      req
    });

    return res.status(200).json({
      success: true,
      data: {
        barcode: assets.canonicalValue,
        generatedAt: assets.generatedAt,
        includePayload,
        reprint,
        code128: assets.code128,
        dataMatrix: assets.dataMatrix,
        qr: assets.qr
      }
    });
  } catch (error) {
    logger.error('Erro ao gerar artefatos industriais de barcode:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao gerar artefatos de barcode',
      message: error.message
    });
  }
});

router.get('/:id/results', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const sampleForScope = await sampleService.getSample(db, req.params.id);
    if (sampleForScope && !isRecordInOrganizationScope(sampleForScope, req.organizationScope, 'collectionSite')) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
      });
    }

    const { ObjectId } = require('mongodb');
    const results = await sampleService.getSampleResults(db, new ObjectId(req.params.id));

    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      resourceType: 'Sample',
      resourceId: req.params.id,
      status: 'success',
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

router.post('/:id/return', authenticate, requirePermission('withdrawSample', 'UPDATE'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const sampleForScope = await sampleService.getSample(db, req.params.id);
    if (sampleForScope && !isRecordInOrganizationScope(sampleForScope, req.organizationScope, 'collectionSite')) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
      });
    }

    const { ObjectId } = require('mongodb');
    const auditInfo = {
      userId: req.user?.id || req.user?._id?.toString(),
      userName: req.user?.name || req.user?.username,
      userRole: req.user?.roleName || req.user?.role,
      ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
      userAgent: req.headers['user-agent']
    };

    const result = await sampleService.returnSample(db, new ObjectId(req.params.id), req.body, auditInfo);

    if (req.user) {
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'RETURN',
        resourceType: 'Sample',
        resourceId: req.params.id,
        status: 'success',
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

router.get('/:id/movements', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const sampleForScope = await sampleService.getSample(db, req.params.id);
    if (sampleForScope && !isRecordInOrganizationScope(sampleForScope, req.organizationScope, 'collectionSite')) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
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

router.get('/:id/rcs-assessments', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const sampleForScope = await sampleService.getSample(db, req.params.id);
    if (sampleForScope && !isRecordInOrganizationScope(sampleForScope, req.organizationScope, 'collectionSite')) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
      });
    }

    const assessments = await sampleService.getRcsAssessments(db, req.params.id);

    return res.status(200).json({
      success: true,
      data: assessments
    });
  } catch (error) {
    logger.error('Erro ao buscar snapshots RCS:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar snapshots RCS',
      message: error.message
    });
  }
});

router.get('/:id/sprec-profiles', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const sampleForScope = await sampleService.getSample(db, req.params.id);
    if (sampleForScope && !isRecordInOrganizationScope(sampleForScope, req.organizationScope, 'collectionSite')) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
      });
    }

    const profiles = await sampleService.getSprecProfiles(db, req.params.id);

    return res.status(200).json({
      success: true,
      data: profiles
    });
  } catch (error) {
    logger.error('Erro ao buscar snapshots SPREC:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar snapshots SPREC',
      message: error.message
    });
  }
});

router.get('/:id/quarantine-actions', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const sampleForScope = await sampleService.getSample(db, req.params.id);
    if (sampleForScope && !isRecordInOrganizationScope(sampleForScope, req.organizationScope, 'collectionSite')) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
      });
    }

    const actions = await sampleService.getQuarantineActions(db, req.params.id);

    return res.status(200).json({
      success: true,
      data: actions
    });
  } catch (error) {
    logger.error('Erro ao buscar ações de quarentena:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar ações de quarentena',
      message: error.message
    });
  }
});

const sampleFileController = require('../../controllers/sample-file.controller');

router.post('/:specimenId/files/upload',
  authenticate,
  requirePermission('uploadSampleFiles'),
  requireOrganizationScope,
  sampleFileController.uploadMiddleware(),
  sampleFileController.uploadFile.bind(sampleFileController)
);

router.get('/:specimenId/files',
  authenticate,
  requireOrganizationScope,
  sampleFileController.listFiles.bind(sampleFileController)
);

router.get('/:specimenId/files/:fileID/download',
  authenticate,
  requireOrganizationScope,
  sampleFileController.downloadFile.bind(sampleFileController)
);

router.delete('/:specimenId/files/:fileID',
  authenticate,
  requirePermission('deleteSampleFiles'),
  requireOrganizationScope,
  sampleFileController.deleteFile.bind(sampleFileController)
);

router.put('/:specimenId/files/:fileID/replace',
  authenticate,
  requirePermission('uploadSampleFiles', 'CREATE'),
  requireOrganizationScope,
  sampleFileController.uploadMiddleware(),
  sampleFileController.replaceFile.bind(sampleFileController)
);

router.get('/:specimenId/files/:fileID/export/hl7',
  authenticate,
  requireOrganizationScope,
  enforceCommercialConsent({ resolveSampleId: (req) => req.params.specimenId }),
  sampleFileController.exportHL7v2.bind(sampleFileController)
);

router.get('/:specimenId/files/:fileID/export/fhir',
  authenticate,
  requireOrganizationScope,
  enforceCommercialConsent({ resolveSampleId: (req) => req.params.specimenId }),
  sampleFileController.exportFHIR.bind(sampleFileController)
);

router.get('/:specimenId/files/:fileID/export/cda',
  authenticate,
  requireOrganizationScope,
  enforceCommercialConsent({ resolveSampleId: (req) => req.params.specimenId }),
  sampleFileController.exportCDA.bind(sampleFileController)
);

router._test = {
  validateCreateSamplePayload,
};

module.exports = router;
