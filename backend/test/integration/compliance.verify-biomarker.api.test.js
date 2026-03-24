const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const biomarkerIntegrityService = require('../../src/services/biomarker-integrity.service');
const sessionService = require('../../src/services/session.service');
const auditLogger = require('../../src/utils/auditLogger');

function createAdminToken() {
  return jwt.sign(
    {
      id: 'qa-admin-1',
      userID: 'qa-admin-1',
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
    app.locals.db = {
      collection: vi.fn(() => ({
        findOne: vi.fn(),
        find: vi.fn(() => ({
          sort: vi.fn(() => ({
            toArray: vi.fn().mockResolvedValue([])
          }))
        })),
        createIndex: vi.fn().mockResolvedValue(undefined)
      }))
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
      patientId: '12345678',
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