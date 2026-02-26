const MongoStorageRepository = require('../../../infrastructure/persistence/mongo/MongoStorageRepository');
const MongoPatientConsentReadRepository = require('../../../infrastructure/persistence/mongo/MongoPatientConsentReadRepository');
const MongoStorageTopologyReadRepository = require('../../../infrastructure/persistence/mongo/MongoStorageTopologyReadRepository');
const GetSampleStorageLocationUseCase = require('../../../core/application/use-cases/GetSampleStorageLocationUseCase');
const GetBoxAvailablePositionsUseCase = require('../../../core/application/use-cases/GetBoxAvailablePositionsUseCase');
const ValidateStoragePositionUseCase = require('../../../core/application/use-cases/ValidateStoragePositionUseCase');
const ListOperationalFreezersUseCase = require('../../../core/application/use-cases/ListOperationalFreezersUseCase');
const SearchAllocatableSamplesUseCase = require('../../../core/application/use-cases/SearchAllocatableSamplesUseCase');
const GetFreezerOccupancyStatsUseCase = require('../../../core/application/use-cases/GetFreezerOccupancyStatsUseCase');
const CheckStorageBoxIntegrityUseCase = require('../../../core/application/use-cases/CheckStorageBoxIntegrityUseCase');
const GetFreezerTreeUseCase = require('../../../core/application/use-cases/GetFreezerTreeUseCase');
const logger = require('../../../utils/logger');

function createListFreezersController() {
  return async function listFreezersController(req, res) {
    try {
      const db = req.app.locals.db;
      const useCase = new ListOperationalFreezersUseCase({
        topologyReadRepository: new MongoStorageTopologyReadRepository(db)
      });

      const data = await useCase.execute();
      return res.status(200).json({ success: true, data });
    } catch (error) {
      logger.error('[StorageQueryController] Erro em listFreezers:', error.message || error);
      return res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  };
}

function createSearchSamplesController() {
  return async function searchSamplesController(req, res) {
    try {
      const db = req.app.locals.db;
      const useCase = new SearchAllocatableSamplesUseCase({
        storageRepository: new MongoStorageRepository(db),
        patientConsentReadRepository: new MongoPatientConsentReadRepository(db)
      });

      const data = await useCase.execute({ query: req.query?.q || '' });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      logger.error('[StorageQueryController] Erro em searchSamples:', error.message || error);
      return res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  };
}

function createGetSampleLocationController() {
  return async function getSampleLocationController(req, res) {
    try {
      const db = req.app.locals.db;
      const useCase = new GetSampleStorageLocationUseCase({
        storageRepository: new MongoStorageRepository(db)
      });

      const result = await useCase.execute({ sampleId: req.params.sampleId });

      if (!result.found) {
        const statusCode = result.error === 'SAMPLE_NOT_FOUND' ? 404 : 400;
        return res.status(statusCode).json({ success: false, ...result });
      }

      return res.status(200).json({
        success: true,
        data: result.location
      });
    } catch (error) {
      logger.error('[StorageQueryController] Erro em getSampleLocation:', error.message || error);
      return res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  };
}

function createGetAvailablePositionsController() {
  return async function getAvailablePositionsController(req, res) {
    try {
      const db = req.app.locals.db;
      const useCase = new GetBoxAvailablePositionsUseCase({
        storageRepository: new MongoStorageRepository(db)
      });

      const result = await useCase.execute({ boxId: req.params.boxId });

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('[StorageQueryController] Erro em getAvailablePositions:', error.message || error);
      const statusCode = error.message.includes('não encontrada') ? 404 : 500;
      return res.status(statusCode).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  };
}

function createValidatePositionController() {
  return async function validatePositionController(req, res) {
    try {
      const db = req.app.locals.db;
      const useCase = new ValidateStoragePositionUseCase({
        storageRepository: new MongoStorageRepository(db)
      });

      const result = await useCase.execute({
        boxId: req.params.boxId,
        position: req.params.position
      });

      return res.status(result.available ? 200 : 409).json({
        success: result.available,
        ...result
      });
    } catch (error) {
      logger.error('[StorageQueryController] Erro em validatePosition:', error.message || error);
      return res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  };
}

function createGetFreezerStatsController() {
  return async function getFreezerStatsController(req, res) {
    try {
      const db = req.app.locals.db;
      const useCase = new GetFreezerOccupancyStatsUseCase({
        topologyReadRepository: new MongoStorageTopologyReadRepository(db)
      });

      const result = await useCase.execute({ freezerId: req.params.freezerId });
      if (!result.stats) {
        return res.status(result.error === 'FREEZER_NOT_FOUND' ? 404 : 400).json({
          success: false,
          ...result
        });
      }

      return res.status(200).json({
        success: true,
        data: result.stats
      });
    } catch (error) {
      logger.error('[StorageQueryController] Erro em getFreezerStats:', error.message || error);
      return res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  };
}

function createCheckBoxIntegrityController() {
  return async function checkBoxIntegrityController(req, res) {
    try {
      const db = req.app.locals.db;
      const useCase = new CheckStorageBoxIntegrityUseCase({
        topologyReadRepository: new MongoStorageTopologyReadRepository(db)
      });

      const result = await useCase.execute({ boxId: req.params.boxId });
      return res.status(result.valid ? 200 : 400).json({
        success: result.valid,
        data: result
      });
    } catch (error) {
      logger.error('[StorageQueryController] Erro em checkBoxIntegrity:', error.message || error);
      return res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  };
}

function createGetFreezerTreeController() {
  return async function getFreezerTreeController(req, res) {
    try {
      const db = req.app.locals.db;
      const useCase = new GetFreezerTreeUseCase({
        topologyReadRepository: new MongoStorageTopologyReadRepository(db)
      });

      const tree = await useCase.execute({ freezerId: req.params.freezerId });
      if (!tree) {
        return res.status(404).json({
          success: false,
          error: 'FREEZER_NOT_FOUND',
          message: `Freezer ${req.params.freezerId} não encontrado`
        });
      }

      return res.status(200).json({
        success: true,
        data: tree
      });
    } catch (error) {
      logger.error('[StorageQueryController] Erro em getFreezerTree:', error.message || error);
      return res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  };
}

module.exports = {
  createListFreezersController,
  createSearchSamplesController,
  createGetSampleLocationController,
  createGetAvailablePositionsController,
  createValidatePositionController,
  createGetFreezerStatsController,
  createCheckBoxIntegrityController,
  createGetFreezerTreeController
};
