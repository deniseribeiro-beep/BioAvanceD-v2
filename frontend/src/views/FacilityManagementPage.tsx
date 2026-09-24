import { useState, useEffect, useMemo, useRef } from 'react';

import { useLanguage } from '../contexts/LanguageContext';
import { useSearchParams } from 'react-router-dom';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import Input from '../components/UI/Input';
import { Plus, Edit, Trash2, Radio, AlertCircle, CheckCircle, Box, Thermometer, Radio as RadioIcon, Shield, Download, Filter, X } from 'lucide-react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Equipment, Temperature, Sensor, Policy } from '../types/models';
import { useEquipment } from '../hooks/useEquipment';
import { useTemperature } from '../hooks/useTemperature';
import { useSensors } from '../hooks/useSensors';
import { usePolicies } from '../hooks/usePolicies';
import { useOrganizations } from '../hooks/useOrganizations';
import { validateReading, validateTemperatureUnit, generateAlert, validateThresholds } from '../utils/validations';
import { CryoBoxGrid } from '../components/CryoBoxGrid';
import { storageApi } from '../services/storageApi';
import { MAINTENANCE_STATUS_OPTIONS, getMaintenanceStatusLabel } from '../config/constants/sensor.constants';
import IncidentManagementPage from './IncidentManagementPage';
import './FacilityManagementPage.css';

type TabType = 'equipment' | 'temperature' | 'history' | 'sensors' | 'policies' | 'incidents';

type HistoryLogEntry = {
  id: string;
  timestamp: string;
  sensorName: string;
  temperature: number;
  status: string;
  validationHash: string;
};

const ALERT_TRIGGER_THRESHOLD = -70;

function createIncidentId() {
  return globalThis.crypto?.randomUUID?.() || `incident-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function buildValidationHash(payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(payload));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export default function FacilityManagementPage() {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TabType | null;
  const validTabs: TabType[] = ['equipment', 'temperature', 'history', 'sensors', 'policies', 'incidents'];
  const initialTab = (tabParam && validTabs.includes(tabParam)) ? tabParam : 'equipment';
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [sensorSnapshot, setSensorSnapshot] = useState({
    sensor1: -80.2,
    sensor2: -79.6,
    sensor3: -81.1,
  });
  const [telemetryData, setTelemetryData] = useState([
    { time: '10:00', temp: -80.1 },
    { time: '10:05', temp: -79.5 },
    { time: '10:10', temp: -80.4 },
    { time: '10:15', temp: -79.8 },
    { time: '10:20', temp: -80.7 },
  ]);
  const [historyLog, setHistoryLog] = useState<HistoryLogEntry[]>([]);

  useEffect(() => {
    if (tabParam && validTabs.includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  useEffect(() => {
    const interval = setInterval(() => {
      void (async () => {
        const nextSensor1 = Number((-80 + (Math.random() * 4 - 2)).toFixed(1));
        const nextSensor2 = Number((-80 + (Math.random() * 4 - 2)).toFixed(1));
        const nextSensor3 = Number((-80 + (Math.random() * 4 - 2)).toFixed(1));
        const nextAverage = Number(((nextSensor1 + nextSensor2 + nextSensor3) / 3).toFixed(1));
        const chartTime = new Date().toLocaleTimeString('pt-BR', { hour12: false, hour: '2-digit', minute: '2-digit' });
        const timestamp = new Date().toISOString();
        const timestampMs = Date.now();

        const sensorReadings = [
          { sensorKey: 'sensor1', sensorName: 'Sensor 1', temperature: nextSensor1 },
          { sensorKey: 'sensor2', sensorName: 'Sensor 2', temperature: nextSensor2 },
          { sensorKey: 'sensor3', sensorName: 'Sensor 3', temperature: nextSensor3 },
        ];

        const logs = await Promise.all(sensorReadings.map(async (entry) => {
          const validationHash = await buildValidationHash(
            `${entry.sensorName}|${timestamp}|${entry.temperature.toFixed(1)}|${entry.temperature > ALERT_TRIGGER_THRESHOLD ? 'Alerta' : 'Normal'}`
          );

          return {
            id: globalThis.crypto?.randomUUID?.() || `${entry.sensorName}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            timestamp,
            sensorName: entry.sensorName,
            temperature: entry.temperature,
            status: entry.temperature > ALERT_TRIGGER_THRESHOLD ? 'Alerta' : 'Normal',
            validationHash,
          };
        }));

        setSensorSnapshot({
          sensor1: nextSensor1,
          sensor2: nextSensor2,
          sensor3: nextSensor3,
        });

        setTelemetryData((current) => [...current.slice(-19), { time: chartTime, temp: nextAverage }]);
        setHistoryLog((prev) => [...logs, ...prev].slice(0, 100));
      })().catch((error) => {
        console.error('Falha ao gerar hash de validação da leitura:', error);
      });
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const tabs = [
    { id: 'equipment' as TabType, label: t('facility.tabs.equipment', 'Equipamentos'), icon: Box },
    { id: 'temperature' as TabType, label: t('facility.tabs.temperature', 'Controle de Temperatura'), icon: Thermometer },
    { id: 'history' as TabType, label: t('facility.tabs.history', 'Histórico de Leituras'), icon: AlertCircle },
    { id: 'incidents' as TabType, label: t('facility.tabs.incidents', 'Gerenciamento de Incidentes'), icon: AlertCircle },
    { id: 'sensors' as TabType, label: t('facility.tabs.sensors', 'Sensores'), icon: RadioIcon },
    { id: 'policies' as TabType, label: t('facility.tabs.policies', 'Políticas de Temperatura'), icon: Shield },
  ];

  return (
    <div className="page facility-management-page flex flex-col md:flex-row w-full min-w-0">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('facility.title', 'Gerenciamento de Instalações')}</h1>
          <p className="page-subtitle">{t('facility.subtitle', 'Gerenciamento integrado de equipamentos, temperatura, sensores e políticas')}</p>
        </div>
      </div>

      <div className="facility-tabs">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              data-testid={`facility-tab-${tab.id}`}
              className={`facility-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => {
                setActiveTab(tab.id);
                setSearchParams({ tab: tab.id });
              }}
            >
              <Icon size={18} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="facility-tab-content flex-1 min-w-0 overflow-hidden">
        {activeTab === 'equipment' && <EquipmentSection />}
        {activeTab === 'temperature' && (
          <TemperatureSection
            sensorSnapshot={sensorSnapshot}
            telemetryData={telemetryData}
          />
        )}
        {activeTab === 'history' && (
          <HistorySection historyLog={historyLog} />
        )}
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
function TemperatureSection({
  sensorSnapshot,
  telemetryData,
}: {
  sensorSnapshot: {
    sensor1: number;
    sensor2: number;
    sensor3: number;
  };
  telemetryData: Array<{ time: string; temp: number }>;
}) {

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

  const sensorCards = [
    { id: 'sensor1', label: 'Sensor 1', temperature: sensorSnapshot.sensor1 },
    { id: 'sensor2', label: 'Sensor 2', temperature: sensorSnapshot.sensor2 },
    { id: 'sensor3', label: 'Sensor 3', temperature: sensorSnapshot.sensor3 },
  ];

  const chartWidth = 920;
  const chartHeight = 300;
  const chartPadding = 28;
  const chartMin = -90;
  const chartMax = -60;
  const chartRange = chartMax - chartMin;
  const chartPoints = telemetryData.map((point, index) => {
    const x = telemetryData.length > 1
      ? chartPadding + ((chartWidth - chartPadding * 2) * index) / (telemetryData.length - 1)
      : chartWidth / 2;
    const normalized = (point.temp - chartMin) / chartRange;
    const y = chartHeight - chartPadding - normalized * (chartHeight - chartPadding * 2);
    return { ...point, x, y };
  });
  const chartLinePath = chartPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');

  return (
    <>
      <div className="temperature-monitor-grid">
        <div className="temperature-status-grid">
          {sensorCards.map((sensor) => {
            const tone = getTemperatureTone(sensor.temperature);
            const TrendIcon = tone.trend;

            return (
              <Card
                key={sensor.id}
                className="temperature-status-card"
                style={{
                  border: `1px solid ${tone.border}33`,
                  background: tone.background,
                  boxShadow: '0 18px 36px rgba(15, 23, 42, 0.06)',
                }}
              >
                <div className="temperature-status-card__header" style={{ color: '#64748b' }}>
                  <span className="temperature-status-card__label">{sensor.label}</span>
                  <span
                    className="temperature-status-card__icon"
                    style={{ backgroundColor: `${tone.icon}14`, color: tone.icon }}
                  >
                    <Thermometer size={16} />
                  </span>
                </div>
                <div className="temperature-status-card__value" style={{ color: tone.border }}>
                  {sensor.temperature.toFixed(1)}°C
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
              <p className="temperature-monitor-chart-card__eyebrow">Monitoramento em tempo real</p>
              <h3 className="temperature-monitor-chart-card__title">Histórico recente de temperatura</h3>
            </div>
            <span className="temperature-monitor-chart-card__badge">Atualiza a cada 2s</span>
          </div>

          <div className="temperature-monitor-chart-card__chart">
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="temperature-monitor-chart-card__svg" role="img" aria-label="Histórico recente de temperatura">
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
                <circle key={`${point.time}-${point.x}`} cx={point.x} cy={point.y} r="4.5" className="temperature-monitor-chart-card__point" />
              ))}
            </svg>
          </div>
        </Card>

      </div>
    </>
  );
}

function HistorySection({
  historyLog,
}: {
  historyLog: HistoryLogEntry[];
}) {
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
      entry.validationHash,
    ]);

    const csvLines = [
      ['Timestamp', 'Sensor', 'Temperatura', 'Status', 'Validation Hash'],
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
          <p className="temperature-history-card__eyebrow">Leituras em tempo real</p>
          <h3 className="temperature-history-card__title">Histórico de Leituras</h3>
        </div>
        <div className="temperature-history-card__actions">
          <span className="temperature-history-card__badge">Últimos 100 registros</span>
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

      <Table headers={['Timestamp', 'Sensor', 'Temperatura', 'Status', 'Validation Hash']}>
        {filteredHistory.length === 0 ? (
          <tr>
            <td colSpan={5} className="table-empty-state-cell">
              <div className="table-empty-state">
                <span className="table-empty-state__icon">
                  <Thermometer size={34} />
                </span>
                <h3 className="table-empty-state__title">Nenhuma leitura encontrada</h3>
                <p className="table-empty-state__text">Ajuste os filtros ou aguarde a próxima leitura da simulação para preencher o histórico.</p>
              </div>
            </td>
          </tr>
        ) : (
          paginatedHistory.map((entry) => (
            <tr key={entry.id}>
              <td className="break-words whitespace-normal overflow-x-auto max-w-xs">{entry.timestamp}</td>
              <td className="break-words whitespace-normal overflow-x-auto max-w-xs">{entry.sensorName}</td>
              <td className="break-words whitespace-normal overflow-x-auto max-w-xs">{entry.temperature.toFixed(1)}°C</td>
              <td>
                <span className={`status-badge status-${entry.status.toLowerCase()}`}>{entry.status}</span>
              </td>
              <td className="history-hash-cell break-all whitespace-normal overflow-x-auto max-w-xs">
                <code>{entry.validationHash}</code>
              </td>
            </tr>
          ))
        )}
      </Table>

      {filteredHistory.length > 0 && (
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
  const { sensors, loading, error, collectReading, createSensor, updateSensor, deleteSensor } = useSensors();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSensor, setEditingSensor] = useState<Sensor | null>(null);
  const [isReading, setIsReading] = useState(false);

  const sensorRows = useMemo(() => (Array.isArray(sensors) ? sensors : []), [sensors]);

  async function handleManualReading(sensorId: string | number) {
    if (isReading) {
      return;
    }

    setIsReading(true);

    try {
      const reading = await collectReading(String(sensorId));
      const temperature = (reading as any)?.temperatureValue ?? (reading as any)?.temperature ?? 'N/A';
      alert(`Leitura manual do sensor ${sensorId} realizada com sucesso: ${temperature}°C`);
    } catch (err: any) {
      alert(err.message || 'Erro ao coletar leitura do sensor');
    } finally {
      setIsReading(false);
    }
  }

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
                    onClick={() => handleManualReading(sensorId)}
                    title="Coletar Leitura"
                    disabled={isReading}
                    style={{ opacity: isReading ? 0.5 : 1, cursor: isReading ? 'not-allowed' : 'pointer' }}
                  >
                    <Radio size={16} />
                  </button>
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
                {policy.name || 'Política'} - {policy.targetTemp}{policy.temperatureUnit} (Limites: {policy.minTemp} - {policy.maxTemp})
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
            'Temperatura Alvo',
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
                  {policy.targetTemp}°C
                </td>
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
      targetTemp: -80,
      hysteresis: 2,
      minimumDuration: 5,
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
          label="Temperatura Alvo"
          type="number"
          step="0.1"
          value={formData.targetTemp || ''}
          onChange={(e) =>
            setFormData({
              ...formData,
              targetTemp: parseFloat(e.target.value),
            })
          }
          helperText="Temperatura ideal que deve ser mantida. Deve estar entre o limite mínimo e máximo."
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
          label="Atraso de Alerta (minutos)"
          type="number"
          value={formData.minimumDuration || ''}
          onChange={(e) =>
            setFormData({
              ...formData,
              minimumDuration: parseInt(e.target.value),
            })
          }
          helperText="Tempo em minutos que a temperatura deve estar fora dos limites antes de gerar um alerta."
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


