const integrityService = require('../services/integrityCheckService');
const auditRootService = require('../services/auditRoot.service');
const hl7AuditService = require('../services/hl7Audit.service');
const merkleEnvelopeService = require('../services/merkle-envelope.service');
const rfc3161AdapterService = require('../services/rfc3161-adapter.service');
const logger = require('../utils/logger');

function isIsoDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date || ''));
}

function isHexHash(hash) {
  return /^[a-f0-9]{64}$/i.test(String(hash || ''));
}

function isProofValid(proof) {
  if (!Array.isArray(proof)) return false;
  return proof.every((step) => step && (step.position === 'left' || step.position === 'right') && isHexHash(step.hash));
}

class AuditController {
  async getMerkleRoot(req, res) {
    try {
      const date = req.params.date;
      const db = req.app.locals.db;
      if (!db) return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });

      const result = await integrityService.buildMerkleForDate(date, db);
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error('Erro ao obter Merkle Root:', error.message || error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async verifyAudit(req, res) {
    try {
      const { date, hash, proof, root } = req.body || {};
      if (root !== undefined) {
        return res.status(400).json({ success: false, error: 'Campo root no payload está deprecated e não é aceito.' });
      }
      if (!isIsoDate(date)) {
        return res.status(400).json({ success: false, error: 'date inválida. Esperado YYYY-MM-DD.' });
      }
      if (!isHexHash(hash)) {
        return res.status(400).json({ success: false, error: 'hash inválido. Esperado SHA-256 em hexadecimal.' });
      }
      if (!isProofValid(proof)) {
        return res.status(400).json({ success: false, error: 'proof inválido.' });
      }

      const db = req.app.locals.db;
      if (!db) return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });

      const official = await auditRootService.getOfficialRootRecord(date, db);
      if (!official || !official.rootDoc) {
        return res.status(404).json({ success: false, error: 'Raiz oficial não encontrada para a data informada.' });
      }

      const { rootDoc, envelopeRecord } = official;
      const officialRoot = String(rootDoc.root || envelopeRecord?.envelope?.root || '');
      if (!isHexHash(officialRoot)) {
        return res.status(500).json({ success: false, error: 'Raiz oficial inválida no servidor.' });
      }

      if (!envelopeRecord?.legacyV1) {
        const signatureCheck = merkleEnvelopeService.verifyEnvelopeSignature({
          envelope: envelopeRecord.envelope,
          signature: envelopeRecord.signature,
          signatureAlgorithm: envelopeRecord.signatureAlgorithm,
          keyId: envelopeRecord.keyId,
          publicKeyFingerprint: envelopeRecord.publicKeyFingerprint,
        });
        if (!signatureCheck.ok) {
          return res.status(400).json({ success: false, error: `Envelope inválido: ${signatureCheck.reason}` });
        }

        const replayDetected = rootDoc.timestamp?.token
          ? (await db.collection('audit_roots').countDocuments({
            date: { $ne: date },
            'timestamp.token': rootDoc.timestamp.token,
          })) > 0
          : false;
        const timestampCheck = rfc3161AdapterService.verifyTimestamp({
          envelopeDigestSha256: signatureCheck.envelopeDigestSha256,
          timestamp: rootDoc.timestamp,
          replayDetected,
        });
        if (!timestampCheck.ok) {
          return res.status(400).json({ success: false, error: `Timestamp inválido: ${timestampCheck.reason}` });
        }
      }

      const audit = require('../utils/merkleTree');
      const ok = audit.verifyProof(hash, proof, officialRoot);
      return res.status(200).json({ success: true, verified: !!ok, date });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message || 'Erro ao verificar prova' });
    }
  }

  // E + F
  async report(req, res) {
    try {
      const date = req.params.date;
      const db = req.app.locals.db;
      if (!db) return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });

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
      logger.error('Erro ao gerar relatório:', error.message || error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // G
  async compare(req, res) {
    try {
      const date = req.params.date;
      const db = req.app.locals.db;
      if (!db) return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });

      const saved = await auditRootService.getRootByDate(date, db);
      const recalculated = await integrityService.buildMerkleForDate(date, db);

      const tampered = saved && recalculated && saved.root !== recalculated.root;
      const diff = [];
      if (!saved) diff.push('no_saved_root');
      if (tampered) diff.push('root_mismatch');
      if (diff.length === 0) diff.push('no_diff');

      return res.status(200).json({ success: true, data: { tampered, root_saved: saved ? saved.root : null, root_current: recalculated ? recalculated.root : null, diff } });
    } catch (error) {
      logger.error('Erro ao comparar roots:', error.message || error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // H
  async hl7Report(req, res) {
    try {
      const date = req.params.date;
      const db = req.app.locals.db;
      if (!db) return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });

      const resHL7 = await hl7AuditService.buildHL7MerkleForDate(date, db);
      return res.status(200).json({ success: true, data: resHL7 });
    } catch (error) {
      logger.error('Erro ao gerar relatório HL7:', error.message || error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // J - dashboard
  async dashboardDates(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      const chain = await auditRootService.getChain(db);
      const dates = chain.map(c => ({ date: c.date, chainIndex: c.chainIndex, root: c.root }));
      return res.status(200).json({ success: true, data: dates });
    } catch (error) {
      logger.error('Erro ao listar datas do dashboard:', error.message || error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async dashboardStats(req, res) {
    try {
      const date = req.params.date;
      const db = req.app.locals.db;
      if (!db) return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });

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
      logger.error('Erro ao obter estatísticas do dashboard:', error.message || error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async dashboardRoots(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      const chain = await auditRootService.getChain(db);
      return res.status(200).json({ success: true, data: chain });
    } catch (error) {
      logger.error('Erro ao listar roots do dashboard:', error.message || error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new AuditController();
