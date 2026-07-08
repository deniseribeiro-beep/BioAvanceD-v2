const importLGPDService = require('../../services/import-lgpd.service');
const logger = require('../../utils/logger');
const fs = require('fs');

/**
 * Worker de Importação de Amostras
 * Processa importação de amostras com suporte FHIR
 */

class SampleWorker {
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
        originalname: options.fileName || 'samples.csv',
      };

      // Processa importação
      const results = await importLGPDService.importSamples(db, file, {
        startLocationID: options.startLocationID,
        autoIncrement: options.autoIncrement,
        groupFields: options.groupFields || {},
      });

      const processingTime = (Date.now() - startTime) / 1000;

      return {
        total: results.total,
        success: results.success,
        errors: results.errors,
        processingTime,
      };
    } catch (error) {
      logger.error('Erro no worker de amostras:', error);
      throw error;
    }
  }
}

module.exports = new SampleWorker();

