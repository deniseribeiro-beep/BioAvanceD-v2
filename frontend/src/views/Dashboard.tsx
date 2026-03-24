import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import { AlertTriangle, Users, FlaskConical, FileText, Thermometer, Box, Radio, Shield, FileSearch } from 'lucide-react';
import { usePatients } from '../hooks/usePatients';
import { useSamples } from '../hooks/useSamples';
import { useResults } from '../hooks/useResults';
import { useTemperature } from '../hooks/useTemperature';
import { usePolicies } from '../hooks/usePolicies';
import { useEquipment } from '../hooks/useEquipment';
import { useSensors } from '../hooks/useSensors';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { securityService } from '../services/api';
import './Dashboard.css';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { patients, loading: loadingPatients } = usePatients();
  const { samples, loading: loadingSamples } = useSamples();
  const { results, loading: loadingResults } = useResults();
  const { temperatures, loading: loadingTemperatures, viewControl } = useTemperature();
  const { policies, loading: loadingPolicies } = usePolicies();
  const { equipment, loading: loadingEquipment } = useEquipment();
  const { sensors, loading: loadingSensors } = useSensors();
  const [consentQueueStats, setConsentQueueStats] = useState<{ waiting: number; delayed: number; active: number; failed: number; totalQueued: number; available: boolean } | null>(null);
  const [loadingConsentQueue, setLoadingConsentQueue] = useState(false);
  const [telemetryData, setTelemetryData] = useState<Array<{ time: string; sensor1: number; sensor2: number; sensor3: number }>>([
    { time: '10:01:00', sensor1: -80.4, sensor2: -79.3, sensor3: -81.1 },
    { time: '10:03:00', sensor1: -80.8, sensor2: -78.9, sensor3: -80.6 },
    { time: '10:05:00', sensor1: -79.7, sensor2: -80.1, sensor3: -81.4 },
    { time: '10:07:00', sensor1: -80.9, sensor2: -79.8, sensor3: -80.3 },
    { time: '10:09:00', sensor1: -80.1, sensor2: -79.5, sensor3: -81.0 },
  ]);
  const [activeAlerts, setActiveAlerts] = useState<Array<{ id: string; sensorName: string; time: string; temperature: number }>>([]);

  // TEMPORARIAMENTE DESATIVADO: Não há sensores cadastrados ainda
  const TEMPERATURE_READING_DISABLED = true;

  useEffect(() => {
    const interval = setInterval(() => {
      setTelemetryData((current) => {
        const sensor1 = Number((-82 + Math.random() * 4).toFixed(1));
        const sensor2 = Number((-82 + Math.random() * 4).toFixed(1));
        const sensor3 = Number((-82 + Math.random() * 4).toFixed(1));
        const nextIndex = current.length + 1;
        const forceAnomaly = nextIndex % 10 === 0;
        const anomalySensor = forceAnomaly ? Math.floor(Math.random() * 3) : -1;
        const anomalyTriggered = forceAnomaly || Math.random() < 0.08;
        const time = new Date().toLocaleTimeString('pt-BR', { hour12: false });

        const nextEntry = {
          time,
          sensor1: anomalyTriggered && anomalySensor === 0 ? -60 : sensor1,
          sensor2: anomalyTriggered && anomalySensor === 1 ? -60 : sensor2,
          sensor3: anomalyTriggered && anomalySensor === 2 ? -60 : sensor3,
        };

        const updated = [...current, nextEntry];
        return updated.slice(-20);
      });
    }, 2000);

    return () => clearInterval(interval);
    // telemetryData is intentionally excluded to keep a stable interval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const latest = telemetryData[telemetryData.length - 1];
    if (!latest) {
      return;
    }

    const sensorEntries = [
      { key: 'sensor1', label: 'Sensor 1', temperature: latest.sensor1 },
      { key: 'sensor2', label: 'Sensor 2', temperature: latest.sensor2 },
      { key: 'sensor3', label: 'Sensor 3', temperature: latest.sensor3 },
    ];

    const criticalAlerts = sensorEntries
      .filter((entry) => entry.temperature > -70)
      .map((entry) => ({
        id: `${latest.time}-${entry.key}`,
        sensorName: entry.label,
        time: latest.time,
        temperature: entry.temperature,
      }));

    if (criticalAlerts.length === 0) {
      return;
    }

    setActiveAlerts((current) => {
      const existingIds = new Set(current.map((item) => item.id));
      const merged = [...current];

      criticalAlerts.forEach((alert) => {
        if (!existingIds.has(alert.id)) {
          merged.unshift(alert);
          existingIds.add(alert.id);
        }
      });

      return merged.slice(0, 10);
    });
  }, [telemetryData]);

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

  // Calcula estatísticas reais
  const stats = useMemo(() => {
    // Garante que todos os dados sejam arrays
    const temperaturesArray = Array.isArray(temperatures) ? temperatures : [];
    const policiesArray = Array.isArray(policies) ? policies : [];
    // Para pacientes, se não houver dados e não estiver carregando, usa contagem mínima de 0
    // (os mockados são apenas para exibição na página, não para contagem na dashboard)
    const patientsArray = Array.isArray(patients) ? patients : [];
    const samplesArray = Array.isArray(samples) ? samples : [];
    const resultsArray = Array.isArray(results) ? results : [];
    const equipmentArray = Array.isArray(equipment) ? equipment : [];
    const sensorsArray = Array.isArray(sensors) ? sensors : [];

    // Calcula alertas de temperatura
    let temperatureAlerts = 0;
    temperaturesArray.forEach((temp) => {
      const policy = policiesArray.find((p) => p.policyID?.toString() === temp.policyID?.toString());
      if (policy) {
        if (
          temp.temperatureValue < policy.minThreshold ||
          temp.temperatureValue > policy.maxThreshold ||
          temp.readingStatus !== 'valid'
        ) {
          temperatureAlerts++;
        }
      }
    });

    return {
      patients: patientsArray.length,
      samples: samplesArray.length,
      results: resultsArray.length,
      temperatureAlerts,
      equipment: equipmentArray.length,
      sensors: sensorsArray.length,
      policies: policiesArray.length,
    };
  }, [patients, samples, results, temperatures, policies, equipment, sensors]);

  const loading = loadingPatients || loadingSamples || loadingResults || loadingTemperatures || 
                  loadingPolicies || loadingEquipment || loadingSensors;

  const chartHeight = 280;
  const chartWidth = 860;
  const chartPadding = { top: 20, right: 24, bottom: 36, left: 56 };
  const chartDomain = { min: -90, max: -50 };
  const chartRange = chartDomain.max - chartDomain.min;
  const chartData = telemetryData.map((entry, index) => ({
    ...entry,
    index,
  }));

  const chartPoints = useMemo(() => {
    if (chartData.length === 0) {
      return { sensor1: '', sensor2: '', sensor3: '' };
    }

    const innerWidth = chartWidth - chartPadding.left - chartPadding.right;
    const innerHeight = chartHeight - chartPadding.top - chartPadding.bottom;
    const stepX = chartData.length > 1 ? innerWidth / (chartData.length - 1) : innerWidth;

    const buildPath = (key: 'sensor1' | 'sensor2' | 'sensor3') => {
      return chartData
        .map((point, index) => {
          const value = point[key];
          const normalized = Math.max(chartDomain.min, Math.min(chartDomain.max, value));
          const x = chartPadding.left + (index * stepX);
          const y = chartPadding.top + ((chartDomain.max - normalized) / chartRange) * innerHeight;
          return `${x},${y}`;
        })
        .join(' ');
    };

    return {
      sensor1: buildPath('sensor1'),
      sensor2: buildPath('sensor2'),
      sensor3: buildPath('sensor3'),
    };
  }, [chartData]);

  const chartTicks = useMemo(() => {
    const tickCount = 5;
    const innerHeight = chartHeight - chartPadding.top - chartPadding.bottom;
    return Array.from({ length: tickCount }, (_, index) => {
      const value = chartDomain.max - ((chartRange / (tickCount - 1)) * index);
      const y = chartPadding.top + ((chartDomain.max - value) / chartRange) * innerHeight;
      return { value, y };
    });
  }, []);

  const chartLegend = [
    { label: 'Sensor 1', color: '#2563eb' },
    { label: 'Sensor 2', color: '#16a34a' },
    { label: 'Sensor 3', color: '#dc2626' },
  ];

  const isAdmin = user?.roleName === 'Administrador' || user?.accessType === 4;

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

  // Define quais cards cada tipo de acesso pode ver
  const statCards = useMemo(() => {
    if (!user) return [];

    const allCards = [
      {
        title: t('dashboard.patients'),
        value: stats.patients,
        icon: Users,
        color: 'var(--primary)',
        link: '/patients',
        allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
        allowedAccessTypes: [1, 2, 3, 4], // Inclui Administrador (4)
      },
      {
        title: t('dashboard.samples'),
        value: stats.samples,
        icon: FlaskConical,
        color: 'var(--success)',
        link: '/samples',
        allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
        allowedAccessTypes: [1, 2, 3],
      },
      {
        title: t('dashboard.custodyReports', 'Relatórios de Custódia'),
        value: stats.samples,
        icon: FileSearch,
        link: '/samples/custody-reports',
        allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
        allowedAccessTypes: [2, 3, 4],
      },
      {
        title: t('dashboard.results'),
        value: stats.results,
        icon: FileText,
        color: 'var(--warning)',
        link: '/results',
        allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
        allowedAccessTypes: [1, 2, 3],
      },
      {
        title: t('dashboard.temperatureAlerts'),
        value: stats.temperatureAlerts,
        icon: Thermometer,
        color: 'var(--danger)',
        link: '/temperature',
        allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
        allowedAccessTypes: [2, 3, 4], // Administrador (4) também tem acesso
      },
      {
        title: t('dashboard.equipment'),
        value: stats.equipment,
        icon: Box,
        color: 'var(--secondary)',
        link: '/equipment',
        allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
        allowedAccessTypes: [2, 3, 4], // Administrador (4) também tem acesso
      },
      {
        title: t('dashboard.sensors'),
        value: stats.sensors,
        icon: Radio,
        color: '#8b5cf6',
        link: '/sensors',
        allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
        allowedAccessTypes: [2, 3, 4], // Administrador (4) também tem acesso
      },
      {
        title: t('dashboard.policies'),
        value: stats.policies,
        icon: Shield,
        color: '#06b6d4',
        link: '/policies',
        allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
        allowedAccessTypes: [2, 3, 4], // Administrador (4) também tem acesso
      },
    ];

    // Filtra cards baseado no role ou accessType
    return allCards.filter(card => {
      // Se tem roleName, usa ele
      if (user.roleName) {
        return card.allowedRoles.includes(user.roleName);
      }
      
      // Fallback para accessType com lógica hierárquica
      // Administrador (4) tem acesso a tudo
      if (user.accessType === 4) {
        return true;
      }
      // Coordenador (3) tem acesso a tudo exceto itens exclusivos de admin
      if (user.accessType === 3) {
        return card.allowedAccessTypes.includes(3) || card.allowedAccessTypes.includes(2);
      }
      // Técnico (2) tem acesso aos seus itens
      if (user.accessType === 2) {
        return card.allowedAccessTypes.includes(2) || card.allowedAccessTypes.includes(1);
      }
      // Usuário Externo (1) tem acesso apenas aos seus itens
      return card.allowedAccessTypes.includes(user.accessType || 0);
    });
  }, [user, stats, t]);

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
              key={stat.title}
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

      {/* Main Area: Temperature Chart + Alerts */}
      <div className="content-grid">
        <Card
          className="temperature-card"
        >
          <div className="temperature-card-header">
            <h2 className="temperature-card-title">Gráfico de Temperatura</h2>
            <p className="temperature-card-subtitle">Monitoramento térmico contínuo</p>
          </div>
          <div className="temperature-chart-slot">
            <div className="temperature-chart-svg-wrap">
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Gráfico de temperatura em tempo real">
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

                {telemetryData.map((entry, index) => {
                  const innerWidth = chartWidth - chartPadding.left - chartPadding.right;
                  const stepX = telemetryData.length > 1 ? innerWidth / (telemetryData.length - 1) : innerWidth;
                  const x = chartPadding.left + (index * stepX);
                  return (
                    <text
                      key={`${entry.time}-${index}`}
                      x={x}
                      y={chartHeight - 14}
                      textAnchor="middle"
                      fontSize="11"
                      fill="rgba(15, 23, 42, 0.6)"
                    >
                      {entry.time.slice(0, 5)}
                    </text>
                  );
                })}

                <polyline points={chartPoints.sensor1} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                <polyline points={chartPoints.sensor2} fill="none" stroke="#16a34a" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                <polyline points={chartPoints.sensor3} fill="none" stroke="#dc2626" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />

                {chartLegend.map((item) => (
                  <g key={item.label} transform="translate(0, 0)">
                    <circle cx="22" cy="20" r="5" fill={item.color} />
                  </g>
                ))}
              </svg>

              <div className="temperature-chart-legend">
                {chartLegend.map((item) => (
                  <div key={item.label} className="temperature-chart-legend__item">
                    <span className="temperature-chart-legend__swatch" style={{ backgroundColor: item.color }} />
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <div className="side-card-stack">
          <Card
            className="side-card"
          >
            <h3 className="side-card-title">Alertas de Temperatura Ativos</h3>
            {activeAlerts.length > 0 ? (
              <div className="alert-list">
                {activeAlerts.map((alert) => (
                  <div key={alert.id} className="alert-item alert-item--critical">
                    <AlertTriangle size={18} className="alert-item-icon" />
                    <p className="alert-item-text">
                      <strong>{alert.sensorName}</strong> atingiu <strong>{alert.temperature}°C</strong> às <strong>{alert.time}</strong>
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="side-card-text">Nenhum alerta ativo.</p>
            )}
          </Card>

          {isAdmin && (
            <Card
              className="side-card consent-queue-card"
            >
              <h3 className="side-card-title">Fila de Consentimentos</h3>
              {loadingConsentQueue ? (
                <p className="side-card-text">Carregando...</p>
              ) : consentQueueStats?.available ? (
                <div className="consent-queue-metrics">
                  <div>
                    <span className="consent-queue-label">Na fila</span>
                    <strong>{consentQueueStats.totalQueued ?? 0}</strong>
                  </div>
                  <div>
                    <span className="consent-queue-label">Em envio</span>
                    <strong>{consentQueueStats.active ?? 0}</strong>
                  </div>
                  <div>
                    <span className="consent-queue-label">Falhas</span>
                    <strong>{consentQueueStats.failed ?? 0}</strong>
                  </div>
                </div>
              ) : (
                <p className="side-card-text">Fila indisponível (Redis não configurado).</p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}


