const multer = require('multer');
const path = require('path');
const fs = require('fs');
const importService = require('../services/import.service');
const callerCreateOrganization = require('../services/callerCreateOrganization.service');
const logService = require('../services/log.service');
const logger = require('../utils/logger');
const { UPLOADS_BASE } = require('../config/uploadConfig');

// Configuração do multer para upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(UPLOADS_BASE, 'temp');
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

      if (!dataType || !['patients', 'samples', 'results', 'temperature'].includes(dataType)) {
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
          case 'samples': {
            // #1376, #1192: resolved before any row is read, so a refusal
            // writes nothing; the sample's organizationId comes from the
            // caller's scope, as on the LGPD import.
            let organizationId;
            try {
              ({ organizationId } = await callerCreateOrganization.resolveCallerCreateOrganization(db, {
                userId: req.user?.userID,
                requested: typeof req.body?.organizationId === 'string' ? req.body.organizationId.trim() : undefined
              }));
            } catch (scopeError) {
              importService.cleanupFile(file.path);
              return res.status(scopeError.statusCode || 403).json({ success: false, error: scopeError.message });
            }
            results = await importService.importSamples(db, file, { organizationId });
            break;
          }
          case 'temperature':
            results = await importService.importTemperature(db, file);
            break;
          case 'locations':
            // Desativado (#466): a coleção legada `locations` deve
            // permanecer somente-leitura durante a transição (#457).
            importService.cleanupFile(file.path);
            return res.status(400).json({
              success: false,
              error: "Importação de 'locations' está desativada",
              message: 'A coleção legada locations é somente-leitura durante a transição (#457/#466).'
            });
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
