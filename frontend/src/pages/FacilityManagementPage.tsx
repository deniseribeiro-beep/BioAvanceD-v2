import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import Input from '../components/UI/Input';
import { Plus, Edit, Trash2, Radio, AlertCircle, CheckCircle, Box, MapPin, Thermometer, Radio as RadioIcon, Shield } from 'lucide-react';
import { Equipment, Location, Temperature, Sensor, Policy } from '../types/models';
import { useEquipment } from '../hooks/useEquipment';
import { useLocations } from '../hooks/useLocations';
import { useTemperature } from '../hooks/useTemperature';
import { useSensors } from '../hooks/useSensors';
import { usePolicies } from '../hooks/usePolicies';
import { validateReading, validateTemperatureUnit, generateAlert, validateThresholds } from '../utils/validations';
import { CryoBoxGrid } from '../components/CryoBoxGrid';
import './FacilityManagementPage.css';

type TabType = 'equipment' | 'locations' | 'temperature' | 'sensors' | 'policies';

export default function FacilityManagementPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TabType | null;
  const validTabs: TabType[] = ['equipment', 'locations', 'temperature', 'sensors', 'policies'];
  const initialTab = (tabParam && validTabs.includes(tabParam)) ? tabParam : 'equipment';
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  useEffect(() => {
    if (tabParam && validTabs.includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const tabs = [
    { id: 'equipment' as TabType, label: 'Equipamentos', icon: Box },
    { id: 'locations' as TabType, label: 'Localizações', icon: MapPin },
    { id: 'temperature' as TabType, label: 'Controle de Temperatura', icon: Thermometer },
    { id: 'sensors' as TabType, label: 'Sensores', icon: RadioIcon },
    { id: 'policies' as TabType, label: 'Políticas de Temperatura', icon: Shield },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Gerenciamento de Instalações</h1>
          <p className="page-subtitle">Gerenciamento integrado de equipamentos, localizações, temperatura, sensores e políticas</p>
        </div>
      </div>

      <div className="facility-tabs">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
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

      <div className="facility-tab-content">
        {activeTab === 'equipment' && <EquipmentSection />}
        {activeTab === 'locations' && <LocationsSection />}
        {activeTab === 'temperature' && <TemperatureSection />}
        {activeTab === 'sensors' && <SensorsSection />}
        {activeTab === 'policies' && <PoliciesSection />}
      </div>
    </div>
  );
}

// Seção de Equipamentos
function EquipmentSection() {
  const { equipment, loading, error, createEquipment, updateEquipment, deleteEquipment, loadEquipment } = useEquipment();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState<Equipment | null>(null);

  return (
    <>
      <div className="section-header">
        <Button onClick={() => setIsModalOpen(true)}>
          <Plus size={18} />
          Novo Equipamento
        </Button>
      </div>

      {loading && <p>Carregando...</p>}
      {error && <p style={{ color: 'var(--danger)' }}>Erro: {error}</p>}

      <Card>
        <Table headers={['ID', 'Descrição', 'Modelo', 'Número de Série', 'Data da Compra', 'Ações']}>
          {equipment.map((eq) => (
            <tr key={eq.equipmentID}>
              <td>{eq.equipmentID}</td>
              <td>{eq.equipmentDescription}</td>
              <td>{eq.model || '-'}</td>
              <td>{eq.serialNumber || '-'}</td>
              <td>{eq.purchaseDate ? new Date(eq.purchaseDate).toLocaleDateString('pt-BR') : '-'}</td>
              <td>
                <div className="table-actions">
                  <button
                    className="action-button"
                    onClick={() => {
                      // Garante que o objeto tenha _id para edição
                      const equipmentToEdit = { ...eq, _id: (eq as any)._id || undefined };
                      setEditingEquipment(equipmentToEdit);
                      setIsModalOpen(true);
                    }}
                    title="Editar"
                  >
                    <Edit size={16} />
                  </button>
                  <button
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
          ))}
        </Table>
      </Card>

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingEquipment(null);
        }}
        title={editingEquipment ? 'Editar Equipamento' : 'Novo Equipamento'}
      >
        <EquipmentForm
          equipment={editingEquipment}
          onSave={async (data) => {
            try {
              if (editingEquipment) {
                // Prioriza _id (MongoDB ObjectId), senão usa equipmentID
                const equipmentId = (editingEquipment as any)._id 
                  ? String((editingEquipment as any)._id)
                  : String(editingEquipment.equipmentID);
                
                console.log('Atualizando equipamento:', { equipmentId, editingEquipment, data });
                await updateEquipment(equipmentId, data);
              } else {
                await createEquipment(data);
              }
              setIsModalOpen(false);
              setEditingEquipment(null);
              // Recarrega a lista para garantir que está atualizada
              await loadEquipment();
            } catch (err: any) {
              const errorMessage = err.response?.data?.message || err.response?.data?.error || err.message || 'Erro ao salvar equipamento';
              alert(errorMessage);
              console.error('Erro ao salvar equipamento:', err);
            }
          }}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingEquipment(null);
          }}
        />
      </Modal>
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
  const [formData, setFormData] = useState<Partial<Equipment>>(() => {
    if (equipment) {
      return {
        equipmentDescription: equipment.equipmentDescription || '',
        model: equipment.model || '',
        serialNumber: equipment.serialNumber || '',
        purchaseDate: equipment.purchaseDate ? new Date(equipment.purchaseDate) : undefined,
      };
    }
    return {
      equipmentDescription: '',
      model: '',
      serialNumber: '',
      purchaseDate: undefined,
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
      });
    } else {
      setFormData({
        equipmentDescription: '',
        model: '',
        serialNumber: '',
        purchaseDate: undefined,
      });
    }
  }, [equipment]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="form">
      <div className="form-grid">
        <Input
          label="Descrição do Equipamento"
          value={formData.equipmentDescription || ''}
          onChange={(e) =>
            setFormData({ ...formData, equipmentDescription: e.target.value })
          }
          required
        />
        <Input
          label="Modelo"
          value={formData.model || ''}
          onChange={(e) =>
            setFormData({ ...formData, model: e.target.value })
          }
          placeholder="Ex: Freezer -80°C, Refrigerador 4°C"
        />
        <Input
          label="Número de Série"
          value={formData.serialNumber || ''}
          onChange={(e) =>
            setFormData({ ...formData, serialNumber: e.target.value })
          }
          placeholder="Ex: SN123456789"
        />
        <Input
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
      </div>
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit">Salvar</Button>
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

// Seção de Localizações
function LocationsSection() {
  const { equipment } = useEquipment();
  const { locations, loading, error, createLocation, updateLocation, deleteLocation, loadLocations } = useLocations();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);

  // Importação de localizações
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);

  const handleImportLocations = async (file?: File) => {
    const fileToImport = file || importFile;
    if (!fileToImport) {
      alert('Selecione um arquivo para importar.');
      return;
    }
    setImporting(true);
    setImportProgress(`Arquivo: ${fileToImport.name}`);
    // Aqui você pode implementar a chamada real para o backend
    setTimeout(() => {
      setImporting(false);
      setImportProgress('Importação concluída (simulação)');
      setImportFile(null);
    }, 2000);
  };

  return (
    <>
      {/* Botão para abrir modal de importação */}
      <div className="section-header" style={{ display: 'flex', gap: 12 }}>
        <Button onClick={() => setIsModalOpen(true)}>
          <Plus size={18} />
          Nova Localização
        </Button>
        <Button variant="secondary" onClick={() => setShowImportModal(true)}>
          Importar Localizações
        </Button>
      </div>

      {/* Modal de importação de localizações */}
      <Modal isOpen={showImportModal} onClose={() => setShowImportModal(false)} title="Importação de Localizações">
        <div className="import-card-header">
          <h2 style={{ marginTop: 0 }}>Importação de Localizações</h2>
          <p>Importe localizações em lote via CSV ou Excel. Siga o template para garantir o formato correto.</p>
        </div>
        <div className="import-actions" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <Button variant="secondary" onClick={() => {
            const url = '/import-templates/locations-template.csv';
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'locations-template.csv');
            document.body.appendChild(link);
            link.click();
            link.remove();
          }}>Baixar Template CSV</Button>
          <Button variant="secondary" onClick={() => {
            const url = '/import-templates/locations-template.xlsx';
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'locations-template.xlsx');
            document.body.appendChild(link);
            link.click();
            link.remove();
          }}>Baixar Template Excel</Button>
        </div>
        <div className="import-upload" style={{ border: '1px dashed #ccc', padding: 16, borderRadius: 8, marginBottom: 16 }}>
          <input type="file" accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e => {
            const file = e.target.files?.[0];
            if (file) {
              setImportFile(file);
              setImportProgress('');
              setTimeout(() => handleImportLocations(file), 100);
            }
          }} />
          <p style={{ fontSize: 12, color: '#666' }}>Selecione um arquivo CSV ou Excel conforme o template.</p>
        </div>
        {importing && <p>Importando localizações...</p>}
        {importProgress && <p style={{ color: '#166534' }}>{importProgress}</p>}
      </Modal>

      <div className="section-header">
        <Button onClick={() => setIsModalOpen(true)}>
          <Plus size={18} />
          Nova Localização
        </Button>
      </div>

      {loading && <p>Carregando...</p>}
      {error && <p style={{ color: 'var(--danger)' }}>Erro: {error}</p>}

      <Card>
        <Table
          headers={[
            'Tipo Equipamento',
            'Equipamento',
            'Bloco',
            'Prateleira',
            'Gaveta',
            'Caixa',
            'Poço Eppendorf',
            'Ações',
          ]}
        >
          {locations.map((location, index) => (
            <tr key={(location as any)._id || index}>
              <td>{getEquipmentTypeDescription(location.equipmentType)}</td>
              <td>
                {location.equipmentID
                  ? (() => {
                      const eq = equipment.find((e) => e.equipmentID === location.equipmentID);
                      if (eq) {
                        return (
                          <div>
                            <strong>ID {eq.equipmentID}</strong> - {eq.equipmentDescription}
                            {eq.model && <div style={{ fontSize: '0.875rem', color: 'var(--text-light)' }}>Modelo: {eq.model}</div>}
                          </div>
                        );
                      }
                      return 'N/A';
                    })()
                  : <span style={{ color: 'var(--text-light)', fontStyle: 'italic' }}>Não vinculado</span>}
              </td>
              <td>{location.block}</td>
              <td>{location.rack}</td>
              <td>{location.drawer}</td>
              <td>{location.box}</td>
              <td>{location.wellPosition || location.eppendorfWell || '-'}</td>
              <td>
                <div className="table-actions">
                  <button
                    className="action-button"
                    onClick={() => {
                      setEditingLocation(location);
                      setIsModalOpen(true);
                    }}
                    title="Editar"
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    className="action-button danger"
                    onClick={async () => {
                      if (confirm('Tem certeza que deseja excluir esta localização?')) {
                        try {
                          const locationId = (location as any)._id || index.toString();
                          await deleteLocation(locationId);
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
          ))}
        </Table>
      </Card>

      {/* Visualizador de Caixa 9x9 (UI-only, sem lógica de negócio) */}
      <Card title="Visualizador de Caixa (9x9)">
        <CryoBoxGrid occupiedPositions={[]} selectedPosition={null} onSelect={() => {}} />
      </Card>

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingLocation(null);
        }}
        title={editingLocation ? 'Editar Localização' : 'Nova Localização'}
      >
        <LocationForm
          location={editingLocation}
          equipment={equipment}
          onSave={async (data) => {
            try {
              if (editingLocation) {
                const locationId = (editingLocation as any)._id || '';
                await updateLocation(locationId, data);
              } else {
                await createLocation(data);
              }
              setIsModalOpen(false);
              setEditingLocation(null);
              await loadLocations();
            } catch (err: any) {
              alert(err.message);
            }
          }}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingLocation(null);
          }}
        />
      </Modal>
    </>
  );
}

function LocationForm({
  location,
  equipment,
  onSave,
  onCancel,
}: {
  location: Location | null;
  equipment: Equipment[];
  onSave: (data: Partial<Location>) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState<Partial<Location>>(() => {
    if (location) {
      return {
        equipmentType: location.equipmentType || 1,
        equipmentID: location.equipmentID,
        block: location.block || 1,
        rack: location.rack || 1,
        drawer: location.drawer || 1,
        box: location.box || 1,
        eppendorfWell: location.wellPosition || location.eppendorfWell || '',
      };
    }
    return {
      equipmentType: 1,
      equipmentID: undefined,
      block: 1,
      rack: 1,
      drawer: 1,
      box: 1,
      eppendorfWell: 'A1',
    };
  });

  // Atualiza o formData quando location muda (para edição)
  useEffect(() => {
    if (location) {
      setFormData({
        equipmentType: location.equipmentType || 1,
        equipmentID: location.equipmentID,
        block: location.block || 1,
        rack: location.rack || 1,
        drawer: location.drawer || 1,
        box: location.box || 1,
        eppendorfWell: location.wellPosition || location.eppendorfWell || '',
      });
    } else {
      setFormData({
        equipmentType: 1,
        equipmentID: undefined,
        block: 1,
        rack: 1,
        drawer: 1,
        box: 1,
        eppendorfWell: 'A1',
      });
    }
  }, [location]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Prepara os dados para envio, convertendo tipos e campos
    const dataToSave: any = {
      equipmentType: formData.equipmentType ? Number(formData.equipmentType) : null,
      equipmentID: formData.equipmentID ? Number(formData.equipmentID) : undefined,
      block: formData.block ? Number(formData.block) : null,
      rack: formData.rack ? Number(formData.rack) : null,
      drawer: formData.drawer ? Number(formData.drawer) : null,
      box: formData.box ? Number(formData.box) : null,
    };
    
    // Converte eppendorfWell (string) para wellPosition (string)
    if (formData.eppendorfWell) {
      dataToSave.wellPosition = String(formData.eppendorfWell);
      // Remove eppendorfWell para evitar conflito
      delete dataToSave.eppendorfWell;
    }
    
    onSave(dataToSave);
  };

  return (
    <form onSubmit={handleSubmit} className="form">
      <div className="form-grid">
        <div className="form-grid-full">
          <label className="input-label">Tipo de Equipamento *</label>
          <select
            className="input"
            value={formData.equipmentType || ''}
            onChange={(e) =>
              setFormData({ ...formData, equipmentType: parseInt(e.target.value) })
            }
            required
          >
            <option value="">Selecione um tipo de equipamento</option>
            <option value="1">1 - Freezer -80°C #1</option>
            <option value="2">2 - Freezer -80°C #2</option>
            <option value="3">3 - Freezer -20°C</option>
            <option value="4">4 - Refrigerador 4°C</option>
            <option value="5">5 - Nitrogênio Líquido</option>
          </select>
        </div>
        <div className="form-grid-full">
          <label className="input-label">Equipamento Cadastrado no Sistema *</label>
          <select
            className="input"
            value={formData.equipmentID || ''}
            onChange={(e) =>
              setFormData({
                ...formData,
                equipmentID: e.target.value ? parseInt(e.target.value) : undefined,
              })
            }
            required
          >
            <option value="">Selecione um equipamento cadastrado</option>
            {equipment.map((eq) => (
              <option key={eq.equipmentID} value={eq.equipmentID}>
                ID {eq.equipmentID} - {eq.equipmentDescription}
                {eq.model ? ` | Modelo: ${eq.model}` : ''}
                {eq.serialNumber ? ` | S/N: ${eq.serialNumber}` : ''}
              </option>
            ))}
          </select>
          <p className="form-help-text" style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: 'var(--text-light)' }}>
            Selecione o equipamento físico cadastrado no sistema que será associado a esta localização
          </p>
        </div>
        <Input
          label="Bloco"
          type="number"
          value={formData.block || ''}
          onChange={(e) =>
            setFormData({ ...formData, block: parseInt(e.target.value) })
          }
          required
        />
        <Input
          label="Prateleira"
          type="number"
          value={formData.rack || ''}
          onChange={(e) =>
            setFormData({ ...formData, rack: parseInt(e.target.value) })
          }
          required
        />
        <Input
          label="Gaveta"
          type="number"
          value={formData.drawer || ''}
          onChange={(e) =>
            setFormData({ ...formData, drawer: parseInt(e.target.value) })
          }
          required
        />
        <Input
          label="Caixa"
          type="number"
          value={formData.box || ''}
          onChange={(e) =>
            setFormData({ ...formData, box: parseInt(e.target.value) })
          }
          required
        />
        <Input
          label="Poço Eppendorf (ex: A1)"
          value={formData.eppendorfWell || ''}
          onChange={(e) =>
            setFormData({ ...formData, eppendorfWell: e.target.value })
          }
          required
        />
      </div>
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit">Salvar</Button>
      </div>
    </form>
  );
}

// Seção de Controle de Temperatura
function TemperatureSection() {
  // TEMPORARIAMENTE DESATIVADO: Não há sensores cadastrados ainda
  const TEMPERATURE_READING_DISABLED = true;
  
  const { temperatures, loading, error, viewControl } = useTemperature();
  const { policies } = usePolicies();

  useEffect(() => {
    if (!TEMPERATURE_READING_DISABLED) {
      viewControl().catch(console.error);

      temperatures.forEach((temp) => {
        if (!validateReading(temp)) {
          console.warn(`Leitura inválida: ${temp.logID}`);
        }
        if (temp.temperatureUnit && !validateTemperatureUnit(temp.temperatureUnit)) {
          console.warn(`Unidade inválida: ${temp.temperatureUnit}`);
        }
        if (temp.policyID) {
          const policy = policies.find((p) => {
            const policyIDStr = String(p.policyID);
            const tempPolicyIDStr = String(temp.policyID);
            return policyIDStr === tempPolicyIDStr;
          });
          if (policy) {
            generateAlert(temp, policy);
          }
        }
      });
    }
  }, [temperatures, policies, viewControl]);

  const getStatusIcon = (temp: Temperature) => {
    if (temp.readingStatus === 'valid' && temp.dataQualityScore && temp.dataQualityScore > 0.9) {
      return <CheckCircle size={18} className="status-icon valid" />;
    }
    return <AlertCircle size={18} className="status-icon alert" />;
  };

  if (TEMPERATURE_READING_DISABLED) {
    return (
      <>
        <Card>
          <div style={{ 
            padding: '2rem', 
            textAlign: 'center',
            backgroundColor: '#fff3cd',
            border: '1px solid #ffc107',
            borderRadius: '8px'
          }}>
            <AlertCircle size={48} style={{ color: '#856404', marginBottom: '1rem' }} />
            <h3 style={{ color: '#856404', marginBottom: '0.5rem' }}>Funcionalidade Temporariamente Desativada</h3>
            <p style={{ color: '#856404', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
              A leitura de temperatura está desativada temporariamente porque não há sensores cadastrados no sistema.
            </p>
            <p style={{ color: '#856404', fontSize: '0.75rem' }}>
              Para ativar esta funcionalidade, cadastre sensores na aba <strong>"Sensores"</strong> acima.
            </p>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      {loading && <p>Carregando...</p>}
      {error && <p style={{ color: 'var(--danger)' }}>Erro: {error}</p>}

      <div className="temperature-grid">
        <Card title="Últimas Leituras">
          <Table
            headers={[
              'Timestamp',
              'Sensor',
              'Temperatura',
              'Status',
              'Qualidade',
            ]}
          >
            {temperatures.map((temp) => {
              let sensorDisplay = 'N/A';
              if (temp.sensorID) {
                if (typeof temp.sensorID === 'object' && temp.sensorID !== null) {
                  const sensorObj = temp.sensorID as any;
                  sensorDisplay = sensorObj.sensorID || sensorObj.sensorType || 'N/A';
                } else {
                  sensorDisplay = String(temp.sensorID);
                }
              }
              
              return (
                <tr key={temp.logID}>
                  <td>{new Date(temp.timestamp || '').toLocaleString('pt-BR')}</td>
                  <td>{sensorDisplay}</td>
                  <td>
                    <span className="temperature-value">
                      {temp.temperatureValue} {temp.temperatureUnit}
                    </span>
                  </td>
                  <td>
                    <div className="status-cell">
                      {getStatusIcon(temp)}
                      <span>{temp.readingStatus}</span>
                    </div>
                  </td>
                  <td>
                    <div className="quality-score">
                      {temp.dataQualityScore ? (temp.dataQualityScore * 100).toFixed(0) : 'N/A'}%
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>

        <Card title="Alertas">
          <div className="alerts-list">
            {temperatures.filter((t) => t.readingStatus !== 'valid').length === 0 ? (
              <p className="empty-state">Nenhum alerta no momento</p>
            ) : (
              temperatures
                .filter((t) => t.readingStatus !== 'valid')
                .map((temp) => {
                  let sensorDisplay = 'N/A';
                  if (temp.sensorID) {
                    if (typeof temp.sensorID === 'object' && temp.sensorID !== null) {
                      const sensorObj = temp.sensorID as any;
                      sensorDisplay = sensorObj.sensorID || sensorObj.sensorType || 'N/A';
                    } else {
                      sensorDisplay = String(temp.sensorID);
                    }
                  }
                  
                  return (
                    <div key={temp.logID} className="alert-item">
                      <AlertCircle size={20} className="alert-icon" />
                      <div>
                        <p className="alert-message">
                          {temp.errorMessage || 'Temperatura fora do limite'}
                        </p>
                        <p className="alert-sensor">Sensor: {sensorDisplay}</p>
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

// Seção de Sensores
function SensorsSection() {
  const { sensors, loading, error, collectReading, createSensor, updateSensor, deleteSensor } = useSensors();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSensor, setEditingSensor] = useState<Sensor | null>(null);

  return (
    <>
      <div className="section-header">
        <Button onClick={() => setIsModalOpen(true)}>
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
          {Array.isArray(sensors) && sensors.length > 0 ? (
            sensors.map((sensor) => {
              const sensorId = (sensor as any).sensorID || (sensor as any).sensorId || sensor._id || 'N/A';
              return (
            <tr key={sensorId}>
              <td>{sensorId}</td>
              <td>{sensor.sensorType}</td>
              <td>{sensor.sensorModel}</td>
              <td>
                <span className={`status-badge status-${(sensor.maintenanceStatus || 'Operacional').toLowerCase().replace(' ', '-')}`}>
                  {sensor.maintenanceStatus || 'Operacional'}
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
                    onClick={async () => {
                      try {
                        const reading = await collectReading(sensorId);
                        const quality = reading.dataQualityScore ? (reading.dataQualityScore * 100).toFixed(0) : 'N/A';
                        alert(
                          `Leitura coletada: ${reading.temperatureValue}${reading.temperatureUnit || ''}\nStatus: ${reading.readingStatus}\nQualidade: ${quality}%`
                        );
                      } catch (err: any) {
                        alert(err.message);
                      }
                    }}
                    title="Coletar Leitura (Desativado - não há sensores cadastrados)"
                    disabled={true}
                    style={{ opacity: 0.5, cursor: 'not-allowed' }}
                  >
                    <Radio size={16} />
                  </button>
                  <button
                    className="action-button"
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
  const { locations } = useLocations();
  const { policies } = usePolicies();
  
  const [formData, setFormData] = useState<Partial<Sensor>>(
    sensor || {
      sensorType: '',
      sensorModel: '',
      maintenanceStatus: 'Operacional',
      lastCalibration: null,
      nextCalibration: null,
      calibrationCertificate: '',
      locationID: undefined,
      policyID: undefined,
    }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="form">
      <div className="form-grid">
        <Input
          label="Tipo de Sensor"
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
          <label className="input-label">Status de Manutenção</label>
          <select
            className="input"
            value={formData.maintenanceStatus || 'Operacional'}
            onChange={(e) =>
              setFormData({ ...formData, maintenanceStatus: e.target.value })
            }
          >
            <option value="Operacional">Operacional</option>
            <option value="Em Manutenção">Em Manutenção</option>
            <option value="Fora de Serviço">Fora de Serviço</option>
            <option value="Calibração Pendente">Calibração Pendente</option>
            <option value="Aguardando Reparo">Aguardando Reparo</option>
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
          <label className="input-label">Localização</label>
          <select
            className="input"
            value={formData.locationID || ''}
            onChange={(e) =>
              setFormData({
                ...formData,
                locationID: e.target.value ? parseInt(e.target.value) : undefined,
              })
            }
          >
            {locations.map((location) => {
            const locationId = (location as any)._id || location.locationID;
            const valueId = location.locationID || locationId; // garante valor único
            const wellInfo = location.wellPosition || location.eppendorfWell || 'N/A';
  
           return (
             <option key={String(locationId)} value={String(valueId)}>
                Bloco {location.block}, Prateleira {location.rack}, Gaveta {location.drawer}, Caixa {location.box}
               {wellInfo !== 'N/A' ? `, Poço ${wellInfo}` : ''}
             </option>
         );
        })}

          </select>
        </div>
        <div className="form-grid-full">
          <label className="input-label">Política de Temperatura</label>
          <select
            className="input"
            value={formData.policyID || ''}
            onChange={(e) =>
              setFormData({
                ...formData,
                policyID: e.target.value ? parseInt(e.target.value) : undefined,
              })
            }
          >
            <option value="">Selecione uma política</option>
            {policies.map((policy) => (
              <option key={policy.policyID} value={policy.policyID}>
                Política #{policy.policyID} - {policy.targetTemperature}{policy.temperatureUnit} (Limites: {policy.minThreshold} - {policy.maxThreshold})
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit">Salvar</Button>
      </div>
    </form>
  );
}

// Seção de Políticas
function PoliciesSection() {
  const { policies, loading, error, getActiveLimit, createPolicy, updatePolicy, deletePolicy } = usePolicies();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null);
  const [activeLimits, setActiveLimits] = useState<Record<number, number>>({});

  useEffect(() => {
    policies.forEach(async (policy) => {
      try {
        const limit = await getActiveLimit(policy.policyID, true);
        setActiveLimits((prev) => ({ ...prev, [policy.policyID]: limit.limit }));
      } catch (err) {
        console.error(err);
      }
    });
  }, [policies, getActiveLimit]);

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
            'Temperatura Alvo',
            'Limite Mínimo',
            'Limite Máximo',
            'Histerese',
            'Válido De',
            'Válido Até',
            'Ações',
          ]}
        >
          {policies.map((policy) => (
            <tr key={policy.policyID}>
              <td>
                {policy.targetTemperature} {policy.temperatureUnit}
              </td>
              <td>
                {policy.minThreshold} {policy.temperatureUnit}
              </td>
              <td>
                {policy.maxThreshold} {policy.temperatureUnit}
                <br />
                <small style={{ color: 'var(--text-light)' }}>
                  Limite ativo: {activeLimits[policy.policyID]?.toFixed(1) || 'N/A'} {policy.temperatureUnit}
                </small>
              </td>
              <td>{policy.hysteresis}</td>
              <td>{new Date(policy.validFrom).toLocaleDateString('pt-BR')}</td>
              <td>{new Date(policy.validTo).toLocaleDateString('pt-BR')}</td>
              <td>
                <div className="table-actions">
                  <button
                    className="action-button"
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
                    onClick={async () => {
                      if (confirm('Tem certeza que deseja excluir esta política?')) {
                        try {
                          await deletePolicy(policy.policyID);
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
          ))}
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
                await updatePolicy(editingPolicy.policyID, data);
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
      minThreshold: -85,
      maxThreshold: -75,
      targetTemperature: -80,
      hysteresis: 2,
      alertDelayMin: 5,
      temperatureUnit: '°C',
      validFrom: new Date(),
      validTo: new Date(),
    }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="form">
      <div className="form-grid">
        <Input
          label="Temperatura Alvo"
          type="number"
          step="0.1"
          value={formData.targetTemperature || ''}
          onChange={(e) =>
            setFormData({
              ...formData,
              targetTemperature: parseFloat(e.target.value),
            })
          }
          helperText="Temperatura ideal que deve ser mantida. Deve estar entre o limite mínimo e máximo."
          required
        />
        <Input
          label="Limite Mínimo"
          type="number"
          step="0.1"
          value={formData.minThreshold || ''}
          onChange={(e) =>
            setFormData({
              ...formData,
              minThreshold: parseFloat(e.target.value),
            })
          }
          helperText="Temperatura mínima permitida. Deve ser menor que a temperatura alvo."
          required
        />
        <Input
          label="Limite Máximo"
          type="number"
          step="0.1"
          value={formData.maxThreshold || ''}
          onChange={(e) =>
            setFormData({
              ...formData,
              maxThreshold: parseFloat(e.target.value),
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
          value={formData.alertDelayMin || ''}
          onChange={(e) =>
            setFormData({
              ...formData,
              alertDelayMin: parseInt(e.target.value),
            })
          }
          helperText="Tempo em minutos que a temperatura deve estar fora dos limites antes de gerar um alerta."
        />
        <div className="form-grid-full">
          <label className="input-label">Unidade de Temperatura *</label>
          <select
            className="input"
            value={formData.temperatureUnit || '°C'}
            onChange={(e) =>
              setFormData({ ...formData, temperatureUnit: e.target.value })
            }
          >
            <option value="°C">Celsius (°C)</option>
            <option value="°F">Fahrenheit (°F)</option>
            <option value="K">Kelvin (K)</option>
          </select>
          <p className="form-help-text" style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: 'var(--text-light)' }}>
            Selecione a unidade de medida para todas as temperaturas desta política.
          </p>
        </div>
        <Input
          label="Válido De"
          type="date"
          value={
            formData.validFrom
              ? new Date(formData.validFrom).toISOString().split('T')[0]
              : ''
          }
          onChange={(e) =>
            setFormData({
              ...formData,
              validFrom: new Date(e.target.value),
            })
          }
          helperText="Data de início da vigência desta política. Deve ser anterior à data de término."
          required
        />
        <Input
          label="Válido Até"
          type="date"
          value={
            formData.validTo
              ? new Date(formData.validTo).toISOString().split('T')[0]
              : ''
          }
          onChange={(e) =>
            setFormData({
              ...formData,
              validTo: new Date(e.target.value),
            })
          }
          helperText="Data de término da vigência desta política. Deve ser posterior à data de início."
          required
        />
      </div>
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit">Salvar</Button>
      </div>
    </form>
  );
}

