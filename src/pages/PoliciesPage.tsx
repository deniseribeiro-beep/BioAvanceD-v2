import { useState, useEffect } from 'react';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import Input from '../components/UI/Input';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { Policy } from '../types/models';
import { usePolicies } from '../hooks/usePolicies';
import { validateThresholds } from '../utils/validations';
import './PoliciesPage.css';

export default function PoliciesPage() {
  const { policies, loading, error, getActiveLimit, createPolicy, updatePolicy, deletePolicy } = usePolicies();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null);
  const [activeLimits, setActiveLimits] = useState<Record<number, number>>({});

  // Carrega limites ativos para cada política
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
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Políticas de Temperatura</h1>
          <p className="page-subtitle">
            Configuração de limites e alertas de temperatura
          </p>
        </div>
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
            'ID',
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
              <td>{policy.policyID}</td>
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
            
            // Implementa validateThresholds()
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
    </div>
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
        />
        <div className="form-grid-full">
          <label className="input-label">Unidade de Temperatura</label>
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

