import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { hashToken } = require('../../src/utils/tokenHash');
const authService = require('../../src/services/auth.service');
const rbac = require('../../src/services/rbac-assignment.service');
const tenantInvite = require('../../src/services/tenantInvite.service');

function memoryCollection() {
  const docs = [];
  return {
    createIndex: vi.fn().mockResolvedValue(undefined),
    findOne: vi.fn(async (query) => {
      if (query.$or) {
        return docs.find((d) => query.$or.some((clause) => Object.entries(clause).every(([k, v]) => d[k] === v))) || null;
      }
      return docs.find((d) => Object.entries(query).every(([k, v]) => d[k] === v)) || null;
    }),
    insertOne: vi.fn(async (doc) => {
      const withId = { ...doc, _id: { toString: () => `inv-${docs.length + 1}` } };
      docs.push(withId);
      return { insertedId: withId._id };
    }),
    updateOne: vi.fn(async (query, update) => {
      const idx = docs.findIndex((d) => Object.entries(query).every(([k, v]) => d[k] === v));
      if (idx >= 0) {
        docs[idx] = { ...docs[idx], ...update.$set };
        return { matchedCount: 1 };
      }
      return { matchedCount: 0 };
    }),
    _docs: docs,
  };
}

function buildDb() {
  const stores = {
    tenant_invites: memoryCollection(),
    users: memoryCollection(),
    organizations: {
      findOne: vi.fn().mockResolvedValue({ organizationId: 'ORG-1' }),
    },
  };
  return {
    collection: (name) => stores[name] || { findOne: vi.fn().mockResolvedValue(null) },
    stores,
  };
}

describe('tenantInvite.service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_TENANT_INVITE_LINK_IN_RESPONSE = 'true';
    vi.spyOn(rbac, 'resolveUserHierarchyLevel').mockResolvedValue(4);
    vi.spyOn(rbac, 'resolveOrganizationIdForCreate').mockImplementation((_scope, id) => id);
    vi.spyOn(authService, 'registerUser').mockResolvedValue({
      _id: { toString: () => 'new-user-id' },
      email: 'op@test.org',
    });
    vi.spyOn(authService, 'getAccessTypeForRole').mockImplementation((roleName) => {
      const map = { Administrador: 4, Coordenador: 3, Técnico: 2 };
      return map[roleName] || 2;
    });
  });

  it('createInvite stores hashed token and returns link in non-production', async () => {
    const db = buildDb();
    const result = await tenantInvite.createInvite(db, {
      payload: {
        name: 'Operador',
        email: 'op@test.org',
        username: 'operador',
        roleName: 'Técnico',
        organizationId: 'ORG-1',
      },
      createdBy: 'admin-1',
      organizationScope: { scope: 'global', organizationIds: [] },
    });
    expect(result.email).toBe('op@test.org');
    expect(result.inviteLink).toMatch(/\/invite\/accept\?token=/);
    const stored = db.stores.tenant_invites._docs[0];
    expect(stored.tokenHash).toBeTruthy();
    expect(stored.status).toBe('pending');
  });

  it('previewInvite returns sanitized fields', async () => {
    const db = buildDb();
    const rawToken = 'abc-def-token-12345678901234567890123456789012';
    db.stores.tenant_invites._docs.push({
      _id: { toString: () => '1' },
      tokenHash: hashToken(rawToken),
      status: 'pending',
      email: 'op@test.org',
      username: 'operador',
      displayName: 'Operador',
      organizationId: 'ORG-1',
      roleName: 'Técnico',
      expiresAt: new Date(Date.now() + 60000),
    });
    const preview = await tenantInvite.previewInvite(db, rawToken);
    expect(preview.email).toBe('op@test.org');
    expect(preview.username).toBe('operador');
  });

  it('acceptInvite registers user and marks invite redeemed', async () => {
    const db = buildDb();
    const rawToken = 'accept-token-12345678901234567890123456789012';
    db.stores.tenant_invites._docs.push({
      _id: { toString: () => '1' },
      tokenHash: hashToken(rawToken),
      status: 'pending',
      email: 'op@test.org',
      username: 'operador',
      displayName: 'Operador',
      phone: null,
      organizationId: 'ORG-1',
      roleName: 'Técnico',
      accessType: 2,
      createdBy: 'admin-1',
      expiresAt: new Date(Date.now() + 60000),
    });
    const out = await tenantInvite.acceptInvite(db, rawToken, { password: 'SenhaForte@12345' });
    expect(out.userId).toBe('new-user-id');
    expect(authService.registerUser).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ email: 'op@test.org', username: 'operador' }),
      'admin-1'
    );
    expect(db.stores.tenant_invites._docs[0].status).toBe('redeemed');
  });

  it('rejects expired preview', async () => {
    const db = buildDb();
    const rawToken = 'expired-token-123456789012345678901234567890';
    db.stores.tenant_invites._docs.push({
      tokenHash: hashToken(rawToken),
      status: 'pending',
      email: 'x@y.z',
      username: 'u',
      displayName: 'U',
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(tenantInvite.previewInvite(db, rawToken)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('omits inviteLink in production unless ALLOW_TENANT_INVITE_LINK_IN_RESPONSE', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_TENANT_INVITE_LINK_IN_RESPONSE;
    const db = buildDb();
    const result = await tenantInvite.createInvite(db, {
      payload: {
        name: 'Operador',
        email: 'op2@test.org',
        username: 'operador2',
        roleName: 'Técnico',
        organizationId: 'ORG-1',
      },
      createdBy: 'admin-1',
      organizationScope: { scope: 'global', organizationIds: [] },
    });
    expect(result.inviteLink).toBeUndefined();
    expect(result.email).toBe('op2@test.org');
  });
});