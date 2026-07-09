const importService = require('../../services/import.service');
const logger = require('../../utils/logger');
const fs = require('fs');

class TemperatureWorker {
  async process(db, jobID, filePath, options = {}) {
    const startTime = Date.now();

    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`Arquivo não encontrado: ${filePath}`);
      }

      const file = {
        path: filePath,
        originalname: options.fileName || 'temperature.csv',
      };

      const results = await importService.importTemperature(db, file);

      const processingTime = (Date.now() - startTime) / 1000;
      return {
        total: results.total,
        success: results.success,
        errors: results.errors,
        processingTime,
      };
    } catch (error) {
      logger.error('Erro no worker de temperatura:', error);
      throw error;
    }
  }
}

module.exports = new TemperatureWorker();
