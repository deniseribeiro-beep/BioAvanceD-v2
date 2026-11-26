/**
 * Quarentena de importação LGPD (#794 item 2, RNF011 AC#4 — "Importações
 * inválidas são colocadas em staging ou quarentena, sem correção silenciosa").
 *
 * #787 fez as linhas rejeitadas sobreviverem; o slice 1 do #794 tornou um lote
 * legível pela API. Faltava o operador conseguir chegar até ele: o
 * `stagingBatchId` volta na resposta da importação, mas a importação LGPD não
 * tem nenhum consumidor no frontend (#808), então esse id nunca chegou a uma
 * tela. Esta página é o ponto de entrada — lista os lotes e abre as linhas
 * rejeitadas com os erros que as rejeitaram.
 *
 * #1352: uma linha de um lote de amostras ainda em ERROR pode ser corrigida e
 * reenviada daqui. O reenvio roda pelo mesmo caminho da importação; uma
 * correção ainda errada é recusada com os novos erros, e o registro guarda a
 * tentativa.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileWarning, RefreshCw, FileCheck2, FileX2 } from 'lucide-react';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import ListPagination from '../components/UI/ListPagination';
import { importLGPDService } from '../services/api';
import { LIST_PAGE_SIZE, useClientPagination } from '../hooks/useClientPagination';
import {
  formatBatchSummary,
  formatRecordErrors,
  describeRowFields,
  canResubmit,
  toEditableRow,
  resubmitErrorMessages,
  type QuarantineBatch,
  type QuarantineRecord,
} from './importQuarantineFormatters';

const cellStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'left',
  verticalAlign: 'top',
};

const headStyle: React.CSSProperties = {
  ...cellStyle,
  fontWeight: 600,
  borderBottom: '2px solid #d1d5db',
  whiteSpace: 'nowrap',
};

/**
 * #1352: the correction form for one quarantined row. It starts from the
 * retained row, sends every column back, and shows the backend's answer: on a
 * rejection the new errors, on success nothing, since the page reloads the
 * batch and the record then reads RESUBMITTED.
 */
function ResubmitForm({
  batchId,
  record,
  onResubmitted,
}: {
  batchId: string;
  record: QuarantineRecord;
  onResubmitted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => toEditableRow(record));
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Corrigir e reenviar
      </Button>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setErrors([]);
    try {
      await importLGPDService.resubmitQuarantinedRow(batchId, String(record._id), values);
      onResubmitted();
    } catch (err) {
      const data = (err as { response?: { data?: unknown } })?.response?.data;
      setErrors(resubmitErrorMessages(data));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} aria-label={`Corrigir linha ${record.rowNumber ?? ''}`} style={{ marginTop: 8 }}>
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {Object.keys(values).map((key) => (
            <tr key={key}>
              <td style={{ ...cellStyle, fontWeight: 600 }}>
                <label htmlFor={`resubmit-${String(record._id)}-${key}`}>{key}</label>
              </td>
              <td style={cellStyle}>
                <input
                  id={`resubmit-${String(record._id)}-${key}`}
                  value={values[key]}
                  onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {errors.length > 0 && (
        <ul role="alert" style={{ color: '#b91c1c' }}>
          {errors.map((message, index) => <li key={index}>{message}</li>)}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Reenviando...' : 'Reenviar linha'}
        </Button>
        <Button variant="secondary" type="button" onClick={() => setOpen(false)} disabled={submitting}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

export default function ImportQuarantinePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('batchId') || '';

  const [batches, setBatches] = useState<QuarantineBatch[]>([]);
  const [records, setRecords] = useState<QuarantineRecord[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<QuarantineBatch | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingBatch, setLoadingBatch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [batchPage, setBatchPage] = useState(1);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchTotalPages, setBatchTotalPages] = useState(1);

  const loadBatches = useCallback(async (page = batchPage) => {
    setLoadingList(true);
    setError(null);
    try {
      const response = await importLGPDService.listQuarantineBatches({ limit: LIST_PAGE_SIZE, page });
      setBatches(response.data?.data || []);
      const pagination = response.data?.pagination;
      setBatchTotal(Number(pagination?.total) || 0);
      setBatchTotalPages(Math.max(1, Number(pagination?.totalPages) || 1));
      setBatchPage(Number(pagination?.page) || page);
    } catch (err) {
      setError('Não foi possível carregar os lotes em quarentena.');
    } finally {
      setLoadingList(false);
    }
  }, [batchPage]);

  useEffect(() => {
    loadBatches(batchPage);
  }, [batchPage]); // eslint-disable-line react-hooks/exhaustive-deps -- reload on page change only

  useEffect(() => {
    if (!selectedId) {
      setSelectedBatch(null);
      setRecords([]);
      return;
    }

    let cancelled = false;
    setLoadingBatch(true);
    setError(null);

    importLGPDService
      .getQuarantineBatch(selectedId)
      .then((response) => {
        if (cancelled) return;
        setSelectedBatch(response.data?.batch || null);
        setRecords(response.data?.records || []);
      })
      .catch(() => {
        if (cancelled) return;
        setSelectedBatch(null);
        setRecords([]);
        setError('Lote de quarentena não encontrado ou inacessível.');
      })
      .finally(() => {
        if (!cancelled) setLoadingBatch(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId, reloadKey]);

  const summaries = batches.map(formatBatchSummary);
  const recordsPagination = useClientPagination(records, LIST_PAGE_SIZE);
  const batchPageStart = batchTotal === 0 ? 0 : (batchPage - 1) * LIST_PAGE_SIZE + 1;
  const batchPageEnd = Math.min(batchPage * LIST_PAGE_SIZE, batchTotal);

  return (
    <div className="page-shell" data-testid="import-quarantine-page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button variant="secondary" onClick={() => navigate(-1)} aria-label="Voltar">
            <ArrowLeft size={16} /> Voltar
          </Button>
          <div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
              <FileWarning size={22} /> Quarentena de importação
            </h1>
            <p className="page-subtitle">
              Revisar e reenviar linhas rejeitadas de planilhas históricas. A importação operacional em lote FHIR fica em Importação em lote (<code>/patients/import-fhir</code>).
            </p>
          </div>
        </div>
        <Button variant="secondary" onClick={() => loadBatches(batchPage)} aria-label="Atualizar">
          <RefreshCw size={16} /> Atualizar
        </Button>
      </div>

      {error && (
        <div role="alert" style={{ background: '#fef2f2', color: '#991b1b', padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <Card style={{ marginBottom: 16 }} data-testid="import-quarantine-steps">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Passos (G7)</h2>
        <ol style={{ margin: 0, paddingLeft: 20, color: '#374151', lineHeight: 1.6 }}>
          <li>Abra um lote na tabela abaixo (ou use <code>?batchId=</code> vindo da importação).</li>
          <li>Leia o motivo da rejeição em cada linha — mensagens vêm do validador, sem correção silenciosa.</li>
          <li>Use <strong>Corrigir e reenviar</strong> para mandar a linha de volta pelo mesmo pipeline.</li>
          <li>Após sucesso, a linha sai de ERROR; lotes FHIR recentes devem ser acompanhados também em Importação em lote.</li>
        </ol>
      </Card>

      <Card>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Lotes em quarentena</h2>
        {loadingList ? (
          <p>Carregando lotes...</p>
        ) : summaries.length === 0 ? (
          <p style={{ color: '#4b5563' }}>
            Nenhum lote em quarentena. Importações sem linhas rejeitadas não geram lote.
          </p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={headStyle}>Arquivo</th>
                    <th style={headStyle}>Origem</th>
                    <th style={headStyle}>Data</th>
                    <th style={headStyle}>Linhas</th>
                    <th style={headStyle}>Importadas</th>
                    <th style={headStyle}>Rejeitadas</th>
                    <th style={headStyle}>Arquivo original</th>
                    <th style={headStyle} />
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((summary) => (
                    <tr key={summary.id} style={summary.id === selectedId ? { background: '#eff6ff' } : undefined}>
                      <td style={cellStyle}>{summary.fileName}</td>
                      <td style={cellStyle}>{summary.kindLabel}</td>
                      <td style={cellStyle}>{summary.createdAtLabel}</td>
                      <td style={cellStyle}>{summary.total}</td>
                      <td style={cellStyle}>{summary.imported}</td>
                      <td style={{ ...cellStyle, color: summary.rejected > 0 ? '#b91c1c' : undefined }}>
                        {summary.rejected}
                      </td>
                      <td style={cellStyle}>
                        {summary.sourceFileRetained ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#047857' }}>
                            <FileCheck2 size={14} /> retido
                          </span>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#92400e' }}>
                            <FileX2 size={14} /> não retido
                          </span>
                        )}
                      </td>
                      <td style={cellStyle}>
                        <Button
                          variant="secondary"
                          onClick={() => setSearchParams(summary.id === selectedId ? {} : { batchId: summary.id })}
                        >
                          {summary.id === selectedId ? 'Fechar' : 'Ver linhas'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ListPagination
              currentPage={batchPage}
              totalPages={batchTotalPages}
              pageStart={batchPageStart}
              pageEnd={batchPageEnd}
              total={batchTotal}
              onPageChange={setBatchPage}
              testIdPrefix="quarantine-batches-pagination"
              emptyLabel="Nenhum lote em quarentena"
            />
          </>
        )}
      </Card>

      {selectedId && (
        <Card style={{ marginTop: 20 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>
            Linhas rejeitadas{selectedBatch?.fileName ? ` — ${selectedBatch.fileName}` : ''}
          </h2>

          {loadingBatch ? (
            <p>Carregando linhas...</p>
          ) : records.length === 0 ? (
            selectedBatch?.status === 'FAILED' ? (
              <p style={{ color: '#b91c1c' }}>
                Esta importação falhou antes de processar qualquer linha
                {selectedBatch?.error ? `: ${selectedBatch.error}` : '.'}
              </p>
            ) : (
              <p style={{ color: '#4b5563' }}>Nenhuma linha rejeitada neste lote.</p>
            )
          ) : (
            <>
              {recordsPagination.pagedItems.map((record) => {
                const errors = formatRecordErrors(record);
                const fields = describeRowFields(record);
                return (
                  <div
                    key={String(record._id || record.rowNumber)}
                    style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, marginTop: 12 }}
                  >
                    <strong>Linha {record.rowNumber ?? '--'}</strong>
                    {record.status && record.status !== 'ERROR' && (
                      <span style={{ marginLeft: 8, color: '#047857' }}>{record.status}</span>
                    )}

                    <ul style={{ color: '#b91c1c', marginTop: 6, marginBottom: 6 }}>
                      {errors.length === 0 ? (
                        <li>Rejeitada sem mensagem registrada.</li>
                      ) : (
                        errors.map((message, index) => <li key={index}>{message}</li>)
                      )}
                    </ul>

                    {fields.length === 0 ? (
                      <p style={{ color: '#6b7280', margin: 0 }}>
                        Conteúdo original não retido para esta linha.
                      </p>
                    ) : (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ borderCollapse: 'collapse' }}>
                          <tbody>
                            {fields.map((field) => (
                              <tr key={field.label}>
                                <td style={{ ...cellStyle, fontWeight: 600 }}>{field.label}</td>
                                <td style={cellStyle}>{field.value}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {canResubmit(selectedBatch, record) && (
                      <div style={{ marginTop: 8 }}>
                        <ResubmitForm
                          batchId={selectedId}
                          record={record}
                          onResubmitted={() => {
                            setReloadKey((key) => key + 1);
                            loadBatches(batchPage);
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              <ListPagination
                currentPage={recordsPagination.currentPage}
                totalPages={recordsPagination.totalPages}
                pageStart={recordsPagination.pageStart}
                pageEnd={recordsPagination.pageEnd}
                total={recordsPagination.total}
                onPageChange={recordsPagination.setCurrentPage}
                testIdPrefix="quarantine-records-pagination"
                emptyLabel="Nenhuma linha rejeitada"
              />
            </>
          )}
        </Card>
      )}
    </div>
  );
}
