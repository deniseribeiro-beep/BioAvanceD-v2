const StorageService = require('../../services/storageService');
const logger = require('../../utils/logger');

function createAutoAssignSampleController() {
  return async function autoAssignSampleController(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'DATABASE_UNAVAILABLE',
          message: 'Banco de dados não disponível'
        });
      }

      const { sampleId, boxId } = req.body || {};
      if (!sampleId || !boxId) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_INPUT',
          message: 'sampleId e boxId são obrigatórios'
        });
      }

      const storageService = new StorageService(db);
      const result = await storageService.autoAssignSampleToBox(sampleId, boxId);

      if (!result.success) {
        const statusCode =
          result.error === 'BOX_NOT_FOUND' || result.error === 'SAMPLE_NOT_FOUND'
            ? 404
            : result.error === 'ALREADY_ALLOCATED' || result.error === 'BOX_FULL'
              ? 409
              : 500;

        return res.status(statusCode).json({
          success: false,
          error: result.error || 'AUTO_ALLOCATION_ERROR',
          message: result.message || 'Erro ao alocar amostra automaticamente'
        });
      }

      return res.status(201).json({
        success: true,
        data: result.sampleLocation,
        message: `Amostra alocada automaticamente na Posição ${result.sampleLocation.position}`,
        graphPersisted: false,
        projectionQueued: result.projectionQueued === true
      });
    } catch (error) {
      logger.error('[AutoAssignSampleController] Erro na alocação automática:', error.message || error);
      return res.status(500).json({
        success: false,
        error: 'AUTO_ALLOCATION_ERROR',
        message: error.message || 'Erro ao alocar amostra automaticamente'
      });
    }
  };
}

module.exports = {
  createAutoAssignSampleController
};
