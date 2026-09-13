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

      const storageService = new StorageService(db, req.app.locals.neo4jDriver || null);
      const result = await storageService.autoAssignSampleToBox(sampleId, boxId);

      if (!result.success) {
        // #987 applied to the fourth storage endpoint. This defaulted to 400,
        // so every failure that is not one of the four sentinels below --
        // including the topology refusal e47219c6 just added, a database
        // outage, or a bug -- was reported as a bad request. A caller doing
        // what a 400 instructs, retrying with different input, would fail
        // identically forever.
        //
        // Unlike allocate/move/release there is no validation-shaped 400 case
        // here: autoAssignSampleToBox returns exactly these four sentinels for
        // client-actionable conditions and AUTO_ASSIGNMENT_ERROR for
        // everything else, which is by definition unexpected.
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
        graphPersisted: result.graphPersisted === true
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