const integrityService = require('../services/integrityCheckService');
const auditRootService = require('../services/auditRoot.service');
const hl7AuditService = require('../services/hl7Audit.service');
const merkleEnvelopeService = require('../services/merkle-envelope.service');
const rfc3161AdapterService = require('../services/rfc3161-adapter.service');
const auditV2Service = require('../services/audit-v2.service');
const signingProvider = require('../services/audit-signing.provider');
const auditTreeService = require('../services/audit-tree.service');
const dailyMerkleJob = require('../workers/jobs/daily-merkle.job');
const logger = require('../utils/logger');

class AuditController {
  // #959: an on-demand anchor. Without this the sealing path had exactly one
  // trigger -- a 02:30-UTC setTimeout in the worker -- so audit_tree_heads was
  // empty on every stack and no test could tell a broken TSA from a job that
  // had simply never fired. manageSystem rather than the viewReports every
  // other route here uses: this WRITES to the tamper-evident chain.
  //
  // createTreeHead upserts on {logId, treeSize} with $setOnInsert, so a repeat
  // call for the same date is idempotent.
  async anchorNow(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });

      // Explicit date required to be useful: the nightly job seals YESTERDAY,
      // which is never the day a caller has just generated events for.
      const raw = (req.body && req.body.date) || null;
      const date = raw === null
        ? new Date(Date.now() - 86400000).toISOString().slice(0, 10)
        : String(raw);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ success: false, error: 'date deve estar no formato YYYY-MM-DD' });
      }

      // #1307: the audit_events chain is sealed whatever the date holds.
      const chainHead = await dailyMerkleJob.sealEventChain(db);
      const eventChain = chainHead
        ? { logId: chainHead.logId, treeSize: chainHead.treeSize, rootHash: chainHead.rootHash, anchorStatus: chainHead.anchorStatus }
        : null;
      const treeHead = await dailyMerkleJob.anchorDate(db, date);
      if (!treeHead) {
        return res.status(422).json({
          success: false,
          error: `Nenhum resultado Merkle válido para ${date}; nada foi selado.`,
          details: [`Nenhum resultado Merkle válido para ${date}`],
          eventChain,
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          date,
          treeHeadId: treeHead._id,
          treeSize: treeHead.treeSize,
          // anchorStatus is the OUTCOME. `status` is part of the signed
          // envelope and is the constant PENDING_TIMESTAMP on every document
          // ever written, so a caller filtering on it sees zero anchored heads
          // even on a fully anchored corpus. Both are returned, outcome first.
          anchorStatus: treeHead.anchorStatus,
          status: treeHead.status,
          eventChain,
        },
      });
    } catch (error) {
      logger.error('Erro ao ancorar tree head sob demanda:', error.message || error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

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
      const { eventId, treeHeadId, root, proof, hash, date } = req.body || {};
      if (root !== undefined || proof !== undefined || hash !== undefined || date !== undefined) {
        return res.status(400).json({ success: false, error: 'Contrato inválido: envie apenas eventId e, opcionalmente, treeHeadId.' });
      }
      if (!eventId || typeof eventId !== 'string') {
        return res.status(400).json({ success: false, error: 'eventId é obrigatório.' });
      }
      const db = req.app.locals.db;
      if (!db) return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      const events = db.collection('audit_events');
      const heads = db.collection('audit_tree_heads');
      const tokens = db.collection('audit_timestamp_tokens');
      const witnesses = db.collection('audit_witnesses');
      const event = await events.findOne({ eventId });
      if (!event) return res.status(404).json({ success: false, error: 'Evento de auditoria não encontrado.' });

      // Without an explicit head, the first one sealed after this event.
      const treeHead = treeHeadId
        ? await heads.findOne({ _id: treeHeadId })
        : (await heads.find({ logId: event.logId, treeSize: { $gte: event.sequenceNumber || event.treeSize || 1 } })
          .sort({ treeSize: 1 }).limit(1).toArray())[0] || null;
      if (!treeHead) return res.status(404).json({ success: false, error: 'Tree head oficial não encontrado.' });

      // #1307: the proof is computed from the chain as stored now (archived
      // events included), against the head's sealed size. A rewritten,
      // inserted or deleted event moves the recomputed root off the signed one.
      const leaves = await auditV2Service.loadChain(db, event.logId);
      const sealed = leaves.slice(0, treeHead.treeSize);
      const sealedTree = auditTreeService.buildTree(sealed.map((item) => item.canonicalLeaf));
      const inSeal = sealed.length === treeHead.treeSize && sealedTree.rootHash === treeHead.rootHash;
      const leafIndex = sealed.findIndex((item) => item.eventId === event.eventId);
      const inclusionProof = leafIndex >= 0 ? auditTreeService.inclusionProof(sealedTree, leafIndex) : [];
      const inclusion = leafIndex >= 0 && auditTreeService.verifyInclusion(event.canonicalLeaf, inclusionProof, treeHead.rootHash);
      const chain = auditV2Service.verifyChain(sealed);
      const eventIntegrity = auditV2Service.verifyEventHash(event);
      const treeHeadEnvelope = {
        schemaVersion: treeHead.schemaVersion,
        logId: treeHead.logId,
        treeSize: treeHead.treeSize,
        rootHash: treeHead.rootHash,
        previousTreeHeadHash: treeHead.previousTreeHeadHash,
        periodStart: treeHead.periodStart,
        periodEnd: treeHead.periodEnd,
        createdAt: treeHead.createdAt,
        hashAlgorithm: treeHead.hashAlgorithm,
        merkleAlgorithm: treeHead.merkleAlgorithm,
        signatureAlgorithm: treeHead.signatureAlgorithm,
        keyId: treeHead.keyId,
        status: treeHead.status,
      };
      const signatureCheck = signingProvider.verify(Buffer.from(require('../services/audit-canonicalization.service').canonicalize(treeHeadEnvelope), 'utf8'), treeHead.signature, treeHead.keyId);
      const token = await tokens.findOne({ logId: treeHead.logId, treeSize: treeHead.treeSize }) || treeHead.timestampToken || null;
      const witnessRecord = await witnesses.findOne({ logId: treeHead.logId, treeSize: treeHead.treeSize }) || treeHead.witness || null;
      // Consistency: this head's sealed leaves still reproduce the head sealed
      // before it (an append-only extension), and its own root.
      const priorHead = (await heads.find({ logId: treeHead.logId, treeSize: { $lt: treeHead.treeSize } })
        .sort({ treeSize: -1 }).limit(1).toArray())[0] || null;
      const consistencyValid = inSeal && (!priorHead || auditTreeService.verifyConsistency(priorHead.treeSize, priorHead.rootHash, sealed.map((item) => item.canonicalLeaf)));
      const chainValid = chain.valid;
      const integrityOk = eventIntegrity && inclusion && chainValid && consistencyValid;
      return res.status(200).json({
        success: true,
        data: {
          eventIntegrity,
          inclusionValid: !!inclusion,
          chainValid,
          chainBrokenAt: chain.brokenAt,
          treeHeadSignatureValid: !!signatureCheck.ok,
          timestampValid: Boolean(token && (token.token || token.tokenDerHex || token.status === 'TIMESTAMPED')),
          externalWitnessValid: Boolean(witnessRecord && (witnessRecord.receipt || witnessRecord.receiptEnvelope)),
          consistencyValid,
          overallStatus: integrityOk && signatureCheck.ok && token && witnessRecord ? 'VALID' : (integrityOk && signatureCheck.ok && token && !witnessRecord ? 'PARTIALLY_ANCHORED' : 'INVALID'),
          failures: [
            ...(eventIntegrity ? [] : ['eventIntegrity']),
            ...(inclusion ? [] : ['inclusion']),
            ...(chainValid ? [] : ['chain']),
            ...(signatureCheck.ok ? [] : ['treeHeadSignature']),
            ...(token && (token.token || token.tokenDerHex || token.status === 'TIMESTAMPED') ? [] : ['timestamp']),
            ...(witnessRecord && (witnessRecord.receipt || witnessRecord.receiptEnvelope) ? [] : ['witness']),
            ...(consistencyValid ? [] : ['consistency']),
          ],
        }
      });
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
