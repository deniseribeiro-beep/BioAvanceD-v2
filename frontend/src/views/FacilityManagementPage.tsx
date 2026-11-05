import { useState, useEffect, useMemo, useRef } from 'react';

import { useLanguage } from '../contexts/LanguageContext';
import { useSearchParams } from 'react-router-dom';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import Input from '../components/UI/Input';
import { Plus, Edit, Trash2, AlertCircle, CheckCircle, Box, Thermometer, Radio as RadioIcon, Shield, Download, Filter, X } from 'lucide-react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Equipment, Temperature, Sensor, Policy } from '../types/models';
import { useEquipment } from '../hooks/useEquipment';
import { useTemperatureReadings, TemperatureReading } from '../hooks/useTemperatureReadings';
import { useSensors } from '../hooks/useSensors';
import { usePolicies } from '../hooks/usePolicies';
import { useOrganizations } from '../hooks/useOrganizations';
import { validateThresholds } from '../utils/validations';
import { CryoBoxGrid } from '../components/CryoBoxGrid';
import { storageApi } from '../services/storageApi';
import { MAINTENANCE_STATUS_OPTIONS, getMaintenanceStatusLabel } from '../config/constants/sensor.constants';
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

      <div
        className="facility-tabs relative z-0 flex shrink-0 flex-wrap gap-1 rounded-xl border border-border bg-card p-1"
        role="tablist"
        aria-label={t('facility.tabsLabel', 'Seções do gerenciamento de instalações')}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
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
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

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
  const { equipment, loading, error, createEquipment, updateEquipment, deleteEquipment, loadEquipment } = useEquipment();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState<Equipment | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const equipmentRows = useMemo(() => (Array.isArray(equipment) ? equipment : []), [equipment]);
  const totalPages = Math.max(1, Math.ceil(equipmentRows.length / pageSize));
  const paginatedEquipment = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return equipmentRows.slice(startIndex, startIndex + pageSize);
  }, [equipmentRows, currentPage, pageSize]);
  const equipmentHeaders = ['ID', 'Descrição', 'Modelo', 'Número de Série', 'Data da Compra', 'Ações'];

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const openNewEquipmentForm = () => {
    setEditingEquipment(null);
    setIsFormOpen(true);
  };

  const openEditEquipmentForm = (equipmentItem: Equipment) => {
    const equipmentToEdit = { ...equipmentItem, _id: (equipmentItem as any)._id || undefined };
    setEditingEquipment(equipmentToEdit);
    setIsFormOpen(true);
  };

  const closeEquipmentForm = () => {
    setIsFormOpen(false);
    setEditingEquipment(null);
  };

  return (
    <>
      <div className="section-header">
        <Button data-testid="equipment-new-button" onClick={openNewEquipmentForm}>
          <Plus size={18} />
          {t('facility.equipment.new', 'Novo Equipamento')}
        </Button>
      </div>

      {isFormOpen && (
        <div data-testid="equipment-form-panel">
        <Card className="equipment-form-panel equipment-form-panel--open">
          <div className="equipment-form-panel__header">
            <div>
              <p className="equipment-form-panel__eyebrow">
                {editingEquipment ? t('facility.equipment.quickEdit', 'Edição rápida') : t('facility.equipment.quickCreate', 'Criação rápida')}
              </p>
              <h2 className="equipment-form-panel__title">
                {editingEquipment ? 'Editar Equipamento' : 'Novo Equipamento'}
              </h2>
              <p className="equipment-form-panel__subtitle">
                Formulário inline para reduzir atrito e manter a navegação na mesma tela.
              </p>
            </div>
            <Button data-testid="equipment-form-close-button" variant="secondary" onClick={closeEquipmentForm}>
              Fechar
            </Button>
          </div>

          <EquipmentForm
            equipment={editingEquipment}
            onSave={async (data) => {
              try {
                if (editingEquipment) {
                  const equipmentId = (editingEquipment as any)._id
                    ? String((editingEquipment as any)._id)
                    : String(editingEquipment.equipmentID);
                  await updateEquipment(equipmentId, data);
                } else {
                  await createEquipment(data);
                }
                closeEquipmentForm();
                await loadEquipment();
              } catch (err: any) {
                const errorMessage = err.response?.data?.message || err.response?.data?.error || err.message || 'Erro ao salvar equipamento';
                alert(errorMessage);
                console.error('Erro ao salvar equipamento:', err);
              }
            }}
            onCancel={closeEquipmentForm}
          />
        </Card>
        </div>
      )}

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
                        openEditEquipmentForm(eq);
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
            {equipmentRows.length === 0
              ? 'Nenhum equipamento cadastrado'
              : `Mostrando ${Math.min((currentPage - 1) * pageSize + 1, equipmentRows.length)}-${Math.min(currentPage * pageSize, equipmentRows.length)} de ${equipmentRows.length}`}
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

function EquipmentForm({
  equipment,
  onSave,
  onCancel,
}: {
  equipment: Equipment | null;
  onSave: (data: Partial<Equipment>) => void;
  onCancel: () => void;
}) {
  const { organizations } = useOrganizations();

  const [formData, setFormData] = useState<Partial<Equipment>>(() => {
    if (equipment) {
      return {
        equipmentDescription: equipment.equipmentDescription || '',
        model: equipment.model || '',
        serialNumber: equipment.serialNumber || '',
        purchaseDate: equipment.purchaseDate ? new Date(equipment.purchaseDate) : undefined,
        organizationId: equipment.organizationId || null,
      };
    }
    return {
      equipmentDescription: '',
      model: '',
      serialNumber: '',
      purchaseDate: undefined,
      organizationId: null,
    };
  });

  // Atualiza o formData quando equipment muda (para edição)
  useEffect(() => {
    if (equipment) {
      setFormData({
        equipmentDescription: equipment.equipmentDescription || '',
        model: equipment.model || '',
        serialNumber: equipment.serialNumber || '',
        purchaseDate: equipment.purchaseDate ? new Date(equipment.purchaseDate) : undefined,
        organizationId: equipment.organizationId || null,
      });
    } else {
      setFormData({
        equipmentDescription: '',
        model: '',
        serialNumber: '',
        purchaseDate: undefined,
        organizationId: null,
      });
    }
  }, [equipment]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="form" data-testid="equipment-form">
      <div className="form-grid">
        <Input
          data-testid="equipment-description-input"
          label="Descrição do Equipamento"
          value={formData.equipmentDescription || ''}
          onChange={(e) =>
            setFormData({ ...formData, equipmentDescription: e.target.value })
          }
          required
        />
        <Input
          data-testid="equipment-model-input"
          label="Modelo"
          value={formData.model || ''}
          onChange={(e) =>
            setFormData({ ...formData, model: e.target.value })
          }
          placeholder="Ex: Freezer -80°C, Refrigerador 4°C"
        />
        <Input
          data-testid="equipment-serial-input"
          label="Número de Série"
          value={formData.serialNumber || ''}
          onChange={(e) =>
            setFormData({ ...formData, serialNumber: e.target.value })
          }
          placeholder="Ex: SN123456789"
        />
        <Input
          data-testid="equipment-purchase-date-input"
          label="Data da Compra"
          type="date"
          value={
            formData.purchaseDate
              ? new Date(formData.purchaseDate).toISOString().split('T')[0]
              : ''
          }
          onChange={(e) =>
            setFormData({
              ...formData,
              purchaseDate: e.target.value ? new Date(e.target.value) : undefined,
            })
          }
        />
        <div className="form-grid-full">
          <label className="input-label" htmlFor="equipmentOrganizationSelect">Organização</label>
          <select
            id="equipmentOrganizationSelect"
            data-testid="equipment-organization-select"
            className="input"
            value={formData.organizationId || ''}
            onChange={(e) =>
              setFormData({
                ...formData,
                organizationId: e.target.value || null,
              })
            }
          >
            <option value="">Selecione uma organização</option>
            {organizations.map((org) => (
              <option key={org.organizationId} value={org.organizationId}>
                {org.officialName}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-actions">
        <Button data-testid="equipment-cancel-button" type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>
        <Button data-testid="equipment-save-button" type="submit">Salvar</Button>
      </div>
    </form>
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
  const { sensors, loading, error, createSensor, updateSensor, deleteSensor } = useSensors();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSensor, setEditingSensor] = useState<Sensor | null>(null);

  const sensorRows = useMemo(() => (Array.isArray(sensors) ? sensors : []), [sensors]);

  return (
    <>
      <div className="section-header">
        <Button data-testid="new-sensor-button" onClick={() => setIsModalOpen(true)}>
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
          {sensorRows.length > 0 ? (
            sensorRows.map((sensor) => {
              const sensorId = sensor.sensorID || (sensor as any).sensorId || sensor._id || 'N/A';
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
                    data-testid={`sensor-edit-${sensor.sensorId}`}
                    onClick={() => {
                      setEditingSensor(sensor);
                      setIsModalOpen(true);
                    }}
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

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingSensor(null);
        }}
        title={editingSensor ? 'Editar Sensor' : 'Novo Sensor'}
      >
        <SensorForm
          sensor={editingSensor}
          onSave={async (data) => {
            try {
              if (editingSensor) {
                const sensorId = (editingSensor as any).sensorID || (editingSensor as any).sensorId || editingSensor._id;
                if (!sensorId) {
                  throw new Error('ID do sensor não encontrado');
                }
                await updateSensor(String(sensorId), data);
              } else {
                await createSensor(data);
              }
              setIsModalOpen(false);
              setEditingSensor(null);
            } catch (err: any) {
              alert(err.message);
            }
          }}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingSensor(null);
          }}
        />
      </Modal>
    </>
  );
}

function SensorForm({
  sensor,
  onSave,
  onCancel,
}: {
  sensor: Sensor | null;
  onSave: (data: Partial<Sensor>) => void;
  onCancel: () => void;
}) {
  const { policies } = usePolicies();
  const { organizations } = useOrganizations();
  const [freezers, setFreezers] = useState<{ _id: string; name: string; containerID?: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    storageApi.listFreezers().then((response) => {
      if (!cancelled && response.success && Array.isArray(response.data)) {
        setFreezers(response.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [formData, setFormData] = useState<Partial<Sensor>>(
    sensor || {
      sensorType: '',
      sensorModel: '',
      maintenanceStatus: 'operational',
      lastCalibration: null,
      nextCalibration: null,
      calibrationCertificate: '',
      locationID: undefined,
      temperaturePolicy: undefined,
      macAddress: '',
      storageContainer: undefined,
      organizationId: null,
    }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="form">
      <div className="form-grid">
        {!sensor && (
          <Input
            label="ID do Sensor"
            data-testid="sensor-id-input"
            value={formData.sensorID || ''}
            onChange={(e) =>
              setFormData({ ...formData, sensorID: e.target.value })
            }
            required
          />
        )}
        <Input
          label="Tipo de Sensor"
          data-testid="sensor-type-input"
          value={formData.sensorType || ''}
          onChange={(e) =>
            setFormData({ ...formData, sensorType: e.target.value })
          }
          required
        />
        <Input
          label="Modelo"
          value={formData.sensorModel || ''}
          onChange={(e) =>
            setFormData({ ...formData, sensorModel: e.target.value })
          }
        />
        <div className="form-grid-full">
          <label className="input-label" htmlFor="maintenanceStatusSelect">Status de Manutenção</label>
          <select
            id="maintenanceStatusSelect"
            className="input"
            value={formData.maintenanceStatus || 'operational'}
            onChange={(e) =>
              setFormData({ ...formData, maintenanceStatus: e.target.value })
            }
          >
            {MAINTENANCE_STATUS_OPTIONS.map((option, index) => (
              <option key={`${option.value}-${index}`} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <Input
          label="Última Calibração"
          type="date"
          value={
            formData.lastCalibration
              ? new Date(formData.lastCalibration).toISOString().split('T')[0]
              : ''
          }
          onChange={(e) =>
            setFormData({
              ...formData,
              lastCalibration: e.target.value ? new Date(e.target.value) : null,
            })
          }
        />
        <Input
          label="Próxima Calibração"
          type="date"
          value={
            formData.nextCalibration
              ? new Date(formData.nextCalibration).toISOString().split('T')[0]
              : ''
          }
          onChange={(e) =>
            setFormData({
              ...formData,
              nextCalibration: e.target.value ? new Date(e.target.value) : null,
            })
          }
        />
        <Input
          label="Certificado de Calibração"
          value={formData.calibrationCertificate || ''}
          onChange={(e) =>
            setFormData({
              ...formData,
              calibrationCertificate: e.target.value,
            })
          }
        />
        <div className="form-grid-full">
          <label className="input-label" htmlFor="sensorLocationSelect">Localização</label>
          <select
            id="sensorLocationSelect"
            className="input"
            value={formData.locationID || ''}
            onChange={(e) =>
              setFormData({
                ...formData,
                locationID: e.target.value ? parseInt(e.target.value) : undefined,
              })
            }
          >
            <option value="">Selecione um freezer</option>
            {freezers
              .filter((freezer) => freezer.containerID !== undefined && freezer.containerID !== null)
              .map((freezer) => (
                <option key={freezer._id} value={String(freezer.containerID)}>
                  {freezer.name}
                </option>
              ))}
          </select>
        </div>
        <div className="form-grid-full">
          <label className="input-label" htmlFor="sensorPolicySelect">Política de Temperatura</label>
          {/* #1145: binds SensorMetadata.temperaturePolicy, the field the
              telemetry path resolves thresholds from, by the policy's _id.
              It used to send a numeric policyID onto Sensor.policyId, which
              nothing read. The binding lives on SensorMetadata, which only
              exists when a MAC address is given, so it needs one. On edit it
              rebinds that row (#1179), pre-filled from the list. The freezer
              select below lives on the same row and has the same rule. */}
          <select
            id="sensorPolicySelect"
            data-testid="sensor-policy-select"
            className="input"
            value={formData.temperaturePolicy || ''}
            disabled={!formData.macAddress}
            onChange={(e) =>
              setFormData({
                ...formData,
                temperaturePolicy: e.target.value || undefined,
              })
            }
          >
            <option value="">
              {formData.macAddress ? 'Selecione uma política' : 'Informe o MAC Address para vincular uma política'}
            </option>
            {policies.filter((policy) => policy && policy._id).map((policy) => (
              <option key={policy._id} value={policy._id}>
                {policy.name || 'Política'} (Limites: {policy.minTemp} - {policy.maxTemp}{policy.temperatureUnit})
              </option>
            ))}
          </select>
        </div>
        <Input
          label="MAC Address"
          data-testid="sensor-mac-address-input"
          placeholder="AA:BB:CC:DD:EE:FF"
          value={formData.macAddress || ''}
          onChange={(e) =>
            // #1145: without a MAC there is no SensorMetadata to bind a policy
            // to, so clearing it clears the choice rather than submitting one
            // the backend would refuse.
            setFormData({
              ...formData,
              macAddress: e.target.value,
              ...(e.target.value ? {} : { temperaturePolicy: undefined, storageContainer: undefined }),
            })
          }
        />
        <div className="form-grid-full">
          <label className="input-label" htmlFor="sensorStorageContainerSelect">Contêiner de Armazenamento (Freezer)</label>
          <select
            id="sensorStorageContainerSelect"
            data-testid="sensor-storage-container-select"
            className="input"
            value={formData.storageContainer || ''}
            disabled={!formData.macAddress}
            onChange={(e) =>
              setFormData({
                ...formData,
                storageContainer: e.target.value || undefined,
              })
            }
          >
            <option value="">{formData.macAddress ? 'Selecione um freezer' : 'Informe o MAC Address para vincular um freezer'}</option>
            {freezers.map((freezer) => (
              <option key={freezer._id} value={freezer._id}>
                {freezer.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-grid-full">
          <label className="input-label" htmlFor="sensorOrganizationSelect">Organização</label>
          <select
            id="sensorOrganizationSelect"
            data-testid="sensor-organization-select"
            className="input"
            value={formData.organizationId || ''}
            onChange={(e) =>
              setFormData({
                ...formData,
                organizationId: e.target.value || null,
              })
            }
          >
            <option value="">Selecione uma organização</option>
            {organizations.map((org) => (
              <option key={org.organizationId} value={org.organizationId}>
                {org.officialName}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" data-testid="sensor-form-submit">Salvar</Button>
      </div>
    </form>
  );
}

// Seção de Políticas
function PoliciesSection() {
  const { policies, loading, error, getActiveLimit, createPolicy, updatePolicy, deletePolicy } = usePolicies();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null);
  // #1178: keyed by _id, the only id the policy API returns.
  const [activeLimits, setActiveLimits] = useState<Record<string, number>>({});

  const policyRows = useMemo(() => (Array.isArray(policies) ? policies : []), [policies]);

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
      <div className="section-header">
        <Button onClick={() => setIsModalOpen(true)}>
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
          {policyRows.filter((policy) => policy && policy._id).length === 0 ? (
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
            policyRows
              .filter((policy) => policy && policy._id)
              .map((policy) => (
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
                      onClick={() => {
                        setEditingPolicy(policy);
                        setIsModalOpen(true);
                      }}
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

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingPolicy(null);
        }}
        title={editingPolicy ? 'Editar Política' : 'Nova Política'}
      >
        <PolicyForm
          policy={editingPolicy}
          onSave={async (data) => {
            const policyToValidate = { ...(editingPolicy || {}), ...data } as Policy;
            
            if (!validateThresholds(policyToValidate)) {
              alert('Limites de temperatura inválidos! Verifique se min < target < max.');
              return;
            }

            try {
              if (editingPolicy) {
                await updatePolicy(String(editingPolicy._id), data);
              } else {
                await createPolicy(data);
              }
              setIsModalOpen(false);
              setEditingPolicy(null);
            } catch (err: any) {
              alert(err.message);
            }
          }}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingPolicy(null);
          }}
        />
      </Modal>
    </>
  );
}

function PolicyForm({
  policy,
  onSave,
  onCancel,
}: {
  policy: Policy | null;
  onSave: (data: Partial<Policy>) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState<Partial<Policy>>(
    policy || {
      // #1089: required by the API as of the temperaturePolicies cutover.
      name: '',
      minTemp: -85,
      maxTemp: -75,
      hysteresis: 2,
      // #1196: 30 min, past a -80 °C freezer's recovery to -75 °C after a
      // routine door opening, so a retrieval does not compromise the samples.
      minimumDuration: 30,
      temperatureUnit: '°C',
      effectivePeriod: { start: new Date(), end: new Date() },
    }
  );
  // #1139: the API takes effectivePeriod whole, so each date input edits
  // one bound and keeps the other.
  const setPeriodBound = (bound: 'start' | 'end', value: string) =>
    setFormData({
      ...formData,
      effectivePeriod: {
        start: formData.effectivePeriod?.start ?? new Date(),
        end: formData.effectivePeriod?.end ?? null,
        [bound]: new Date(value),
      },
    });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="form">
      <div className="form-grid">
        {/* #1089: sources dict-02 P1X-0106 profileName, which the canonical
            store requires. Also the first thing to populate the policy
            table's existing name column, which was blank until now. */}
        <Input
          label="Nome da Política"
          type="text"
          value={formData.name || ''}
          onChange={(e) =>
            setFormData({
              ...formData,
              name: e.target.value,
            })
          }
          helperText="Identifica a política na listagem e nos alertas. Ex.: Freezer -80."
          required
        />
        <Input
          label="Limite Mínimo"
          type="number"
          step="0.1"
          value={formData.minTemp || ''}
          onChange={(e) =>
            setFormData({
              ...formData,
              minTemp: parseFloat(e.target.value),
            })
          }
          helperText="Temperatura mínima permitida. Deve ser menor que a temperatura alvo."
          required
        />
        <Input
          label="Limite Máximo"
          type="number"
          step="0.1"
          value={formData.maxTemp || ''}
          onChange={(e) =>
            setFormData({
              ...formData,
              maxTemp: parseFloat(e.target.value),
            })
          }
          helperText="Temperatura máxima permitida. Deve ser maior que a temperatura alvo."
          required
        />
        <Input
          label="Histerese"
          type="number"
          step="0.1"
          value={formData.hysteresis || ''}
          onChange={(e) =>
            setFormData({ ...formData, hysteresis: parseFloat(e.target.value) })
          }
          helperText="Margem de tolerância para evitar alertas frequentes. Valor recomendado: 1-5 unidades."
        />
        <Input
          label="Duração Mínima da Excursão (minutos)"
          type="number"
          value={formData.minimumDuration || ''}
          onChange={(e) =>
            setFormData({
              ...formData,
              minimumDuration: parseInt(e.target.value),
            })
          }
          helperText="Tempo em minutos que a temperatura deve permanecer fora dos limites antes de as amostras serem marcadas como comprometidas."
        />
        {/* #1198: fixed, not selectable. Alert enforcement compares readings
            against these limits in Celsius, so a policy entered in another
            unit was misapplied (°F) or rejected by the API (K). */}
        <div className="form-grid-full">
          <p className="input-label">Unidade de Temperatura</p>
          <p className="form-help-text" data-testid="policy-temperature-unit" style={{ fontSize: '0.875rem', color: 'var(--text-light)' }}>
            Celsius (°C). Todas as temperaturas desta política são em °C.
          </p>
        </div>
        <Input
          label="Válido De"
          type="date"
          value={
            formData.effectivePeriod?.start
              ? new Date(formData.effectivePeriod.start).toISOString().split('T')[0]
              : ''
          }
          onChange={(e) => setPeriodBound('start', e.target.value)}
          helperText="Data de início da vigência desta política. Deve ser anterior à data de término."
          required
        />
        <Input
          label="Válido Até"
          type="date"
          value={
            formData.effectivePeriod?.end
              ? new Date(formData.effectivePeriod.end).toISOString().split('T')[0]
              : ''
          }
          onChange={(e) => setPeriodBound('end', e.target.value)}
          helperText="Data de término da vigência desta política. Deve ser posterior à data de início."
          required
        />
      </div>
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>
        <Button type="submit">Salvar</Button>
      </div>
    </form>
  );
}


