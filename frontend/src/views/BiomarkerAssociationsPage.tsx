import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import ListPagination from '../components/UI/ListPagination';
import { Plus, Edit } from 'lucide-react';
import { biomarkerAssociationService } from '../services/api';
import { extractResponseItems } from '../api/response.adapters';
import type { BiomarkerAssociation, Coding } from '../types/models';
import { biomarkerAssociationErrorMessages } from './biomarkerAssociationForm';
import { LIST_PAGE_SIZE, useClientPagination } from '../hooks/useClientPagination';

function codingLabel(coding: Partial<Coding> | null | undefined): string {
  return coding?.display || coding?.code || '-';
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

/** Match biomarkerId, analyte code/display, or associatedCondition code/display. */
export function matchesBiomarkerAssociationSearch(
  row: BiomarkerAssociation,
  rawQuery: string,
): boolean {
  const query = normalizeSearch(rawQuery);
  if (!query) return true;
  const haystack = [
    row.biomarkerId,
    row.analyte?.code,
    row.analyte?.display,
    row.biomarkerRole,
    ...(row.associatedCondition || []).flatMap((item) => [item?.code, item?.display]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

export default function BiomarkerAssociationsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<BiomarkerAssociation[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const trimmed = String(q || '').trim();
      const response = await biomarkerAssociationService.getAll(
        trimmed.length >= 2
          ? { q: trimmed, limit: 500 }
          : { limit: 500 },
      );
      const items = extractResponseItems<BiomarkerAssociation>(response);
      setRows(items);
    } catch (err: any) {
      setLoadError(biomarkerAssociationErrorMessages(err, 'Erro ao carregar as associações de biomarcadores'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) return undefined;
    const handle = window.setTimeout(() => {
      void load(trimmed);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchQuery, load]);

  const filteredRows = useMemo(
    () => rows.filter((row) => matchesBiomarkerAssociationSearch(row, searchQuery)),
    [rows, searchQuery],
  );

  const pagination = useClientPagination(filteredRows, LIST_PAGE_SIZE);

  useEffect(() => {
    pagination.setCurrentPage(1);
    // Reset only when the search text changes, not on every pagination identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: searchQuery only
  }, [searchQuery]);

  const showEmptyCatalog = !loading && !loadError && rows.length === 0;
  const showNoMatches = !loading && !loadError && rows.length > 0 && filteredRows.length === 0;

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
        {!showEmptyCatalog && !loadError && (
          <div style={{ marginBottom: '1rem', maxWidth: '28rem' }}>
            <Input
              label="Buscar"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Analito, condição ORPHA ou biomarkerId"
              data-testid="biomarker-associations-search"
              aria-label="Buscar por analito ou condições"
            />
          </div>
        )}

        {showEmptyCatalog ? (
          <div data-testid="biomarker-associations-empty" style={{ padding: '1rem 0' }}>
            <p style={{ margin: 0 }}>Nenhuma associação cadastrada neste ambiente.</p>
            <p style={{ margin: '0.5rem 0 0', color: 'var(--text-light)' }}>
              Em produção, rode o import oficial{' '}
              <code>npm run reference:import:biomarker-associations</code> (SRC_MARKERDB). Use{' '}
              <strong>Nova Associação</strong> só para exceção institucional. Sem esse catálogo, o passo
              clínico do cadastro integrado não sugere biomarcadores pela doença.
            </p>
          </div>
        ) : showNoMatches ? (
          <div data-testid="biomarker-associations-no-matches" style={{ padding: '1rem 0' }}>
            <p style={{ margin: 0 }}>Nenhuma associação corresponde à busca.</p>
          </div>
        ) : (
          !loading && (
            <>
              <Table headers={['biomarkerId', 'Analito', 'Condições', 'Papel', 'Contexto de uso', 'Evidências', 'Ações']}>
                {pagination.pagedItems.map((row) => (
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
              <ListPagination
                currentPage={pagination.currentPage}
                totalPages={pagination.totalPages}
                pageStart={pagination.pageStart}
                pageEnd={pagination.pageEnd}
                total={pagination.total}
                onPageChange={pagination.setCurrentPage}
                testIdPrefix="biomarker-associations-pagination"
                emptyLabel="Nenhuma associação exibida"
              />
            </>
          )
        )}
      </Card>
    </div>
  );
}
