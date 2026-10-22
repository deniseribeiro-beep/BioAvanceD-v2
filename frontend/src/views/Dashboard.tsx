import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import { AlertTriangle, Users, FlaskConical, FileText, Thermometer, FileSearch, Boxes, BarChart3, UserCog, ShieldCheck, ScrollText, Settings } from 'lucide-react';
import { usePatients } from '../hooks/usePatients';
import { useSamples } from '../hooks/useSamples';
import { useResults } from '../hooks/useResults';
import { useTemperature } from '../hooks/useTemperature';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useTemperatureReadings } from '../hooks/useTemperatureReadings';
import { securityService, reportsService } from '../services/api';
import { apiClient } from '../api/client';
import { DASHBOARD_CARDS, dashboardRole, needsReportCount, type DashboardCardKey } from './dashboardCards';
import { activeIncidents, buildTemperatureSeries } from './dashboardTemperature';
import { onDashboardDataChanged } from '../utils/dashboardRefresh';
import './Dashboard.css';

type DashboardIncident = {
  _id: string;
  sensorName: string;
  currentTemperature: number;
  openedAt: string;
  status: 'open' | 'acknowledged' | 'escalated' | 'resolved';
};

type IncidentRead = { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: DashboardIncident[] };

const CHART_COLORS = ['#2563eb', '#16a34a', '#dc2626'];

// #1397 (RF009 AC7): the chart draws the readings persisted in InfluxDB, and
// an empty or failed read as such, never a generated value.
function DashboardTemperatureChart() {
  const { t, language } = useLanguage();
  const locale = language;
  const { readings, loading, error } = useTemperatureReadings();

  if (error) {
    return (
      <div role="alert" data-testid="dashboard-temperature-error" style={{ color: 'var(--danger)' }}>
        Falha ao carregar as leituras de temperatura: {error}
      </div>
    );
  }

  if (loading && readings.length === 0) {
    return <div data-testid="dashboard-temperature-loading">Carregando leituras de temperatura…</div>;
  }

  const { series, domain, timeRange } = buildTemperatureSeries(readings);
  if (series.length === 0 || !timeRange) {
    return <div data-testid="dashboard-temperature-empty">Nenhuma leitura de temperatura registrada.</div>;
  }

  const chartHeight = 280;
  const chartWidth = 860;
  const chartPadding = { top: 20, right: 24, bottom: 36, left: 56 };
  const innerWidth = chartWidth - chartPadding.left - chartPadding.right;
  const innerHeight = chartHeight - chartPadding.top - chartPadding.bottom;
  const chartRange = domain.max - domain.min;
  const timeSpan = timeRange.end - timeRange.start;
  const xOf = (time: number) => (timeSpan > 0
    ? chartPadding.left + ((time - timeRange.start) / timeSpan) * innerWidth
    : chartPadding.left + innerWidth / 2);
  const yOf = (celsius: number) => chartPadding.top + ((domain.max - celsius) / chartRange) * innerHeight;

  const tickCount = 5;
  const chartTicks = Array.from({ length: tickCount }, (_, index) => {
    const value = domain.max - ((chartRange / (tickCount - 1)) * index);
    return { value, y: yOf(value) };
  });
  const timeLabels = (timeSpan > 0 ? [timeRange.start, timeRange.end] : [timeRange.start]).map((time) => ({
    time,
    x: xOf(time),
    label: new Date(time).toLocaleTimeString(locale, { hour12: false }).slice(0, 5),
  }));

  return (
    <div className="temperature-chart-svg-wrap">
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={t('dashboard.temperatureChartAria', 'Gráfico de temperatura em tempo real')}>
        <defs>
          <linearGradient id="chartAreaGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.95)" />
            <stop offset="100%" stopColor="rgba(236,253,245,0.8)" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width={chartWidth} height={chartHeight} rx="18" fill="url(#chartAreaGradient)" />

        {chartTicks.map((tick) => (
          <g key={tick.value}>
            <line
              x1={chartPadding.left}
              y1={tick.y}
              x2={chartWidth - chartPadding.right}
              y2={tick.y}
              stroke="rgba(15, 23, 42, 0.08)"
              strokeDasharray="4 6"
            />
            <text
              x={chartPadding.left - 10}
              y={tick.y + 4}
              textAnchor="end"
              fontSize="12"
              fill="rgba(15, 23, 42, 0.72)"
            >
              {`${tick.value}°C`}
            </text>
          </g>
        ))}

        {timeLabels.map((item) => (
          <text
            key={item.time}
            x={item.x}
            y={chartHeight - 14}
            textAnchor="middle"
            fontSize="11"
            fill="rgba(15, 23, 42, 0.6)"
          >
            {item.label}
          </text>
        ))}

        {series.map((item, index) => (
          <polyline
            key={item.sensorId}
            data-testid={`dashboard-temperature-line-${item.sensorId}`}
            points={item.points.map((point) => `${xOf(point.time)},${yOf(point.celsius)}`).join(' ')}
            fill="none"
            stroke={CHART_COLORS[index]}
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      </svg>

      <div className="temperature-chart-legend">
        {series.map((item, index) => (
          <div key={item.sensorId} data-testid={`dashboard-temperature-sensor-${item.sensorId}`} className="temperature-chart-legend__item">
            <span className="temperature-chart-legend__swatch" style={{ backgroundColor: CHART_COLORS[index] }} />
            <span>{item.sensorId}</span>
            <strong>{`${item.latest.temperatureCelsius.toFixed(1)}°C`}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const locale = language;
  const { patients, loading: loadingPatients, loadPatients } = usePatients();
  const { samples, loading: loadingSamples, loadSamples } = useSamples();
  const { results, loading: loadingResults, loadResults } = useResults();
  const { temperatures, loading: loadingTemperatures, viewControl } = useTemperature();
  const [consentQueueStats, setConsentQueueStats] = useState<{ waiting: number; delayed: number; active: number; failed: number; totalQueued: number; available: boolean } | null>(null);
  const [loadingConsentQueue, setLoadingConsentQueue] = useState(false);
  const role = dashboardRole(user);
  // RF002 AC2/AC4: saved reports, which the backend limits to the granted
  // ones for an external user. null until loaded or when the call fails.
  const [reportCount, setReportCount] = useState<number | null>(null);

  useEffect(() => {
    if (!needsReportCount(role)) return;
    let cancelled = false;
    reportsService.getAll()
      .then((response) => { if (!cancelled) setReportCount(Array.isArray(response.data) ? response.data.length : 0); })
      .catch(() => { if (!cancelled) setReportCount(null); });
    return () => { cancelled = true; };
  }, [role]);

  // #1397 (RF015): the alerts are the backend's temperature incidents that are
  // not resolved, read once; never an alert raised in the browser.
  const [incidentRead, setIncidentRead] = useState<IncidentRead>({ status: 'loading' });

  useEffect(() => {
    if (!role || role === 'external') return;
    let cancelled = false;
    setIncidentRead({ status: 'loading' });
    apiClient.get('/incidents', {
      params: { limit: '50' },
      suppressErrorToast: true,
    } as Parameters<typeof apiClient.get>[1])
      .then(({ data }) => {
        if (cancelled) return;
        setIncidentRead(Array.isArray(data?.incidents)
          ? { status: 'ready', items: activeIncidents(data.incidents as DashboardIncident[]) }
          : { status: 'error' });
      })
      .catch(() => { if (!cancelled) setIncidentRead({ status: 'error' }); });
    return () => { cancelled = true; };
  }, [role]);

  // TEMPORARIAMENTE DESATIVADO: Não há sensores cadastrados ainda
  const TEMPERATURE_READING_DISABLED = true;

  // Carrega controle de temperatura (não bloqueia o carregamento da dashboard)
  useEffect(() => {
    // Apenas tenta carregar se não estiver desativado, não estiver carregando e se a função existir
    if (!TEMPERATURE_READING_DISABLED && viewControl && !loadingTemperatures) {
      viewControl().catch((err) => {
        // Erro não bloqueia o carregamento da dashboard
        console.warn('Erro ao carregar controle de temperatura:', err);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Executa apenas uma vez ao montar

  useEffect(() => {
    return onDashboardDataChanged(() => {
      void Promise.allSettled([
        loadPatients(),
        loadSamples(),
        loadResults(),
      ]);
    });
  }, [loadPatients, loadResults, loadSamples]);

  // Calcula estatísticas reais
  const stats = useMemo(() => {
    // Garante que todos os dados sejam arrays
    const temperaturesArray = Array.isArray(temperatures) ? temperatures : [];
    // Para pacientes, se não houver dados e não estiver carregando, usa contagem mínima de 0
    // (os mockados são apenas para exibição na página, não para contagem na dashboard)
    const patientsArray = Array.isArray(patients) ? patients : [];
    const samplesArray = Array.isArray(samples) ? samples : [];
    const resultsArray = Array.isArray(results) ? results : [];
    const temperatureAlerts = temperaturesArray.length;

    return {
      patients: patientsArray.length,
      samples: samplesArray.length,
      results: resultsArray.length,
      temperatureAlerts,
    };
  }, [patients, samples, results, temperatures]);

  const loading = loadingPatients || loadingSamples || loadingResults || loadingTemperatures;

  const isAdmin = role === 'administrator';

  useEffect(() => {
    if (!isAdmin) return;

    let mounted = true;
    const fetchQueueStats = async () => {
      setLoadingConsentQueue(true);
      try {
        const response = await securityService.getConsentQueueStatus();
        const payload = (response as any)?.data?.data;
        if (mounted) {
          setConsentQueueStats(payload || null);
        }
      } catch (error) {
        if (mounted) {
          setConsentQueueStats(null);
        }
      } finally {
        if (mounted) {
          setLoadingConsentQueue(false);
        }
      }
    };

    fetchQueueStats();
    const interval = setInterval(fetchQueueStats, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [isAdmin]);

  // RF002: each role's cards come from DASHBOARD_CARDS (dashboardCards.ts).
  const statCards = useMemo(() => {
    if (!role) return [];
    const open = t('dashboard.openCard', 'Abrir');
    const reports = reportCount === null ? '—' : reportCount;
    const temperatureAlerts = incidentRead.status === 'ready' ? incidentRead.items.length : '—';
    const cards: Record<DashboardCardKey, { title: string; value: number | string; icon: typeof Users; link: string }> = {
      patients: { title: t('dashboard.patients'), value: stats.patients, icon: Users, link: '/patients' },
      samples: { title: t('dashboard.samples'), value: stats.samples, icon: FlaskConical, link: '/samples' },
      custodyReports: { title: t('dashboard.custodyReports', 'Relatórios de Custódia'), value: stats.samples, icon: FileSearch, link: '/samples/custody-reports' },
      storage: { title: t('dashboard.storage', 'Armazenamento'), value: open, icon: Boxes, link: '/locations' },
      results: { title: t('dashboard.results'), value: stats.results, icon: FileText, link: '/results' },
      temperatureAlerts: { title: t('dashboard.temperatureAlerts'), value: temperatureAlerts, icon: Thermometer, link: '/temperature' },
      governanceReports: { title: t('dashboard.governanceReports', 'Relatórios de Governança'), value: reports, icon: BarChart3, link: '/reports' },
      authorizedReports: { title: t('dashboard.authorizedReports', 'Relatórios Autorizados'), value: reports, icon: BarChart3, link: '/reports' },
      users: { title: t('dashboard.users', 'Usuários'), value: open, icon: UserCog, link: '/users' },
      security: { title: t('dashboard.security', 'Segurança'), value: open, icon: ShieldCheck, link: '/security' },
      audit: { title: t('dashboard.audit', 'Auditoria'), value: open, icon: ScrollText, link: '/logs' },
      settings: { title: t('dashboard.settings', 'Configurações'), value: open, icon: Settings, link: '/system-management' },
    };
    return DASHBOARD_CARDS[role].map((key) => ({ key, ...cards[key] }));
  }, [role, stats, t, incidentRead, reportCount]);

  return (
    <div className="dashboard-bento">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('dashboard.title')}</h1>
          <p className="page-subtitle">{t('dashboard.subtitle')}</p>
        </div>
      </div>

      {/* KPIs Top */}
      <div className="kpi-grid">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          const handleClick = () => {
            if (stat.link) navigate(stat.link);
          };
          const isAlert = stat.link === '/temperature';
          const variant = stat.link === '/patients'
            ? 'primary'
            : stat.link === '/samples'
            ? 'success'
            : stat.link === '/results'
            ? 'secondary'
            : stat.link === '/sensors'
            ? 'action'
            : stat.link === '/temperature'
            ? 'danger'
            : 'primary';
          return (
            <Card
              key={stat.key}
              data-testid={`dashboard-card-${stat.key}`}
              className={`kpi-card ${isAlert ? 'alert' : ''} ${stat.link ? 'is-clickable' : ''}`}
              onClick={handleClick}
            >
              <div className={`kpi-icon kpi-icon--${variant}`}>
                <Icon size={22} />
              </div>
              <div className="kpi-info">
                <p className="kpi-title">{stat.title}</p>
                <p className="kpi-value">{loading ? '...' : stat.value}</p>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Main Area: Temperature Chart + Alerts. RF002 AC4: not for an external user. */}
      {role !== 'external' && (
      <div className="content-grid">
        <Card
          className="temperature-card"
        >
          <div className="temperature-card-header">
            <h2 className="temperature-card-title">{t('dashboard.temperatureChartTitle', 'Gráfico de Temperatura')}</h2>
            <p className="temperature-card-subtitle">{t('dashboard.temperatureChartSubtitle', 'Monitoramento térmico contínuo')}</p>
          </div>
          <div className="temperature-chart-slot">
            {role && <DashboardTemperatureChart />}
          </div>
        </Card>

        <div className="side-card-stack">
          <Card
            className="side-card"
          >
            <h3 className="side-card-title">{t('dashboard.activeTemperatureAlertsTitle', 'Alertas de Temperatura Ativos')}</h3>
            {incidentRead.status === 'loading' ? (
              <p className="side-card-text" data-testid="dashboard-alerts-loading">{t('dashboard.queueLoading', 'Carregando...')}</p>
            ) : incidentRead.status === 'error' ? (
              <p className="side-card-text" role="alert" data-testid="dashboard-alerts-error">Falha ao carregar os incidentes de temperatura.</p>
            ) : incidentRead.items.length > 0 ? (
              <div className="alert-list">
                {incidentRead.items.map((incident) => (
                  <div key={incident._id} data-testid={`dashboard-alert-${incident._id}`} className="alert-item alert-item--critical">
                    <AlertTriangle size={18} className="alert-item-icon" />
                    <p className="alert-item-text">
                      <strong>{incident.sensorName}</strong> atingiu <strong>{incident.currentTemperature}°C</strong> às <strong>{new Date(incident.openedAt).toLocaleString(locale)}</strong>
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="side-card-text" data-testid="dashboard-alerts-empty">{t('dashboard.noActiveAlerts', 'Nenhum alerta ativo.')}</p>
            )}
          </Card>

          {isAdmin && (
            <Card
              className="side-card consent-queue-card"
            >
              <h3 className="side-card-title">{t('dashboard.consentQueueTitle', 'Fila de Consentimentos')}</h3>
              {loadingConsentQueue ? (
                <p className="side-card-text">{t('dashboard.queueLoading', 'Carregando...')}</p>
              ) : consentQueueStats?.available ? (
                <div className="consent-queue-metrics">
                  <div>
                    <span className="consent-queue-label">{t('dashboard.queueWaiting', 'Na fila')}</span>
                    <strong>{consentQueueStats.totalQueued ?? 0}</strong>
                  </div>
                  <div>
                    <span className="consent-queue-label">{t('dashboard.queueSending', 'Em envio')}</span>
                    <strong>{consentQueueStats.active ?? 0}</strong>
                  </div>
                  <div>
                    <span className="consent-queue-label">{t('dashboard.queueFailures', 'Falhas')}</span>
                    <strong>{consentQueueStats.failed ?? 0}</strong>
                  </div>
                </div>
              ) : (
                <p className="side-card-text">{t('dashboard.queueUnavailable', 'Fila indisponível (Redis não configurado).')}</p>
              )}
            </Card>
          )}
        </div>
      </div>
      )}
    </div>
  );
}


