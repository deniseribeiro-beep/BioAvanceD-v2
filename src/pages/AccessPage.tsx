import { useState } from 'react';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import Input from '../components/UI/Input';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { Access } from '../types/models';
import { useAccess } from '../hooks/useAccess';
import './AccessPage.css';

export default function AccessPage() {
  const { accesses, loading, error, createAccess, updateAccess, deleteAccess } = useAccess();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccess, setEditingAccess] = useState<Access | null>(null);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Controle de Acesso</h1>
          <p className="page-subtitle">Gerenciamento de tipos de acesso e permissões</p>
        </div>
        <Button onClick={() => setIsModalOpen(true)}>
          <Plus size={18} />
          Novo Tipo de Acesso
        </Button>
      </div>

      {loading && <p>Carregando...</p>}
      {error && <p style={{ color: 'var(--danger)' }}>Erro: {error}</p>}

      <Card>
        <Table headers={['ID', 'Tipo de Relatório', 'Ações']}>
          {accesses.map((access) => (
            <tr key={access.reportID}>
              <td>{access.reportID}</td>
              <td>{access.reportType}</td>
              <td>
                <div className="table-actions">
                  <button
                    className="action-button"
                    onClick={() => {
                      setEditingAccess(access);
                      setIsModalOpen(true);
                    }}
                    title="Editar"
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    className="action-button danger"
                    onClick={async () => {
                      if (confirm('Tem certeza que deseja excluir este tipo de acesso?')) {
                        try {
                          await deleteAccess(access.reportID);
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
          setEditingAccess(null);
        }}
        title={editingAccess ? 'Editar Acesso' : 'Novo Tipo de Acesso'}
      >
        <AccessForm
          access={editingAccess}
          onSave={async (data) => {
            try {
              if (editingAccess) {
                await updateAccess(editingAccess.reportID, data);
              } else {
                await createAccess(data);
              }
              setIsModalOpen(false);
              setEditingAccess(null);
            } catch (err: any) {
              alert(err.message);
            }
          }}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingAccess(null);
          }}
        />
      </Modal>
    </div>
  );
}

function AccessForm({
  access,
  onSave,
  onCancel,
}: {
  access: Access | null;
  onSave: (data: Partial<Access>) => void;
  onCancel: () => void;
}) {
  const editingAccess = access !== null;
  
  const [formData, setFormData] = useState<Partial<Access>>(
    access || {
      reportType: '',
    }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.reportType || formData.reportType.trim() === '') {
      alert('Por favor, selecione um tipo de relatório');
      return;
    }
    
    // Validação conforme método do diagrama
    if (!validateAccessType(formData.reportType)) {
      alert('Tipo de acesso inválido');
      return;
    }
    
    // Remove reportID ao criar novo (será gerado no backend)
    const dataToSave = editingAccess 
      ? formData 
      : { reportType: formData.reportType.trim() };
    
    onSave(dataToSave);
  };

  // Implementação do método validateAccessType do diagrama
  const validateAccessType = (description: string): boolean => {
    const validTypes = [
      'Relatório de Pacientes',
      'Relatório de Amostras',
      'Relatório de Temperatura',
      'Relatório de Sensores',
      'Acesso Completo',
    ];
    return validTypes.includes(description) || description.length > 0;
  };

  return (
    <form onSubmit={handleSubmit} className="form">
      <div className="form-grid">
        <div className="form-grid-full">
          <label className="form-label">Tipo de Relatório *</label>
          <select
            value={formData.reportType || ''}
            onChange={(e) =>
              setFormData({ ...formData, reportType: e.target.value })
            }
            required
            className="form-select"
          >
            <option value="">Selecione um tipo...</option>
            <option value="Relatório de Pacientes">Relatório de Pacientes</option>
            <option value="Relatório de Amostras">Relatório de Amostras</option>
            <option value="Relatório de Temperatura">Relatório de Temperatura</option>
            <option value="Relatório de Sensores">Relatório de Sensores</option>
            <option value="Acesso Completo">Acesso Completo</option>
          </select>
        </div>
        {!editingAccess && (
          <div className="form-grid-full">
            <p className="form-help-text">
              ℹ️ O ID será gerado automaticamente pelo sistema
            </p>
          </div>
        )}
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

