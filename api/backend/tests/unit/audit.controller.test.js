import { describe, it, expect, vi, afterEach } from 'vitest';

const auditController = require('../../src/controllers/audit.controller');
const integrityService = require('../../src/services/integrityCheckService');
const auditRootService = require('../../src/services/auditRoot.service');
const hl7AuditService = require('../../src/services/hl7Audit.service');
const logger = require('../../src/utils/logger');

function buildRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('audit.controller.getMerkleRoot', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = { params: { date: '2026-07-04' }, app: { locals: { db: null } } };
    const res = buildRes();

    await auditController.getMerkleRoot(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Banco de dados não disponível' });
  });

  it('returns 200 with the built Merkle root on success', async () => {
    const merkle = { root: 'abc123', leaves: [1, 2] };
    vi.spyOn(integrityService, 'buildMerkleForDate').mockResolvedValue(merkle);
    const req = { params: { date: '2026-07-04' }, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.getMerkleRoot(req, res);

    expect(integrityService.buildMerkleForDate).toHaveBeenCalledWith('2026-07-04', {});
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: merkle });
  });

  it('returns 500 when the service throws', async () => {
    vi.spyOn(integrityService, 'buildMerkleForDate').mockRejectedValue(new Error('db down'));
    const req = { params: { date: '2026-07-04' }, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.getMerkleRoot(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'db down' });
  });

  it('logs the raw thrown value when it has no .message (falsy-message fallback)', async () => {
    vi.spyOn(integrityService, 'buildMerkleForDate').mockRejectedValue('plain string failure');
    vi.spyOn(logger, 'error');
    const req = { params: { date: '2026-07-04' }, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.getMerkleRoot(req, res);

    expect(logger.error).toHaveBeenCalledWith('Erro ao obter Merkle Root:', 'plain string failure');
  });
});

describe('audit.controller.verifyAudit', () => {
  function buildDb({ event, treeHead, olderTreeHead, token, witnessRecord, leaves } = {}) {
    const events = {
      findOne: vi.fn().mockResolvedValue(event ?? null),
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(leaves ?? []) }) }),
    };
    const heads = {
      findOne: vi.fn((query) => {
        if (query && Object.prototype.hasOwnProperty.call(query, 'treeSize') && olderTreeHead !== undefined && query.treeSize !== treeHead?.treeSize) {
          return Promise.resolve(olderTreeHead);
        }
        return Promise.resolve(treeHead ?? null);
      }),
    };
    const tokens = { findOne: vi.fn().mockResolvedValue(token ?? null) };
    const witnesses = { findOne: vi.fn().mockResolvedValue(witnessRecord ?? null) };
    const collections = {
      audit_events: events,
      audit_tree_heads: heads,
      audit_timestamp_tokens: tokens,
      audit_witnesses: witnesses,
    };
    return { collection: vi.fn((name) => collections[name]) };
  }

  it('returns 503 when db is unavailable', async () => {
    const req = { body: { eventId: 'evt-1' }, app: { locals: { db: null } } };
    const res = buildRes();

    await auditController.verifyAudit(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Banco de dados não disponível' });
  });

  it('returns 400 for the retired contract when only date is sent (right-hand OR branch)', async () => {
    const req = { body: { eventId: 'evt-1', date: '2026-07-04' } };
    const res = buildRes();

    await auditController.verifyAudit(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Contrato inválido: envie apenas eventId e, opcionalmente, treeHeadId.',
    });
  });

  it('looks up the tree head by treeHeadId when one is supplied', async () => {
    const event = { eventId: 'evt-1', logId: 'log-1', treeSize: 1, sequenceNumber: 0, canonicalLeaf: {} };
    const db = buildDb({ event, treeHead: null, leaves: [event] });
    db.collection('audit_tree_heads').findOne.mockResolvedValueOnce(null);
    const req = { body: { eventId: 'evt-1', treeHeadId: 'th-explicit' }, app: { locals: { db } } };
    const res = buildRes();

    await auditController.verifyAudit(req, res);

    expect(db.collection('audit_tree_heads').findOne).toHaveBeenCalledWith({ _id: 'th-explicit' });
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 400 with a generic message when the thrown error has no .message', async () => {
    const db = buildDb({});
    db.collection = vi.fn(() => { throw 'boom-no-message'; });
    const req = { body: { eventId: 'evt-5' }, app: { locals: { db } } };
    const res = buildRes();

    await auditController.verifyAudit(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Erro ao verificar prova' });
  });

  it('returns 400 with the thrown error message when one is present', async () => {
    const db = buildDb({});
    db.collection = vi.fn(() => { throw new Error('collection blew up'); });
    const req = { body: { eventId: 'evt-6' }, app: { locals: { db } } };
    const res = buildRes();

    await auditController.verifyAudit(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'collection blew up' });
  });

  it('returns 400 when the request carries the retired hash/proof/root/date contract', async () => {
    const req = { body: { eventId: 'evt-1', hash: 'h', proof: [], root: 'r' } };
    const res = buildRes();

    await auditController.verifyAudit(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Contrato inválido: envie apenas eventId e, opcionalmente, treeHeadId.',
    });
  });

  it('returns 400 when eventId is missing', async () => {
    const req = { body: {} };
    const res = buildRes();

    await auditController.verifyAudit(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'eventId é obrigatório.' });
  });

  it('returns 404 when the audit event is not found', async () => {
    const req = { body: { eventId: 'missing' }, app: { locals: { db: buildDb({ event: null }) } } };
    const res = buildRes();

    await auditController.verifyAudit(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Evento de auditoria não encontrado.' });
  });


  // #1307: the cases below read a real chain from the in-memory store, so
  // inclusion, consistency and the chain walk are computed, not stubbed.
  // Only the signature and the anchoring evidence are faked.
  describe('against a stored chain', () => {
    const { createFakeDb } = require('./foundation/helpers/fake-db');
    const auditV2Service = require('../../src/services/audit-v2.service');
    const auditTreeService = require('../../src/services/audit-tree.service');
    const signingProvider = require('../../src/services/audit-signing.provider');

    async function sealedChain(n, { token = { token: 'tk' }, witnessRecord = { receipt: 'r' } } = {}) {
      const db = createFakeDb();
      for (let i = 1; i <= n; i += 1) {
        await auditV2Service.ingestLogRecord({ _id: `rec-${i}`, action: `ACT-${i}`, userName: 'USR-0A1B2C3D' }, db);
      }
      const leaves = await auditV2Service.loadChain(db);
      const head = {
        _id: `th-${n}`, logId: 'audit-events', treeSize: n,
        rootHash: auditTreeService.buildTree(leaves.map((item) => item.canonicalLeaf)).rootHash,
        signature: 'sig', keyId: 'key-1', status: 'PENDING_TIMESTAMP',
        schemaVersion: 'audit.treehead.v1', previousTreeHeadHash: null, periodStart: null, periodEnd: null,
        createdAt: '2026-10-08T00:00:00.000Z', hashAlgorithm: 'SHA-256', merkleAlgorithm: 'RFC9162-STYLE', signatureAlgorithm: 'Ed25519',
      };
      await db.collection('audit_tree_heads').insertOne(head);
      if (token) await db.collection('audit_timestamp_tokens').insertOne({ logId: 'audit-events', treeSize: n, ...token });
      if (witnessRecord) await db.collection('audit_witnesses').insertOne({ logId: 'audit-events', treeSize: n, ...witnessRecord });
      return { db, events: db.collection('audit_events').docs, head };
    }

    async function verify(db, body) {
      const res = buildRes();
      await auditController.verifyAudit({ body, app: { locals: { db } } }, res);
      return { status: res.status.mock.calls[0][0], payload: res.json.mock.calls[0][0] };
    }

    it('returns 404 when no head has been sealed since the event', async () => {
      const { db, events } = await sealedChain(2);
      await auditV2Service.ingestLogRecord({ action: 'LATER' }, db);
      const { status, payload } = await verify(db, { eventId: events[2].eventId });
      expect(status).toBe(404);
      expect(payload).toEqual({ success: false, error: 'Tree head oficial não encontrado.' });
    });

    it('verifies an event in the middle of a sealed chain as VALID', async () => {
      vi.spyOn(signingProvider, 'verify').mockReturnValue({ ok: true });
      const { db, events } = await sealedChain(5);

      const { status, payload } = await verify(db, { eventId: events[2].eventId });

      expect(status).toBe(200);
      expect(payload.data).toMatchObject({
        eventIntegrity: true, inclusionValid: true, chainValid: true, chainBrokenAt: null,
        consistencyValid: true, treeHeadSignatureValid: true, timestampValid: true,
        externalWitnessValid: true, overallStatus: 'VALID', failures: [],
      });
    });

    it('verifies against the first head sealed after the event, with events appended since', async () => {
      vi.spyOn(signingProvider, 'verify').mockReturnValue({ ok: true });
      const { db, events } = await sealedChain(3);
      await auditV2Service.ingestLogRecord({ action: 'AFTER-SEAL' }, db);

      const { payload } = await verify(db, { eventId: events[0].eventId });

      expect(payload.data.overallStatus).toBe('VALID');
    });

    it('reads a rewritten event as INVALID, naming the event, the chain and the root', async () => {
      vi.spyOn(signingProvider, 'verify').mockReturnValue({ ok: true });
      const { db, events } = await sealedChain(3);
      events[1].action = 'FORGED';

      const { payload } = await verify(db, { eventId: events[1].eventId });

      expect(payload.data.overallStatus).toBe('INVALID');
      expect(payload.data.chainBrokenAt).toBe(2);
      expect(payload.data.failures).toEqual(expect.arrayContaining(['eventIntegrity', 'chain']));
    });

    it('reads a deleted earlier event as INVALID when verifying a later one', async () => {
      vi.spyOn(signingProvider, 'verify').mockReturnValue({ ok: true });
      const { db, events } = await sealedChain(4);
      const kept = events[3].eventId;
      events.splice(1, 1);

      const { payload } = await verify(db, { eventId: kept });

      expect(payload.data.overallStatus).toBe('INVALID');
      expect(payload.data.failures).toEqual(expect.arrayContaining(['inclusion', 'chain', 'consistency']));
    });

    it('fails consistency when a head no longer extends the head sealed before it', async () => {
      vi.spyOn(signingProvider, 'verify').mockReturnValue({ ok: true });
      const { db, events } = await sealedChain(3);
      await db.collection('audit_tree_heads').insertOne({ _id: 'th-old', logId: 'audit-events', treeSize: 2, rootHash: 'not-the-prefix-root' });

      const { payload } = await verify(db, { eventId: events[2].eventId, treeHeadId: 'th-3' });

      expect(payload.data.consistencyValid).toBe(false);
      expect(payload.data.overallStatus).toBe('INVALID');
    });

    it('reports PARTIALLY_ANCHORED when the chain holds and a timestamp exists but no witness does', async () => {
      vi.spyOn(signingProvider, 'verify').mockReturnValue({ ok: true });
      const { db, events } = await sealedChain(2, { token: { tokenDerHex: 'der', status: 'TIMESTAMPED' }, witnessRecord: null });

      const { payload } = await verify(db, { eventId: events[0].eventId });

      expect(payload.data.overallStatus).toBe('PARTIALLY_ANCHORED');
      expect(payload.data.failures).toEqual(['witness']);
    });

    it('reads a bad head signature and missing anchoring as INVALID', async () => {
      vi.spyOn(signingProvider, 'verify').mockReturnValue({ ok: false });
      const { db, events } = await sealedChain(1, { token: null, witnessRecord: null });

      const { payload } = await verify(db, { eventId: events[0].eventId });

      expect(payload.data.overallStatus).toBe('INVALID');
      expect(payload.data.failures).toEqual(['treeHeadSignature', 'timestamp', 'witness']);
    });
  });

});

describe('audit.controller.report', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = { params: { date: '2026-07-04' }, query: {}, app: { locals: { db: null } } };
    const res = buildRes();

    await auditController.report(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('reports tampered:false and no proof when roots match and no hash query is given', async () => {
    const recalculated = { root: 'same', leaves: [1, 2, 3] };
    vi.spyOn(auditRootService, 'getRootByDate').mockResolvedValue({ root: 'same', previousRootHash: 'prev' });
    vi.spyOn(integrityService, 'buildMerkleForDate').mockResolvedValue(recalculated);
    const req = { params: { date: '2026-07-04' }, query: {}, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.report(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        savedRoot: 'same',
        recalculatedRoot: 'same',
        proof: null,
        leafCount: 3,
        previousRootHash: 'prev',
        tampered: false,
      },
    });
  });

  it('flags tampered:true when saved and recalculated roots differ', async () => {
    vi.spyOn(auditRootService, 'getRootByDate').mockResolvedValue({ root: 'old-root', previousRootHash: null });
    vi.spyOn(integrityService, 'buildMerkleForDate').mockResolvedValue({ root: 'new-root', leaves: [] });
    const req = { params: { date: '2026-07-04' }, query: {}, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.report(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ tampered: true }),
    }));
  });

  it('builds a proof for the hash query param when the recalculated root supports it', async () => {
    const getProofForHash = vi.fn().mockReturnValue(['proof-step']);
    vi.spyOn(auditRootService, 'getRootByDate').mockResolvedValue(null);
    vi.spyOn(integrityService, 'buildMerkleForDate').mockResolvedValue({ root: 'r', leaves: [], getProofForHash });
    const req = { params: { date: '2026-07-04' }, query: { hash: 'h1' }, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.report(req, res);

    expect(getProofForHash).toHaveBeenCalledWith('h1');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ proof: ['proof-step'], savedRoot: null }),
    }));
  });

  it('returns 500 when a dependency throws', async () => {
    vi.spyOn(auditRootService, 'getRootByDate').mockRejectedValue(new Error('mongo error'));
    const req = { params: { date: '2026-07-04' }, query: {}, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.report(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'mongo error' });
  });

  it('nulls out recalculatedRoot and leafCount when the Merkle rebuild returns nothing', async () => {
    vi.spyOn(auditRootService, 'getRootByDate').mockResolvedValue({ root: 'saved-root', previousRootHash: null });
    vi.spyOn(integrityService, 'buildMerkleForDate').mockResolvedValue(null);
    const req = { params: { date: '2026-07-04' }, query: {}, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.report(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        savedRoot: 'saved-root',
        recalculatedRoot: null,
        proof: null,
        leafCount: 0,
        previousRootHash: null,
        tampered: null,
      },
    });
  });

  it('logs the raw thrown value when it has no .message (falsy-message fallback)', async () => {
    vi.spyOn(auditRootService, 'getRootByDate').mockRejectedValue('plain string failure');
    vi.spyOn(logger, 'error');
    const req = { params: { date: '2026-07-04' }, query: {}, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.report(req, res);

    expect(logger.error).toHaveBeenCalledWith('Erro ao gerar relatório:', 'plain string failure');
  });
});

describe('audit.controller.compare', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = { params: { date: '2026-07-04' }, app: { locals: { db: null } } };
    const res = buildRes();

    await auditController.compare(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('reports no_saved_root when there is no saved root yet', async () => {
    vi.spyOn(auditRootService, 'getRootByDate').mockResolvedValue(null);
    vi.spyOn(integrityService, 'buildMerkleForDate').mockResolvedValue({ root: 'r' });
    const req = { params: { date: '2026-07-04' }, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.compare(req, res);

    // tampered is `saved && recalculated && ...`, which short-circuits to the
    // falsy `saved` (null here) rather than coercing to boolean false.
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { tampered: null, root_saved: null, root_current: 'r', diff: ['no_saved_root'] },
    });
  });

  it('reports root_mismatch when roots differ', async () => {
    vi.spyOn(auditRootService, 'getRootByDate').mockResolvedValue({ root: 'old' });
    vi.spyOn(integrityService, 'buildMerkleForDate').mockResolvedValue({ root: 'new' });
    const req = { params: { date: '2026-07-04' }, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.compare(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { tampered: true, root_saved: 'old', root_current: 'new', diff: ['root_mismatch'] },
    });
  });

  it('reports no_diff when saved and recalculated roots match', async () => {
    vi.spyOn(auditRootService, 'getRootByDate').mockResolvedValue({ root: 'same' });
    vi.spyOn(integrityService, 'buildMerkleForDate').mockResolvedValue({ root: 'same' });
    const req = { params: { date: '2026-07-04' }, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.compare(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { tampered: false, root_saved: 'same', root_current: 'same', diff: ['no_diff'] },
    });
  });

  it('returns 500 when a dependency throws', async () => {
    vi.spyOn(auditRootService, 'getRootByDate').mockRejectedValue(new Error('boom'));
    const req = { params: { date: '2026-07-04' }, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.compare(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('nulls out root_current when the Merkle rebuild returns nothing', async () => {
    vi.spyOn(auditRootService, 'getRootByDate').mockResolvedValue({ root: 'saved-root' });
    vi.spyOn(integrityService, 'buildMerkleForDate').mockResolvedValue(null);
    const req = { params: { date: '2026-07-04' }, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.compare(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { tampered: null, root_saved: 'saved-root', root_current: null, diff: ['no_diff'] },
    });
  });

  it('logs the raw thrown value when it has no .message (falsy-message fallback)', async () => {
    vi.spyOn(auditRootService, 'getRootByDate').mockRejectedValue('plain string failure');
    vi.spyOn(logger, 'error');
    const req = { params: { date: '2026-07-04' }, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.compare(req, res);

    expect(logger.error).toHaveBeenCalledWith('Erro ao comparar roots:', 'plain string failure');
  });
});

describe('audit.controller.hl7Report', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = { params: { date: '2026-07-04' }, app: { locals: { db: null } } };
    const res = buildRes();

    await auditController.hl7Report(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 200 with the HL7 Merkle result on success', async () => {
    const hl7Result = { root: 'hl7-root' };
    vi.spyOn(hl7AuditService, 'buildHL7MerkleForDate').mockResolvedValue(hl7Result);
    const req = { params: { date: '2026-07-04' }, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.hl7Report(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: hl7Result });
  });

  it('returns 500 when the service throws', async () => {
    vi.spyOn(hl7AuditService, 'buildHL7MerkleForDate').mockRejectedValue(new Error('hl7 error'));
    const req = { params: { date: '2026-07-04' }, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.hl7Report(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('logs the raw thrown value when it has no .message (falsy-message fallback)', async () => {
    vi.spyOn(hl7AuditService, 'buildHL7MerkleForDate').mockRejectedValue('plain string failure');
    vi.spyOn(logger, 'error');
    const req = { params: { date: '2026-07-04' }, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.hl7Report(req, res);

    expect(logger.error).toHaveBeenCalledWith('Erro ao gerar relatório HL7:', 'plain string failure');
  });
});

describe('audit.controller.dashboardDates', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = { app: { locals: { db: null } } };
    const res = buildRes();

    await auditController.dashboardDates(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('maps the chain to date/chainIndex/root entries', async () => {
    vi.spyOn(auditRootService, 'getChain').mockResolvedValue([
      { date: '2026-07-01', chainIndex: 0, root: 'r0', extra: 'dropped' },
      { date: '2026-07-02', chainIndex: 1, root: 'r1' },
    ]);
    const req = { app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.dashboardDates(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [
        { date: '2026-07-01', chainIndex: 0, root: 'r0' },
        { date: '2026-07-02', chainIndex: 1, root: 'r1' },
      ],
    });
  });

  it('returns 500 when the service throws', async () => {
    vi.spyOn(auditRootService, 'getChain').mockRejectedValue(new Error('chain error'));
    const req = { app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.dashboardDates(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('logs the raw thrown value when it has no .message (falsy-message fallback)', async () => {
    vi.spyOn(auditRootService, 'getChain').mockRejectedValue('plain string failure');
    vi.spyOn(logger, 'error');
    const req = { app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.dashboardDates(req, res);

    expect(logger.error).toHaveBeenCalledWith('Erro ao listar datas do dashboard:', 'plain string failure');
  });
});

describe('audit.controller.dashboardStats', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = { params: { date: '2026-07-04' }, app: { locals: { db: null } } };
    const res = buildRes();

    await auditController.dashboardStats(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('assembles date/leafCount/hl7Count/tampered stats on success', async () => {
    vi.spyOn(integrityService, 'buildMerkleForDate').mockResolvedValue({ root: 'r', leaves: [1, 2] });
    vi.spyOn(auditRootService, 'getRootByDate').mockResolvedValue({ root: 'r' });
    const countDocuments = vi.fn().mockResolvedValue(5);
    const req = {
      params: { date: '2026-07-04' },
      app: { locals: { db: { collection: vi.fn().mockReturnValue({ countDocuments }) } } },
    };
    const res = buildRes();

    await auditController.dashboardStats(req, res);

    expect(countDocuments).toHaveBeenCalledWith({ action: 'HL7_HASH', date: '2026-07-04' });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { date: '2026-07-04', leafCount: 2, hl7Count: 5, tampered: false },
    });
  });

  it('returns 500 when a dependency throws', async () => {
    vi.spyOn(integrityService, 'buildMerkleForDate').mockRejectedValue(new Error('merkle error'));
    const req = {
      params: { date: '2026-07-04' },
      app: { locals: { db: { collection: vi.fn() } } },
    };
    const res = buildRes();

    await auditController.dashboardStats(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('logs the raw thrown value when it has no .message (falsy-message fallback)', async () => {
    vi.spyOn(integrityService, 'buildMerkleForDate').mockRejectedValue('plain string failure');
    vi.spyOn(logger, 'error');
    const req = {
      params: { date: '2026-07-04' },
      app: { locals: { db: { collection: vi.fn() } } },
    };
    const res = buildRes();

    await auditController.dashboardStats(req, res);

    expect(logger.error).toHaveBeenCalledWith('Erro ao obter estatísticas do dashboard:', 'plain string failure');
  });
});

describe('audit.controller.dashboardRoots', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = { app: { locals: { db: null } } };
    const res = buildRes();

    await auditController.dashboardRoots(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns the full chain as-is on success', async () => {
    const chain = [{ date: '2026-07-01', root: 'r0' }];
    vi.spyOn(auditRootService, 'getChain').mockResolvedValue(chain);
    const req = { app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.dashboardRoots(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: chain });
  });

  it('returns 500 when the service throws', async () => {
    vi.spyOn(auditRootService, 'getChain').mockRejectedValue(new Error('chain error'));
    const req = { app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.dashboardRoots(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('logs the raw thrown value when it has no .message (falsy-message fallback)', async () => {
    vi.spyOn(auditRootService, 'getChain').mockRejectedValue('plain string failure');
    vi.spyOn(logger, 'error');
    const req = { app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.dashboardRoots(req, res);

    expect(logger.error).toHaveBeenCalledWith('Erro ao listar roots do dashboard:', 'plain string failure');
  });
});
