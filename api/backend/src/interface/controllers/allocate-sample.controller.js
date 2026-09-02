const AllocateSampleUseCase = require('../../core/use-cases/AllocateSampleUseCase');
const MongoStorageRepository = require('../../infrastructure/persistence/mongo/MongoStorageRepository');
const MongoAuditRepository = require('../../infrastructure/persistence/mongo/MongoAuditRepository');
const LineageRepository = require('../../infrastructure/database/neo4j/LineageRepository');
const logger = require('../../utils/logger');

// Substrings of the client-input validation errors AllocateSampleUseCase and
// MongoStorageRepository.allocateSamplePosition throw. Anything not matching
// one of these, or the 404/409/LOCATION_BLOCKED_PATTERNS below, is treated
// as an unexpected/infra failure and mapped to 500 instead of masked as a
// 400 (#987, mirrors move-sample.controller.js).
const VALIDATION_ERROR_PATTERNS = [
  'obrigatórios',
  'inválida',
  'fora dos limites',
  'já está alocada em outra posição'
];

// Substrings of MongoStorageRepository.checkLocationBlocked's rejection
// messages (#646 Wave 3, RF017 AC#7) -- a separate list from the
// client-input patterns above since these are business/state rules
// (destination box or an ancestor container unavailable), not malformed
// input, even though both map to the same 400 status.
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

      const { sampleId, boxId, position } = req.body || {};

      const useCase = new AllocateSampleUseCase({
        storageRepository: new MongoStorageRepository(db),
        auditRepository: new MongoAuditRepository(db),
        lineageRepository: new LineageRepository(req.app.locals.neo4jDriver || null)
      });

      const result = await useCase.execute({
        specimenId: sampleId,
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

      return res.status(201).json({
        success: true,
        data: result.sampleLocation,
        message: `Amostra alocada com sucesso em ${result.sampleLocation.position}`
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
