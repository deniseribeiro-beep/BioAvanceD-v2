const multer = require('multer');
const path = require('path');
const fs = require('fs');
const importService = require('../services/import.service');
const logService = require('../services/log.service');
const logger = require('../utils/logger');
const qualityDomain = require('../services/quality-domain.service');

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
  return qualityDomain.calculateMethodologyQualityFromSprec(sprec);
}

function buildPenaltyLog(qualityAssessment = {}) {
  return qualityDomain.buildPenaltyLog(qualityAssessment);
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
      gradeA: 0,
      gradeB: 0,
      gradeC: 0,
      gradeD: 0,
      gradeE: 0,
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
        const { insertedId } = await patientsCol.insertOne(patientDoc);
        patientCount += 1;
        patientMap[resource.id] = insertedId || null;
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
          const participantId = patientMap[patientRef];
          const sprec = resolveSprecAxisFromSpecimen(resource);
          const qualityAssessment = calculateMethodologyQualityFromSprec(sprec);
          const penaltyLog = buildPenaltyLog(qualityAssessment);

          if (qualityAssessment.final_grade === 'A') qualitySummary.gradeA += 1;
          if (qualityAssessment.final_grade === 'B') qualitySummary.gradeB += 1;
          if (qualityAssessment.final_grade === 'C') qualitySummary.gradeC += 1;
          if (qualityAssessment.final_grade === 'D') qualitySummary.gradeD += 1;
          if (qualityAssessment.final_grade === 'E') qualitySummary.gradeE += 1;
          if (qualityAssessment.governance_status === 0 || qualityAssessment.final_grade === 'E') qualitySummary.quarantinedTechnical += 1;

          if (typeof qualityAssessment.rcs_score === 'number') {
            scoreAccumulator += qualityAssessment.rcs_score;
            scoreCount += 1;
          }

          const sampleDoc = {
            participantId,
            specimenType: resource.type?.text || '',
            // Canonical RCS-GOV fields
            model_version: qualityAssessment.model_version,
            matrix_type: qualityAssessment.matrix_type,
            governance_status: qualityAssessment.governance_status,
            governance_failure_reasons: qualityAssessment.governance_failure_reasons,
            governance_rule_codes: qualityAssessment.governance_rule_codes || [],
            p_bio: qualityAssessment.p_bio,
            rcs_score: qualityAssessment.rcs_score,
            score_based_grade: qualityAssessment.score_based_grade,
            final_grade: qualityAssessment.final_grade || '',
            grade_route: qualityAssessment.grade_route,
            axis_penalties: qualityAssessment.axis_penalties,
            calculation_trace: qualityAssessment.calculation_trace,
            rcs_evaluation: qualityAssessment,
            canonical: {
              rcsScore: qualityAssessment.rcs_score,
              scoreBasedGrade: qualityAssessment.final_grade,
              axisPenalties: penaltyLog,
            },
            releaseStatus: qualityAssessment.governance_status === 1 && qualityAssessment.final_grade !== 'E' ? 'AVAILABLE' : 'QUARANTINE',
            sprec,
            fhir: resource
          };
          await samplesCol.insertOne(sampleDoc);
          sampleCount++;
          logger.info('[FHIR_IMPORT] Specimen processado', {
            resourceId: resource.id || null,
            patientLinked: Boolean(participantId),
            final_grade: sampleDoc.final_grade,
            releaseStatus: sampleDoc.releaseStatus,
          });
          break;
        }
        case 'Consent': {
          const patientRef = resource.patient?.reference?.replace('Patient/', '');
          const participantId = patientMap[patientRef];
          const consentDoc = {
            participantId,
            status: resource.status,
            fhir: resource
          };
          await consentsCol.insertOne(consentDoc);
          consentCount++;
          logger.info('[FHIR_IMPORT] Consent processado', {
            resourceId: resource.id || null,
            patientLinked: Boolean(participantId),
            status: consentDoc.status,
          });
          break;
        }
        case 'Observation': {
          const patientRef = resource.subject?.reference?.replace('Patient/', '');
          const participantId = patientMap[patientRef];
          const obsDoc = {
            participantId,
            code: resource.code?.text || '',
            value: resource.valueQuantity?.value,
            fhir: resource
          };
          await observationsCol.insertOne(obsDoc);
          logger.info('[FHIR_IMPORT] Observation processada', {
            resourceId: resource.id || null,
            patientLinked: Boolean(participantId),
            hasNumericValue: obsDoc.value !== undefined && obsDoc.value !== null,
          });
          break;
        }
        case 'Condition': {
          const patientRef = resource.subject?.reference?.replace('Patient/', '');
          const participantId = patientMap[patientRef];
          const condDoc = {
            participantId,
            code: resource.code?.text || '',
            fhir: resource
          };
          await conditionsCol.insertOne(condDoc);
          logger.info('[FHIR_IMPORT] Condition processada', {
            resourceId: resource.id || null,
            patientLinked: Boolean(participantId),
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

