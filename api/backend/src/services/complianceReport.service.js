/**
 * src/services/complianceReport.service.js
 * Gerador de relatórios de conformidade LGPD/ANVISA
 * Coleta métricas de bloqueios éticos, tentativas, etc.
 */

const logger = require('../utils/logger');
const { ObjectId } = require('mongodb');
const { getCollection } = require('../utils/collectionResolver');

class ComplianceReportService {
  constructor() {
    this.db = null;
  }

  _assertReportAvailable(report) {
    if (!report) {
      throw new Error('Relatório de conformidade indisponível: dados-base não foram gerados');
    }
  }

  init(db) {
    this.db = db;
  }

  /**
   * Gera relatório completo de conformidade em período
   */
  async generateComplianceReport(startDate, endDate) {
    if (!this.db) {
      logger.error('[COMPLIANCE] Database não inicializado');
      return null;
    }

    try {
      const dateFilter = {
        timestamp: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      };

      const report = {
        period: {
          start: startDate,
          end: endDate,
          generatedAt: new Date()
        },
        summary: {},
        blockedAttempts: {},
        alerts: {},
        consentMetrics: {},
        auditTrail: {}
      };

      // 1. Alertas de segurança
      report.alerts = await this._getAlertMetrics(dateFilter);

      // 2. Consentimentos
      report.consentMetrics = await this._getConsentMetrics(dateFilter);

      // 3. Tentativas bloqueadas
      report.blockedAttempts = await this._getBlockedAttemptsMetrics(dateFilter);

      // 4. Trilha de auditoria
      report.auditTrail = await this._getAuditTrailMetrics(dateFilter);

      // 5. Score de conformidade
      report.complianceScore = this._calculateComplianceScore(report);

      // 6. Recomendações
      report.recommendations = this._generateRecommendations(report);

      logger.info('[COMPLIANCE] Relatório gerado com sucesso');
      return report;

    } catch (error) {
      logger.error('[COMPLIANCE] Erro ao gerar relatório:', error.message);
      return null;
    }
  }

  /**
   * Métricas de alertas
   */
  async _getAlertMetrics(dateFilter) {
    try {
      const alertsCollection = this.db.collection('security_alerts');

      const total = await alertsCollection.countDocuments(dateFilter);

      const byType = await alertsCollection
        .aggregate([
          { $match: dateFilter },
          { $group: { _id: '$type', count: { $sum: 1 } } }
        ])
        .toArray();

      const bySeverity = await alertsCollection
        .aggregate([
          { $match: dateFilter },
          { $group: { _id: '$severity', count: { $sum: 1 } } }
        ])
        .toArray();

      const criticalAlerts = await alertsCollection.countDocuments({
        ...dateFilter,
        severity: 'critical'
      });

      const openAlerts = await alertsCollection.countDocuments({
        ...dateFilter,
        status: 'open'
      });

      return {
        total,
        byType: Object.fromEntries(byType.map(b => [b._id, b.count])),
        bySeverity: Object.fromEntries(bySeverity.map(b => [b._id, b.count])),
        critical: criticalAlerts,
        open: openAlerts,
        resolved: total - openAlerts
      };
    } catch (error) {
      logger.error('[COMPLIANCE] Erro ao calcular métricas de alertas:', error.message);
      return { total: 0 };
    }
  }

  /**
   * Métricas de consentimento
   */
  async _getConsentMetrics(dateFilter) {
    try {
      // Through the resolver, as the consent writers go: 'patient_consents'
      // was a collection nothing writes, so every metric here read zero.
      const consentsCollection = getCollection(this.db, 'consents');

      const total = await consentsCollection.countDocuments(dateFilter);

      const active = await consentsCollection.countDocuments({
        ...dateFilter,
        status: 'ACTIVE'
      });

      const revoked = await consentsCollection.countDocuments({
        ...dateFilter,
        status: 'REVOKED'
      });

      // Escopos mais concedidos
      const topScopes = await consentsCollection
        .aggregate([
          { $match: dateFilter },
          { $unwind: '$responses' },
          { $group: { _id: '$responses', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 }
        ])
        .toArray();

      return {
        total,
        active,
        revoked,
        activePercentage: total > 0 ? ((active / total) * 100).toFixed(2) : 0,
        revokedPercentage: total > 0 ? ((revoked / total) * 100).toFixed(2) : 0,
        topScopes: topScopes.map(s => ({ scope: s._id, count: s.count }))
      };
    } catch (error) {
      logger.error('[COMPLIANCE] Erro ao calcular métricas de consentimento:', error.message);
      return { total: 0 };
    }
  }

  /**
   * Métricas de tentativas bloqueadas
   */
  async _getBlockedAttemptsMetrics(dateFilter) {
    try {
      const logsCollection = this.db.collection('logs');

      const blockedAttempts = await logsCollection
        .aggregate([
          {
            $match: {
              ...dateFilter,
              action: { $in: ['CONSENT_BLOCK_DENIED', 'CONSENT_SCOPE_DENIED', 'CONSENT_REVOKED_DENIED'] }
            }
          },
          {
            $group: {
              _id: '$action',
              count: { $sum: 1 },
              uniquePatients: { $addToSet: '$payload.patientID' }
            }
          }
        ])
        .toArray();

      const totalBlocked = blockedAttempts.reduce((sum, b) => sum + b.count, 0);
      const uniquePatients = new Set();

      blockedAttempts.forEach(b => {
        b.uniquePatients.forEach(p => uniquePatients.add(p));
      });

      // Top 5 rotas mais bloqueadas
      const topRoutes = await logsCollection
        .aggregate([
          {
            $match: {
              ...dateFilter,
              action: { $in: ['CONSENT_BLOCK_DENIED', 'CONSENT_SCOPE_DENIED', 'CONSENT_REVOKED_DENIED'] }
            }
          },
          {
            $group: {
              _id: '$payload.requestPath',
              count: { $sum: 1 }
            }
          },
          { $sort: { count: -1 } },
          { $limit: 5 }
        ])
        .toArray();

      return {
        total: totalBlocked,
        byReason: Object.fromEntries(blockedAttempts.map(b => [b._id, b.count])),
        uniquePatientsAffected: uniquePatients.size,
        topBlockedRoutes: topRoutes.map(r => ({ route: r._id, count: r.count }))
      };
    } catch (error) {
      logger.error('[COMPLIANCE] Erro ao calcular métricas de bloqueios:', error.message);
      return { total: 0 };
    }
  }

  /**
   * Métricas de trilha de auditoria
   */
  async _getAuditTrailMetrics(dateFilter) {
    try {
      const logsCollection = this.db.collection('logs');

      const total = await logsCollection.countDocuments(dateFilter);

      const byAction = await logsCollection
        .aggregate([
          { $match: dateFilter },
          { $group: { _id: '$action', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 }
        ])
        .toArray();

      const byModule = await logsCollection
        .aggregate([
          { $match: dateFilter },
          { $group: { _id: '$module', count: { $sum: 1 } } }
        ])
        .toArray();

      const byResult = await logsCollection
        .aggregate([
          { $match: dateFilter },
          { $group: { _id: '$result', count: { $sum: 1 } } }
        ])
        .toArray();

      return {
        total,
        byAction: Object.fromEntries(byAction.map(a => [a._id, a.count])),
        byModule: Object.fromEntries(byModule.map(m => [m._id, m.count])),
        byResult: Object.fromEntries(byResult.map(r => [r._id, r.count]))
      };
    } catch (error) {
      logger.error('[COMPLIANCE] Erro ao calcular métricas de auditoria:', error.message);
      return { total: 0 };
    }
  }

  /**
   * Calcula score de conformidade (0-100)
   */
  _calculateComplianceScore(report) {
    let score = 100;

    // Reduz por alertas críticos
    if (report.alerts.critical > 0) {
      score -= report.alerts.critical * 5;
    }

    // Reduz por alertas abertos não resolvidos
    if (report.alerts.open > 0) {
      score -= Math.min(report.alerts.open * 2, 20);
    }

    // Bonifica se consentimentos ativos estão altos
    if (parseFloat(report.consentMetrics.activePercentage) > 80) {
      score += 5;
    }

    // Reduz por tentativas bloqueadas
    if (report.blockedAttempts.total > 10) {
      score -= Math.min((report.blockedAttempts.total - 10) * 1, 15);
    }

    // Floor em 0, ceiling em 100
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Gera recomendações baseadas em métricas
   */
  _generateRecommendations(report) {
    const recommendations = [];

    // Alertas críticos
    if (report.alerts.critical > 5) {
      recommendations.push({
        priority: 'high',
        title: 'Muitos alertas críticos',
        description: `${report.alerts.critical} alertas críticos foram detectados. Investigação imediata recomendada.`,
        action: 'Revisar logs e alertas de segurança'
      });
    }

    // Consentimento baixo
    if (parseFloat(report.consentMetrics.activePercentage) < 50) {
      recommendations.push({
        priority: 'high',
        title: 'Consentimentos ativos baixos',
        description: `Apenas ${report.consentMetrics.activePercentage}% dos consentimentos estão ativos.`,
        action: 'Revisar políticas de consentimento'
      });
    }

    // Bloqueios frequentes
    if (report.blockedAttempts.total > 50) {
      recommendations.push({
        priority: 'medium',
        title: 'Muitas tentativas bloqueadas',
        description: `${report.blockedAttempts.total} tentativas foram bloqueadas por falta de consentimento.`,
        action: 'Revisar fluxo de consentimento'
      });
    }

    // Alertas de revogação
    if (report.blockedAttempts.byReason?.CONSENT_REVOKED_DENIED > 0) {
      recommendations.push({
        priority: 'medium',
        title: 'Consentimentos revogados',
        description: `${report.blockedAttempts.byReason.CONSENT_REVOKED_DENIED} tentativas bloqueadas por consentimento revogado.`,
        action: 'Notificar usuários sobre revogações'
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        priority: 'low',
        title: 'Conformidade em dia',
        description: 'Nenhum problema de conformidade detectado neste período.',
        action: 'Manter monitoramento regular'
      });
    }

    return recommendations;
  }

  /**
   * Exporta relatório em JSON
   */
  async exportReportJSON(startDate, endDate) {
    const report = await this.generateComplianceReport(startDate, endDate);
    this._assertReportAvailable(report);
    return JSON.stringify(report, null, 2);
  }

  /**
   * Exporta relatório em CSV (resumido)
   */
  async exportReportCSV(startDate, endDate) {
    const report = await this.generateComplianceReport(startDate, endDate);
    this._assertReportAvailable(report);

    const csv = [
      'Relatório de Conformidade',
      `Período: ${startDate} a ${endDate}`,
      `Data de Geração: ${report.period.generatedAt}`,
      '',
      'Resumo Executivo',
      `Score de Conformidade: ${report.complianceScore}/100`,
      `Total de Alertas: ${report.alerts.total}`,
      `Alertas Críticos: ${report.alerts.critical}`,
      `Consentimentos Ativos: ${report.consentMetrics.active}/${report.consentMetrics.total}`,
      `Tentativas Bloqueadas: ${report.blockedAttempts.total}`,
      ''
    ].join('\n');

    return csv;
  }

  /**
   * Gera dashboard resumido
   */
  async getDashboardMetrics(daysBack = 30) {
    if (!this.db) {
      logger.error('[COMPLIANCE] Database não inicializado');
      return {
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
      };
    }

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - daysBack * 24 * 60 * 60 * 1000);

    const report = await this.generateComplianceReport(startDate, endDate);
    this._assertReportAvailable(report);

    return {
      complianceScore: report.complianceScore,
      metrics: {
        totalAlerts: report.alerts.total,
        criticalAlerts: report.alerts.critical,
        openAlerts: report.alerts.open,
        activeConsents: report.consentMetrics.active,
        blockedAttempts: report.blockedAttempts.total,
        totalAuditLogs: report.auditTrail.total
      },
      alerts: {
        high: report.alerts.bySeverity.high || 0,
        medium: report.alerts.bySeverity.medium || 0,
        low: report.alerts.bySeverity.low || 0
      },
      topIssues: report.recommendations.slice(0, 3)
    };
  }
}

module.exports = new ComplianceReportService();
