const productLegal = require('../../src/services/productLegal.service');

function createMemoryCollection() {
  const docs = [];
  return {
    docs,
    async createIndex() {
      return null;
    },
    async findOne(query) {
      return (
        docs.find((doc) =>
          Object.entries(query).every(([key, value]) => doc[key] === value)
        ) || null
      );
    },
    find(query) {
      const matched = docs.filter((doc) =>
        Object.entries(query).every(([key, value]) => doc[key] === value)
      );
      return {
        sort() {
          return {
            limit() {
              return {
                async next() {
                  return matched.slice().sort((a, b) => {
                    const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
                    const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
                    return bTime - aTime;
                  })[0] || null;
                },
              };
            },
          };
        },
      };
    },
    async insertOne(doc) {
      docs.push({ ...doc });
      return { insertedId: '1' };
    },
    async updateOne(filter, update, options = {}) {
      const index = docs.findIndex((doc) =>
        Object.entries(filter).every(([key, value]) => doc[key] === value)
      );
      const payload = { ...(update.$set || {}) };
      if (index >= 0) {
        docs[index] = { ...docs[index], ...payload };
      } else if (options.upsert) {
        docs.push({ ...filter, ...payload });
      }
      return { acknowledged: true };
    },
  };
}

function createMemoryDb(collections = {}) {
  return {
    collection(name) {
      if (!collections[name]) {
        collections[name] = createMemoryCollection();
      }
      return collections[name];
    },
  };
}

describe('productLegal.service (G13)', () => {
  it('resolveTenantId from organizationId or default', () => {
    expect(productLegal.resolveTenantId({ organizationId: 'org-1' })).toBe('org-1');
    expect(productLegal.resolveTenantId({ organizationIds: ['a', 'b'] })).toBe('a');
    expect(productLegal.resolveTenantId({})).toBe('default');
  });

  it('seeds defaults, lists pending, records acceptance, and requires re-accept after publish', async () => {
    const db = createMemoryDb();
    await productLegal.ensureIndexes(db);
    await productLegal.seedDefaults(db);

    const user = { organizationId: 'tenant-a' };
    const userId = 'user-1';

    const before = await productLegal.listPendingForUser(db, user, userId);
    expect(before.tenantId).toBe('tenant-a');
    expect(before.pending).toHaveLength(2);
    expect(before.pending.map((item) => item.docType).sort()).toEqual(['privacy', 'terms']);

    const accepted = await productLegal.recordAcceptance(db, {
      user,
      userId,
      docType: 'terms',
      docVersion: productLegal.DEFAULT_VERSION,
      ip: '127.0.0.1',
      userAgent: 'vitest',
    });
    expect(accepted.userId).toBe(userId);
    expect(accepted.tenantId).toBe('tenant-a');
    expect(accepted.docType).toBe('terms');
    expect(accepted.docVersion).toBe(productLegal.DEFAULT_VERSION);
    expect(accepted.ip).toBe('127.0.0.1');
    expect(accepted.userAgent).toBe('vitest');

    await productLegal.recordAcceptance(db, {
      user,
      userId,
      docType: 'privacy',
      docVersion: productLegal.DEFAULT_VERSION,
      ip: '127.0.0.1',
      userAgent: 'vitest',
    });

    const clear = await productLegal.listPendingForUser(db, user, userId);
    expect(clear.pending).toHaveLength(0);

    await productLegal.publishDocument(db, {
      docType: 'terms',
      docVersion: '2.1.1',
      publishedBy: 'admin-1',
    });

    const afterPublish = await productLegal.listPendingForUser(db, user, userId);
    expect(afterPublish.pending).toEqual([
      expect.objectContaining({ docType: 'terms', docVersion: '2.1.1' }),
    ]);
  });

  it('rejects invalid docType and mismatched acceptance version', async () => {
    const db = createMemoryDb();
    await productLegal.seedDefaults(db);

    await expect(
      productLegal.recordAcceptance(db, {
        user: {},
        userId: 'u1',
        docType: 'tcle',
        docVersion: productLegal.DEFAULT_VERSION,
      })
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      productLegal.recordAcceptance(db, {
        user: {},
        userId: 'u1',
        docType: 'terms',
        docVersion: '9.9.9',
      })
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      productLegal.publishDocument(db, { docType: 'terms', docVersion: '' })
    ).rejects.toMatchObject({ status: 400 });
  });
});

