import { afterEach, describe, expect, it, vi } from 'vitest';

const auditController = require('../../src/controllers/audit.controller');
const dailyMerkleJob = require('../../src/workers/jobs/daily-merkle.job');
const logger = require('../../src/utils/logger');
const auditTreeService = require('../../src/services/audit-tree.service');
const signingProvider = require('../../src/services/audit-signing.provider');

function buildRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function buildDb({ event, treeHead, olderTreeHead, token, witnessRecord, leaves } = {}) {
  const events = {
    findOne: vi.fn().mockResolvedValue(event ?? null),
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(leaves ?? []) }),
    }),
  };
  const heads = {
    findOne: vi.fn((query) => {
      if (
        query
        && Object.prototype.hasOwnProperty.call(query, 'treeSize')
        && olderTreeHead !== undefined
        && query.treeSize !== treeHead?.treeSize
      ) {
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('audit.controller item 8 residual branches', () => {
  it('logs the raw thrown value when anchorNow fails without an error.message', async () => {
    vi.spyOn(dailyMerkleJob, 'anchorDate').mockRejectedValue('tsa plain failure');
    const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const req = { body: { date: '2026-09-18' }, app: { locals: { db: {} } } };
    const res = buildRes();

    await auditController.anchorNow(req, res);

    expect(loggerSpy).toHaveBeenCalledWith(
      'Erro ao ancorar tree head sob demanda:',
      'tsa plain failure'
    );
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('treats a null verifyAudit body as an empty object and requires eventId', async () => {
    const req = { body: null, app: { locals: { db: buildDb() } } };
    const res = buildRes();

    await auditController.verifyAudit(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'eventId é obrigatório.',
    });
  });

  it('reports PARTIALLY_ANCHORED when a token exists without a witness', async () => {
    vi.spyOn(auditTreeService, 'verifyInclusion').mockReturnValue(true);
    vi.spyOn(auditTreeService, 'verifyConsistency').mockReturnValue(true);
    vi.spyOn(signingProvider, 'verify').mockReturnValue({ ok: true });

    const event = {
      eventId: 'evt-partial',
      logId: 'log-partial',
      treeSize: 1,
      sequenceNumber: 0,
      eventHash: 'h',
      payloadDigest: 'd',
      canonicalLeaf: { eventHash: 'h' },
      inclusionProof: [],
    };
    const treeHead = {
      _id: 'th-partial',
      logId: 'log-partial',
      treeSize: 1,
      rootHash: 'root',
      signature: 'sig',
      keyId: 'key',
      schemaVersion: 1,
      previousTreeHeadHash: null,
      periodStart: null,
      periodEnd: null,
      createdAt: '2026-09-18T00:00:00.000Z',
      hashAlgorithm: 'sha256',
      merkleAlgorithm: 'sha256',
      signatureAlgorithm: 'ed25519',
      status: 'ANCHORED',
    };
    const db = buildDb({
      event,
      treeHead,
      token: { token: 'tk-1' },
      witnessRecord: null,
      leaves: [event],
    });
    const req = { body: { eventId: 'evt-partial' }, app: { locals: { db } } };
    const res = buildRes();

    await auditController.verifyAudit(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.data.overallStatus).toBe('PARTIALLY_ANCHORED');
    expect(payload.data.failures).toEqual(['witness']);
  });

  it('records a timestamp failure when the token lacks a valid timestamp marker', async () => {
    vi.spyOn(auditTreeService, 'verifyInclusion').mockReturnValue(true);
    vi.spyOn(auditTreeService, 'verifyConsistency').mockReturnValue(true);
    vi.spyOn(signingProvider, 'verify').mockReturnValue({ ok: true });

    const event = {
      eventId: 'evt-ts',
      logId: 'log-ts',
      treeSize: 1,
      sequenceNumber: 0,
      eventHash: 'h',
      payloadDigest: 'd',
      canonicalLeaf: { eventHash: 'h' },
      inclusionProof: [],
    };
    const treeHead = {
      _id: 'th-ts',
      logId: 'log-ts',
      treeSize: 1,
      rootHash: 'root',
      signature: 'sig',
      keyId: 'key',
      schemaVersion: 1,
      previousTreeHeadHash: null,
      periodStart: null,
      periodEnd: null,
      createdAt: '2026-09-18T00:00:00.000Z',
      hashAlgorithm: 'sha256',
      merkleAlgorithm: 'sha256',
      signatureAlgorithm: 'ed25519',
      status: 'ANCHORED',
    };
    const db = buildDb({
      event,
      treeHead,
      token: { status: 'PENDING' },
      witnessRecord: { receipt: 'r-1' },
      leaves: [event],
    });
    const req = { body: { eventId: 'evt-ts' }, app: { locals: { db } } };
    const res = buildRes();

    await auditController.verifyAudit(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.data.timestampValid).toBe(false);
    expect(payload.data.failures).toEqual(expect.arrayContaining(['timestamp']));
  });
});
