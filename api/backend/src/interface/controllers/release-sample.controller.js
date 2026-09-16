const ReleaseSampleUseCase = require('../../core/use-cases/ReleaseSampleUseCase');
const MongoStorageRepository = require('../../infrastructure/persistence/mongo/MongoStorageRepository');
const MongoAuditRepository = require('../../infrastructure/persistence/mongo/MongoAuditRepository');
const MongoLineageRepository = require('../../infrastructure/persistence/mongo/MongoLineageRepository');
const logger = require('../../utils/logger');

const VALIDATION_ERROR_PATTERNS = [
  'obrigatório',
  'não possui localização de armazenamento'
];

function createReleaseSampleController({
  ReleaseSampleUseCaseClass = ReleaseSampleUseCase,
  StorageRepositoryClass = MongoStorageRepository,
  AuditRepositoryClass = MongoAuditRepository,
  LineageRepositoryClass = MongoLineageRepository
} = {}) {
  return async function releaseSampleController(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'DATABASE_UNAVAILABLE',
          message: 'Banco de dados não disponível'
        });
      }

      const { specimenId } = req.params;

      const useCase = new ReleaseSampleUseCaseClass({
        storageRepository: new StorageRepositoryClass(db),
        auditRepository: new AuditRepositoryClass(db),
        lineageRepository: new LineageRepositoryClass(db)
      });

      const result = await useCase.execute({
        specimenId,
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
        data: result.releasedFrom,
        projectionQueued: result.lineageQueued,
        message: `Amostra liberada de ${result.releasedFrom.position}`
      });
    } catch (error) {
      logger.error('[ReleaseSampleController] Erro ao liberar amostra:', error.message || error);
      const message = error?.message || 'Erro ao liberar amostra';

      let statusCode = 500;
      if (message.includes('não encontrada')) {
        statusCode = 404;
      } else if (message.includes('STORAGE_COLLISION')) {
        statusCode = 409;
      } else if (VALIDATION_ERROR_PATTERNS.some((pattern) => message.includes(pattern))) {
        statusCode = 400;
      } else if (message.includes('RF023_LINEAGE_VALIDATION_FAILED')) {
        statusCode = 422;
      }

      return res.status(statusCode).json({
        success: false,
        error: 'RELEASE_ERROR',
        message
      });
    }
  };
}

module.exports = {
  createReleaseSampleController
};