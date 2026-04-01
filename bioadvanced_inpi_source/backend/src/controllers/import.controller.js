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

/**
 * Importação inteligente de Bundle FHIR via JSON (POST /api/import/fhir)
 */
async function importFhirBundle(req, res) {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ message: 'Banco de dados não disponível' });
    }

    const bundle = req.body;
    if (!bundle || !Array.isArray(bundle.entry)) {
      return res.status(400).json({ message: 'Bundle FHIR inválido ou ausente' });
    }

    // Coleções (ajuste nomes conforme necessário)
    const patientsCol = db.collection('patients');
    const samplesCol = db.collection('samples');
    const consentsCol = db.collection('consents');
    const observationsCol = db.collection('observations');
    const conditionsCol = db.collection('conditions');

    let patientMap = {}; // resource.id -> _id
    let patientCount = 0, sampleCount = 0, consentCount = 0;

    // 1ª Passagem: Pacientes
    for (const entry of bundle.entry) {
      const { resource } = entry;
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
        console.log('Paciente:', patientDoc);
      }
    }

    // 2ª Passagem: Demais recursos
    for (const entry of bundle.entry) {
      const { resource } = entry;
      switch (resource.resourceType) {
        case 'Specimen': {
          const patientRef = resource.subject?.reference?.replace('Patient/', '');
          const patientId = patientMap[patientRef];
          const sampleDoc = {
            patientId,
            specimenType: resource.type?.text || '',
            fhir: resource
          };
          // await samplesCol.insertOne(sampleDoc);
          sampleCount++;
          console.log('Amostra:', sampleDoc);
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
          console.log('Consentimento:', consentDoc);
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
          console.log('Exame:', obsDoc);
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
          console.log('Diagnóstico:', condDoc);
          break;
        }
        // outros tipos...
      }
    }

    return res.status(200).json({
      message: 'Importação concluída',
      patients: patientCount,
      samples: sampleCount,
      consents: consentCount
    });
  } catch (err) {
    console.error('Erro na importação FHIR:', err);
    return res.status(500).json({ message: 'Erro ao importar FHIR', error: err.message });
  }
}

module.exports.importFhirBundle = importFhirBundle;

