import { useState } from 'react';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import Input from '../components/UI/Input';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { SampleWithQualityDescription } from '../types/models';
import { useQualityDescriptions } from '../hooks/useQualityDescriptions';

export default function QualityDescriptionPage() {
  const { qualities, loading, error, createQuality, updateQuality, deleteQuality } = useQualityDescriptions();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingQuality, setEditingQuality] = useState<SampleWithQualityDescription | null>(null);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Descrições de Qualidade</h1>
          <p className="page-subtitle">Gerenciamento de descrições de qualidade de amostras</p>
        </div>
        <Button onClick={() => setIsModalOpen(true)}>
          <Plus size={18} />
          Nova Descrição
        </Button>
      </div>

      {loading && <p>Carregando...</p>}
      {error && <p style={{ color: 'var(--danger)' }}>Erro: {error}</p>}

      <Card>
        <Table headers={['ID', 'Descrição', 'Ações']}>
          {qualities.map((quality) => (
            <tr key={quality.id}>
              <td>{quality.id}</td>
              <td>{quality.description}</td>
              <td>
                <div className="table-actions">
                  <button
                    className="action-button"
                    onClick={() => {
                      setEditingQuality(quality);
                      setIsModalOpen(true);
                    }}
                    title="Editar"
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    className="action-button danger"
                    onClick={async () => {
                      if (confirm('Tem certeza que deseja excluir esta descrição?')) {
                        try {
                          await deleteQuality(quality.id);
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
          setEditingQuality(null);
        }}
        title={editingQuality ? 'Editar Descrição' : 'Nova Descrição'}
      >
        <QualityForm
          quality={editingQuality}
          onSave={async (data) => {
            try {
              if (editingQuality) {
                await updateQuality(editingQuality.id, data);
              } else {
                await createQuality(data);
              }
              setIsModalOpen(false);
              setEditingQuality(null);
            } catch (err: any) {
              alert(err.message);
            }
          }}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingQuality(null);
          }}
        />
      </Modal>
    </div>
  );
}

function QualityForm({
  quality,
  onSave,
  onCancel,
}: {
  quality: SampleWithQualityDescription | null;
  onSave: (data: Partial<SampleWithQualityDescription>) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState<Partial<SampleWithQualityDescription>>(
    quality || {
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

