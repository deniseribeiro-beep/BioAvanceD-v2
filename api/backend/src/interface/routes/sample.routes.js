const express = require('express');
const router = express.Router();
// MIABIS Compliance Validator
const { validateMiabisCompliance } = require('../../services/miabisValidator.service');
const SampleGraphValidator = require('../../services/SampleGraphValidator');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireOrganizationScope, requireRole } = require('../../infrastructure/middleware/rbac');
const quarantineReleaseService = require('../../services/quarantine-release.service');
// #1266: lgpd.allowDataExport switches the HL7/FHIR/CDA file exports off.
const { requireDataExportAllowed } = require('../../infrastructure/middleware/lgpdExportGate');
const { assertOrganizationFieldNotReparented } = require('../../services/rbac-assignment.service');
const { resolveCallerCreateOrganization } = require('../../services/callerCreateOrganization.service');
// #1192: a sample is scoped by organizationId, falling back to collectionSite.
const { isSampleInOrganizationScope, applySampleOrganizationScope } = require('../../services/sampleTenancy.service');
// const { authenticate } = require('../../infrastructure/middleware/auth');
const sampleService = require('../../services/sample.service');
const { readSampleGraphStatus } = require('../../services/sampleGraphStatus.service');
const { qualificationContextErrors } = require('../../services/quality-domain.service');

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

    // #624: mirrors #340/#619/#623's out-of-scope 403 pattern — a separate
    // getSample call purely for the scope check, since validateMiabisCompliance
    // doesn't expose the raw sample document.
    const sampleForScope = await sampleService.getSample(db, sampleId);
    if (sampleForScope && !isSampleInOrganizationScope(sampleForScope, req.organizationScope)) {
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

    // #624: mirrors #340/#619/#623's out-of-scope 403 pattern — a separate
    // getSample call purely for the scope check, since
    // SampleGraphValidator doesn't expose the raw sample document.
    const sampleForScope = await sampleService.getSample(db, req.params.id);
    if (sampleForScope && !isSampleInOrganizationScope(sampleForScope, req.organizationScope)) {
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

// #1559: the sample's projected graph status (RF019 cold-chain compromise), read in a READ session; the projector is the only graph writer.
router.get('/:id/graph-status', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const graphDb = req.app.locals.db;
    if (!graphDb) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const graphSample = await sampleService.getSample(graphDb, req.params.id);
    if (graphSample && !isSampleInOrganizationScope(graphSample, req.organizationScope)) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
      });
    }
    if (!graphSample) {
      return res.status(404).json({ success: false, error: 'Amostra não encontrada' });
    }

    const graphDriver = req.app.locals.neo4jDriver;
    if (!graphDriver) {
      return res.status(503).json({ success: false, error: 'Grafo indisponível' });
    }

    return res.status(200).json({
      success: true,
      data: await readSampleGraphStatus(graphDriver, String(graphSample._id)),
    });
  } catch (error) {
    logger.error('[SAMPLE_GRAPH_STATUS] Falha ao ler o estado projetado da amostra:', error.message);
    // A graph unreachable after boot is the same outage as an absent driver;
    // the driver's text (host and port) stays in the log, never in the body.
    if (error.code === 'ServiceUnavailable' || error.code === 'SessionExpired') {
      return res.status(503).json({ success: false, error: 'Grafo indisponível' });
    }
    return res.status(500).json({
      success: false,
      error: 'Erro ao ler o estado projetado da amostra',
    });
  }
});
const RegisterSampleUseCase = require('../../core/use-cases/RegisterSampleUseCase');
const LineageRepository = require('../../infrastructure/database/neo4j/LineageRepository');
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
const { SPECIMEN_ROLE_VALUES, findRcsDerivedFields, rcsDerivedWriteDetails } = require('../../models/Sample');

// #789: the prohibited pre-rename vocabulary, in ONE place. It was inlined
// in validateCreateSamplePayload only, so `GET /` had no way to reject the
// same names and silently ignored them instead -- the mechanism behind #533
// (currentStatus) and #785 (patientID). Both guards now read this list.
const NON_CANONICAL_SAMPLE_ALIASES = Object.freeze([
  'patientID',
  'sampleID',
  'sampleId',
  'registerDate',
  'registrationDate',
  'currentStatus',
  'merkle_root',
  // dict-02 ELM-0120 names the plural parentSpecimenIds (#1368).
  'parentSampleId',
  'parentSpecimenId',
]);

// #789: the query keys `GET /` actually applies. listSamples reads exactly
// these; anything else was dropped in flight with no signal, which is what
// #533 and #785 both were. Kept next to the alias list so the two stay in
// view of each other.
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
      fields: [...new Set(aliasFields)],
      details: [...new Set(aliasFields)].map((field) => `${field}: campo não canônico`)
    });
  }

  // RNF018 AC4: the RCS result is set only by certification, never by a caller.
  const rcsDerivedFields = findRcsDerivedFields(payload);
  if (rcsDerivedFields.length > 0) {
    return res.status(422).json({
      success: false,
      error: 'RCS_DERIVED_WRITE_REFUSED',
      fields: rcsDerivedFields,
      details: rcsDerivedWriteDetails(rcsDerivedFields)
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

  // #462: legacy `locationID` input replaced by boxId/positionCode, the
  // canonical StorageBox placement pair (docs/architecture/
  // legacy-location-migration-mapping.md).
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

  // dict-02 ELM-0120 (#1368): a derivative names its parents by specimenId.
  if (payload.parentSpecimenIds !== undefined) {
    if (!Array.isArray(payload.parentSpecimenIds)) {
      errors.push('parentSpecimenIds deve ser uma lista de specimenIds');
    } else if (payload.parentSpecimenIds.some((parentId) => typeof parentId !== 'string' || parentId.trim() === '')) {
      errors.push('parentSpecimenIds deve conter apenas specimenIds não vazios');
    } else if (new Set(payload.parentSpecimenIds.map((parentId) => parentId.trim())).size !== payload.parentSpecimenIds.length) {
      errors.push('parentSpecimenIds não pode repetir um specimenId');
    }
  }

  // ELM-0121 (#1201): the model checks the role against the parents.
  if (payload.specimenRole !== undefined
    && (typeof payload.specimenRole !== 'string'
      || !SPECIMEN_ROLE_VALUES.includes(payload.specimenRole.trim().toLowerCase()))) {
    errors.push('specimenRole deve ser primary, aliquot, derivative, pool ou control');
  }

  // RF018 AC2 (#1320): a use context that is sent names all five fields,
  // never a partial one stored with silent nulls. An absent one stays null.
  errors.push(...qualificationContextErrors(payload.qualificationContext));

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

// #847: this used to build its filter from `patient?.patientID` (dead --
// Patient.js's CANONICAL_FIELDS never declares it) and `patient?._id?.toString()`
// (an ObjectId string, never what `consents` documents store their
// participant under -- every writer emits `participantId`, e.g.
// PatientConsent.js:63, consent.service.js:901/918, RegisterSample.js:128,
// intakeWizard.js:523). The query therefore selected on a key absent from
// every consent document and findOne returned null every time, badging
// every sample not-consented regardless of a signed TCLE. Returning null
// here when the patient has no participantId of its own -- rather than
// falling back to some other identifier -- keeps an absent id from ever
// degrading into a match-anything filter, which was #788's failure mode.
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

// #655: reads directly off the already-fetched sample's own storageLocation
// snapshot (boxName/position, set by sample.service.js#createSample) rather
// than resolving the full freezer/shelf/rack path via storagePaths -- avoids
// depending on #657's cosmetic "N/A" gap for new code, and a print job only
// needs enough to find the box, not the full breadcrumb.
function buildLocationLineFromSample(sample) {
  const box = sample?.storageLocation || {};
  const parts = [
    box.boxName || box.boxId ? `Box ${box.boxName || box.boxId}` : null,
    box.position ? `Pos ${box.position}` : null,
  ].filter(Boolean);
  return parts.join(' / ') || null;
}

function buildZplPrintJob({ sampleId, barcode, location }) {
  const safeSampleId = escapeZpl(sampleId);
  const safeBarcode = escapeZpl(barcode);
  const safeLocation = location ? escapeZpl(location).slice(0, 44) : '';

  return [
    '^XA',
    '^CI28',
    '^PW600',
    '^LL320',
    '^FO35,28^A0N,30,30^FDBioAvanceD^FS',
    `^FO35,70^A0N,28,28^FDAmostra: ${safeSampleId}^FS`,
    `^FO35,110^BCN,80,Y,N,N^FD${safeBarcode}^FS`,
    safeLocation ? `^FO35,220^A0N,24,24^FD${safeLocation}^FS` : null,
    '^XZ',
  ].filter(Boolean).join('\n');
}

// #646 Wave 3 (RF016 AC#6): "auditar geração e reimpressão" -- shared by
// both label-generation routes below (SVG /:id/label and PNG
// /by-barcode/:barcode/symbology-assets) since they're two renderings of
// the same underlying concept (a specimen's label) and a reimpressão is
// tracked per specimen, not per format. labelGenerations is append-only:
// the presence of a prior entry for this sampleId is what makes this call
// a reprint rather than the first generation.
async function recordLabelGeneration(db, { sample, formats, req }) {
  const { getUserAnonId } = require('../../utils/userAnonymization');
  const labelGenerationsCollection = await getCollection(db, 'labelGenerations');
  const sampleId = String(sample._id);

  const priorGeneration = await labelGenerationsCollection.findOne({ specimenId: sampleId });
  const isReprint = Boolean(priorGeneration);

  await labelGenerationsCollection.insertOne({
    specimenId: sampleId,
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
        ? `Etiqueta reimpressa para amostra ${sampleId} (${formats.join(', ')})`
        : `Etiqueta gerada para amostra ${sampleId} (${formats.join(', ')})`,
      payload: { specimenId: sampleId, barcode: sample.barcode || null, formats, reprint: isReprint, generatedByAnonId },
      req,
      module: 'Amostras'
    });
  }

  return { reprint: isReprint };
}

// RF004 - Cadastro de Amostra
router.post('/',
  authenticate,
  requirePermission('createSample'),
  requireOrganizationScope,
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
        lineageRepository: new LineageRepository(db),
        quarantineService: req.app.locals.neo4jQuarantineService || req.app.locals.topologicalQuarantine || null
      });

      // #1185, #1192, #1376: #1071's create rule decides the organization the
      // sample belongs to -- a single-organization caller's own, a
      // multi-organization caller's pick among its own, a global caller's
      // pick of any existing organization, or none -- named in the body's own
      // organizationId field, and createSample stamps it as
      // Sample.organizationId. The body's organizationId is never passed on.
      // The collection site the body names (ELM-0128) is data and is kept; a
      // body naming none gets the stamped organization, as before.
      const requestedOrganizationId = typeof req.body?.organizationId === 'string' && req.body.organizationId.trim() !== ''
        ? req.body.organizationId.trim()
        : undefined;
      const { organizationId } = await resolveCallerCreateOrganization(db, {
        organizationScope: req.organizationScope,
        requested: requestedOrganizationId
      });
      const { organizationId: _bodyOrganizationId, ...body } = req.body || {};
      const namesCollectionSite = body.collectionSite !== undefined
        && body.collectionSite !== null
        && body.collectionSite !== '';
      const sampleData = namesCollectionSite || !organizationId
        ? body
        : { ...body, collectionSite: organizationId };

      const result = await registerSampleUseCase.execute({
        sampleData,
        options: { organizationId },
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
          resourceType: 'Sample',
          resourceId: sample._id.toString(),
          status: 'success',
          severity: 'info',
          // #795: `sample.patientID` was undefined at all three read sites in
          // this handler -- SampleModel.create emits `participantId` and
          // Sample.js does not declare `patientID`. The audit row therefore
          // read literally "Paciente ID: undefined" for every sample ever
          // created, and the payload key serialised away entirely. Unlike
          // #788's list badge there is no live recomputation to fall back on,
          // so an audit row written wrong stays wrong.
          message: `Amostra criada - Participante ID: ${sample.participantId}`, // Apenas ID, sem dados sensíveis
          payload: {
            specimenId: sample.specimenId || null,
            participantId: sample.participantId, // Apenas ID anonimizado
            sampleType: sample.sampleType,
            barcode: sample.barcode,
            quality: sample.quality !== undefined && sample.quality !== null ? sample.quality : null // Id MIABIS canônico
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
          // #1216: the canonical business id every report, ledger row and
          // export carries, and every id-taking sample, file and storage
          // route resolves. The Mongo _id left the response under its
          // prohibited legacy name, sampleID.
          specimenId: sample.specimenId || null,
          // #795: canonical name on the way out, matching the way in --
          // validateCreateSamplePayload already 422s a request carrying
          // `patientID` (NON_CANONICAL_FIELD), and the field is on
          // canonical-data-contract-v1.md's "Legacy Fields Prohibited" list.
          // Renaming breaks no caller: the value was `undefined`, so
          // JSON.stringify has always dropped the key from this response.
          participantId: sample.participantId, // Apenas ID, sem dados sensíveis (LGPD)
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

      // RNF007 AC4 (#1463): a barcode holding personal data answers its stable code.
      if (error.code === 'BARCODE_PERSONAL_DATA') {
        return res.status(422).json({ success: false, error: 'BARCODE_PERSONAL_DATA', message: errorMessage, details: [errorMessage] });
      }

      if ([400, 422].includes(error.status || error.statusCode)) {
        return res.status(error.status || error.statusCode).json({
          success: false,
          error: req.t?.('samples.createError') || 'Erro ao criar amostra',
          message: errorMessage,
          details: error.details
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

router.get('/', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    // #789: the prohibited pre-rename names are now rejected on the way IN
    // here too, with the same 422 NON_CANONICAL_FIELD contract
    // validateCreateSamplePayload applies to the POST body. Same vocabulary
    // migration, same feedback -- previously GET answered 200 with a full
    // unfiltered page and nothing to distinguish it from a filtered one.
    const queryAliases = findNonCanonicalAliases(req.query);
    if (queryAliases.length > 0) {
      return res.status(422).json({
        success: false,
        error: 'NON_CANONICAL_FIELD',
        fields: [...new Set(queryAliases)],
        details: [...new Set(queryAliases)].map((field) => `${field}: campo não canônico`)
      });
    }

    // #789: an unrecognised-but-not-prohibited key is still not a hard error
    // -- unknown callers currently get a soft failure and #780 deliberately
    // chose a fallback over a rejection for exactly that reason. What changes
    // is that the drop stops being silent: it is logged, and the response
    // echoes what was actually applied, the way log.service.js echoes the
    // sort it actually used.
    const ignoredQueryParams = Object.keys(req.query || {}).filter(
      (key) => !RECOGNIZED_SAMPLE_QUERY_KEYS.includes(key)
    );
    if (ignoredQueryParams.length > 0) {
      logger.warn(
        `[SAMPLES] Parâmetros de consulta não reconhecidos, ignorados: ${ignoredQueryParams.join(', ')}`
      );
    }

    // #533: currentStatus was accepted here but sample.service.js#listSamples
    // never applied it to the query (only participantId/specimenStatus/
    // sampleType are) — dropped rather than wired up, since no frontend
    // caller ever sends it (see #533's follow-up for the broader
    // status/currentStatus-vs-specimenStatus trace).
    // #785: the sibling instance of that same class, three lines below the
    // note above. The key built here was patientID, which listSamples never
    // reads, so the participant filter was dropped in flight and the endpoint
    // answered with an unfiltered page and a 200. participantId is the
    // canonical name (Sample.js:31, required + indexed); patientID is the
    // pre-rename alias validateCreateSamplePayload rejects with a 422
    // NON_CANONICAL_FIELD, so it is not re-admitted here as a query alias.
    const filters = {
      participantId: req.query.participantId,
      sampleType: req.query.sampleType,
      limit: parseInt(req.query.limit) || 50,
      skip: parseInt(req.query.skip) || 0,
      organizationScope: req.organizationScope
    };

    const result = await sampleService.listSamples(db, filters);

    // #517: resolve current storage location + SPREC profile per sample,
    // batched (one query per collection across the whole page, not one
    // per row) so the list view doesn't have to read the legacy embedded
    // shape or make N per-sample follow-up requests.
    const MongoStorageRepository = require('../../infrastructure/persistence/mongo/MongoStorageRepository');
    const specimenPreanalyticsService = require('../../services/specimen-preanalytics.service');
    const storageRepository = new MongoStorageRepository(db);
    const [storageLocationsBySampleId, currentProfilesBySpecimenId] = await Promise.all([
      storageRepository.resolveStorageLocationsForSamples(result.samples),
      specimenPreanalyticsService.getCurrentProfilesForSpecimens(db, result.samples)
    ]);

    // Enriquecer amostras com informação de consentimento
    const patientConsentsCollection = await getCollection(db, 'consents');
    const patientsCollection = await getCollection(db, 'patients');

    const enrichedSamples = await Promise.all(result.samples.map(async (sample) => {
      let consentValid = false;
      let consentMessage = '';
      let canUse = false;

      // Buscar paciente pelo identificador canonico da amostra.
      // #788: isto lia `sample.patientID`, um campo que nenhum escritor grava
      // (Sample.js:31 declara `participantId`; RegisterSample.js e
      // import-lgpd.service.js gravam so esse). Patient.js tambem nao tem
      // `patientID` em CANONICAL_FIELDS, entao as duas pernas do $or eram
      // mortas. Como `undefined` serializa para null, a consulta degenerava
      // para `{ patientID: null }`, que casa com QUALQUER paciente -- o
      // findOne devolvia um arbitrario e o selo de consentimento de toda
      // amostra vinha do consentimento de um paciente sem relacao com ela.
      // O guard abaixo e parte do conserto: sem identificador nao se monta
      // filtro, para que a consulta nunca possa degenerar desse jeito.
      const participantId = String(sample?.participantId ?? '').trim();
      const patient = participantId
        ? await patientsCollection.findOne({ participantId })
        : null;

      if (patient) {
        // Verificar se há consentimento ativo
        // #847: a null query means the patient has no participantId of its
        // own -- treated as "no active consent" without issuing a findOne,
        // rather than falling back to a filter that could match anything.
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
        resolvedStorageLocation: storageLocationsBySampleId.get(String(sample._id)) || null,
        currentSpecimenPreanalytics: currentProfilesBySpecimenId.get(String(sample.specimenId || '')) || null
      };
    }));

    // Registra log de consulta de amostras
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
      // #789: what the server actually filtered on. Without this the drop of
      // an unrecognised parameter is as invisible as the bug it replaces.
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
    const numericId = Number(rawId);
    const sample = await samplesCollection.findOne({
      $or: [
        ...(ObjectId.isValid(rawId) ? [{ _id: new ObjectId(rawId) }] : []),
        { specimenId: rawId },
        ...(Number.isFinite(numericId) ? [{ sampleID: numericId }] : []),
        { sampleID: rawId },
        { sampleId: rawId },
        { barcode: rawId },
      ],
    });
    if (!sample) {
      return res.status(404).json({
        success: false,
        error: 'Amostra não encontrada'
      });
    }

    // #619: mirrors #340's GET /:id out-of-scope 403 — a sub-resource
    // route for an existing sample outside the caller's organization scope
    // must not leak the label either.
    if (!isSampleInOrganizationScope(sample, req.organizationScope)) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
      });
    }

    // The canonical specimenId, which SampleModel writes; sampleID is the
    // retired name, kept as a fallback for rows written before the rename.
    const sampleIdentifier = escapeXml(String(sample.specimenId || sample.sampleID || sample._id || req.params.id));
    const barcode = escapeXml(String(sample.barcode || sampleIdentifier));
    const title = escapeXml(String(sample.sampleType || 'AMOSTRA').slice(0, 32));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="378" height="189" viewBox="0 0 378 189">
  <rect width="378" height="189" fill="#fff" stroke="#111" stroke-width="2"/>
  <text x="189" y="34" font-family="Arial, sans-serif" font-size="20" font-weight="700" text-anchor="middle">${title}</text>
  <text x="189" y="92" font-family="Arial, sans-serif" font-size="24" font-weight="700" text-anchor="middle">${barcode}</text>
  <text x="189" y="150" font-family="Arial, sans-serif" font-size="18" text-anchor="middle">${sampleIdentifier}</text>
</svg>`;

    // #646 Wave 3 (RF016 AC#6) - audited before responding so a request
    // that never actually returns the label to the caller (e.g. a client
    // disconnect) doesn't count as a generation.
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

// #655: RF016's own requirement text is "gerar E imprimir etiquetas" --
// label.routes.js (the route SampleLabelPage.tsx used to call) had ZPL
// print-job generation this file's symbology-backed label family didn't;
// ported here so nothing is lost now the real UI is redirected to this
// file's endpoints instead. ZPL's own ^BC command draws the Code128
// barcode from the raw value at print time -- unlike the on-screen
// symbology-assets endpoint, a print job doesn't need a rendered PNG.
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
    const numericId = Number(rawId);
    const sample = await samplesCollection.findOne({
      $or: [
        ...(ObjectId.isValid(rawId) ? [{ _id: new ObjectId(rawId) }] : []),
        { specimenId: rawId },
        ...(Number.isFinite(numericId) ? [{ sampleID: numericId }] : []),
        { sampleID: rawId },
        { sampleId: rawId },
        { barcode: rawId },
      ],
    });
    if (!sample) {
      return res.status(404).json({
        success: false,
        error: 'Amostra não encontrada'
      });
    }

    if (!isSampleInOrganizationScope(sample, req.organizationScope)) {
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

    // specimenId first, as the SVG label route above.
    const sampleIdentifier = String(sample.specimenId ?? sample.sampleID ?? sample._id);
    const location = buildLocationLineFromSample(sample);
    const zpl = buildZplPrintJob({ sampleId: sampleIdentifier, barcode: sample.barcode, location });

    // #646 Wave 3 (RF016 AC#6) - audited before responding, same reasoning
    // as the SVG label route above.
    const { reprint } = await recordLabelGeneration(db, { sample, formats: ['zpl'], req });

    return res.status(200).json({
      success: true,
      data: {
        sampleId: sampleIdentifier,
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

// #646 Wave 3 (RF016 AC#4): "gerar lote após cadastro ou importação
// autorizada" -- batch generation on demand, given a list of specimen
// identifiers (the caller resolves which samples just came from a
// registration/import run; this endpoint doesn't itself auto-trigger from
// either, same scoping decision as #650's notification-domain follow-up).
// Each sample is resolved and scope-checked individually so one caller
// can't fish for another organization's labels by including its id in the
// batch -- a per-id 403 in results, not a whole-request failure.
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
        const numericId = Number(id);
        const sample = await samplesCollection.findOne({
          $or: [
            ...(ObjectId.isValid(id) ? [{ _id: new ObjectId(id) }] : []),
            { specimenId: id },
            ...(Number.isFinite(numericId) ? [{ sampleID: numericId }] : []),
            { sampleID: id },
            { sampleId: id },
            { barcode: id },
          ],
        });

        if (!sample) {
          return { specimenId: id, success: false, error: 'Amostra não encontrada' };
        }

        if (!isSampleInOrganizationScope(sample, req.organizationScope)) {
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
      error: 'Erro ao gerar lote de etiquetas',
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

    const sample = await sampleService.getSample(db, req.params.id);

    // #340: an existing sample outside the caller's organization scope
    // 403s rather than 404s, matching sample-file.controller.js's
    // out-of-scope precedent — direct access, not a discoverability leak
    // via a different error code, but not a silent pass-through either.
    if (sample && !isSampleInOrganizationScope(sample, req.organizationScope)) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
      });
    }

    if (!sample) {
      // Registra tentativa de busca de amostra inexistente
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

    // Registra log de busca de amostra
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

// RF006 - Retirada de Amostra
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

      // #623: mirrors #340/#619's out-of-scope 403 pattern — the scope
      // check runs before the mutation, not just before a read.
      const sampleForScope = await sampleService.getSample(db, req.params.id);
      if (sampleForScope && !isSampleInOrganizationScope(sampleForScope, req.organizationScope)) {
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

      
      // Preparar informações de auditoria
      const auditInfo = {
        userId: req.user?.id || req.user?._id?.toString(),
        userName: req.user?.name || req.user?.username,
        userRole: req.user?.roleName || req.user?.role,
        ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
        userAgent: req.headers['user-agent']
      };
      
      const result = await sampleService.withdrawSample(db, req.params.id, req.body, auditInfo);

      // Registra log de alta severidade (RF006)
      if (req.user) {
        const auditLogger = require('../../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'WITHDRAW',
          resourceType: 'Sample',
          resourceId: req.params.id,
          status: 'success',
          severity: 'warning',
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
router.put('/:id', authenticate, requirePermission('editSample'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    // #623: mirrors #340/#619's out-of-scope 403 pattern — the scope
    // check runs before the mutation, not just before a read.
    const sampleForScope = await sampleService.getSample(db, req.params.id);
    if (sampleForScope && !isSampleInOrganizationScope(sampleForScope, req.organizationScope)) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
      });
    }

    // #1053: the check above proves the sample is CURRENTLY the caller's.
    // updateSample's allowlist contains collectionSite, so without a
    // destination check an in-scope caller could push their own sample into
    // another organization. #1192: that holds only while the sample has no
    // organizationId, when collectionSite is still its tenancy key; once the
    // key is stamped, editing collectionSite is editing data.
    const sampleOrganizationId = sampleForScope?.organizationId;
    if (sampleForScope
      && (sampleOrganizationId === undefined || sampleOrganizationId === null || sampleOrganizationId === '')) {
      assertOrganizationFieldNotReparented(req.organizationScope, sampleForScope.collectionSite, req.body?.collectionSite, 'collectionSite');
    }

    // RF019 AC5 (#1315): leaving quarantine is an evidenced release with its
    // own route, never an edit of the status field.
    if (sampleForScope?.specimenStatus === 'quarantined'
      && String(req.body?.specimenStatus || '').toLowerCase() === 'available') {
      return res.status(409).json({
        success: false,
        error: 'QUARANTINE_RELEASE_REQUIRED',
        message: 'Uma amostra em quarentena é liberada por POST /api/samples/:id/quarantine/release, com evidência',
      });
    }

    const result = await sampleService.updateSample(db, req.params.id, req.body);

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
    // #1053: a refused re-parent throws statusCode:403. Mapped explicitly
    // rather than honouring any error.statusCode, which would change the
    // status of updateSample's own validation errors.
    if (error.statusCode === 403) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: error.message
      });
    }
    // RF006 AC3 / RF026 AC7: a refused status write (quantityStatus,
    // `closed`, a v1.3.0 value, a change out of closed) answers 422.
    if (error.code === 'SPECIMEN_STATUS_WRITE_REFUSED') {
      return res.status(422).json({
        success: false,
        error: 'SPECIMEN_STATUS_WRITE_REFUSED',
        message: error.message,
        details: [error.message]
      });
    }
    // RNF018 AC4: a write to the RCS result answers 422.
    if (error.code === 'RCS_DERIVED_WRITE_REFUSED') return res.status(422).json({ success: false, error: 'RCS_DERIVED_WRITE_REFUSED', message: error.message, fields: error.fields, details: error.details });
    // RF018 AC10 (#1537): an edit that changes the certified SPREC answers 422.
    if (error.code === 'SPREC_WRITE_REFUSED') return res.status(422).json({ success: false, error: 'SPREC_WRITE_REFUSED', message: error.message, fields: error.fields, details: error.details });
    // RNF018 AC1 (#1525): a negative or non-numeric quantity answers 422.
    if (error.code === 'INVALID_QUANTITY') return res.status(422).json({ success: false, error: 'INVALID_QUANTITY', message: error.message, fields: error.fields, details: error.details });
    // RF006 AC4 (#1531): an edit of a ledgered quantity answers 422.
    if (error.code === 'QUANTITY_LEDGER_WRITE_REFUSED') return res.status(422).json({ success: false, error: 'QUANTITY_LEDGER_WRITE_REFUSED', message: error.message, fields: error.fields, details: error.details });
    // #1548: a reseal that lost a race with another edit answers 409; the client re-reads.
    if (error.code === 'SAMPLE_SEAL_WRITE_CONFLICT') return res.status(409).json({ success: false, error: 'SAMPLE_SEAL_WRITE_CONFLICT', message: error.message, details: error.details });
    // #1378 (ELM-0116): a barcode write after the migration window answers 422.
    if (error.code === 'LEGACY_BARCODE_WRITE_REFUSED') {
      return res.status(422).json({
        success: false,
        error: 'LEGACY_BARCODE_WRITE_REFUSED',
        message: error.message,
        details: [error.message]
      });
    }
    // RNF007 AC4 (#1463): a barcode holding personal data answers its stable code.
    if (error.code === 'BARCODE_PERSONAL_DATA') {
      return res.status(422).json({ success: false, error: 'BARCODE_PERSONAL_DATA', message: error.message, details: [error.message] });
    }
    return res.status(400).json({
      success: false,
      error: 'Erro ao atualizar amostra',
      message: error.message
    });
  }
});

// Deletar amostra
router.delete('/:id', authenticate, requirePermission('deleteSample'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    // #623: mirrors #340/#619's out-of-scope 403 pattern — the scope
    // check runs before the mutation, not just before a read.
    const sampleForScope = await sampleService.getSample(db, req.params.id);
    if (sampleForScope && !isSampleInOrganizationScope(sampleForScope, req.organizationScope)) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
      });
    }

    const result = await sampleService.deleteSample(db, req.params.id);

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

// Buscar amostras por termo (barcode ou ID) - para autocomplete
router.get('/search/by-term', authenticate, requireOrganizationScope, async (req, res) => {
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
    // #533: excluir amostras retiradas via withdrawnAt (o sinal real que
    // sample.service.js#withdrawSample grava) — currentStatus:'WITHDRAWN'
    // nunca é escrito por nenhum fluxo do backend, então esse filtro nunca
    // excluía nada.
    const query = {
      $or: [
        { barcode: { $regex: term, $options: 'i' } },
        { _id: { $regex: term, $options: 'i' } }
      ],
      withdrawnAt: null
    };
    // #1187: scoped like GET / -- this search carried only `authenticate`.
    applySampleOrganizationScope(query, req.organizationScope);

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

// Buscar amostra por código de barras
router.get('/by-barcode/:barcode', authenticate, requireOrganizationScope, async (req, res) => {
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

    // #1187: GET /:id's #340 check. This lookup returned the sample and its
    // patient's name to any authenticated caller.
    if (!isSampleInOrganizationScope(result.sample, req.organizationScope)) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
      });
    }

    // Registra log de busca por código de barras
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

// #655/#653: this route had no requireOrganizationScope/organization-scope
// check at all, unlike every other sample sub-resource route in this file --
// filed as #653 when this was still an unreached backend capability;
// SampleLabelPage.tsx now depends on it directly, so the gap is fixed
// alongside the redirect rather than left for a separate slice.
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

    if (!isSampleInOrganizationScope(lookup.sample, req.organizationScope)) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
      });
    }

    const includePayload = String(req.query.includePayload || 'false').toLowerCase() === 'true';
    const assets = await sampleService.getBarcodeIndustrialAssets(barcode, { includePayload });

    // #646 Wave 3 (RF016 AC#6).
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

// Buscar arquivos de analise de uma amostra
router.get('/:id/results', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    // #619: mirrors #340's GET /:id out-of-scope 403 for this sub-resource.
    const sampleForScope = await sampleService.getSample(db, req.params.id);
    if (sampleForScope && !isSampleInOrganizationScope(sampleForScope, req.organizationScope)) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
      });
    }

    const results = await sampleService.getSampleResults(db, req.params.id);

    // Registra log de consulta de arquivos de analise da amostra
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      resourceType: 'Sample',
      resourceId: req.params.id,
      status: 'success',
      severity: 'info',
      message: `Arquivos de analise da amostra consultados - ${results.length || 0} registros`,
      payload: { specimenId: sampleForScope?.specimenId || req.params.id, resultsCount: results.length || 0 },
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
router.post('/:id/return', authenticate, requirePermission('withdrawSample', 'UPDATE'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    // #623: mirrors #340/#619's out-of-scope 403 pattern — the scope
    // check runs before the mutation, not just before a read.
    const sampleForScope = await sampleService.getSample(db, req.params.id);
    if (sampleForScope && !isSampleInOrganizationScope(sampleForScope, req.organizationScope)) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
      });
    }


    // Preparar informações de auditoria
    const auditInfo = {
      userId: req.user?.id || req.user?._id?.toString(),
      userName: req.user?.name || req.user?.username,
      userRole: req.user?.roleName || req.user?.role,
      ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
      userAgent: req.headers['user-agent']
    };
    
    const result = await sampleService.returnSample(db, req.params.id, req.body, auditInfo);

    // Registra log (anonimizado via auditLogger)
    if (req.user) {
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'RETURN',
        resourceType: 'Sample',
        resourceId: req.params.id,
        status: 'success',
        severity: 'warning',
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
router.get('/:id/movements', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    // #619: mirrors #340's GET /:id out-of-scope 403 for this sub-resource.
    const sampleForScope = await sampleService.getSample(db, req.params.id);
    if (sampleForScope && !isSampleInOrganizationScope(sampleForScope, req.organizationScope)) {
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

// dict-07/dict-08 (#383) - RCS certificado como entidade separada e
// referenciada por specimenId (não duplicada em Sample). Snapshots
// versionados, mais recente primeiro.
router.get('/:id/rcs-assessments', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    // #619: mirrors #340's GET /:id out-of-scope 403 for this sub-resource.
    const sampleForScope = await sampleService.getSample(db, req.params.id);
    if (sampleForScope && !isSampleInOrganizationScope(sampleForScope, req.organizationScope)) {
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

// dict-07/dict-08 (#388) - SPREC (SpecimenPreanalytics) como entidade
// separada e referenciada por specimenId (não duplicada em Sample).
// Snapshots versionados, mais recente primeiro — mirrors #383's
// RcsAssessment/GET /:id/rcs-assessments pattern.
router.get('/:id/sprec-profiles', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    // #619: mirrors #340's GET /:id out-of-scope 403 for this sub-resource.
    const sampleForScope = await sampleService.getSample(db, req.params.id);
    if (sampleForScope && !isSampleInOrganizationScope(sampleForScope, req.organizationScope)) {
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

// dict-02 P1X-0113–0119 (#406) - QuarantineAction como entidade separada e
// referenciada por specimenIds (não duplicada em Sample). Histórico
// versionado, mais recente primeiro — mirrors #383's RcsAssessment/
// GET /:id/rcs-assessments pattern.
// RF019 AC5/AC6 (#1315): an authorized actor (Coordenador or Administrador)
// releases a quarantined specimen with evidence, once the rule behind each
// open quarantine is satisfied (quarantine-release.service.js).
router.post('/:id/quarantine/release', authenticate, requireRole(3, 4), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }
    const sample = await sampleService.getSample(db, req.params.id);
    if (!sample) {
      return res.status(404).json({ success: false, error: 'Amostra não encontrada' });
    }
    if (!isSampleInOrganizationScope(sample, req.organizationScope)) {
      return res.status(403).json({ success: false, error: 'Acesso negado', message: 'Esta amostra pertence a outra organização' });
    }
    const released = await quarantineReleaseService.releaseQuarantine(db, sample, {
      actorId: req.user?.userID || req.user?.id || null,
      evidenceIds: req.body?.evidenceIds,
      reason: req.body?.reason || null,
      req,
    });
    // RF019 AC6: the release itself is audited on the specimen, with its
    // evidence, whether or not it closed a QuarantineAction.
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'sample_release',
      resourceType: 'Sample',
      resourceId: req.params.id,
      status: 'success',
      severity: 'warning',
      message: 'Quarentena liberada com evidência',
      payload: {
        evidenceIds: released.evidenceIds,
        reason: req.body?.reason || null,
        releasedActionIds: released.releasedActions.map((action) => action.quarantineActionId),
      },
      req,
    });
    return res.status(200).json({ success: true, data: released });
  } catch (error) {
    if (error instanceof quarantineReleaseService.QuarantineReleaseError) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.code,
        message: error.message,
        ...(error.unsatisfied ? { unsatisfied: error.unsatisfied } : {}),
      });
    }
    logger.error('Erro ao liberar quarentena:', error.message);
    return res.status(500).json({ success: false, error: 'Erro ao liberar quarentena' });
  }
});

// RF026 AC7 (dictionary RULE-006): closes a fully consumed specimen
// (quantityStatus depleted), recorded as an OperationalStateDecision and
// audited. A specimen still holding material is refused (409), as is one
// already closed. The other closing path is an executed destroy or transfer
// DispositionAction. Same permission as the edit route: no narrower one
// exists for this change. editSample allows only UPDATE, and a POST maps to
// CREATE, so the action is passed explicitly, as on POST /:id/return.
router.post('/:id/close', authenticate, requirePermission('editSample', 'UPDATE'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }
    const sampleForScope = await sampleService.getSample(db, req.params.id);
    if (!sampleForScope) {
      return res.status(404).json({ success: false, error: 'Amostra não encontrada' });
    }
    if (!isSampleInOrganizationScope(sampleForScope, req.organizationScope)) {
      return res.status(403).json({ success: false, error: 'Acesso negado', message: 'Esta amostra pertence a outra organização' });
    }

    const closed = await sampleService.closeSpecimen(db, req.params.id, {
      actorId: req.user?.userID || req.user?.id || null,
    });
    if (!closed) {
      return res.status(404).json({ success: false, error: 'Amostra não encontrada' });
    }

    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'UPDATE',
      resourceType: 'Sample',
      resourceId: req.params.id,
      status: 'success',
      severity: 'critical',
      message: 'Amostra encerrada (closed) após consumo total validado',
      payload: {
        previousStatus: closed.previousStatus,
        specimenStatus: closed.specimenStatus,
        quantityStatus: closed.quantityStatus,
        operationalStateDecisionId: closed.operationalStateDecisionId,
        rulesApplied: ['rf026_ac7_validated_consumption'],
      },
      req,
    });

    return res.status(200).json({ success: true, data: closed });
  } catch (error) {
    if (error.statusCode === 409) {
      return res.status(409).json({ success: false, error: 'SPECIMEN_CLOSE_REFUSED', message: error.message });
    }
    logger.error('Erro ao encerrar amostra:', error.message);
    return res.status(500).json({ success: false, error: 'Erro ao encerrar amostra' });
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

    // #619: mirrors #340's GET /:id out-of-scope 403 for this sub-resource.
    const sampleForScope = await sampleService.getSample(db, req.params.id);
    if (sampleForScope && !isSampleInOrganizationScope(sampleForScope, req.organizationScope)) {
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

// RF006 AC7: the append-only OperationalStateDecisions of a specimen, one
// per specimenStatus change, oldest first.
router.get('/:id/state-decisions', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const sampleForScope = await sampleService.getSample(db, req.params.id);
    if (sampleForScope && !isSampleInOrganizationScope(sampleForScope, req.organizationScope)) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Esta amostra pertence a outra organização'
      });
    }

    const decisions = await sampleService.getStateDecisions(db, req.params.id);
    if (!decisions) {
      return res.status(404).json({
        success: false,
        error: 'Amostra não encontrada'
      });
    }

    return res.status(200).json({
      success: true,
      data: decisions
    });
  } catch (error) {
    logger.error('Erro ao buscar decisões de estado:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar decisões de estado',
      message: error.message
    });
  }
});

// RF007 - Upload de Arquivos de Análise
const sampleFileController = require('../../controllers/sample-file.controller');

// #625: requireOrganizationScope on all 8 routes below, mirroring the
// rest of this file's org-scope precedent — the actual per-record 403
// check runs inside sample-file.controller.js itself (post-fetch), same
// split as patient.routes.js/paciente.controller.js (#626).

// Upload de arquivo - Apenas Admin e Coordenador
router.post('/:specimenId/files/upload',
  authenticate,
  requirePermission('uploadSampleFiles'),
  requireOrganizationScope,
  sampleFileController.uploadMiddleware(),
  sampleFileController.uploadFile.bind(sampleFileController)
);

// Lista arquivos - Todos os perfis autenticados
router.get('/:specimenId/files',
  authenticate,
  requireOrganizationScope,
  sampleFileController.listFiles.bind(sampleFileController)
);

// Download de arquivo - Todos os perfis autenticados
router.get('/:specimenId/files/:fileID/download',
  authenticate,
  requireOrganizationScope,
  sampleFileController.downloadFile.bind(sampleFileController)
);

// Deletar arquivo - Apenas Admin e Coordenador
router.delete('/:specimenId/files/:fileID',
  authenticate,
  requirePermission('deleteSampleFiles'),
  requireOrganizationScope,
  sampleFileController.deleteFile.bind(sampleFileController)
);

// Substituir arquivo - Apenas Admin e Coordenador (RF007 AC#7, #334)
// #631: explicit 'CREATE' action -- uploadSampleFiles's catalog entry
// only allows CREATE, but this route's PUT verb defaults to UPDATE via
// METHOD_TO_ACTION; a replace is a new-content write, same as upload.
router.put('/:specimenId/files/:fileID/replace',
  authenticate,
  requirePermission('uploadSampleFiles', 'CREATE'),
  requireOrganizationScope,
  sampleFileController.uploadMiddleware(),
  sampleFileController.replaceFile.bind(sampleFileController)
);

// Exportação HL7 - Todos os perfis autenticados podem exportar (não contém dados sensíveis, apenas patientID anonimizado)
// HL7 v2.x
router.get('/:specimenId/files/:fileID/export/hl7',
  authenticate,
  requireOrganizationScope,
  requireDataExportAllowed,
  enforceCommercialConsent({ resolveSampleId: (req) => req.params.specimenId }),
  sampleFileController.exportHL7v2.bind(sampleFileController)
);

// FHIR R4 JSON
router.get('/:specimenId/files/:fileID/export/fhir',
  authenticate,
  requireOrganizationScope,
  requireDataExportAllowed,
  enforceCommercialConsent({ resolveSampleId: (req) => req.params.specimenId }),
  sampleFileController.exportFHIR.bind(sampleFileController)
);

// CDA XML
router.get('/:specimenId/files/:fileID/export/cda',
  authenticate,
  requireOrganizationScope,
  requireDataExportAllowed,
  enforceCommercialConsent({ resolveSampleId: (req) => req.params.specimenId }),
  sampleFileController.exportCDA.bind(sampleFileController)
);

router._test = {
  validateCreateSamplePayload,
};

module.exports = router;

