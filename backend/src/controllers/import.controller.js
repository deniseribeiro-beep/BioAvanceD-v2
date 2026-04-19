const multer = require('multer');
const path = require('path');
const fs = require('fs');
const importService = require('../services/import.service');
const logService = require('../services/log.service');
const logger = require('../utils/logger');

// Configuração do multer para upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(__dirname, '../../uploads/temp');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const blockedExts = ['.exe', '.sh', '.bat'];

    if (blockedExts.includes(ext)) {
      const err = new Error('Formato de arquivo não seguro');
      err.status = 400;
      return cb(err, false);
    }

    const allowedMimes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/json',
      'application/zip',
      'application/x-zip-compressed'
    ];

    if (!allowedMimes.includes(file.mimetype)) {
      const err = new Error('Formato de arquivo não seguro');
      err.status = 400;
      return cb(err, false);
    }

    cb(null, true);
  },
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

/**
 * Controller de Importação
 * RF007 - Upload e Importação de Dados
 */
class ImportController {
  /**
   * Middleware de upload
   */
  uploadMiddleware() {
    return upload.single('file');
  }

  /**
   * Valida arquivo antes de importar
   */
  async validate(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { dataType } = req.body;
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'Arquivo não fornecido'
        });
      }

      if (!dataType || !['patients', 'samples', 'results', 'temperature', 'locations'].includes(dataType)) {
        return res.status(400).json({
          success: false,
          error: 'Tipo de dados inválido'
        });
      }

      // Valida formato
      if (!importService.validateFileFormat(file, dataType)) {
        importService.cleanupFile(file.path);
        return res.status(400).json({
          success: false,
          error: 'Formato de arquivo não suportado para este tipo de dados'
        });
      }

      // Valida estrutura (CSV)
      if (path.extname(file.originalname).toLowerCase() === '.csv') {
        try {
          const validation = await importService.validateCSVStructure(file, dataType);
          return res.status(200).json({
            success: true,
            message: 'Arquivo válido',
            data: {
              valid: true,
              rowCount: validation.rowCount,
              headers: validation.headers
            }
          });
        } catch (error) {
          importService.cleanupFile(file.path);
          return res.status(400).json({
            success: false,
            error: 'Estrutura do arquivo inválida',
            message: error.message
          });
        }
      }

      // JSON - validação básica
      if (path.extname(file.originalname).toLowerCase() === '.json') {
        const fhirValidation = importService.validateFHIRFile(file);

        if (fhirValidation.isFhir && !fhirValidation.valid) {
          logger.warn('Validação FHIR falhou (sync import):', JSON.stringify(fhirValidation.operationOutcome));
          importService.cleanupFile(file.path);
          return res.status(400).json({
            success: false,
            error: 'Validação FHIR falhou',
            errors: fhirValidation.issues.map(issue => issue.diagnostics),
            operationOutcome: fhirValidation.operationOutcome
          });
        }

        return res.status(200).json({
          success: true,
          message: fhirValidation.isFhir ? 'Arquivo FHIR válido' : 'Arquivo válido',
          data: { valid: true, fhir: fhirValidation.isFhir, resourcesValidated: fhirValidation.resourcesValidated || 0 }
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Arquivo válido',
        data: { valid: true }
      });
    } catch (error) {
      logger.error('Erro na validação:', error.message);
      if (req.file) {
        importService.cleanupFile(req.file.path);
      }
      return res.status(500).json({
        success: false,
        error: 'Erro ao validar arquivo',
        message: error.message
      });
    }
  }

  /**
   * Importa dados
   */
  async import(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { dataType } = req.body;
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'Arquivo não fornecido'
        });
      }

      let results;

      try {
        switch (dataType) {
          case 'patients':
            results = await importService.importPatients(db, file);
            break;
          case 'samples':
            results = await importService.importSamples(db, file);
            break;
          case 'temperature':
            results = await importService.importTemperature(db, file);
            break;
          case 'locations':
            results = await importService.importLocations(db, file);
            break;
          case 'results':
            // TODO: Implementar importacao de arquivos de analise
            results = { success: 0, errors: [{ error: 'Importacao de arquivos de analise ainda nao implementada' }], total: 0 };
            break;
          default:
            throw new Error('Tipo de dados não suportado');
        }

        // Registra log de importação (anonimizado via auditLogger)
        if (req.user) {
          const auditLogger = require('../utils/auditLogger');
          auditLogger.init(db);
          const entityName = mapDataTypeToEntity(dataType);
          await auditLogger.logImport(
            req, 
            entityName, 
            results.errors.length === 0 ? 'success' : 'partial',
            results.total, 
            results.success, 
            results.errors.length
          );
        }

        // Limpa arquivo temporário
        importService.cleanupFile(file.path);

        return res.status(200).json({
          success: true,
          message: 'Importação concluída',
          data: results
        });
      } catch (error) {
        importService.cleanupFile(file.path);
        throw error;
      }
    } catch (error) {
      logger.error('Erro na importação:', error.message);
      if (req.file) {
        importService.cleanupFile(req.file.path);
      }
      return res.status(500).json({
        success: false,
        error: 'Erro ao importar dados',
        message: error.message
      });
    }
  }
}

function mapDataTypeToEntity(dataType) {
  const s = (dataType || '').toString().toLowerCase();
  if (s.includes('sample')) return 'Sample';
  if (s.includes('patient')) return 'Patient';
  if (s.includes('result')) return 'Result';
  if (s.includes('temper')) return 'Temperature';
  return 'Import';
}

module.exports = new ImportController();

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function parseNumberSafe(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function resolveSprecAxisFromSpecimen(specimen = {}) {
  const direct = specimen?.sprec && typeof specimen.sprec === 'object' ? specimen.sprec : {};

  const extensionSprec = Array.isArray(specimen?.extension)
    ? specimen.extension.find((item) => {
      const url = String(item?.url || '').toLowerCase();
      return url.includes('sprec') && item?.valueObject && typeof item.valueObject === 'object';
    })
    : null;

  const extensionObject = extensionSprec?.valueObject && typeof extensionSprec.valueObject === 'object'
    ? extensionSprec.valueObject
    : {};

  return {
    matrixType: String(direct.matrixType || extensionObject.matrixType || specimen?.matrixType || 'fluid').trim().toLowerCase(),
    sampleType: normalizeCode(direct.sampleType || extensionObject.sampleType || specimen?.sampleType || specimen?.type?.coding?.[0]?.code || specimen?.type?.text || ''),
    primaryContainer: normalizeCode(direct.primaryContainer || extensionObject.primaryContainer || specimen?.primaryContainer || ''),
    preCentrifugation: normalizeCode(direct.preCentrifugation || extensionObject.preCentrifugation || specimen?.preCentrifugation || ''),
    centrifugation: normalizeCode(direct.centrifugation || extensionObject.centrifugation || specimen?.centrifugation || ''),
    secondCentrifugation: normalizeCode(direct.secondCentrifugation || extensionObject.secondCentrifugation || specimen?.secondCentrifugation || ''),
    postCentrifugationDelay: normalizeCode(direct.postCentrifugationDelay || extensionObject.postCentrifugationDelay || specimen?.postCentrifugationDelay || ''),
    longTermStorage: normalizeCode(direct.longTermStorage || extensionObject.longTermStorage || specimen?.longTermStorage || ''),
    preAnalyticalUnknown: Boolean(direct.preAnalyticalUnknown || extensionObject.preAnalyticalUnknown || specimen?.preAnalyticalUnknown),
  };
}

function calculateMethodologyQualityFromSprec(sprec = {}) {
  const SCORE_BASE = 100;
  const isUnknownCode = (value) => ['X', 'XXX'].includes(normalizeCode(value));

  const mandatoryCodes = [
    sprec.sampleType,
    sprec.primaryContainer,
    sprec.preCentrifugation,
    sprec.centrifugation,
    sprec.secondCentrifugation,
    sprec.postCentrifugationDelay,
    sprec.longTermStorage,
  ];

  const missingMandatoryMetadata = mandatoryCodes.some((value) => normalizeCode(value).length === 0);
  const unknownMandatoryMetadata = mandatoryCodes.some((value) => isUnknownCode(value));
  const criticalMetadataFailure = Boolean(sprec.preAnalyticalUnknown) || missingMandatoryMetadata || unknownMandatoryMetadata;

  if (criticalMetadataFailure) {
    return {
      score: 0,
      category: 'C',
      penaltyIschemia: 0,
      penaltyTemperature: 0,
      penaltyProtocolAlert: 0,
      penaltyCriticalFailure: 100,
      forcedQuarantine: true,
    };
  }

  const matrixType = String(sprec.matrixType || 'fluid').trim().toLowerCase();
  const preCode = normalizeCode(sprec.preCentrifugation);
  const centrifCode = normalizeCode(sprec.centrifugation);
  const secondCentrifCode = normalizeCode(sprec.secondCentrifugation);

  let penaltyIschemia = 0;
  if (matrixType === 'solid') {
    if (preCode === 'X') {
      penaltyIschemia = 100;
    } else if (['C', 'D'].includes(preCode)) {
      penaltyIschemia = 10;
    } else if (['E', 'F'].includes(preCode)) {
      penaltyIschemia = 20;
    }

    if (centrifCode === 'X') {
      penaltyIschemia = Math.min(100, penaltyIschemia + 100);
    } else if (['D', 'E'].includes(centrifCode)) {
      penaltyIschemia += 10;
    } else if (['F'].includes(centrifCode)) {
      penaltyIschemia += 20;
    }
  } else {
    if (preCode === 'X') {
      penaltyIschemia = 100;
    } else if (['C', 'D', 'E', 'F'].includes(preCode)) {
      penaltyIschemia = 15;
    } else if (['G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'].includes(preCode)) {
      penaltyIschemia = 30;
    }
  }

  let penaltyTemperature = 0;
  let penaltyProtocolAlert = 0;

  if (matrixType === 'solid') {
    if (secondCentrifCode === 'X') {
      penaltyTemperature = 50;
    } else if (['F', 'G'].includes(secondCentrifCode)) {
      penaltyTemperature = 20;
    } else if (['E'].includes(secondCentrifCode)) {
      penaltyTemperature = 10;
    }
  } else {
    const ambientNoBrakeCodes = new Set(['A', 'M']);
    if (['X'].includes(centrifCode) || ['X'].includes(secondCentrifCode)) {
      penaltyTemperature = 50;
    } else if (ambientNoBrakeCodes.has(centrifCode) || ambientNoBrakeCodes.has(secondCentrifCode)) {
      penaltyTemperature = 20;
    }
    if (new Set(['I', 'J']).has(centrifCode)) {
      penaltyProtocolAlert = 10;
    }
  }

  const totalPenalty = Math.min(100, penaltyIschemia + penaltyTemperature + penaltyProtocolAlert);
  const score = Math.max(0, SCORE_BASE - totalPenalty);
  const category = score >= 85 ? 'A' : score >= 65 ? 'B' : 'C';

  return {
    score,
    category,
    penaltyIschemia,
    penaltyTemperature,
    penaltyProtocolAlert,
    penaltyCriticalFailure: 0,
    forcedQuarantine: false,
  };
}

function buildPenaltyLog(qualityAssessment = {}) {
  const log = [];
  if (Number(qualityAssessment.penaltyCriticalFailure || 0) > 0) {
    log.push(`metadata_critica_ausente:+${qualityAssessment.penaltyCriticalFailure}`);
  }
  if (Number(qualityAssessment.penaltyIschemia || 0) > 0) {
    log.push(`isquemia:+${qualityAssessment.penaltyIschemia}`);
  }
  if (Number(qualityAssessment.penaltyTemperature || 0) > 0) {
    log.push(`temperatura:+${qualityAssessment.penaltyTemperature}`);
  }
  if (Number(qualityAssessment.penaltyProtocolAlert || 0) > 0) {
    log.push(`protocolo_alta_rotacao:+${qualityAssessment.penaltyProtocolAlert}`);
  }
  if (qualityAssessment.forcedQuarantine) {
    log.push('quarentena_forcada:true');
  }
  return log;
}

function normalizeFhirEntries(payload) {
  if (payload && typeof payload === 'object' && Array.isArray(payload.entry)) {
    return payload.entry;
  }

  if (Array.isArray(payload)) {
    return payload.map((resource) => ({ resource }));
  }

  if (payload && typeof payload === 'object' && payload.resourceType) {
    return [{ resource: payload }];
  }

  return [];
}

/**
 * Importação inteligente de Bundle FHIR via JSON (POST /api/import/fhir)
 */
async function importFhirBundle(req, res) {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ message: 'Banco de dados não disponível' });
    }

    const entries = normalizeFhirEntries(req.body);
    if (!entries.length) {
      return res.status(400).json({ message: 'Bundle FHIR inválido ou ausente' });
    }

    // Coleções (ajuste nomes conforme necessário)
    const patientsCol = db.collection('patients');
    const samplesCol = db.collection('samples');
    const consentsCol = db.collection('consents');
    const observationsCol = db.collection('observations');
    const conditionsCol = db.collection('conditions');

    let patientMap = {}; // resource.id -> _id
    let patientCount = 0;
    let sampleCount = 0;
    let consentCount = 0;
    const qualitySummary = {
      categoryA: 0,
      categoryB: 0,
      categoryC: 0,
      quarantinedTechnical: 0,
      averageScore: null,
    };
    let scoreAccumulator = 0;
    let scoreCount = 0;

    // 1ª Passagem: Pacientes
    for (const entry of entries) {
      const { resource } = entry;
      if (!resource || typeof resource !== 'object') continue;
      if (resource.resourceType === 'Patient') {
        const name = resource.name?.[0]?.text || resource.name?.[0]?.given?.join(' ') || '';
        const cpf = resource.identifier?.find(id => id.system?.includes('cpf'))?.value || null;
        const birthDate = resource.birthDate || null;
        const patientDoc = {
          name, cpf, birthDate,
          fhir: resource // subdocumento original
        };
        // Salvar no MongoDB (descomente para produção)
        // const result = await patientsCol.insertOne(patientDoc);
        // patientMap[resource.id] = result.insertedId;
        // Simulação:
        const fakeId = `patient_${++patientCount}`;
        patientMap[resource.id] = fakeId;
        logger.info('[FHIR_IMPORT] Patient processado', {
          resourceId: resource.id || null,
          hasIdentifier: Array.isArray(resource.identifier) && resource.identifier.length > 0,
        });
      }
    }

    // 2ª Passagem: Demais recursos
    for (const entry of entries) {
      const { resource } = entry;
      if (!resource || typeof resource !== 'object') continue;
      switch (resource.resourceType) {
        case 'Specimen': {
          const patientRef = resource.subject?.reference?.replace('Patient/', '');
          const patientId = patientMap[patientRef];
          const sprec = resolveSprecAxisFromSpecimen(resource);
          const qualityAssessment = calculateMethodologyQualityFromSprec(sprec);
          const penaltyLog = buildPenaltyLog(qualityAssessment);

          if (qualityAssessment.category === 'A') qualitySummary.categoryA += 1;
          if (qualityAssessment.category === 'B') qualitySummary.categoryB += 1;
          if (qualityAssessment.category === 'C') qualitySummary.categoryC += 1;
          if (qualityAssessment.forcedQuarantine) qualitySummary.quarantinedTechnical += 1;

          if (typeof qualityAssessment.score === 'number') {
            scoreAccumulator += qualityAssessment.score;
            scoreCount += 1;
          }

          const sampleDoc = {
            patientId,
            specimenType: resource.type?.text || '',
            quality_score: parseNumberSafe(qualityAssessment.score, 0),
            quality_category: qualityAssessment.category,
            penalty_log: penaltyLog,
            release_status: qualityAssessment.forcedQuarantine ? 'QUARANTINE' : 'AVAILABLE',
            sprec,
            fhir: resource
          };
          // await samplesCol.insertOne(sampleDoc);
          sampleCount++;
          logger.info('[FHIR_IMPORT] Specimen processado', {
            resourceId: resource.id || null,
            patientLinked: Boolean(patientId),
            quality_category: sampleDoc.quality_category,
            release_status: sampleDoc.release_status,
          });
          break;
        }
        case 'Consent': {
          const patientRef = resource.patient?.reference?.replace('Patient/', '');
          const patientId = patientMap[patientRef];
          const consentDoc = {
            patientId,
            status: resource.status,
            fhir: resource
          };
          // await consentsCol.insertOne(consentDoc);
          consentCount++;
          logger.info('[FHIR_IMPORT] Consent processado', {
            resourceId: resource.id || null,
            patientLinked: Boolean(patientId),
            status: consentDoc.status,
          });
          break;
        }
        case 'Observation': {
          const patientRef = resource.subject?.reference?.replace('Patient/', '');
          const patientId = patientMap[patientRef];
          const obsDoc = {
            patientId,
            code: resource.code?.text || '',
            value: resource.valueQuantity?.value,
            fhir: resource
          };
          // await observationsCol.insertOne(obsDoc);
          logger.info('[FHIR_IMPORT] Observation processada', {
            resourceId: resource.id || null,
            patientLinked: Boolean(patientId),
            hasNumericValue: obsDoc.value !== undefined && obsDoc.value !== null,
          });
          break;
        }
        case 'Condition': {
          const patientRef = resource.subject?.reference?.replace('Patient/', '');
          const patientId = patientMap[patientRef];
          const condDoc = {
            patientId,
            code: resource.code?.text || '',
            fhir: resource
          };
          // await conditionsCol.insertOne(condDoc);
          logger.info('[FHIR_IMPORT] Condition processada', {
            resourceId: resource.id || null,
            patientLinked: Boolean(patientId),
          });
          break;
        }
        // outros tipos...
      }
    }

    qualitySummary.averageScore = scoreCount > 0
      ? Math.round((scoreAccumulator / scoreCount) * 100) / 100
      : null;

    return res.status(200).json({
      success: true,
      message: 'Importação concluída',
      patients: patientCount,
      samples: sampleCount,
      consents: consentCount,
      qualitySummary,
    });
  } catch (err) {
    logger.error('Erro na importação FHIR:', err.message || err);
    return res.status(500).json({ message: 'Erro ao importar FHIR', error: err.message });
  }
}

module.exports.importFhirBundle = importFhirBundle;

