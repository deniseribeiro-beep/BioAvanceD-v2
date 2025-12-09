import { useState } from 'react';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import Input from '../components/UI/Input';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { Equipment } from '../types/models';
import { useEquipment } from '../hooks/useEquipment';
import './EquipmentPage.css';

export default function EquipmentPage() {
  const { equipment, loading, error, createEquipment, updateEquipment, deleteEquipment } = useEquipment();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState<Equipment | null>(null);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Equipamentos</h1>
          <p className="page-subtitle">Gerenciamento de equipamentos de armazenamento</p>
        </div>
        <Button onClick={() => setIsModalOpen(true)}>
          <Plus size={18} />
          Novo Equipamento
        </Button>
      </div>

      {loading && <p>Carregando...</p>}
      {error && <p style={{ color: 'var(--danger)' }}>Erro: {error}</p>}

      <Card>
        <Table headers={['ID', 'Descrição', 'Ações']}>
          {equipment.map((eq) => (
            <tr key={eq.equipmentID}>
              <td>{eq.equipmentID}</td>
              <td>{eq.equipmentDescription}</td>
              <td>
                <div className="table-actions">
                  <button
                    className="action-button"
                    onClick={() => {
                      setEditingEquipment(eq);
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
                          await deleteEquipment(eq.equipmentID);
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
          setEditingEquipment(null);
        }}
        title={editingEquipment ? 'Editar Equipamento' : 'Novo Equipamento'}
      >
        <EquipmentForm
          equipment={editingEquipment}
          onSave={async (data) => {
            try {
              if (editingEquipment) {
                await updateEquipment(editingEquipment.equipmentID, data);
              } else {
                await createEquipment(data);
              }
              setIsModalOpen(false);
              setEditingEquipment(null);
            } catch (err: any) {
              alert(err.message);
            }
          }}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingEquipment(null);
          }}
        />
      </Modal>
    </div>
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
  const [formData, setFormData] = useState<Partial<Equipment>>(
    equipment || {
      equipmentDescription: '',
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
          label="Descrição do Equipamento"
          value={formData.equipmentDescription || ''}
          onChange={(e) =>
            setFormData({ ...formData, equipmentDescription: e.target.value })
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

