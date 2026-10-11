const importLGPDService = require('../../services/import-lgpd.service');
const logger = require('../../utils/logger');
const fs = require('fs');
const { ObjectId } = require('mongodb');
const UserModel = require('../../models/User');

async function resolveActor(db, userID) {
  if (!userID) {
    return { userId: null, userName: 'IMPORT_WORKER' };
  }

  try {
    const usersCollection = db.collection('users');
    const user = await usersCollection.findOne({ _id: new ObjectId(userID) });
    return {
      userId: userID,
      userName: UserModel.displayNameOf(user) || user?.email || 'IMPORT_WORKER',
      userRole: user?.role || null,
    };
  } catch (error) {
    logger.warn('[SAMPLE_WORKER] Falha ao resolver usuário para atribuição de auditoria:', error.message);
    return { userId: userID, userName: 'IMPORT_WORKER' };
  }
}

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
      // #483: neo4jDriver and actor now come from import-worker.js's options
      // (connectNeo4j() + job.data.userID) when available. Both stay
      // optional here — AllocateSampleUseCase already fails open (logs,
      // doesn't block) when lineageRepository has no driver, and
      // resolveActor() falls back to the previous IMPORT_WORKER identity
      // when no userID was queued or the user lookup fails.
      const actor = await resolveActor(db, options.userID);
      const results = await importLGPDService.importSamples(db, file, {
        startBoxId: options.startBoxId,
        autoIncrement: options.autoIncrement,
        groupFields: options.groupFields || {},
        neo4jDriver: options.neo4jDriver || null,
        actor,
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
      logger.error('Erro no worker de amostras:', error);
      throw error;
    }
  }
}

module.exports = new SampleWorker();

