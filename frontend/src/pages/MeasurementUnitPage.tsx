import { useState } from 'react';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import Input from '../components/UI/Input';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { SampleWithMeasurementUnit } from '../types/models';
import { useMeasurementUnits } from '../hooks/useMeasurementUnits';
import './MeasurementUnitPage.css';

export default function MeasurementUnitPage() {
  const { units, loading, error, createUnit, updateUnit, deleteUnit } = useMeasurementUnits();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<SampleWithMeasurementUnit | null>(null);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Unidades de Medida</h1>
          <p className="page-subtitle">Gerenciamento de unidades de medida para amostras</p>
        </div>
        <Button onClick={() => setIsModalOpen(true)}>
          <Plus size={18} />
          Nova Unidade
        </Button>
      </div>

      {loading && <p>Carregando...</p>}
      {error && <p style={{ color: 'var(--danger)' }}>Erro: {error}</p>}

      <Card>
        <Table headers={['ID', 'Descrição', 'Ações']}>
          {units.map((unit) => (
            <tr key={unit.unitID}>
              <td>{unit.unitID}</td>
              <td>{unit.description}</td>
              <td>
                <div className="table-actions">
                  <button
                    className="action-button"
                    onClick={() => {
                      setEditingUnit(unit);
                      setIsModalOpen(true);
                    }}
                    title="Editar"
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    className="action-button danger"
                    onClick={async () => {
                      if (confirm('Tem certeza que deseja excluir esta unidade?')) {
                        try {
                          await deleteUnit(unit.unitID);
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
          setEditingUnit(null);
        }}
        title={editingUnit ? 'Editar Unidade' : 'Nova Unidade'}
      >
        <UnitForm
          unit={editingUnit}
          onSave={async (data) => {
            try {
              if (editingUnit) {
                await updateUnit(editingUnit.unitID, data);
              } else {
                await createUnit(data);
              }
              setIsModalOpen(false);
              setEditingUnit(null);
            } catch (err: any) {
              alert(err.message);
            }
          }}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingUnit(null);
          }}
        />
      </Modal>
    </div>
  );
}

function UnitForm({
  unit,
  onSave,
  onCancel,
}: {
  unit: SampleWithMeasurementUnit | null;
  onSave: (data: Partial<SampleWithMeasurementUnit>) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState<Partial<SampleWithMeasurementUnit>>(
    unit || {
      description: '',
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
          label="Descrição"
          value={formData.description || ''}
          onChange={(e) =>
            setFormData({ ...formData, description: e.target.value })
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

