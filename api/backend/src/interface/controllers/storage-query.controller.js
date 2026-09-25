const MongoStorageRepository = require('../../infrastructure/persistence/mongo/MongoStorageRepository');
const MongoPatientConsentReadRepository = require('../../infrastructure/persistence/mongo/MongoPatientConsentReadRepository');
const MongoStorageTopologyReadRepository = require('../../infrastructure/persistence/mongo/MongoStorageTopologyReadRepository');
const GetSampleStorageLocationUseCase = require('../../core/use-cases/GetSampleStorageLocationUseCase');
const GetBoxAvailablePositionsUseCase = require('../../core/use-cases/GetBoxAvailablePositionsUseCase');
const ValidateStoragePositionUseCase = require('../../core/use-cases/ValidateStoragePositionUseCase');
const ListOperationalFreezersUseCase = require('../../core/use-cases/ListOperationalFreezersUseCase');
const SearchAllocatableSamplesUseCase = require('../../core/use-cases/SearchAllocatableSamplesUseCase');
const GetFreezerOccupancyStatsUseCase = require('../../core/use-cases/GetFreezerOccupancyStatsUseCase');
const CheckStorageBoxIntegrityUseCase = require('../../core/use-cases/CheckStorageBoxIntegrityUseCase');
const GetFreezerTreeUseCase = require('../../core/use-cases/GetFreezerTreeUseCase');
const { sampleScopeFilter, freezerScopeFilter } = require('../../services/storage-scope.service');
const logger = require('../../utils/logger');

function createListFreezersController() {
  return async function listFreezersController(req, res) {
    try {
      const db = req.app.locals.db;
      const useCase = new ListOperationalFreezersUseCase({
        topologyReadRepository: new MongoStorageTopologyReadRepository(db)
      });

      const data = await useCase.execute({ scopeFilter: await freezerScopeFilter(db, req.organizationScope) });
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

      const data = await useCase.execute({
        query: req.query?.q || '',
        scopeFilter: sampleScopeFilter(req.organizationScope)
      });
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

      const result = await useCase.execute({ specimenId: req.params.sampleId });

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
      const statusCode = typeof error?.message === 'string' && error.message.includes('não encontrada') ? 404 : 500;
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
      // #892 item 2: the `: 400` arm below is unreachable against the current
      // repository -- MongoStorageTopologyReadRepository#getFreezerOccupancyStats
      // has exactly one early return and FREEZER_NOT_FOUND is the only error
      // it can produce, so `!result.stats` implies that code. Kept
      // deliberately, not overlooked: it is a defensive default that degrades
      // to 400 rather than 200-with-no-stats if the repository ever grows a
      // second error branch. Verified reachable-by-one-code only, 2026-09-01.
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

      // #892 item 1: `checkBoxIntegrity` reports two unrelated situations
      // through one `valid: false` channel -- "the box exists and its
      // occupancy grid disagrees with samples" and "there is no such box".
      // Collapsing both onto 400 made this the only route in this router that
      // answers 400 for a missing entity (/freezer/:id/stats, /freezer/:id/tree
      // and /sample/:id all answer 404), contradicted
      // `docs/STORAGE_API_EXAMPLES.js`'s own error table -- which lists
      // BOX_NOT_FOUND under "404 - Não encontrado" and documents 400 only for
      // the inconsistency case (example 8B) -- and disagreed with
      // auto-assign-sample.controller, which already maps this exact code to
      // 404. The error also goes to the top level so a caller can tell the
      // two apart without parsing `data`.
      if (result.error === 'BOX_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          error: 'BOX_NOT_FOUND',
          data: result
        });
      }

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
