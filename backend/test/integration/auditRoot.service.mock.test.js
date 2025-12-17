const assert = require('assert');
const auditRootService = require('../../src/services/auditRoot.service');

(async () => {
  console.log('-> Running auditRoot.service mock test...');

  // Mock DB provides minimal API used by service
  const mockColl = [];
  const mockDb = {
    collection: () => ({
      find: () => ({
        sort: () => ({
          limit: async () => mockColl.slice(-1),
          toArray: async () => mockColl
        })
      }),
      findOne: async (q) => mockColl.find(d => d.date === q.date) || null,
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

  console.log('\x1b[32m%s\x1b[0m', '✓ auditRoot.service mock tests passed');
  process.exit(0);
})();