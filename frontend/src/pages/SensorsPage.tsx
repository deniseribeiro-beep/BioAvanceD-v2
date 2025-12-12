import { useState } from 'react';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import Input from '../components/UI/Input';
import { Plus, Edit, Trash2, Radio } from 'lucide-react';
import { Sensor } from '../types/models';
import { useSensors } from '../hooks/useSensors';
import { useLocations } from '../hooks/useLocations';
import { usePolicies } from '../hooks/usePolicies';
import './SensorsPage.css';

export default function SensorsPage() {
  const { sensors, loading, error, collectReading, createSensor, updateSensor, deleteSensor } = useSensors();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSensor, setEditingSensor] = useState<Sensor | null>(null);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Sensores</h1>
          <p className="page-subtitle">Gerenciamento de sensores de temperatura</p>
        </div>
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
          {sensors.map((sensor) => (
            <tr key={sensor.sensorID}>
              <td>{sensor.sensorID}</td>
              <td>{sensor.sensorType}</td>
              <td>{sensor.sensorModel}</td>
              <td>
                <span className={`status-badge status-${sensor.maintenanceStatus.toLowerCase()}`}>
                  {sensor.maintenanceStatus}
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
                        // Implementa Sensor.collectReading(): TemperatureLog
                        const reading = await collectReading(sensor.sensorID);
                        alert(
                          `Leitura coletada: ${reading.temperatureValue}${reading.temperatureUnit}\nStatus: ${reading.readingStatus}\nQualidade: ${(reading.dataQualityScore * 100).toFixed(0)}%`
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
                          await deleteSensor(sensor.sensorID);
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
          setEditingSensor(null);
        }}
        title={editingSensor ? 'Editar Sensor' : 'Novo Sensor'}
      >
        <SensorForm
          sensor={editingSensor}
          onSave={async (data) => {
            try {
              if (editingSensor) {
                await updateSensor(editingSensor.sensorID, data);
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
    </div>
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
            <option value="">Selecione uma localização</option>
            {locations.map((location) => {
              const locationId = location.locationID || (location as any)._id;
              return (
                <option key={locationId} value={location.locationID || ''}>
                  Bloco {location.block}, Prateleira {location.rack}, Gaveta {location.drawer}, Caixa {location.box}, Poço {location.eppendorfWell}
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

