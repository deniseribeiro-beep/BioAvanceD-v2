import { describe, it, expect, vi, beforeEach } from 'vitest';

const merkleTree = require('../../src/utils/merkleTree');
const auditController = require('../../src/controllers/audit.controller');
const auditRootService = require('../../src/services/auditRoot.service');
const merkleEnvelopeService = require('../../src/services/merkle-envelope.service');
const rfc3161AdapterService = require('../../src/services/rfc3161-adapter.service');

function mockRes() {
  const payload = { statusCode: 200, body: null };
  return {
    payload,
    status(code) {
      payload.statusCode = code;
      return this;
    },
    json(body) {
      payload.body = body;
      return this;
    },
  };
}

describe('audit.controller.verifyAudit', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejeita root enviada pelo cliente', async () => {
    const req = {
      body: { date: '2026-07-01', hash: 'a'.repeat(64), proof: [], root: 'b'.repeat(64) },
      app: { locals: { db: {} } },
    };
    const res = mockRes();

    await auditController.verifyAudit(req, res);

    expect(res.payload.statusCode).toBe(400);
    expect(res.payload.body.success).toBe(false);
  });

  it('usa apenas root oficial do servidor e valida prova', async () => {
    const leaves = ['leaf-a', 'leaf-b', 'leaf-c'].map((value) => merkleTree.sha256Hex(value));
    const tree = merkleTree.buildMerkleTree(leaves);
    const proof = merkleTree.getProofForHash(leaves, tree.layers, leaves[1]);

    vi.spyOn(auditRootService, 'getOfficialRootRecord').mockResolvedValue({
      rootDoc: {
        root: tree.root,
        timestamp: { token: Buffer.from('mock-tsa:test').toString('base64'), messageImprint: 'f'.repeat(64) },
      },
      envelopeRecord: {
        legacyV1: false,
        envelope: { root: tree.root },
        signature: 'sig',
        signatureAlgorithm: 'ED25519',
        keyId: 'kid-1',
        publicKeyFingerprint: 'fp',
      },
    });
    vi.spyOn(merkleEnvelopeService, 'verifyEnvelopeSignature').mockReturnValue({ ok: true, envelopeDigestSha256: 'f'.repeat(64) });
    vi.spyOn(rfc3161AdapterService, 'verifyTimestamp').mockReturnValue({ ok: true });

    const req = {
      body: { date: '2026-07-01', hash: leaves[1], proof },
      app: {
        locals: {
          db: {
            collection: () => ({
              countDocuments: async () => 0,
            }),
          },
        },
      },
    };
    const res = mockRes();

    await auditController.verifyAudit(req, res);

    expect(res.payload.statusCode).toBe(200);
    expect(res.payload.body.verified).toBe(true);
  });

  it('falha para prova valida em arvore falsa', async () => {
    const officialLeaves = ['l1', 'l2', 'l3'].map((value) => merkleTree.sha256Hex(value));
    const officialTree = merkleTree.buildMerkleTree(officialLeaves);
    const fakeLeaves = ['x1', 'x2', 'x3'].map((value) => merkleTree.sha256Hex(value));
    const fakeTree = merkleTree.buildMerkleTree(fakeLeaves);
    const fakeProof = merkleTree.getProofForHash(fakeLeaves, fakeTree.layers, fakeLeaves[0]);

    vi.spyOn(auditRootService, 'getOfficialRootRecord').mockResolvedValue({
      rootDoc: { root: officialTree.root, timestamp: { token: Buffer.from('mock-tsa:test').toString('base64'), messageImprint: 'a'.repeat(64) } },
      envelopeRecord: { legacyV1: false, envelope: { root: officialTree.root }, signature: 'sig', signatureAlgorithm: 'ED25519', keyId: 'kid-1', publicKeyFingerprint: 'fp' },
    });
    vi.spyOn(merkleEnvelopeService, 'verifyEnvelopeSignature').mockReturnValue({ ok: true, envelopeDigestSha256: 'a'.repeat(64) });
    vi.spyOn(rfc3161AdapterService, 'verifyTimestamp').mockReturnValue({ ok: true });

    const req = {
      body: { date: '2026-07-01', hash: fakeLeaves[0], proof: fakeProof },
      app: { locals: { db: { collection: () => ({ countDocuments: async () => 0 }) } } },
    };
    const res = mockRes();

    await auditController.verifyAudit(req, res);

    expect(res.payload.statusCode).toBe(200);
    expect(res.payload.body.verified).toBe(false);
  });

  it('falha quando assinatura do envelope e invalida', async () => {
    const leaves = ['s1', 's2'].map((value) => merkleTree.sha256Hex(value));
    const tree = merkleTree.buildMerkleTree(leaves);
    const proof = merkleTree.getProofForHash(leaves, tree.layers, leaves[0]);

    vi.spyOn(auditRootService, 'getOfficialRootRecord').mockResolvedValue({
      rootDoc: { root: tree.root, timestamp: { token: 'tok', messageImprint: 'f'.repeat(64) } },
      envelopeRecord: { legacyV1: false, envelope: { root: tree.root }, signature: 'bad', signatureAlgorithm: 'ED25519', keyId: 'kid-x', publicKeyFingerprint: 'fp' },
    });
    vi.spyOn(merkleEnvelopeService, 'verifyEnvelopeSignature').mockReturnValue({ ok: false, reason: 'signature_verification_failed' });

    const req = {
      body: { date: '2026-07-01', hash: leaves[0], proof },
      app: { locals: { db: { collection: () => ({ countDocuments: async () => 0 }) } } },
    };
    const res = mockRes();

    await auditController.verifyAudit(req, res);

    expect(res.payload.statusCode).toBe(400);
  });

  it('falha para keyId desconhecido e token TSA invalido', async () => {
    const leaves = ['k1', 'k2'].map((value) => merkleTree.sha256Hex(value));
    const tree = merkleTree.buildMerkleTree(leaves);
    const proof = merkleTree.getProofForHash(leaves, tree.layers, leaves[0]);

    vi.spyOn(auditRootService, 'getOfficialRootRecord').mockResolvedValue({
      rootDoc: { root: tree.root, timestamp: { token: 'tok', messageImprint: 'f'.repeat(64) } },
      envelopeRecord: { legacyV1: false, envelope: { root: tree.root }, signature: 'sig', signatureAlgorithm: 'ED25519', keyId: 'missing', publicKeyFingerprint: 'fp' },
    });
    vi.spyOn(merkleEnvelopeService, 'verifyEnvelopeSignature').mockReturnValue({ ok: false, reason: 'unknown_key_id' });

    const req = {
      body: { date: '2026-07-01', hash: leaves[0], proof },
      app: { locals: { db: { collection: () => ({ countDocuments: async () => 0 }) } } },
    };
    const res = mockRes();

    await auditController.verifyAudit(req, res);

    expect(res.payload.statusCode).toBe(400);
  });

  it('detecta replay de token TSA', async () => {
    const leaves = ['z1', 'z2'].map((value) => merkleTree.sha256Hex(value));
    const tree = merkleTree.buildMerkleTree(leaves);
    const proof = merkleTree.getProofForHash(leaves, tree.layers, leaves[0]);

    vi.spyOn(auditRootService, 'getOfficialRootRecord').mockResolvedValue({
      rootDoc: {
        root: tree.root,
        timestamp: { token: 'same-token', messageImprint: 'f'.repeat(64) },
      },
      envelopeRecord: {
        legacyV1: false,
        envelope: { root: tree.root },
        signature: 'sig',
        signatureAlgorithm: 'ED25519',
        keyId: 'kid-1',
        publicKeyFingerprint: 'fp',
      },
    });
    vi.spyOn(merkleEnvelopeService, 'verifyEnvelopeSignature').mockReturnValue({ ok: true, envelopeDigestSha256: 'f'.repeat(64) });
    vi.spyOn(rfc3161AdapterService, 'verifyTimestamp').mockReturnValue({ ok: false, reason: 'token_replay_detected' });

    const req = {
      body: { date: '2026-07-01', hash: leaves[0], proof },
      app: {
        locals: {
          db: {
            collection: () => ({
              countDocuments: async () => 1,
            }),
          },
        },
      },
    };
    const res = mockRes();

    await auditController.verifyAudit(req, res);

    expect(res.payload.statusCode).toBe(400);
    expect(String(res.payload.body.error)).toContain('Timestamp inválido');
  });
});
