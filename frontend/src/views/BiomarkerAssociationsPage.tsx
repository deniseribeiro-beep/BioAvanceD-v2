import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import { Plus, Edit } from 'lucide-react';
import { biomarkerAssociationService } from '../services/api';
import { extractResponseItems } from '../api/response.adapters';
import type { BiomarkerAssociation, Coding } from '../types/models';
import { biomarkerAssociationErrorMessages } from './biomarkerAssociationForm';

function codingLabel(coding: Partial<Coding> | null | undefined): string {
  return coding?.display || coding?.code || '-';
}

export default function BiomarkerAssociationsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<BiomarkerAssociation[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await biomarkerAssociationService.getAll();
      setRows(extractResponseItems<BiomarkerAssociation>(response));
    } catch (err: any) {
      setLoadError(biomarkerAssociationErrorMessages(err, 'Erro ao carregar as associações de biomarcadores'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Associações de Biomarcadores</h1>
          <p className="page-subtitle">
            Catálogo de analitos associados a condições ORPHA e às evidências que os sustentam. As sugestões do cadastro integrado usam este catálogo quando o grafo Neo4j não responde.
          </p>
        </div>
        <Button onClick={() => navigate('/biomarker-associations/new')}>
          <Plus size={18} />
          Nova Associação
        </Button>
      </div>

      {loading && <p>Carregando...</p>}
      {loadError && (
        <div style={{ color: 'var(--danger)' }}>
          {loadError.map((message) => (
            <p key={message}>Erro: {message}</p>
          ))}
        </div>
      )}

      <Card>
        {!loading && !loadError && rows.length === 0 ? (
          <div data-testid="biomarker-associations-empty" style={{ padding: '1rem 0' }}>
            <p style={{ margin: 0 }}>Nenhuma associação cadastrada neste ambiente.</p>
            <p style={{ margin: '0.5rem 0 0', color: 'var(--text-light)' }}>
              Use Nova Associação para registrar um analito e suas condições. Sem esse catálogo, o passo clínico do cadastro integrado não sugere biomarcadores pela doença.
            </p>
          </div>
        ) : (
          <Table headers={['biomarkerId', 'Analito', 'Condições', 'Papel', 'Contexto de uso', 'Evidências', 'Ações']}>
            {rows.map((row) => (
              <tr key={row.biomarkerId}>
                <td>{row.biomarkerId}</td>
                <td>{codingLabel(row.analyte)}</td>
                <td>{(row.associatedCondition || []).map((item) => item?.code).join(', ')}</td>
                <td>{row.biomarkerRole}</td>
                <td>{row.contextOfUse}</td>
                <td>{(row.evidenceReferences || []).map((item) => `${item?.system}:${item?.value}`).join(', ')}</td>
                <td>
                  <div className="table-actions">
                    <button
                      className="action-button"
                      onClick={() =>
                        navigate(`/biomarker-associations/${encodeURIComponent(row.biomarkerId)}/edit`, {
                          state: { association: row },
                        })
                      }
                      title="Editar"
                    >
                      <Edit size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
