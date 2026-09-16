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

      // Canonical v2 boundary: specimenId is the only specimen identity accepted here;
      // the retired sampleId alias is intentionally not mapped or tolerated.
      const { specimenId, boxId } = req.body || {};
      if (!specimenId || !boxId) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_INPUT',
          message: 'specimenId e boxId são obrigatórios'
        });
      }

      const storageService = new StorageService(db);
      const result = await storageService.autoAssignSampleToBox(specimenId, boxId);

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

      const currentStoragePlacement = result.currentStoragePlacement || null;
      return res.status(201).json({
        success: true,
        data: currentStoragePlacement,
        currentStoragePlacement,
        message: currentStoragePlacement?.positionCode
          ? `Amostra alocada automaticamente na Posição ${currentStoragePlacement.positionCode}`
          : 'Amostra alocada automaticamente',
        projectionQueued: result.projectionQueued === true,
        projectionEventId: result.projectionEventId || null
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

module.exports = { createAutoAssignSampleController };
