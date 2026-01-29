import { useState } from 'react';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import Input from '../components/UI/Input';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { Location, Equipment } from '../types/models';
import { useLocations } from '../hooks/useLocations';
import { useEquipment } from '../hooks/useEquipment';
import './LocationPage.css';

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

export default function LocationPage() {
  const { equipment } = useEquipment();
  const { locations, loading, error, createLocation, updateLocation, deleteLocation } = useLocations();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);

  // Importação de localizações
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');

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
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Localizações</h1>
          <p className="page-subtitle">Gerenciamento de localizações físicas de amostras</p>
        </div>
        <Button onClick={() => setIsModalOpen(true)}>
          <Plus size={18} />
          Nova Localização
        </Button>
      </div>

      {/* Seção de importação de localizações */}
      <Card className="import-card" style={{ marginBottom: 24 }}>
        <div className="import-card-header">
          <h2>Importação de Localizações</h2>
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
      </Card>

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
              <td>{location.equipmentType}</td>
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
                          // Assumindo que Location tem _id do MongoDB
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
    </div>
  );
}

function LocationForm({
  location,
  onSave,
  onCancel,
}: {
  location: Location | null;
  onSave: (data: Partial<Location>) => void;
  onCancel: () => void;
}) {
  const [equipment] = useState<Equipment[]>([
    {
      equipmentID: 1,
      equipmentDescription: 'Freezer -80°C',
    },
    {
      equipmentID: 2,
      equipmentDescription: 'Refrigerador 4°C',
    },
  ]);

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

