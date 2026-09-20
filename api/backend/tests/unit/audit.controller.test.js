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

  it('returns 404 when the tree head is not found', async () => {
    const event = { eventId: 'evt-1', logId: 'log-1', treeSize: 1, sequenceNumber: 0, canonicalLeaf: {} };
    const db = buildDb({ event, treeHead: null, leaves: [event] });
    const req = { body: { eventId: 'evt-1' }, app: { locals: { db } } };
    const res = buildRes();

    await auditController.verifyAudit(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Tree head oficial não encontrado.' });
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

  it('falls back to an empty inclusion proof when the event has none, and to null for a missing prior tree head root', async () => {
    const auditTreeService = require('../../src/services/audit-tree.service');
    const signingProvider = require('../../src/services/audit-signing.provider');
    vi.spyOn(auditTreeService, 'verifyInclusion').mockReturnValue(false);
    vi.spyOn(auditTreeService, 'verifyConsistency').mockReturnValue(false);
    vi.spyOn(signingProvider, 'verify').mockReturnValue({ ok: true });

    const event = {
      eventId: 'evt-3', logId: 'log-3', treeSize: 2, sequenceNumber: 1,
      eventHash: 'h', payloadDigest: 'd', canonicalLeaf: { eventHash: 'h' },
      // no inclusionProof field
    };
    const treeHead = {
      _id: 'th-3', logId: 'log-3', treeSize: 2, rootHash: 'root-3', signature: 'sig', keyId: 'key-3',
      schemaVersion: 1, previousTreeHeadHash: null, periodStart: null, periodEnd: null,
      createdAt: '2026-07-04T00:00:00.000Z', hashAlgorithm: 'sha256', merkleAlgorithm: 'sha256', signatureAlgorithm: 'ed25519', status: 'ANCHORED',
    };
    const token = { token: 'tk-3' };
    const witnessRecord = { receiptEnvelope: 're-3' };
    const db = buildDb({ event, treeHead, olderTreeHead: null, token, witnessRecord, leaves: [event] });
    const req = { body: { eventId: 'evt-3' }, app: { locals: { db } } };
    const res = buildRes();

    await auditController.verifyAudit(req, res);

    expect(auditTreeService.verifyInclusion).toHaveBeenCalledWith(event.canonicalLeaf, [], treeHead.rootHash);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.consistencyValid).toBe(false);
  });

  it('reports PARTIALLY_ANCHORED when a timestamp token exists but no witness record does', async () => {
    const auditTreeService = require('../../src/services/audit-tree.service');
    const signingProvider = require('../../src/services/audit-signing.provider');
    vi.spyOn(auditTreeService, 'verifyInclusion').mockReturnValue(true);
    vi.spyOn(auditTreeService, 'verifyConsistency').mockReturnValue(true);
    vi.spyOn(signingProvider, 'verify').mockReturnValue({ ok: true });

    const event = {
      eventId: 'evt-4', logId: 'log-4', treeSize: 1, sequenceNumber: 0,
      eventHash: 'h', payloadDigest: 'd', canonicalLeaf: { eventHash: 'h' }, inclusionProof: [],
    };
    const treeHead = {
      _id: 'th-4', logId: 'log-4', treeSize: 1, rootHash: 'root-4', signature: 'sig', keyId: 'key-4',
      schemaVersion: 1, previousTreeHeadHash: null, periodStart: null, periodEnd: null,
      createdAt: '2026-07-04T00:00:00.000Z', hashAlgorithm: 'sha256', merkleAlgorithm: 'sha256', signatureAlgorithm: 'ed25519', status: 'ANCHORED',
    };
    const token = { tokenDerHex: 'der-hex', status: 'TIMESTAMPED' };
    const db = buildDb({ event, treeHead, token, witnessRecord: null, leaves: [event] });
    const req = { body: { eventId: 'evt-4' }, app: { locals: { db } } };
    const res = buildRes();

    await auditController.verifyAudit(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.data.overallStatus).toBe('PARTIALLY_ANCHORED');
    expect(payload.data.timestampValid).toBe(true);
    expect(payload.data.externalWitnessValid).toBe(false);
    expect(payload.data.failures).toEqual(['witness']);
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

  it('returns 200 with overallStatus VALID when every check passes', async () => {
    const auditTreeService = require('../../src/services/audit-tree.service');
    const signingProvider = require('../../src/services/audit-signing.provider');
    vi.spyOn(auditTreeService, 'verifyInclusion').mockReturnValue(true);
    vi.spyOn(auditTreeService, 'verifyConsistency').mockReturnValue(true);
    vi.spyOn(signingProvider, 'verify').mockReturnValue({ ok: true });

    const event = {
      eventId: 'evt-1',
      logId: 'log-1',
      treeSize: 1,
      sequenceNumber: 0,
      eventHash: 'hash-1',
      payloadDigest: 'digest-1',
      canonicalLeaf: { eventHash: 'hash-1' },
      inclusionProof: [],
    };
    const treeHead = {
      _id: 'th-1', logId: 'log-1', treeSize: 1, rootHash: 'root-1', signature: 'sig', keyId: 'key-1',
      schemaVersion: 1, previousTreeHeadHash: null, periodStart: null, periodEnd: null,
      createdAt: '2026-07-04T00:00:00.000Z', hashAlgorithm: 'sha256', merkleAlgorithm: 'sha256', signatureAlgorithm: 'ed25519', status: 'ANCHORED',
    };
    const token = { token: 'tk-1' };
    const witnessRecord = { receipt: 'r-1' };
    const db = buildDb({ event, treeHead, token, witnessRecord, leaves: [event] });
    const req = { body: { eventId: 'evt-1' }, app: { locals: { db } } };
    const res = buildRes();

    await auditController.verifyAudit(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.overallStatus).toBe('VALID');
    expect(payload.data.failures).toEqual([]);
    expect(payload.data.eventIntegrity).toBe(true);
    expect(payload.data.inclusionValid).toBe(true);
    expect(payload.data.treeHeadSignatureValid).toBe(true);
    expect(payload.data.timestampValid).toBe(true);
    expect(payload.data.externalWitnessValid).toBe(true);
    expect(payload.data.consistencyValid).toBe(true);
  });

  it('returns 200 with overallStatus INVALID and lists failures when checks fail', async () => {
    const auditTreeService = require('../../src/services/audit-tree.service');
    const signingProvider = require('../../src/services/audit-signing.provider');
    vi.spyOn(auditTreeService, 'verifyInclusion').mockReturnValue(false);
    vi.spyOn(auditTreeService, 'verifyConsistency').mockReturnValue(false);
    vi.spyOn(signingProvider, 'verify').mockReturnValue({ ok: false });

    const event = {
      eventId: 'evt-2',
      logId: 'log-2',
      treeSize: 1,
      sequenceNumber: 0,
      eventHash: null,
      payloadDigest: null,
      canonicalLeaf: { eventHash: 'hash-2' },
      inclusionProof: [],
    };
    const treeHead = {
      _id: 'th-2', logId: 'log-2', treeSize: 1, rootHash: 'root-2', signature: 'sig', keyId: 'key-2',
      schemaVersion: 1, previousTreeHeadHash: null, periodStart: null, periodEnd: null,
      createdAt: '2026-07-04T00:00:00.000Z', hashAlgorithm: 'sha256', merkleAlgorithm: 'sha256', signatureAlgorithm: 'ed25519', status: 'ANCHORED',
    };
    const db = buildDb({ event, treeHead, token: null, witnessRecord: null, leaves: [event] });
    const req = { body: { eventId: 'evt-2' }, app: { locals: { db } } };
    const res = buildRes();

    await auditController.verifyAudit(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.overallStatus).toBe('INVALID');
    expect(payload.data.failures).toEqual(
      expect.arrayContaining(['eventIntegrity', 'inclusion', 'treeHeadSignature', 'timestamp', 'witness', 'consistency'])
    );
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


describe('audit.controller.anchorNow item 8 residual branches', () => {
  const dailyMerkleJob = require('../../src/workers/jobs/daily-merkle.job');

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 503 when the database is unavailable', async () => {
    const req = { body: { date: '2026-09-19' }, app: { locals: { db: null } } };
    const res = buildRes();

    await auditController.anchorNow(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Banco de dados não disponível' });
  });

  it('defaults to yesterday when date is omitted and returns the anchored outcome', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T12:00:00.000Z'));
    const anchorDate = vi.spyOn(dailyMerkleJob, 'anchorDate').mockResolvedValue({
      _id: 'head-1',
      treeSize: 12,
      anchorStatus: 'ANCHORED',
      status: 'PENDING_TIMESTAMP',
    });
    const db = {};
    const req = { body: {}, app: { locals: { db } } };
    const res = buildRes();

    await auditController.anchorNow(req, res);

    expect(anchorDate).toHaveBeenCalledWith(db, '2026-09-19');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        date: '2026-09-19',
        treeHeadId: 'head-1',
        treeSize: 12,
        anchorStatus: 'ANCHORED',
        status: 'PENDING_TIMESTAMP',
      },
    });
  });

  it('rejects a caller-supplied date outside YYYY-MM-DD before invoking the Merkle job', async () => {
    const anchorDate = vi.spyOn(dailyMerkleJob, 'anchorDate');
    const req = { body: { date: '20/09/2026' }, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.anchorNow(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(anchorDate).not.toHaveBeenCalled();
  });

  it('returns 422 when the requested date has no valid Merkle result to seal', async () => {
    vi.spyOn(dailyMerkleJob, 'anchorDate').mockResolvedValue(null);
    const req = { body: { date: '2026-09-19' }, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.anchorNow(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Nenhum resultado Merkle válido para 2026-09-19; nada foi selado.',
    });
  });

  it('returns the explicit date and tree-head outcome on a successful on-demand anchor', async () => {
    vi.spyOn(dailyMerkleJob, 'anchorDate').mockResolvedValue({
      _id: 'head-2',
      treeSize: 5,
      anchorStatus: 'TIMESTAMPED',
      status: 'PENDING_TIMESTAMP',
    });
    const req = { body: { date: '2026-09-18' }, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.anchorNow(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        date: '2026-09-18',
        treeHeadId: 'head-2',
        anchorStatus: 'TIMESTAMPED',
      }),
    }));
  });

  it('returns 500 and logs the underlying failure when anchoring throws', async () => {
    vi.spyOn(dailyMerkleJob, 'anchorDate').mockRejectedValue(new Error('tsa unavailable'));
    const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const req = { body: { date: '2026-09-18' }, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.anchorNow(req, res);

    expect(loggerSpy).toHaveBeenCalledWith('Erro ao ancorar tree head sob demanda:', 'tsa unavailable');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'tsa unavailable' });
  });
});
