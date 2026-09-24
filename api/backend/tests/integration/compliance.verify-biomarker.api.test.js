
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const biomarkerIntegrityService = require('../../src/services/biomarker-integrity.service');
const sessionService = require('../../src/services/session.service');
const auditLogger = require('../../src/utils/auditLogger');
const { buildRbacCollections } = require('../factories/rbac.factory');
const {
  makeAuthToken,
  makeLegacyClaimsToken,
  buildAuthenticatedCollections,
  userForAccessType,
  TEST_USER_ACCOUNT_IDS,
} = require('../factories/auth.factory');


function createAdminToken() {
  return jwt.sign(
    {
      id: TEST_USER_ACCOUNT_IDS[4],
      userID: TEST_USER_ACCOUNT_IDS[4],
      accessType: 4,
      roleName: 'Administrador',
      name: 'QA Admin',
      mfaVerified: true,
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('GET /api/compliance/verify-biomarker/:id', () => {
  beforeEach(() => {
    // #421: enforcement resolves permissions via UserRoleAssignment -> Role
    // -> Permission, keyed by userID, not accessType off the JWT directly —
    // wire in real query-matching mocks for those three collections, seeded
    // with an active admin (accessType 4) assignment for qa-admin-1, so the
    // route's requireRole/requirePermission guard behaves like the old
    // accessType-based check did.
    const rbacCollections = buildRbacCollections([{ userAccountId: TEST_USER_ACCOUNT_IDS[4], accessType: 4 }]);
    const genericCollection = () => ({
      findOne: vi.fn(),
      find: vi.fn(() => ({
        sort: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue([])
        }))
      })),
      createIndex: vi.fn().mockResolvedValue(undefined)
    });
    app.locals.db = {
      collection: vi.fn((name) => rbacCollections[name] || genericCollection())
    };

    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'compliance-session-1' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'compliance-session-1' });

    vi.spyOn(auditLogger, 'init').mockImplementation(() => undefined);
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    vi.spyOn(auditLogger, 'logError').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deve retornar prova criptográfica válida (200)', async () => {
    const biomarkerIntegrityId = '507f1f77bcf86cd799439011';
    vi.spyOn(biomarkerIntegrityService, 'verifyBiomarkerById').mockResolvedValue({
      biomarkerIntegrityId,
      participantId: '12345678',
      biomarkerType: 'alphaGal',
      integrityHash: 'abc123',
      merkleRoot: 'root123',
      proof: [{ position: 'left', data: 'x' }],
      verified: true
    });

    const response = await request(app)
      .get(`/api/compliance/verify-biomarker/${biomarkerIntegrityId}`)
      .set('Authorization', `Bearer ${createAdminToken()}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.verified).toBe(true);
    expect(response.body.data.biomarkerIntegrityId).toBe(biomarkerIntegrityId);
    expect(biomarkerIntegrityService.verifyBiomarkerById).toHaveBeenCalledWith(app.locals.db, biomarkerIntegrityId);
  });

  it('deve retornar 400 para id inválido de biomarcador', async () => {
    const invalidId = 'id-invalido';
    const error = new Error('ID de integridade de biomarcador inválido');
    error.statusCode = 400;

    vi.spyOn(biomarkerIntegrityService, 'verifyBiomarkerById').mockRejectedValue(error);

    const response = await request(app)
      .get(`/api/compliance/verify-biomarker/${invalidId}`)
      .set('Authorization', `Bearer ${createAdminToken()}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('inválido');
  });
});