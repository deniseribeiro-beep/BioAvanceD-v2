import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Users, FlaskConical, FileText, Thermometer, FileSearch, Boxes, BarChart3, UserCog, ShieldCheck, ScrollText, Settings } from 'lucide-react';
import { usePatients } from '../hooks/usePatients';
import { useSamples } from '../hooks/useSamples';
import { useResults } from '../hooks/useResults';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useTemperatureReadings } from '../hooks/useTemperatureReadings';
import { equipmentService, logService, reportsService, securityService, userService } from '../services/api';
import { extractResponseItems, extractResponseTotal } from '../api/response.adapters';
import { apiClient } from '../api/client';
import { DASHBOARD_CARDS, dashboardRole, needsReportCount, showsCard, type DashboardCardKey } from './dashboardCards';
import { activeIncidents, buildTemperatureSeries } from './dashboardTemperature';
import { onDashboardDataChanged } from '../utils/dashboardRefresh';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/shadcn/card';
import { cn } from '@/lib/utils';

type DashboardIncident = {
  _id: string;
  sensorName: string;
  currentTemperature: number;
  openedAt: string;
  status: 'open' | 'acknowledged' | 'escalated' | 'resolved';
};

type IncidentRead = { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: DashboardIncident[]; total: number };

const CHART_COLORS = ['#2563eb', '#16a34a', '#dc2626'];

// #1397 (RF009 AC7): the chart draws the readings persisted in InfluxDB, and
// an empty or failed read as such, never a generated value.
function DashboardTemperatureChart() {
  const { t, language } = useLanguage();
  const locale = language;
  const { readings, loading, error } = useTemperatureReadings();

  if (error) {
    // RNF027 C2 (#1324): --danger on white is 3.8:1; this is 8.3:1.
    return (
      <div role="alert" data-testid="dashboard-temperature-error" style={{ color: '#991b1b' }}>
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
  const xOf = (time: number) =>
    timeSpan > 0
      ? chartPadding.left + ((time - timeRange.start) / timeSpan) * innerWidth
      : chartPadding.left + innerWidth / 2;
  const yOf = (celsius: number) =>
    chartPadding.top + ((domain.max - celsius) / chartRange) * innerHeight;

  const tickCount = 5;
  const chartTicks = Array.from({ length: tickCount }, (_, index) => {
    const value = domain.max - (chartRange / (tickCount - 1)) * index;
    return { value, y: yOf(value) };
  });
  const timeLabels = (timeSpan > 0 ? [timeRange.start, timeRange.end] : [timeRange.start]).map((time) => ({
    time,
    x: xOf(time),
    label: new Date(time).toLocaleTimeString(locale, { hour12: false }).slice(0, 5),
  }));

  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        role="img"
        aria-label={t('dashboard.temperatureChartAria', 'Gráfico de temperatura em tempo real')}
        className="h-auto w-full rounded-md border border-border bg-card"
      >
        {chartTicks.map((tick) => (
          <g key={tick.value}>
            <line
              x1={chartPadding.left}
              y1={tick.y}
              x2={chartWidth - chartPadding.right}
              y2={tick.y}
              stroke="#E2E8F0"
              strokeDasharray="4 6"
            />
            <text x={chartPadding.left - 10} y={tick.y + 4} textAnchor="end" fontSize="12" fill="#64748B">
              {`${tick.value}°C`}
            </text>
          </g>
        ))}

        {timeLabels.map((item) => (
          <text key={item.time} x={item.x} y={chartHeight - 14} textAnchor="middle" fontSize="11" fill="#64748B">
            {item.label}
          </text>
        ))}

        {series.map((item, index) => (
          <polyline
            key={item.sensorId}
            data-testid={`dashboard-temperature-line-${item.sensorId}`}
            points={item.points.map((point) => `${xOf(point.time)},${yOf(point.celsius)}`).join(' ')}
            fill="none"
            stroke={CHART_COLORS[index % CHART_COLORS.length]}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      </svg>

      <div className="flex flex-wrap gap-3">
        {series.map((item, index) => (
          <div
            key={item.sensorId}
            data-testid={`dashboard-temperature-sensor-${item.sensorId}`}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm"
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
            />
            <span className="text-muted-foreground">{item.sensorId}</span>
            <strong className="text-foreground">{`${item.latest.temperatureCelsius.toFixed(1)}°C`}</strong>
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
  const { patients, total: patientTotal, loading: loadingPatients, loadPatients } = usePatients();
  const { samples, total: sampleTotal, loading: loadingSamples, loadSamples } = useSamples();
  const { results, loading: loadingResults, loadResults } = useResults();
  const [consentQueueStats, setConsentQueueStats] = useState<{ waiting: number; delayed: number; active: number; failed: number; totalQueued: number; available: boolean } | null>(null);
  const [loadingConsentQueue, setLoadingConsentQueue] = useState(false);
  const role = dashboardRole(user);
  // RF002 AC2/AC4: saved reports, which the backend limits to the granted
  // ones for an external user. null until loaded or when the call fails.
  const [reportCount, setReportCount] = useState<number | null>(null);
  const [equipmentCount, setEquipmentCount] = useState<number | null>(null);
  const [userCount, setUserCount] = useState<number | null>(null);
  const [logCount, setLogCount] = useState<number | null>(null);

  useEffect(() => {
    if (!showsCard(role, 'storage')) return;
    let cancelled = false;
    setEquipmentCount(null);
    equipmentService.getAll()
      .then((response) => { if (!cancelled) setEquipmentCount(extractResponseItems(response).length); })
      .catch(() => { if (!cancelled) setEquipmentCount(Number.NaN); });
    return () => { cancelled = true; };
  }, [role]);

  useEffect(() => {
    if (!showsCard(role, 'users')) return;
    let cancelled = false;
    setUserCount(null);
    userService.getAll()
      .then((response) => { if (!cancelled) setUserCount(extractResponseItems(response).length); })
      .catch(() => { if (!cancelled) setUserCount(Number.NaN); });
    return () => { cancelled = true; };
  }, [role]);

  useEffect(() => {
    if (!showsCard(role, 'audit')) return;
    let cancelled = false;
    setLogCount(null);
    logService.getLogs({ limit: 1 })
      .then((response) => { if (!cancelled) setLogCount(extractResponseTotal(response.data, 0)); })
      .catch(() => { if (!cancelled) setLogCount(Number.NaN); });
    return () => { cancelled = true; };
  }, [role]);

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
      params: { limit: '3', excludeResolved: 'true' },
      suppressErrorToast: true,
    } as Parameters<typeof apiClient.get>[1])
      .then(({ data }) => {
        if (cancelled) return;
        if (!Array.isArray(data?.incidents)) {
          setIncidentRead({ status: 'error' });
          return;
        }
        const items = activeIncidents(data.incidents as DashboardIncident[]);
        const total = typeof data.total === 'number' && Number.isFinite(data.total) ? data.total : items.length;
        setIncidentRead({ status: 'ready', items, total });
      })
      .catch(() => { if (!cancelled) setIncidentRead({ status: 'error' }); });
    return () => { cancelled = true; };
  }, [role]);

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
    // Para pacientes, se não houver dados e não estiver carregando, usa contagem mínima de 0
    // (os mockados são apenas para exibição na página, não para contagem na dashboard)
    const patientsArray = Array.isArray(patients) ? patients : [];
    const samplesArray = Array.isArray(samples) ? samples : [];
    const resultsArray = Array.isArray(results) ? results : [];

    return {
      patients: patientTotal ?? patientsArray.length,
      samples: sampleTotal ?? samplesArray.length,
      results: resultsArray.length,
    };
  }, [patients, patientTotal, samples, sampleTotal, results]);

  const loading = loadingPatients || loadingSamples || loadingResults;

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
    const temperatureAlerts = incidentRead.status === 'ready' ? incidentRead.total : '—';
    const listed = (count: number | null) => count === null ? '...' : Number.isNaN(count) ? '—' : count;
    const cards: Record<DashboardCardKey, { title: string; value: number | string; icon: typeof Users; link: string }> = {
      patients: { title: t('dashboard.patients'), value: stats.patients, icon: Users, link: '/patients' },
      samples: { title: t('dashboard.samples'), value: stats.samples, icon: FlaskConical, link: '/samples' },
      custodyReports: { title: t('dashboard.custodyReports', 'Relatórios de Custódia'), value: stats.samples, icon: FileSearch, link: '/samples/custody-reports' },
      storage: { title: t('dashboard.storage', 'Armazenamento'), value: listed(equipmentCount), icon: Boxes, link: '/locations' },
      results: { title: t('dashboard.results'), value: stats.results, icon: FileText, link: '/results' },
      temperatureAlerts: { title: t('dashboard.temperatureAlerts'), value: temperatureAlerts, icon: Thermometer, link: '/incidents' },
      governanceReports: { title: t('dashboard.governanceReports', 'Relatórios de Governança'), value: reports, icon: BarChart3, link: '/reports' },
      authorizedReports: { title: t('dashboard.authorizedReports', 'Relatórios Autorizados'), value: reports, icon: BarChart3, link: '/reports' },
      users: { title: t('dashboard.users', 'Usuários'), value: listed(userCount), icon: UserCog, link: '/users' },
      security: { title: t('dashboard.security', 'Segurança'), value: open, icon: ShieldCheck, link: '/security' },
      audit: { title: t('dashboard.audit', 'Auditoria'), value: listed(logCount), icon: ScrollText, link: '/logs' },
      settings: { title: t('dashboard.settings', 'Configurações'), value: open, icon: Settings, link: '/system-management' },
    };
    return DASHBOARD_CARDS[role].map((key) => ({ key, ...cards[key] }));
  }, [role, stats, t, incidentRead, reportCount, equipmentCount, userCount, logCount]);

  const iconTone: Record<string, string> = {
    primary: 'bg-primary text-primary-foreground',
    success: 'bg-success text-success-foreground',
    secondary: 'bg-primary text-primary-foreground',
    action: 'bg-brand-violet text-white',
    danger: 'bg-destructive text-destructive-foreground',
  };

  return (
    <div className="page-shell">
      <Card>
        <CardHeader>
          {/* h1.page-title is the RNF027 axe/interface ready selector */}
          <h1 className="page-title text-lg font-semibold leading-none tracking-tight">{t('dashboard.title')}</h1>
          <CardDescription>{t('dashboard.subtitle')}</CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          const handleClick = () => {
            if (stat.link) navigate(stat.link);
          };
          const isAlert = stat.link === '/incidents';
          const variant =
            stat.link === '/patients'
              ? 'primary'
              : stat.link === '/samples'
                ? 'success'
                : stat.link === '/results'
                  ? 'secondary'
                  : stat.link === '/sensors'
                    ? 'action'
                    : stat.link === '/incidents'
                      ? 'danger'
                      : 'primary';
          return (
            <button
              type="button"
              key={stat.key}
              data-testid={`dashboard-card-${stat.key}`}
              className={cn(
                'rounded-lg border border-border bg-card text-left text-card-foreground shadow-card',
                isAlert && 'border-destructive/40',
                'cursor-pointer hover:bg-accent/30',
              )}
              onClick={handleClick}
            >
              <span className="flex items-center gap-3 p-4">
                <span className={cn('flex h-10 w-10 items-center justify-center rounded-md', iconTone[variant])}>
                  <Icon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">{stat.title}</span>
                  <span className="kpi-value block text-2xl font-semibold text-foreground">{loading ? '...' : stat.value}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {role !== 'external' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="temperature-card">
            <CardHeader>
              <CardTitle className="text-base">{t('dashboard.temperatureChartTitle', 'Gráfico de Temperatura')}</CardTitle>
              <CardDescription>{t('dashboard.temperatureChartSubtitle', 'Monitoramento térmico contínuo')}</CardDescription>
            </CardHeader>
            <CardContent>{role ? <DashboardTemperatureChart /> : null}</CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('dashboard.activeTemperatureAlertsTitle', 'Alertas de Temperatura Ativos')}</CardTitle>
              </CardHeader>
              <CardContent>
                {incidentRead.status === 'loading' ? (
                  <p className="text-sm text-muted-foreground" data-testid="dashboard-alerts-loading">{t('dashboard.queueLoading', 'Carregando...')}</p>
                ) : incidentRead.status === 'error' ? (
                  <p className="text-sm text-destructive" role="alert" data-testid="dashboard-alerts-error">Falha ao carregar os incidentes de temperatura.</p>
                ) : incidentRead.items.length > 0 ? (
                  <div className="space-y-2">
                    {incidentRead.items.map((incident) => (
                      <div key={incident._id} data-testid={`dashboard-alert-${incident._id}`} className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-sm">
                        <AlertTriangle size={16} className="mt-0.5 text-destructive" />
                        <p>
                          <strong>{incident.sensorName}</strong> atingiu <strong>{incident.currentTemperature}°C</strong> às <strong>{new Date(incident.openedAt).toLocaleString(locale)}</strong>
                        </p>
                      </div>
                    ))}
                    {incidentRead.total > incidentRead.items.length && (
                      <Link to="/incidents" data-testid="dashboard-alerts-more" className="inline-flex text-sm font-medium text-primary">
                        {t('dashboard.seeMoreAlerts', 'Ver mais')}
                      </Link>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid="dashboard-alerts-empty">{t('dashboard.noActiveAlerts', 'Nenhum alerta ativo.')}</p>
                )}
              </CardContent>
            </Card>

            {isAdmin ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('dashboard.consentQueueTitle', 'Fila de Consentimentos')}</CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingConsentQueue ? (
                    <p className="text-sm text-muted-foreground">{t('dashboard.queueLoading', 'Carregando...')}</p>
                  ) : consentQueueStats?.available ? (
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-md border border-border p-2">
                        <p className="text-xs text-muted-foreground">{t('dashboard.queueWaiting', 'Na fila')}</p>
                        <p className="text-lg font-semibold">{consentQueueStats.totalQueued ?? 0}</p>
                      </div>
                      <div className="rounded-md border border-border p-2">
                        <p className="text-xs text-muted-foreground">{t('dashboard.queueSending', 'Em envio')}</p>
                        <p className="text-lg font-semibold">{consentQueueStats.active ?? 0}</p>
                      </div>
                      <div className="rounded-md border border-border p-2">
                        <p className="text-xs text-muted-foreground">{t('dashboard.queueFailures', 'Falhas')}</p>
                        <p className="text-lg font-semibold">{consentQueueStats.failed ?? 0}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('dashboard.queueUnavailable', 'Fila indisponível (Redis não configurado).')}</p>
                  )}
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}


