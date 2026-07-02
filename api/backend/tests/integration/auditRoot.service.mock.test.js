const assert = require('assert');
const crypto = require('crypto');
const env = require('../../src/config/env');
const auditRootService = require('../../src/services/auditRoot.service');

async function runAuditRootMockTest() {
  console.log('-> Running auditRoot.service mock test...');

  const keyPair = crypto.generateKeyPairSync('ed25519');
  const privatePem = keyPair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const publicPem = keyPair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  env.AUDIT_MERKLE_SIGN_KEY_ID = 'test-key-1';
  env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_PEM = privatePem;
  env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify({ 'test-key-1': publicPem });
  env.AUDIT_RFC3161_MODE = 'mock';

  // Mock DB provides minimal API used by service
  const mockColl = [];

  const createCursor = (docs) => {
    let current = [...docs];

    return {
      sort: (criteria = {}) => {
        const [[field, direction]] = Object.entries(criteria);
        current.sort((a, b) => {
          const left = a[field] ?? 0;
          const right = b[field] ?? 0;
          if (left === right) return 0;
          return direction >= 0 ? (left > right ? 1 : -1) : (left > right ? -1 : 1);
        });
        return createCursor(current);
      },
      limit: (n) => createCursor(current.slice(0, n)),
      toArray: async () => current
    };
  };

  const mockDb = {
    collection: () => ({
      createIndex: async () => {},
      find: () => createCursor(mockColl),
      findOne: async (q) => mockColl.find(d => d.date === q.date) || null,
      countDocuments: async (q) => mockColl.filter((d) => d?.timestamp?.token && d.timestamp.token === q['timestamp.token'] && d.date !== q.date?.$ne).length,
      updateOne: async (filter, update, opts) => {
        const existing = mockColl.find(d => d.date === filter.date);
        if (!existing && opts.upsert) {
          mockColl.push(update.$setOnInsert);
        }
      }
    })
  };

  // Save first root
  const saved = await auditRootService.saveDailyRoot({ date: '2025-12-11', root: 'root1', db: mockDb });
  assert.ok(saved, 'saved should exist');

  // Save second root
  const saved2 = await auditRootService.saveDailyRoot({ date: '2025-12-12', root: 'root2', db: mockDb });
  assert.ok(saved2, 'saved2 should exist');

  // getChain
  const chain = await auditRootService.getChain(mockDb);
  assert.ok(Array.isArray(chain));

  // verifyChainIntegrity structural check
  const check = await auditRootService.verifyChainIntegrity({ externalDb: mockDb });
  assert.ok(check.ok);

  const legacyMockDb = {
    collection: () => ({
      findOne: async () => ({ date: '2024-01-10', root: 'a'.repeat(64), previousRootHash: null }),
    }),
  };
  const legacy = await auditRootService.getOfficialRootRecord('2024-01-10', legacyMockDb);
  assert.equal(legacy.envelopeRecord.legacyV1, true);

  console.log('\x1b[32m%s\x1b[0m', '✓ auditRoot.service mock tests passed');
}

if (typeof process !== 'undefined' && process.env && process.env.VITEST) {
  describe('auditRoot.service mock flow', () => {
    it('executa fluxo de cadeia de raízes sem erro', async () => {
      await expect(runAuditRootMockTest()).resolves.toBeUndefined();
    });
  });
} else {
  runAuditRootMockTest()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}