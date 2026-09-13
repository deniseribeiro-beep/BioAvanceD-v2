import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const logger = require('../../../src/utils/logger');
const complianceReportService = require('../../../src/services/complianceReport.service');

function makeCollection(name, behavior) {
  return {
    countDocuments: vi.fn((filter) => behavior.countDocuments(filter)),
    aggregate: vi.fn((pipeline) => ({
      toArray: () => behavior.aggregate(pipeline)
    }))
  };
}

// Builds a fake db whose collections return canned "happy path" data,
// modeled after what each private helper expects to consume.
function makeHappyDb() {
  const alerts = makeCollection('security_alerts', {
    countDocuments: async (filter) => {
      if (filter.severity === 'critical') return 2;
      if (filter.status === 'open') return 3;
      return 10; // plain dateFilter -> total
    },
    aggregate: async (pipeline) => {
      const groupId = pipeline[1].$group._id;
      if (groupId === '$type') return [{ _id: 'brute_force', count: 4 }, { _id: 'xss', count: 6 }];
      if (groupId === '$severity') return [{ _id: 'high', count: 5 }, { _id: 'low', count: 5 }];
      return [];
    }
  });

  const consents = makeCollection('patient_consents', {
    countDocuments: async (filter) => {
      if (filter.status === 'ACTIVE') return 90;
      if (filter.status === 'REVOKED') return 10;
      return 100;
    },
    aggregate: async () => [{ _id: 'labResults', count: 50 }]
  });

  const logs = makeCollection('logs', {
    countDocuments: async () => 200,
    aggregate: async (pipeline) => {
      const groupId = pipeline[1].$group._id;
      if (groupId === '$action') {
        return [
          { _id: 'CONSENT_BLOCK_DENIED', count: 3, uniquePatients: ['p1', 'p2'] },
          { _id: 'CONSENT_REVOKED_DENIED', count: 2, uniquePatients: ['p2', 'p3'] }
        ];
      }
      if (groupId === '$payload.requestPath') {
        return [{ _id: '/api/labs', count: 4 }];
      }
      if (groupId === '$module') return [{ _id: 'lab', count: 100 }];
      if (groupId === '$result') return [{ _id: 'success', count: 150 }];
      return [];
    }
  });

  const collections = { security_alerts: alerts, patient_consents: consents, logs };
  return { db: { collection: vi.fn((name) => collections[name]) }, collections };
}

// Builds a db where every collection method throws, to exercise the
// try/catch -> { total: 0 } fallback paths in each private helper.
function makeThrowingDb() {
  const throwingCollection = {
    countDocuments: vi.fn(() => { throw new Error('boom-count'); }),
    aggregate: vi.fn(() => { throw new Error('boom-aggregate'); })
  };
  return { db: { collection: vi.fn(() => throwingCollection) } };
}

describe('complianceReport.service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    complianceReportService.db = null;
  });

  describe('init', () => {
    it('stores the provided db on the instance', () => {
      const fakeDb = { collection: vi.fn() };
      complianceReportService.init(fakeDb);
      expect(complianceReportService.db).toBe(fakeDb);
    });
  });

  describe('generateComplianceReport', () => {
    it('returns null and logs an error when db is not initialized', async () => {
      complianceReportService.db = null;
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      const result = await complianceReportService.generateComplianceReport('2026-01-01', '2026-01-31');

      expect(result).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith('[COMPLIANCE] Database não inicializado');
    });

    it('assembles a full report with score and recommendations on the happy path', async () => {
      const { db } = makeHappyDb();
      complianceReportService.init(db);

      const report = await complianceReportService.generateComplianceReport('2026-01-01', '2026-01-31');

      expect(report).not.toBeNull();
      expect(report.period.start).toBe('2026-01-01');
      expect(report.period.end).toBe('2026-01-31');
      expect(report.alerts.total).toBe(10);
      expect(report.alerts.critical).toBe(2);
      expect(report.alerts.open).toBe(3);
      expect(report.alerts.resolved).toBe(7);
      expect(report.consentMetrics.total).toBe(100);
      expect(report.consentMetrics.active).toBe(90);
      expect(report.consentMetrics.activePercentage).toBe('90.00');
      expect(report.blockedAttempts.total).toBe(5);
      expect(report.blockedAttempts.byReason).toEqual({
        CONSENT_BLOCK_DENIED: 3,
        CONSENT_REVOKED_DENIED: 2
      });
      expect(report.blockedAttempts.uniquePatientsAffected).toBe(3);
      expect(report.auditTrail.total).toBe(200);
      expect(typeof report.complianceScore).toBe('number');
      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    it('returns null and logs an error when an unexpected exception occurs mid-flow', async () => {
      const { db } = makeHappyDb();
      complianceReportService.init(db);
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      // Force _calculateComplianceScore (a synchronous pure step called
      // directly by generateComplianceReport) to throw, simulating an
      // unexpected runtime failure that the outer try/catch must handle.
      vi.spyOn(complianceReportService, '_calculateComplianceScore').mockImplementation(() => {
        throw new Error('unexpected failure');
      });

      const result = await complianceReportService.generateComplianceReport('2026-01-01', '2026-01-31');

      expect(result).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith('[COMPLIANCE] Erro ao gerar relatório:', 'unexpected failure');
    });
  });

  describe('private metric helpers - error fallback', () => {
    it('_getAlertMetrics falls back to { total: 0 } and logs when the collection throws', async () => {
      const { db } = makeThrowingDb();
      complianceReportService.init(db);
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      const result = await complianceReportService._getAlertMetrics({});

      expect(result).toEqual({ total: 0 });
      expect(errorSpy).toHaveBeenCalledWith(
        '[COMPLIANCE] Erro ao calcular métricas de alertas:',
        'boom-count'
      );
    });

    it('_getConsentMetrics falls back to { total: 0 } and logs when the collection throws', async () => {
      const { db } = makeThrowingDb();
      complianceReportService.init(db);
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      const result = await complianceReportService._getConsentMetrics({});

      expect(result).toEqual({ total: 0 });
      expect(errorSpy).toHaveBeenCalledWith(
        '[COMPLIANCE] Erro ao calcular métricas de consentimento:',
        'boom-count'
      );
    });

    it('_getBlockedAttemptsMetrics falls back to { total: 0 } and logs when the collection throws', async () => {
      const { db } = makeThrowingDb();
      complianceReportService.init(db);
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      const result = await complianceReportService._getBlockedAttemptsMetrics({});

      expect(result).toEqual({ total: 0 });
      expect(errorSpy).toHaveBeenCalledWith(
        '[COMPLIANCE] Erro ao calcular métricas de bloqueios:',
        'boom-aggregate'
      );
    });

    it('_getAuditTrailMetrics falls back to { total: 0 } and logs when the collection throws', async () => {
      const { db } = makeThrowingDb();
      complianceReportService.init(db);
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      const result = await complianceReportService._getAuditTrailMetrics({});

      expect(result).toEqual({ total: 0 });
      expect(errorSpy).toHaveBeenCalledWith(
        '[COMPLIANCE] Erro ao calcular métricas de auditoria:',
        'boom-count'
      );
    });
  });

  describe('_calculateComplianceScore', () => {
    function baseReport(overrides = {}) {
      return {
        alerts: { critical: 0, open: 0 },
        consentMetrics: { activePercentage: '0' },
        blockedAttempts: { total: 0 },
        ...overrides
      };
    }

    it('returns 100 when there are no negative signals and consent is not above the bonus threshold', () => {
      const score = complianceReportService._calculateComplianceScore(baseReport());
      expect(score).toBe(100);
    });

    it('subtracts 5 points per critical alert', () => {
      const score = complianceReportService._calculateComplianceScore(
        baseReport({ alerts: { critical: 2, open: 0 } })
      );
      expect(score).toBe(90);
    });

    it('subtracts open-alert penalty capped at 20', () => {
      // 3 open * 2 = 6, under the cap
      const uncapped = complianceReportService._calculateComplianceScore(
        baseReport({ alerts: { critical: 0, open: 3 } })
      );
      expect(uncapped).toBe(94);

      // 50 open * 2 = 100, capped at 20
      const capped = complianceReportService._calculateComplianceScore(
        baseReport({ alerts: { critical: 0, open: 50 } })
      );
      expect(capped).toBe(80);
    });

    it('adds a 5 point bonus when activePercentage is above 80', () => {
      const score = complianceReportService._calculateComplianceScore(
        baseReport({ consentMetrics: { activePercentage: '85.50' } })
      );
      expect(score).toBe(105 > 100 ? 100 : 105); // clamped to 100
      expect(score).toBe(100);
    });

    it('does not add the bonus when activePercentage is exactly 80', () => {
      const score = complianceReportService._calculateComplianceScore(
        baseReport({ consentMetrics: { activePercentage: '80' } })
      );
      expect(score).toBe(100);
    });

    it('subtracts blocked-attempts penalty capped at 15, only above 10 total', () => {
      // 15 total -> (15-10)*1 = 5, under cap
      const uncapped = complianceReportService._calculateComplianceScore(
        baseReport({ blockedAttempts: { total: 15 } })
      );
      expect(uncapped).toBe(95);

      // 100 total -> (100-10)*1 = 90, capped at 15
      const capped = complianceReportService._calculateComplianceScore(
        baseReport({ blockedAttempts: { total: 100 } })
      );
      expect(capped).toBe(85);

      // exactly 10 total triggers no penalty (threshold is > 10)
      const atThreshold = complianceReportService._calculateComplianceScore(
        baseReport({ blockedAttempts: { total: 10 } })
      );
      expect(atThreshold).toBe(100);
    });

    it('clamps the score to a floor of 0 when penalties would push it negative', () => {
      const score = complianceReportService._calculateComplianceScore(
        baseReport({
          alerts: { critical: 50, open: 50 },
          blockedAttempts: { total: 200 }
        })
      );
      expect(score).toBe(0);
    });
  });

  describe('_generateRecommendations', () => {
    function baseReport(overrides = {}) {
      return {
        alerts: { critical: 0 },
        consentMetrics: { activePercentage: '100' },
        blockedAttempts: { total: 0, byReason: {} },
        ...overrides
      };
    }

    it('recommends investigating when critical alerts exceed 5', () => {
      const recs = complianceReportService._generateRecommendations(
        baseReport({ alerts: { critical: 6 } })
      );
      expect(recs).toContainEqual(
        expect.objectContaining({ priority: 'high', title: 'Muitos alertas críticos' })
      );
    });

    it('does not flag critical alerts at exactly the threshold of 5', () => {
      const recs = complianceReportService._generateRecommendations(
        baseReport({ alerts: { critical: 5 } })
      );
      expect(recs.some(r => r.title === 'Muitos alertas críticos')).toBe(false);
    });

    it('recommends reviewing consent policy when activePercentage is below 50', () => {
      const recs = complianceReportService._generateRecommendations(
        baseReport({ consentMetrics: { activePercentage: '49' } })
      );
      expect(recs).toContainEqual(
        expect.objectContaining({ priority: 'high', title: 'Consentimentos ativos baixos' })
      );
    });

    it('recommends reviewing the consent flow when blockedAttempts.total exceeds 50', () => {
      const recs = complianceReportService._generateRecommendations(
        baseReport({ blockedAttempts: { total: 51, byReason: {} } })
      );
      expect(recs).toContainEqual(
        expect.objectContaining({ priority: 'medium', title: 'Muitas tentativas bloqueadas' })
      );
    });

    it('recommends notifying users when CONSENT_REVOKED_DENIED occurred', () => {
      const recs = complianceReportService._generateRecommendations(
        baseReport({ blockedAttempts: { total: 1, byReason: { CONSENT_REVOKED_DENIED: 2 } } })
      );
      expect(recs).toContainEqual(
        expect.objectContaining({ priority: 'medium', title: 'Consentimentos revogados' })
      );
    });

    it('does not throw when byReason is undefined and produces the fallback recommendation', () => {
      const report = {
        alerts: { critical: 0 },
        consentMetrics: { activePercentage: '100' },
        blockedAttempts: { total: 0 }
      };
      const recs = complianceReportService._generateRecommendations(report);
      expect(recs).toEqual([
        expect.objectContaining({ priority: 'low', title: 'Conformidade em dia' })
      ]);
    });

    it('falls back to the "conformidade em dia" recommendation when nothing is flagged', () => {
      const recs = complianceReportService._generateRecommendations(baseReport());
      expect(recs).toHaveLength(1);
      expect(recs[0]).toEqual(
        expect.objectContaining({ priority: 'low', title: 'Conformidade em dia' })
      );
    });

    it('can accumulate multiple recommendations at once', () => {
      const recs = complianceReportService._generateRecommendations(
        baseReport({
          alerts: { critical: 10 },
          consentMetrics: { activePercentage: '10' },
          blockedAttempts: { total: 100, byReason: { CONSENT_REVOKED_DENIED: 5 } }
        })
      );
      expect(recs).toHaveLength(4);
    });
  });

  describe('exportReportJSON', () => {
    it('returns a JSON stringified version of the generated report', async () => {
      const { db } = makeHappyDb();
      complianceReportService.init(db);

      const json = await complianceReportService.exportReportJSON('2026-01-01', '2026-01-31');
      const parsed = JSON.parse(json);

      expect(parsed.period.start).toBe('2026-01-01');
      expect(typeof parsed.complianceScore).toBe('number');
    });
  });

  describe('exportReportCSV', () => {
    it('returns a CSV summary containing key metrics from the report', async () => {
      const { db } = makeHappyDb();
      complianceReportService.init(db);

      const csv = await complianceReportService.exportReportCSV('2026-01-01', '2026-01-31');

      expect(csv).toContain('Relatório de Conformidade');
      expect(csv).toContain('Período: 2026-01-01 a 2026-01-31');
      expect(csv).toContain('Total de Alertas: 10');
      expect(csv).toContain('Alertas Críticos: 2');
      expect(csv).toContain('Consentimentos Ativos: 90/100');
      expect(csv).toContain('Tentativas Bloqueadas: 5');
    });

    it('throws a clear error (not a TypeError) when the underlying report generation returns null', async () => {
      complianceReportService.db = null;
      vi.spyOn(logger, 'error').mockImplementation(() => {});

      await expect(
        complianceReportService.exportReportCSV('2026-01-01', '2026-01-31')
      ).rejects.toThrow('Relatório de conformidade indisponível');
    });
  });

  describe('getDashboardMetrics', () => {
    it('summarizes the report into dashboard-shaped metrics using the default 30 day window', async () => {
      const { db } = makeHappyDb();
      complianceReportService.init(db);

      const dashboard = await complianceReportService.getDashboardMetrics();

      expect(dashboard.complianceScore).toEqual(expect.any(Number));
      expect(dashboard.metrics).toEqual({
        totalAlerts: 10,
        criticalAlerts: 2,
        openAlerts: 3,
        activeConsents: 90,
        blockedAttempts: 5,
        totalAuditLogs: 200
      });
      expect(dashboard.alerts).toEqual({ high: 5, medium: 0, low: 5 });
      expect(dashboard.topIssues.length).toBeLessThanOrEqual(3);
    });

    it('defaults missing severities to 0 when bySeverity has no matching key', async () => {
      const { db, collections } = makeHappyDb();
      collections.security_alerts.aggregate = vi.fn(() => ({
        toArray: async () => []
      }));
      complianceReportService.init(db);

      const dashboard = await complianceReportService.getDashboardMetrics(7);

      expect(dashboard.alerts).toEqual({ high: 0, medium: 0, low: 0 });
    });

    // getDashboardMetrics's own `if (!this.db)` guard degrades gracefully to
    // a default all-zeros dashboard instead of throwing. The route
    // (compliance.routes.js) always calls init(db) with a confirmed-truthy
    // db immediately before this call, so this branch is unreachable via the
    // real caller, but the fail-open default is still a safe, deliberate
    // guard (fixed per #15/#156) rather than a crash.
    it('degrades to a default all-zeros dashboard when the db is not initialized', async () => {
      complianceReportService.db = null;
      vi.spyOn(logger, 'error').mockImplementation(() => {});

      const dashboard = await complianceReportService.getDashboardMetrics(30);

      expect(dashboard).toEqual({
        complianceScore: 0,
        metrics: {
          totalAlerts: 0,
          criticalAlerts: 0,
          openAlerts: 0,
          activeConsents: 0,
          blockedAttempts: 0,
          totalAuditLogs: 0
        },
        alerts: {
          high: 0,
          medium: 0,
          low: 0
        },
        topIssues: []
      });
    });
  });
});
