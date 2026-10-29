const referenceReleaseService = require('../services/referenceRelease.service');
const logger = require('../utils/logger');

// RF028 AC8/AC9: a refused promotion or rollback names its reason.
const STATUS_BY_REASON = {
  release_not_found: 404,
  no_active_release: 404,
  approver_required: 403,
  release_not_approved: 409,
  promotion_in_progress: 409,
  approved_run_not_found: 409,
  coverage_manifest_missing: 409,
  coverage_manifest_invalid: 409,
  coverage_incomplete: 409,
  quality_assessment_missing: 409,
  quality_assessment_failed: 409,
  no_previous_release: 409,
  previous_release_not_found: 409,
};

function refusal(res, reason) {
  return res.status(STATUS_BY_REASON[reason] || 409).json({ success: false, error: reason });
}

class ReferenceReleaseController {
  async promote(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }
      const result = await referenceReleaseService.promoteRelease({
        db,
        releaseId: req.params.id,
        approvedBy: req.user && req.user.userID,
        req,
      });
      if (!result.promoted) return refusal(res, result.reason);
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error('Erro ao promover release de referência:', error.message);
      return res.status(500).json({ success: false, error: 'Erro ao promover release de referência' });
    }
  }

  async rollback(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }
      const initiatedBy = req.user && req.user.userID;
      if (!initiatedBy) {
        return res.status(403).json({ success: false, error: 'approver_required' });
      }
      const result = await referenceReleaseService.rollbackRelease({
        db,
        datasetCode: req.params.datasetCode,
        initiatedBy,
        req,
      });
      if (!result.rolledBack) return refusal(res, result.reason);
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error('Erro ao reverter release de referência:', error.message);
      return res.status(500).json({ success: false, error: 'Erro ao reverter release de referência' });
    }
  }
}

module.exports = new ReferenceReleaseController();
