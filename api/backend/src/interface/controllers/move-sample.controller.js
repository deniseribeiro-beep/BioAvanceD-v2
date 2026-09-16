const MoveSampleUseCase = require('../../core/use-cases/MoveSampleUseCase');
const MongoStorageRepository = require('../../infrastructure/persistence/mongo/MongoStorageRepository');
const MongoAuditRepository = require('../../infrastructure/persistence/mongo/MongoAuditRepository');
const MongoLineageRepository = require('../../infrastructure/persistence/mongo/MongoLineageRepository');
const logger = require('../../utils/logger');

const VALIDATION_ERROR_PATTERNS = [
  'inválido',
  'obrigatório',
  'deve seguir formato',
  'não possui localização de origem',
  'deve ser diferente da posição atual',
  'Localização de origem mudou'
];

const LOCATION_BLOCKED_PATTERNS = ['está retirada de uso', 'Localização indisponível'];

function createMoveSampleController() {
  return async function moveSampleController(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'DATABASE_UNAVAILABLE',
          message: 'Banco de dados não disponível'
        });
      }

      const { specimenId, targetBoxId, targetPosition, reason, notes } = req.body || {};

      const storageRepository = new MongoStorageRepository(db);
      const auditRepository = new MongoAuditRepository(db);
      const lineageRepository = new MongoLineageRepository(db);

      const useCase = new MoveSampleUseCase({
        storageRepository,
        auditRepository,
        lineageRepository
      });

      const result = await useCase.execute({
        specimenId,
        targetBoxId,
        targetPosition,
        reason,
        notes,
        actor: {
          userId: req.user?.id || req.user?._id?.toString() || req.user?.userID || null,
          userName: req.user?.name || req.user?.username || null,
          userRole: req.user?.roleName || req.user?.role || null,
          ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || null,
          userAgent: req.headers['user-agent'] || null
        }
      });

      return res.status(200).json({
        success: true,
        data: result,
        message: 'Amostra movida com sucesso'
      });
    } catch (error) {
      logger.error('[MoveSampleController] Erro ao mover amostra:', error.message || error);
      const message = error?.message || 'Erro ao mover amostra';

      let statusCode = 500;
      if (message.includes('não encontrada')) {
        statusCode = 404;
      } else if (message.includes('STORAGE_COLLISION')) {
        statusCode = 409;
      } else if (LOCATION_BLOCKED_PATTERNS.some((pattern) => message.includes(pattern))) {
        statusCode = 400;
      } else if (VALIDATION_ERROR_PATTERNS.some((pattern) => message.includes(pattern))) {
        statusCode = 400;
      } else if (message.includes('RF023_LINEAGE_VALIDATION_FAILED')) {
        statusCode = 422;
      }

      return res.status(statusCode).json({
        success: false,
        error: 'MOVE_SAMPLE_ERROR',
        message
      });
    }
  };
}

module.exports = {
  createMoveSampleController
};
