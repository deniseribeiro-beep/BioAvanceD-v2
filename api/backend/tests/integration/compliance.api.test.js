import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const express = require('express');
const request = require('supertest');

const modulePaths = {
  auth: require.resolve('../../src/infrastructure/middleware/auth'),
  rbac: require.resolve('../../src/infrastructure/middleware/rbac'),
  complianceReportService: require.resolve('../../src/services/complianceReport.service'),
  securityAlertsService: require.resolve('../../src/services/securityAlerts.service'),
  biomarkerIntegrityService: require.resolve('../../src/services/biomarker-integrity.service'),
  controller: require.resolve('../../src/interface/routes/compliance.routes'),
};

function setCachedModule(modulePath, exportsObject) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsObject,
  };
}

describe('Compliance API integration', () => {
  let app;
  let fakeComplianceReportService;
  let fakeSecurityAlertsService;
  let fakeBiomarkerIntegrityService;
  const authenticate = (req, _res, next) => {
    req.user = { userID: 'user-1', actorId: '550e8400-e29b-41d4-a716-446655440011', _id: 'user-1' };
    next();
  };
  const requireRole = () => (_req, _res, next) => next();

  function buildApp(db = {}) {
    for (const modulePath of Object.values(modulePaths)) {
      delete require.cache[modulePath];
    }

    setCachedModule(modulePaths.auth, { authenticate });
    setCachedModule(modulePaths.rbac, { requireRole });

    fakeComplianceReportService = {
      init: vi.fn(),
      getDashboardMetrics: vi.fn().mockResolvedValue({ totalEvents: 3 }),
      generateComplianceReport: vi.fn().mockResolvedValue({ summary: 'ok' }),
      exportReportCSV: vi.fn().mockResolvedValue('col1,col2\nval1,val2'),
    };
    setCachedModule(modulePaths.complianceReportService, fakeComplianceReportService);

    fakeSecurityAlertsService = {
      init: vi.fn(),
      getOpenAlerts: vi.fn().mockResolvedValue([{ _id: 'a1', severity: 'high' }]),
      acknowledgeAlert: vi.fn().mockResolvedValue(undefined),
      resolveAlert: vi.fn().mockResolvedValue(undefined),
    };
    setCachedModule(modulePaths.securityAlertsService, fakeSecurityAlertsService);

    fakeBiomarkerIntegrityService = {
      verifyBiomarkerById: vi.fn().mockResolvedValue({ valid: true, hash: 'abc' }),
    };
    setCachedModule(modulePaths.biomarkerIntegrityService, fakeBiomarkerIntegrityService);

    const complianceRouter = require(modulePaths.controller);

    const application = express();
    application.use(express.json());
    application.use((req, _res, next) => {
      req.app.locals.db = db;
      next();
    });
    application.use('/api/compliance', complianceRouter);
    return application;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp({ marker: 'fake-db' });
  });

  afterEach(() => {
    for (const modulePath of Object.values(modulePaths)) {
      delete require.cache[modulePath];
    }
  });

  describe('GET /dashboard', () => {
    it('retorna 200 com métricas do dashboard usando o default de 30 dias', async () => {
      const response = await request(app).get('/api/compliance/dashboard');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, data: { totalEvents: 3 } });
      expect(fakeComplianceReportService.getDashboardMetrics).toHaveBeenCalledWith(30);
    });

    it('respeita o query param days quando fornecido', async () => {
      const response = await request(app).get('/api/compliance/dashboard?days=7');

      expect(response.status).toBe(200);
      expect(fakeComplianceReportService.getDashboardMetrics).toHaveBeenCalledWith(7);
    });

    it('retorna 503 quando o db não está disponível', async () => {
      app = buildApp(null);
      const response = await request(app).get('/api/compliance/dashboard');

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Banco de dados não disponível');
    });

    it('retorna 500 quando o serviço lança erro', async () => {
      fakeComplianceReportService.getDashboardMetrics.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/compliance/dashboard');

      expect(response.status).toBe(500);
      expect(response.body.message).toBe('boom');
    });
  });

  describe('GET /report', () => {
    it('retorna 400 quando startDate/endDate estão ausentes', async () => {
      const response = await request(app).get('/api/compliance/report');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('startDate e endDate são obrigatórios');
      expect(fakeComplianceReportService.generateComplianceReport).not.toHaveBeenCalled();
    });

    it('retorna 200 com relatório JSON no caminho feliz', async () => {
      const response = await request(app)
        .get('/api/compliance/report')
        .query({ startDate: '2026-01-01', endDate: '2026-01-31' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, data: { summary: 'ok' } });
      expect(fakeComplianceReportService.generateComplianceReport).toHaveBeenCalledWith(
        '2026-01-01',
        '2026-01-31'
      );
    });

    it('retorna CSV quando format=csv é passado', async () => {
      const response = await request(app)
        .get('/api/compliance/report')
        .query({ startDate: '2026-01-01', endDate: '2026-01-31', format: 'csv' });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/^text\/csv/);
      expect(response.headers['content-disposition']).toMatch(/attachment; filename="compliance-report.csv"/);
      expect(response.text).toBe('col1,col2\nval1,val2');
      expect(fakeComplianceReportService.generateComplianceReport).not.toHaveBeenCalled();
    });

    it('retorna 503 quando o db não está disponível', async () => {
      app = buildApp(null);
      const response = await request(app)
        .get('/api/compliance/report')
        .query({ startDate: '2026-01-01', endDate: '2026-01-31' });

      expect(response.status).toBe(503);
    });

    it('retorna 500 quando o serviço lança erro', async () => {
      fakeComplianceReportService.generateComplianceReport.mockRejectedValue(new Error('report boom'));

      const response = await request(app)
        .get('/api/compliance/report')
        .query({ startDate: '2026-01-01', endDate: '2026-01-31' });

      expect(response.status).toBe(500);
      expect(response.body.message).toBe('report boom');
    });
  });

  describe('GET /alerts', () => {
    it('retorna 200 com lista de alertas e total', async () => {
      const response = await request(app).get('/api/compliance/alerts');

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(response.body.data).toEqual([{ _id: 'a1', severity: 'high' }]);
      expect(fakeSecurityAlertsService.getOpenAlerts).toHaveBeenCalledWith({});
    });

    it('repassa filtros severity e type para o serviço', async () => {
      const response = await request(app)
        .get('/api/compliance/alerts')
        .query({ severity: 'high', type: 'auth' });

      expect(response.status).toBe(200);
      expect(fakeSecurityAlertsService.getOpenAlerts).toHaveBeenCalledWith({
        severity: 'high',
        type: 'auth',
      });
    });

    it('retorna 503 quando o db não está disponível', async () => {
      app = buildApp(null);
      const response = await request(app).get('/api/compliance/alerts');

      expect(response.status).toBe(503);
    });

    it('retorna 500 quando o serviço lança erro', async () => {
      fakeSecurityAlertsService.getOpenAlerts.mockRejectedValue(new Error('alerts boom'));

      const response = await request(app).get('/api/compliance/alerts');

      expect(response.status).toBe(500);
      expect(response.body.message).toBe('alerts boom');
    });
  });

  describe('POST /alerts/:id/acknowledge', () => {
    it('reconhece o alerta e retorna sucesso', async () => {
      const response = await request(app).post(
        '/api/compliance/alerts/507f1f77bcf86cd799439011/acknowledge'
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, message: 'Alerta reconhecido' });
      expect(fakeSecurityAlertsService.acknowledgeAlert).toHaveBeenCalledTimes(1);
      const [objectIdArg, userIdArg] = fakeSecurityAlertsService.acknowledgeAlert.mock.calls[0];
      expect(objectIdArg.toString()).toBe('507f1f77bcf86cd799439011');
      expect(userIdArg).toBe('user-1');
    });

    it('retorna 503 quando o db não está disponível', async () => {
      app = buildApp(null);
      const response = await request(app).post(
        '/api/compliance/alerts/507f1f77bcf86cd799439011/acknowledge'
      );

      expect(response.status).toBe(503);
    });

    it('retorna 500 quando o id não é um ObjectId válido', async () => {
      const response = await request(app).post('/api/compliance/alerts/not-an-object-id/acknowledge');

      expect(response.status).toBe(500);
      expect(fakeSecurityAlertsService.acknowledgeAlert).not.toHaveBeenCalled();
    });

    it('retorna 500 quando o serviço lança erro', async () => {
      fakeSecurityAlertsService.acknowledgeAlert.mockRejectedValue(new Error('ack boom'));

      const response = await request(app).post(
        '/api/compliance/alerts/507f1f77bcf86cd799439011/acknowledge'
      );

      expect(response.status).toBe(500);
      expect(response.body.message).toBe('ack boom');
    });
  });

  describe('POST /alerts/:id/resolve', () => {
    it('retorna 400 quando resolution está ausente', async () => {
      const response = await request(app).post(
        '/api/compliance/alerts/507f1f77bcf86cd799439011/resolve'
      );

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('resolution é obrigatório');
      expect(fakeSecurityAlertsService.resolveAlert).not.toHaveBeenCalled();
    });

    it('resolve o alerta e retorna sucesso', async () => {
      const response = await request(app)
        .post('/api/compliance/alerts/507f1f77bcf86cd799439011/resolve')
        .send({ resolution: 'falso positivo' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, message: 'Alerta resolvido' });
      const [objectIdArg, resolutionArg, userIdArg] = fakeSecurityAlertsService.resolveAlert.mock.calls[0];
      expect(objectIdArg.toString()).toBe('507f1f77bcf86cd799439011');
      expect(resolutionArg).toBe('falso positivo');
      expect(userIdArg).toBe('user-1');
    });

    it('retorna 503 quando o db não está disponível', async () => {
      app = buildApp(null);
      const response = await request(app)
        .post('/api/compliance/alerts/507f1f77bcf86cd799439011/resolve')
        .send({ resolution: 'falso positivo' });

      expect(response.status).toBe(503);
    });

    it('retorna 500 quando o serviço lança erro', async () => {
      fakeSecurityAlertsService.resolveAlert.mockRejectedValue(new Error('resolve boom'));

      const response = await request(app)
        .post('/api/compliance/alerts/507f1f77bcf86cd799439011/resolve')
        .send({ resolution: 'falso positivo' });

      expect(response.status).toBe(500);
      expect(response.body.message).toBe('resolve boom');
    });
  });

  describe('GET /scopes', () => {
    it('retorna todos os escopos por padrão', async () => {
      const response = await request(app).get('/api/compliance/scopes');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('filtra por category quando fornecida', async () => {
      const response = await request(app).get('/api/compliance/scopes?category=research');

      expect(response.status).toBe(200);
      expect(response.body.data.every((scope) => scope.category === 'research')).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('filtra por highRiskOnly=true quando fornecido', async () => {
      const response = await request(app).get('/api/compliance/scopes?highRiskOnly=true');

      expect(response.status).toBe(200);
      expect(response.body.data.every((scope) => scope.riskLevel === 'high')).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('GET /verify-biomarker/:id', () => {
    it('retorna 200 com o resultado da verificação', async () => {
      const response = await request(app).get('/api/compliance/verify-biomarker/biomarker-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, data: { valid: true, hash: 'abc' } });
      expect(fakeBiomarkerIntegrityService.verifyBiomarkerById).toHaveBeenCalledWith(
        { marker: 'fake-db' },
        'biomarker-1'
      );
    });

    it('retorna 503 quando o db não está disponível', async () => {
      app = buildApp(null);
      const response = await request(app).get('/api/compliance/verify-biomarker/biomarker-1');

      expect(response.status).toBe(503);
    });

    it('propaga o statusCode de um erro customizado do serviço', async () => {
      const customError = new Error('não encontrado');
      customError.statusCode = 404;
      fakeBiomarkerIntegrityService.verifyBiomarkerById.mockRejectedValue(customError);

      const response = await request(app).get('/api/compliance/verify-biomarker/missing-id');

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('não encontrado');
    });

    it('retorna 500 quando o erro não tem statusCode', async () => {
      fakeBiomarkerIntegrityService.verifyBiomarkerById.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/compliance/verify-biomarker/x');

      expect(response.status).toBe(500);
      expect(response.body.message).toBe('boom');
    });
  });
});
