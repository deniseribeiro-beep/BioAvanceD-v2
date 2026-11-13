import { useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { SampleWithQualityDescription } from '../types/models';
import { useQualityDescriptions } from '../hooks/useQualityDescriptions';

export default function QualityDescriptionPage() {
  const navigate = useNavigate();
  const { qualities, loading, error, deleteQuality } = useQualityDescriptions();

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Descrições de Qualidade</h1>
          <p className="page-subtitle">Gerenciamento de descrições de qualidade de amostras</p>
        </div>
        <Button onClick={() => navigate('/quality-descriptions/new')}>
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
                    onClick={() =>
                      navigate(`/quality-descriptions/${quality.id}/edit`, { state: { quality } })
                    }
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
    </div>
  );
}
