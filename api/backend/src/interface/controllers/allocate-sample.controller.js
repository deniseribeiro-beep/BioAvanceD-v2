const AllocateSampleUseCase = require('../../core/use-cases/AllocateSampleUseCase');
const MongoStorageRepository = require('../../infrastructure/persistence/mongo/MongoStorageRepository');
const MongoAuditRepository = require('../../infrastructure/persistence/mongo/MongoAuditRepository');
const MongoLineageRepository = require('../../infrastructure/persistence/mongo/MongoLineageRepository');
const logger = require('../../utils/logger');

const VALIDATION_ERROR_PATTERNS = [
  'obrigatórios',
  'inválida',
  'fora dos limites',
  'já está alocada em outra posição'
];

const LOCATION_BLOCKED_PATTERNS = ['está retirada de uso', 'Localização indisponível'];

function createAllocateSampleController() {
  return async function allocateSampleController(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'DATABASE_UNAVAILABLE',
          message: 'Banco de dados não disponível'
        });
      }

      const { specimenId, boxId, position } = req.body || {};

      const useCase = new AllocateSampleUseCase({
        storageRepository: new MongoStorageRepository(db),
        auditRepository: new MongoAuditRepository(db),
        lineageRepository: new MongoLineageRepository(db)
      });

      const result = await useCase.execute({
        specimenId,
        boxId,
        position,
        actor: {
          userId: req.user?.id || req.user?._id?.toString() || req.user?.userID || null,
          userName: req.user?.name || req.user?.username || null,
          userRole: req.user?.roleName || req.user?.role || null,
          ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || null,
          userAgent: req.headers['user-agent'] || null
        }
      });

      const currentStoragePlacement = result.currentStoragePlacement || null;
      return res.status(201).json({
        success: true,
        data: currentStoragePlacement,
        currentStoragePlacement,
        projectionQueued: result.lineageQueued,
        projectionEventId: result.lineageEventId || null,
        message: currentStoragePlacement?.positionCode
          ? `Amostra alocada com sucesso em ${currentStoragePlacement.positionCode}`
          : 'Amostra alocada com sucesso'
      });
    } catch (error) {
      logger.error('[AllocateSampleController] Erro ao alocar amostra:', error.message || error);
      const message = error?.message || 'Erro ao alocar amostra';

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
        error: 'ALLOCATION_ERROR',
        message
      });
    }
  };
}

module.exports = {
  createAllocateSampleController
};
