const importService = require('../../services/import.service');
const logger = require('../../utils/logger');
const fs = require('fs');

/**
 * Worker de Importação de Localizações
 */
class LocationWorker {
  async process(db, jobID, filePath, options = {}) {
    const startTime = Date.now();

    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`Arquivo não encontrado: ${filePath}`);
      }

      const file = {
        path: filePath,
        originalname: options.fileName || 'locations.csv',
      };

      const results = await importService.importLocations(db, file);
      const processingTime = (Date.now() - startTime) / 1000;

      return {
        total: results.total,
        success: results.success,
        errors: results.errors,
        processingTime,
        fhirResourcesCreated: 0,
        fhirResourcesUpdated: 0,
        fhirResources: [],
      };
    } catch (error) {
      logger.error('Erro no worker de localizações:', error);
      throw error;
    }
  }
}

module.exports = new LocationWorker();
