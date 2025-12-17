const integrityService = require('../services/integrityCheckService');
const auditRootService = require('../services/auditRoot.service');
const hl7AuditService = require('../services/hl7Audit.service');
const logger = require('../utils/logger');

class AuditController {
  async getMerkleRoot(req, res) {
    try {
      const date = req.params.date;
      const db = req.app.locals.db;
      if (!db) return res.status(503).json({ success: false, error: 'DB not available' });

      const result = await integrityService.buildMerkleForDate(date, db);
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error('Error getMerkleRoot:', error.message || error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async verifyAudit(req, res) {
    try {
      const { hash, proof, root } = req.body;
      const audit = require('../utils/merkleTree');
      const ok = audit.verifyProof(hash, proof, root);
      return res.status(200).json({ success: true, verified: !!ok });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }

  // E + F
  async report(req, res) {
    try {
      const date = req.params.date;
      const db = req.app.locals.db;
      if (!db) return res.status(503).json({ success: false, error: 'DB not available' });

      const saved = await auditRootService.getRootByDate(date, db);
      const recalculated = await integrityService.buildMerkleForDate(date, db);

      // optional proof for query param hash
      const hashQuery = req.query.hash;
      let proof = null;
      if (hashQuery && recalculated && recalculated.getProofForHash) {
        proof = recalculated.getProofForHash(hashQuery);
      }

      const tampered = saved && recalculated && saved.root !== recalculated.root;

      return res.status(200).json({
        success: true,
        data: {
          savedRoot: saved ? saved.root : null,
          recalculatedRoot: recalculated ? recalculated.root : null,
          proof,
          leafCount: recalculated ? recalculated.leaves.length : 0,
          previousRootHash: saved ? saved.previousRootHash : null,
          tampered
        }
      });
    } catch (error) {
      logger.error('Error report:', error.message || error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // G
  async compare(req, res) {
    try {
      const date = req.params.date;
      const db = req.app.locals.db;
      if (!db) return res.status(503).json({ success: false, error: 'DB not available' });

      const saved = await auditRootService.getRootByDate(date, db);
      const recalculated = await integrityService.buildMerkleForDate(date, db);

      const tampered = saved && recalculated && saved.root !== recalculated.root;
      const diff = [];
      if (!saved) diff.push('no_saved_root');
      if (tampered) diff.push('root_mismatch');
      if (diff.length === 0) diff.push('no_diff');

      return res.status(200).json({ success: true, data: { tampered, root_saved: saved ? saved.root : null, root_current: recalculated ? recalculated.root : null, diff } });
    } catch (error) {
      logger.error('Error compare:', error.message || error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // H
  async hl7Report(req, res) {
    try {
      const date = req.params.date;
      const db = req.app.locals.db;
      if (!db) return res.status(503).json({ success: false, error: 'DB not available' });

      const resHL7 = await hl7AuditService.buildHL7MerkleForDate(date, db);
      return res.status(200).json({ success: true, data: resHL7 });
    } catch (error) {
      logger.error('Error hl7Report:', error.message || error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // J - dashboard
  async dashboardDates(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) return res.status(503).json({ success: false, error: 'DB not available' });
      const chain = await auditRootService.getChain(db);
      const dates = chain.map(c => ({ date: c.date, chainIndex: c.chainIndex, root: c.root }));
      return res.status(200).json({ success: true, data: dates });
    } catch (error) {
      logger.error('Error dashboardDates:', error.message || error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async dashboardStats(req, res) {
    try {
      const date = req.params.date;
      const db = req.app.locals.db;
      if (!db) return res.status(503).json({ success: false, error: 'DB not available' });

      const recalculated = await integrityService.buildMerkleForDate(date, db);
      const hl7Count = await db.collection('logs').countDocuments({ action: 'HL7_HASH', date });
      const saved = await auditRootService.getRootByDate(date, db);
      const tampered = saved && recalculated && saved.root !== recalculated.root;

      const stats = {
        date,
        leafCount: recalculated ? recalculated.leaves.length : 0,
        hl7Count,
        tampered
      };
      return res.status(200).json({ success: true, data: stats });
    } catch (error) {
      logger.error('Error dashboardStats:', error.message || error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async dashboardRoots(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) return res.status(503).json({ success: false, error: 'DB not available' });
      const chain = await auditRootService.getChain(db);
      return res.status(200).json({ success: true, data: chain });
    } catch (error) {
      logger.error('Error dashboardRoots:', error.message || error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new AuditController();
