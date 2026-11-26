import { useState, useEffect, useMemo, useRef } from 'react';

import { useLanguage } from '../contexts/LanguageContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import { Plus, Edit, Trash2, AlertCircle, CheckCircle, Box, Thermometer, Radio as RadioIcon, Shield, Download, Filter, X, Search } from 'lucide-react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Equipment } from '../types/models';
import { useEquipment } from '../hooks/useEquipment';
import { useTemperatureReadings, TemperatureReading } from '../hooks/useTemperatureReadings';
import { useSensors } from '../hooks/useSensors';
import { usePolicies } from '../hooks/usePolicies';
import { equipmentFormEditPath } from './EquipmentFormPage';
import { sensorFormEditPath, resolveSensorId } from './SensorFormPage';
import { policyFormEditPath } from './PolicyFormPage';
import { getMaintenanceStatusLabel } from '../config/constants/sensor.constants';
import IncidentManagementPage from './IncidentManagementPage';

type TabType = 'equipment' | 'temperature' | 'history' | 'sensors' | 'policies' | 'incidents';

type HistoryLogEntry = {
  id: string;
  timestamp: string;
  sensorName: string;
  temperature: number;
  status: string;
  readingId: string;
};

const ALERT_TRIGGER_THRESHOLD = -70;

export default function FacilityManagementPage() {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TabType | null;
  const validTabs: TabType[] = ['equipment', 'temperature', 'history', 'sensors', 'policies', 'incidents'];
  const initialTab = (tabParam && validTabs.includes(tabParam)) ? tabParam : 'equipment';
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  useEffect(() => {
    if (tabParam && validTabs.includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const tabs = [
    { id: 'equipment' as TabType, label: t('facility.tabs.equipment', 'Equipamentos'), icon: Box },
    { id: 'temperature' as TabType, label: t('facility.tabs.temperature', 'Controle de Temperatura'), icon: Thermometer },
    { id: 'history' as TabType, label: t('facility.tabs.history', 'Histórico de Leituras'), icon: AlertCircle },
    { id: 'incidents' as TabType, label: t('facility.tabs.incidents', 'Gerenciamento de Incidentes'), icon: AlertCircle },
    { id: 'sensors' as TabType, label: t('facility.tabs.sensors', 'Sensores'), icon: RadioIcon },
    { id: 'policies' as TabType, label: t('facility.tabs.policies', 'Políticas de Temperatura'), icon: Shield },
  ];

  return (
    <div className="page-shell facility-management-page flex w-full min-w-0 flex-col gap-4">
      <div className="card-surface">
        <h1 className="page-title">{t('facility.title', 'Gerenciamento de Instalações')}</h1>
        <p className="page-subtitle">{t('facility.subtitle', 'Gerenciamento integrado de equipamentos, temperatura, sensores e políticas')}</p>
      </div>

      <nav
        className="facility-tabs relative z-0 flex shrink-0 flex-wrap gap-1 rounded-xl border border-border bg-card p-1"
        aria-label={t('facility.tabsLabel', 'Seções do gerenciamento de instalações')}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              aria-pressed={active}
              data-testid={`facility-tab-${tab.id}`}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-primary-soft hover:text-primary'
              }`}
              onClick={() => {
                setActiveTab(tab.id);
                setSearchParams({ tab: tab.id });
              }}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="facility-tab-content relative z-0 min-w-0 flex-1">
        {activeTab === 'equipment' && <EquipmentSection />}
        {activeTab === 'temperature' && <TemperatureSection />}
        {activeTab === 'history' && <HistorySection />}
        {activeTab === 'incidents' && <IncidentManagementPage />}
        {activeTab === 'sensors' && <SensorsSection />}
        {activeTab === 'policies' && <PoliciesSection />}

      </div>
    </div>
  );
}

// Seção de Equipamentos
function EquipmentSection() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { equipment, loading, error, deleteEquipment } = useEquipment();
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const equipmentRows = useMemo(() => (Array.isArray(equipment) ? equipment : []), [equipment]);
  const filteredEquipment = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return equipmentRows;
    return equipmentRows.filter((eq) =>
      [eq.equipmentDescription, eq.model, eq.serialNumber, eq.equipmentID]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [equipmentRows, search]);
  const totalPages = Math.max(1, Math.ceil(filteredEquipment.length / pageSize));
  const paginatedEquipment = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredEquipment.slice(startIndex, startIndex + pageSize);
  }, [filteredEquipment, currentPage, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  return (
    <>
      <div className="section-header flex flex-wrap items-center gap-3">
        <div className="relative min-w-[12rem] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
          <input
            type="search"
            className="input w-full pl-9"
            data-testid="equipment-search-input"
            placeholder={t('facility.equipment.search', 'Buscar equipamentos…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button data-testid="equipment-new-button" onClick={() => navigate('/equipment/new')}>
          <Plus size={18} />
          {t('facility.equipment.new', 'Novo Equipamento')}
        </Button>
      </div>

      {loading && <p>Carregando...</p>}
      {error && <p style={{ color: 'var(--danger)' }}>Erro: {error}</p>}

      <Card>
        <Table headers={["DESCRIÇÃO", "MODELO", "NÚMERO DE SÉRIE", "DATA DA COMPRA", "AÇÕES"]}>
          {paginatedEquipment.length === 0 ? (
            <tr>
              <td colSpan={5} className="table-empty-state-cell">
                <div className="table-empty-state">
                  <span className="table-empty-state__icon">
                    <Box size={34} />
                  </span>
                  <h3 className="table-empty-state__title">Nenhum equipamento encontrado</h3>
                  <p className="table-empty-state__text">Clique no botão acima para adicionar o seu primeiro equipamento.</p>
                </div>
              </td>
            </tr>
          ) : (
            paginatedEquipment.map((eq, index) => (
              <tr key={`equipment-row-${eq.equipmentID || index}`}> {/* Garantir unicidade */}
                <td className="break-words whitespace-normal overflow-x-auto max-w-xs">{eq.equipmentDescription}</td>
                <td className="break-words whitespace-normal overflow-x-auto max-w-xs">{eq.model || '-'}</td>
                <td className="break-all whitespace-normal overflow-x-auto max-w-xs">{eq.serialNumber || '-'}</td>
                <td className="break-words whitespace-normal overflow-x-auto max-w-xs">{eq.purchaseDate ? new Date(eq.purchaseDate).toLocaleDateString('pt-BR') : '-'}</td>
                <td>
                  <div className="table-actions">
                    <button
                      data-testid={`equipment-edit-button-${eq.equipmentID || index}`}
                      className="action-button"
                      onClick={() => {
                        const equipmentToEdit = { ...eq, _id: (eq as { _id?: string })._id || undefined };
                        navigate(equipmentFormEditPath(eq), { state: { equipment: equipmentToEdit } });
                      }}
                      title="Editar"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      data-testid={`equipment-delete-button-${eq.equipmentID || index}`}
                      className="action-button danger"
                      onClick={async () => {
                        if (confirm('Tem certeza que deseja excluir este equipamento?')) {
                          try {
                            // Usa _id se disponível, senão usa equipmentID
                            const equipmentId = (eq as any)._id || eq.equipmentID;
                            await deleteEquipment(equipmentId);
                          } catch (err: any) {
                            alert(err.message || 'Erro ao excluir equipamento');
                          }
                        }
                      }}
                      title="Excluir"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </Table>
        <div className="equipment-pagination">
          <div className="equipment-pagination__summary">
            {filteredEquipment.length === 0
              ? 'Nenhum equipamento cadastrado'
              : `Mostrando ${Math.min((currentPage - 1) * pageSize + 1, filteredEquipment.length)}-${Math.min(currentPage * pageSize, filteredEquipment.length)} de ${filteredEquipment.length}`}
          </div>

          <div className="equipment-pagination__controls">
            <Button
              variant="secondary"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={currentPage === 1}
            >
              {t('common.previous', 'Anterior')}
            </Button>
            <span className="equipment-pagination__page">
              {t('common.page', 'Página')} {currentPage} {t('common.of', 'de')} {totalPages}
            </span>
            <Button
              variant="secondary"
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              disabled={currentPage === totalPages}
            >
              {t('common.next', 'Próxima')}
            </Button>
          </div>

          <div className="equipment-pagination__size">
            <label htmlFor="equipment-page-size">Itens por página</label>
            <select
              id="equipment-page-size"
              className="input"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setCurrentPage(1);
              }}
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>
        </div>
      </Card>
    </>
  );
}

// Função helper para obter a descrição do tipo de equipamento
function getEquipmentTypeDescription(equipmentType: number | undefined): string {
  if (!equipmentType) return '-';
  const types: Record<number, string> = {
    1: 'Freezer -80°C #1',
    2: 'Freezer -80°C #2',
    3: 'Freezer -20°C',
    4: 'Refrigerador 4°C',
    5: 'Nitrogênio Líquido',
  };
  return types[equipmentType] || `Tipo ${equipmentType}`;
}

// Seção de Controle de Temperatura
// #1397 (RF009 AC7): the cards and the chart show the readings persisted in
// InfluxDB, and an empty or failed read as such, never a generated value.
function TemperatureSection() {
  const { readings, loading, error, reload } = useTemperatureReadings();

  const getTemperatureTone = (temperature: number) => {
    if (temperature <= -78 && temperature >= -82) {
      return {
        label: 'Estável',
        border: '#16a34a',
        icon: '#16a34a',
        trend: Minus,
        background: 'linear-gradient(180deg, rgba(240, 253, 244, 0.98), rgba(255, 255, 255, 1))',
        badgeBackground: 'rgba(240, 253, 244, 1)',
      };
    }

    if (temperature > -78 && temperature <= -70) {
      return {
        label: 'Atenção',
        border: '#f59e0b',
        icon: '#f59e0b',
        trend: TrendingUp,
        background: 'linear-gradient(180deg, rgba(255, 251, 235, 0.98), rgba(255, 255, 255, 1))',
        badgeBackground: 'rgba(255, 251, 235, 1)',
      };
    }

    return {
      label: 'Crítico',
      border: '#dc2626',
      icon: '#dc2626',
      trend: TrendingDown,
      background: 'linear-gradient(180deg, rgba(254, 242, 242, 0.98), rgba(255, 255, 255, 1))',
      badgeBackground: 'rgba(254, 242, 242, 1)',
    };
  };

  if (error) {
    return (
      <div role="alert" data-testid="temperature-readings-error" style={{ color: 'var(--danger)' }}>
        Falha ao carregar as leituras de temperatura: {error}
      </div>
    );
  }

  if (loading && readings.length === 0) {
    return <div data-testid="temperature-readings-loading">Carregando leituras de temperatura…</div>;
  }

  if (readings.length === 0) {
    return <div data-testid="temperature-readings-empty">Nenhuma leitura de temperatura registrada.</div>;
  }

  // Readings come newest first, so a sensor's first reading is its newest.
  const sensorCards: TemperatureReading[] = [];
  const seenSensors = new Set<string>();
  readings.forEach((reading) => {
    if (reading.sensorId === null || seenSensors.has(reading.sensorId)) return;
    seenSensors.add(reading.sensorId);
    sensorCards.push(reading);
  });

  const chartSensorId = readings[0].sensorId;
  const telemetryData = readings
    .filter((reading) => reading.sensorId === chartSensorId)
    .slice(0, 20)
    .reverse();

  const chartWidth = 920;
  const chartHeight = 300;
  const chartPadding = 28;
  const chartValues = telemetryData.map((point) => point.temperatureCelsius);
  const chartMin = Math.min(-90, Math.floor(Math.min(...chartValues)) - 2);
  const chartMax = Math.max(-60, Math.ceil(Math.max(...chartValues)) + 2);
  const chartRange = chartMax - chartMin;
  const chartPoints = telemetryData.map((point, index) => {
    const x = telemetryData.length > 1
      ? chartPadding + ((chartWidth - chartPadding * 2) * index) / (telemetryData.length - 1)
      : chartWidth / 2;
    const normalized = (point.temperatureCelsius - chartMin) / chartRange;
    const y = chartHeight - chartPadding - normalized * (chartHeight - chartPadding * 2);
    return { key: point.telemetryReadingId ?? `${point.timestamp}-${index}`, x, y };
  });
  const chartLinePath = chartPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const chartTitle = `Histórico recente de temperatura — ${chartSensorId ?? '—'}`;

  return (
    <>
      <div className="temperature-monitor-grid">
        <div className="temperature-status-grid">
          {sensorCards.map((sensor) => {
            const tone = getTemperatureTone(sensor.temperatureCelsius);
            const TrendIcon = tone.trend;

            return (
              <Card
                key={sensor.sensorId}
                data-testid={`temperature-sensor-card-${sensor.sensorId}`}
                className="temperature-status-card"
                style={{
                  border: `1px solid ${tone.border}33`,
                  background: tone.background,
                  boxShadow: '0 18px 36px rgba(15, 23, 42, 0.06)',
                }}
              >
                <div className="temperature-status-card__header" style={{ color: '#64748b' }}>
                  <span className="temperature-status-card__label">{sensor.sensorId}</span>
                  <span
                    className="temperature-status-card__icon"
                    style={{ backgroundColor: `${tone.icon}14`, color: tone.icon }}
                  >
                    <Thermometer size={16} />
                  </span>
                </div>
                <div className="temperature-status-card__value" style={{ color: tone.border }}>
                  {sensor.temperatureCelsius.toFixed(1)}°C
                </div>
                <div className="temperature-status-card__timestamp" style={{ color: '#64748b', fontSize: '0.75rem' }}>
                  {new Date(sensor.timestamp).toLocaleString('pt-BR')}
                </div>
                <div className="temperature-status-card__footer">
                  <span
                    className="temperature-status-card__tone"
                    style={{ color: tone.border, backgroundColor: tone.badgeBackground }}
                  >
                    <TrendIcon size={14} />
                    <span>{tone.label}</span>
                  </span>
                </div>
              </Card>
            );
          })}
        </div>

        <Card className="temperature-monitor-chart-card">
          <div className="temperature-monitor-chart-card__header">
            <div>
              <p className="temperature-monitor-chart-card__eyebrow">Leituras persistidas</p>
              <h3 className="temperature-monitor-chart-card__title">{chartTitle}</h3>
            </div>
            <Button variant="secondary" data-testid="temperature-readings-refresh" onClick={() => void reload()}>
              Atualizar
            </Button>
          </div>

          <div className="temperature-monitor-chart-card__chart">
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="temperature-monitor-chart-card__svg" role="img" aria-label={chartTitle}>
              <defs>
                <linearGradient id="temperatureLineGradient" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#2563eb" stopOpacity="0.95" />
                  <stop offset="100%" stopColor="#0f766e" stopOpacity="0.95" />
                </linearGradient>
              </defs>

              {Array.from({ length: 5 }).map((_, index) => {
                const y = chartPadding + ((chartHeight - chartPadding * 2) * index) / 4;
                return <line key={`grid-y-${index}`} x1={chartPadding} y1={y} x2={chartWidth - chartPadding} y2={y} className="temperature-monitor-chart-card__grid-line" />;
              })}

              {Array.from({ length: 6 }).map((_, index) => {
                const x = chartPadding + ((chartWidth - chartPadding * 2) * index) / 5;
                return <line key={`grid-x-${index}`} x1={x} y1={chartPadding} x2={x} y2={chartHeight - chartPadding} className="temperature-monitor-chart-card__grid-line temperature-monitor-chart-card__grid-line--vertical" />;
              })}

              <path d={chartLinePath} className="temperature-monitor-chart-card__line" stroke="url(#temperatureLineGradient)" />

              {chartPoints.map((point) => (
                <circle key={point.key} cx={point.x} cy={point.y} r="4.5" className="temperature-monitor-chart-card__point" />
              ))}
            </svg>
          </div>
        </Card>

      </div>
    </>
  );
}

// #1397 (RF009 AC7): the rows are the readings persisted in InfluxDB, and an
// empty or failed read shows as such.
function HistorySection() {
  const { readings, loading, error, reload } = useTemperatureReadings();
  const historyLog = useMemo<HistoryLogEntry[]>(() => readings.map((reading) => ({
    id: reading.telemetryReadingId ?? `${reading.sensorId}-${reading.timestamp}`,
    timestamp: reading.timestamp,
    sensorName: reading.sensorId ?? '—',
    temperature: reading.temperatureCelsius,
    status: reading.temperatureCelsius > ALERT_TRIGGER_THRESHOLD ? 'Alerta' : 'Normal',
    readingId: reading.telemetryReadingId ?? '—',
  })), [readings]);
  const [currentPage, setCurrentPage] = useState(1);
  const [sensorFilter, setSensorFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const pageSize = 12;

  const sensorOptions = useMemo(() => Array.from(new Set(historyLog.map((entry) => entry.sensorName))), [historyLog]);

  const filteredHistory = useMemo(() => {
    return historyLog.filter((entry) => {
      const matchesSensor = sensorFilter === 'all' || entry.sensorName === sensorFilter;
      const matchesStatus = statusFilter === 'all' || entry.status.toLowerCase() === statusFilter;
      return matchesSensor && matchesStatus;
    });
  }, [historyLog, sensorFilter, statusFilter]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filteredHistory.length / pageSize));
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, filteredHistory.length]);

  useEffect(() => {
    setCurrentPage(1);
  }, [sensorFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / pageSize));
  const paginatedHistory = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredHistory.slice(startIndex, startIndex + pageSize);
  }, [currentPage, filteredHistory]);

  const handleExportCsv = () => {
    const rows = filteredHistory.map((entry) => [
      entry.timestamp,
      entry.sensorName,
      `${entry.temperature.toFixed(1)}°C`,
      entry.status,
      entry.readingId,
    ]);

    const csvLines = [
      ['Timestamp', 'Sensor', 'Temperatura', 'Status', 'ID da leitura'],
      ...rows,
    ].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(';'));

    const csvContent = `\uFEFF${csvLines.join('\n')}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `historico-leituras-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const clearFilters = () => {
    setSensorFilter('all');
    setStatusFilter('all');
  };

  return (
    <Card className="temperature-history-card">
      <div className="temperature-history-card__header">
        <div>
          <p className="temperature-history-card__eyebrow">Leituras persistidas</p>
          <h3 className="temperature-history-card__title">Histórico de Leituras</h3>
        </div>
        <div className="temperature-history-card__actions">
          <span className="temperature-history-card__badge">Últimos 100 registros</span>
          <Button variant="secondary" data-testid="history-readings-refresh" onClick={() => void reload()}>
            Atualizar
          </Button>
          <Button variant="secondary" onClick={handleExportCsv} disabled={filteredHistory.length === 0}>
            <Download size={16} />
            Exportar CSV
          </Button>
        </div>
      </div>

      <div className="history-filters" aria-label="Filtros de histórico">
        <div className="history-filters__group">
          <span className="history-filters__label">
            <Filter size={14} />
            Sensor
          </span>
          <select aria-label="Filtrar por sensor" className="input history-filters__select" value={sensorFilter} onChange={(e) => setSensorFilter(e.target.value)}>
            <option value="all">Todos os sensores</option>
            {sensorOptions.map((sensor) => (
              <option key={sensor} value={sensor}>{sensor}</option>
            ))}
          </select>
        </div>

        <div className="history-filters__group">
          <span className="history-filters__label">
            <Filter size={14} />
            Status
          </span>
          <select aria-label="Filtrar por status" className="input history-filters__select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">Todos os status</option>
            <option value="normal">Normal</option>
            <option value="alerta">Alerta</option>
          </select>
        </div>

        <Button variant="secondary" onClick={clearFilters} disabled={sensorFilter === 'all' && statusFilter === 'all'}>
          <X size={16} />
          Limpar filtros
        </Button>
      </div>

      <Table headers={['Timestamp', 'Sensor', 'Temperatura', 'Status', 'ID da leitura']}>
        {error ? (
          <tr>
            <td colSpan={5}>
              <div role="alert" data-testid="history-readings-error" style={{ color: 'var(--danger)' }}>
                Falha ao carregar as leituras de temperatura: {error}
              </div>
            </td>
          </tr>
        ) : loading && readings.length === 0 ? (
          <tr>
            <td colSpan={5} data-testid="history-readings-loading">Carregando leituras de temperatura…</td>
          </tr>
        ) : filteredHistory.length === 0 ? (
          <tr>
            <td colSpan={5} className="table-empty-state-cell" data-testid="history-readings-empty">
              <div className="table-empty-state">
                <span className="table-empty-state__icon">
                  <Thermometer size={34} />
                </span>
                <h3 className="table-empty-state__title">Nenhuma leitura encontrada</h3>
                <p className="table-empty-state__text">Nenhuma leitura persistida corresponde aos filtros.</p>
              </div>
            </td>
          </tr>
        ) : (
          paginatedHistory.map((entry) => (
            <tr key={entry.id} data-testid={`history-row-${entry.id}`}>
              <td className="break-words whitespace-normal overflow-x-auto max-w-xs">{entry.timestamp}</td>
              <td className="break-words whitespace-normal overflow-x-auto max-w-xs">{entry.sensorName}</td>
              <td className="break-words whitespace-normal overflow-x-auto max-w-xs">{entry.temperature.toFixed(1)}°C</td>
              <td>
                <span className={`status-badge status-${entry.status.toLowerCase()}`}>{entry.status}</span>
              </td>
              <td className="history-hash-cell break-all whitespace-normal overflow-x-auto max-w-xs">
                <code>{entry.readingId}</code>
              </td>
            </tr>
          ))
        )}
      </Table>

      {!error && filteredHistory.length > 0 && (
        <div className="history-pagination">
          <div className="history-pagination__summary">
            Mostrando {Math.min((currentPage - 1) * pageSize + 1, filteredHistory.length)}-
            {Math.min(currentPage * pageSize, filteredHistory.length)} de {filteredHistory.length}
          </div>

          <div className="history-pagination__controls">
            <Button
              variant="secondary"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={currentPage === 1}
            >
              Anterior
            </Button>
            <span className="history-pagination__page">
              Página {currentPage} de {totalPages}
            </span>
            <Button
              variant="secondary"
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              disabled={currentPage === totalPages}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// Seção de Sensores
function SensorsSection() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { sensors, loading, error, deleteSensor } = useSensors();
  const [search, setSearch] = useState('');

  const sensorRows = useMemo(() => (Array.isArray(sensors) ? sensors : []), [sensors]);
  const filteredSensors = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sensorRows;
    return sensorRows.filter((sensor) => {
      const sensorId = resolveSensorId(sensor) ?? '';
      return [sensorId, sensor.sensorType, sensor.sensorModel]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [sensorRows, search]);

  return (
    <>
      <div className="section-header flex flex-wrap items-center gap-3">
        <div className="relative min-w-[12rem] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
          <input
            type="search"
            className="input w-full pl-9"
            data-testid="sensors-search-input"
            placeholder={t('facility.sensors.search', 'Buscar sensores…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button data-testid="new-sensor-button" onClick={() => navigate('/sensors/new')}>
          <Plus size={18} />
          Novo Sensor
        </Button>
      </div>

      {loading && <p>Carregando...</p>}
      {error && <p style={{ color: 'var(--danger)' }}>Erro: {error}</p>}

      <Card>
        <Table
          headers={[
            'ID',
            'Tipo',
            'Modelo',
            'Status',
            'Última Calibração',
            'Próxima Calibração',
            'Ações',
          ]}
        >
          {filteredSensors.length > 0 ? (
            filteredSensors.map((sensor) => {
              const sensorId = resolveSensorId(sensor) || 'N/A';
              return (
            <tr key={sensorId}>
              <td>{sensorId}</td>
              <td>{sensor.sensorType}</td>
              <td>{sensor.sensorModel}</td>
              <td>
                <span className={`status-badge status-${(sensor.maintenanceStatus || 'operational').toLowerCase().replace(' ', '-')}`}>
                  {getMaintenanceStatusLabel(sensor.maintenanceStatus)}
                </span>
              </td>
              <td>
                {sensor.lastCalibration
                  ? new Date(sensor.lastCalibration).toLocaleDateString('pt-BR')
                  : 'N/A'}
              </td>
              <td>
                {sensor.nextCalibration
                  ? new Date(sensor.nextCalibration).toLocaleDateString('pt-BR')
                  : 'N/A'}
              </td>
              <td>
                <div className="table-actions">
                  <button
                    className="action-button"
                    data-testid={`sensor-edit-${sensor.sensorId ?? resolveSensorId(sensor)}`}
                    onClick={() => navigate(sensorFormEditPath(sensor), { state: { sensor } })}
                    title="Editar"
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    className="action-button danger"
                    onClick={async () => {
                      if (confirm('Tem certeza que deseja excluir este sensor?')) {
                        try {
                          await deleteSensor(sensorId);
                        } catch (err: any) {
                          alert(err.message);
                        }
                      }
                    }}
                    title="Excluir"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </td>
            </tr>
            );
            })
          ) : (
            <tr>
              <td colSpan={7} style={{ textAlign: 'center', padding: '2rem' }}>
                {loading ? 'Carregando...' : 'Nenhum sensor cadastrado'}
              </td>
            </tr>
          )}
        </Table>
      </Card>
    </>
  );
}

// Seção de Políticas
function PoliciesSection() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { policies, loading, error, getActiveLimit, deletePolicy } = usePolicies();
  const [search, setSearch] = useState('');
  // #1178: keyed by _id, the only id the policy API returns.
  const [activeLimits, setActiveLimits] = useState<Record<string, number>>({});

  const policyRows = useMemo(() => (Array.isArray(policies) ? policies : []), [policies]);
  const filteredPolicies = useMemo(() => {
    const q = search.trim().toLowerCase();
    const withId = policyRows.filter((p) => p && p._id);
    if (!q) return withId;
    return withId.filter((p) =>
      [p.name, p.minTemp, p.maxTemp]
        .filter((v) => v !== undefined && v !== null)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [policyRows, search]);

  useEffect(() => {
    const validPolicies = policyRows.filter((p) => p && p._id);
    validPolicies.forEach(async (policy) => {
      try {
        const limit = await getActiveLimit(String(policy._id), true);
        setActiveLimits((prev) => ({ ...prev, [String(policy._id)]: limit.limit }));
      } catch (err) {
        console.error(`Erro ao obter limite para política ${policy._id}:`, err);
      }
    });
  }, [policyRows, getActiveLimit]);

  return (
    <>
      <div className="section-header flex flex-wrap items-center gap-3">
        <div className="relative min-w-[12rem] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
          <input
            type="search"
            className="input w-full pl-9"
            data-testid="policies-search-input"
            placeholder={t('facility.policies.search', 'Buscar políticas…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button data-testid="new-policy-button" onClick={() => navigate('/policies/new')}>
          <Plus size={18} />
          Nova Política
        </Button>
      </div>

      {loading && <p>Carregando...</p>}
      {error && <p style={{ color: 'var(--danger)' }}>Erro: {error}</p>}

      <Card>
        <Table
          headers={[
            'Política',
            'Limite Mínimo',
            'Limite Máximo',
            'Histerese',
            'Válido De',
            'Válido Até',
            'Ações',
          ]}
        >
          {filteredPolicies.length === 0 ? (
            <tr>
              <td colSpan={8} className="table-empty-state-cell">
                <div className="table-empty-state">
                  <span className="table-empty-state__icon">
                    <Shield size={34} />
                  </span>
                  <h3 className="table-empty-state__title">Nenhuma política encontrada</h3>
                  <p className="table-empty-state__text">Clique no botão acima para adicionar a sua primeira política de temperatura.</p>
                </div>
              </td>
            </tr>
          ) : (
            filteredPolicies.map((policy) => (
              <tr key={`policy-${policy._id}`} data-testid={`policy-row-${policy._id}`}>
                <td>{policy.name}</td>
                <td>
                  {policy.minTemp}°C
                </td>
                <td>
                  {policy.maxTemp}°C
                  <br />
                  <small style={{ color: 'var(--text-light)' }}>
                    Limite ativo: {activeLimits[String(policy._id)]?.toFixed(1) || 'N/A'}°C
                  </small>
                </td>
                <td>{policy.hysteresis}°C</td>
                <td>{new Date(policy.effectivePeriod?.start).toLocaleDateString('pt-BR')}</td>
                <td>{policy.effectivePeriod?.end ? new Date(policy.effectivePeriod.end).toLocaleDateString('pt-BR') : '—'}</td>
                <td>
                  <div className="table-actions">
                    <button
                      className="action-button"
                      data-testid={`policy-edit-${policy._id}`}
                      onClick={() => navigate(policyFormEditPath(policy), { state: { policy } })}
                      title="Editar"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      className="action-button danger"
                      data-testid={`policy-delete-${policy._id}`}
                      onClick={async () => {
                        if (confirm('Tem certeza que deseja excluir esta política?')) {
                          try {
                            await deletePolicy(String(policy._id));
                          } catch (err: any) {
                            alert(err.message);
                          }
                        }
                      }}
                      title="Excluir"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </Table>
      </Card>
    </>
  );
}

