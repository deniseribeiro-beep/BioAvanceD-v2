const importLGPDService = require('../../services/import-lgpd.service');
const logger = require('../../utils/logger');
const fs = require('fs');

/**
 * Worker de Importação de Pacientes
 * Processa importação de pacientes com suporte FHIR
 */

class PatientWorker {
  async process(db, jobID, filePath, options = {}) {
    const startTime = Date.now();
    try {
      // Verifica se arquivo existe
      if (!fs.existsSync(filePath)) {
        throw new Error(`Arquivo não encontrado: ${filePath}`);
      }

      // Cria objeto file para compatibilidade com importLGPDService
      const file = {
        path: filePath,
        originalname: options.fileName || 'patients.csv',
      };

      // Processa importação
      const results = await importLGPDService.importPatients(db, file, {
        groupFields: options.groupFields || {},
      });

      const processingTime = (Date.now() - startTime) / 1000;

      return {
        total: results.total,
        success: results.success,
        errors: results.errors,
        skipped: results.skipped,
        duplicates: results.duplicates, // #931
        processingTime,
      };
    } catch (error) {
      logger.error('Erro no worker de pacientes:', error);
      throw error;
    }
  }
}

module.exports = new PatientWorker();

