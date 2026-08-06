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
      // #477: no Neo4j driver is available in this worker process — lineage
      // recording falls back to fail-open (logs, doesn't block) exactly as
      // AllocateSampleUseCase already handles a missing lineageRepository.
      const results = await importLGPDService.importSamples(db, file, {
        startBoxId: options.startBoxId,
        autoIncrement: options.autoIncrement,
        groupFields: options.groupFields || {},
        actor: { userId: null, userName: 'IMPORT_WORKER' },
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

