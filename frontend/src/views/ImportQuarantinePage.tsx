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
 * A correção-e-reenvio de uma linha (item 3 do #794) ainda não existe; até lá
 * a tela é de revisão, e diz isso explicitamente em vez de sugerir uma ação
 * que não faria nada.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileWarning, RefreshCw, FileCheck2, FileX2 } from 'lucide-react';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import { importLGPDService } from '../services/api';
import {
  formatBatchSummary,
  formatRecordErrors,
  describeRowFields,
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

  const loadBatches = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const response = await importLGPDService.listQuarantineBatches({ limit: 50 });
      setBatches(response.data?.data || []);
    } catch (err) {
      setError('Não foi possível carregar os lotes em quarentena.');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadBatches();
  }, [loadBatches]);

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
  }, [selectedId]);

  const summaries = batches.map(formatBatchSummary);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Button variant="secondary" onClick={() => navigate(-1)} aria-label="Voltar">
          <ArrowLeft size={16} /> Voltar
        </Button>
        <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileWarning size={22} /> Quarentena de importação
        </h1>
        <Button variant="secondary" onClick={loadBatches} aria-label="Atualizar">
          <RefreshCw size={16} /> Atualizar
        </Button>
      </div>

      <p style={{ color: '#4b5563', marginTop: 0 }}>
        Linhas rejeitadas em importações LGPD ficam retidas aqui para revisão, em vez de
        serem descartadas silenciosamente (RNF011). A correção e o reenvio de uma linha
        ainda não estão disponíveis nesta tela.
      </p>

      {error && (
        <div role="alert" style={{ background: '#fef2f2', color: '#991b1b', padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <Card>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Lotes em quarentena</h2>
        {loadingList ? (
          <p>Carregando lotes...</p>
        ) : summaries.length === 0 ? (
          <p style={{ color: '#4b5563' }}>
            Nenhum lote em quarentena. Importações sem linhas rejeitadas não geram lote.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={headStyle}>Arquivo</th>
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
                    <td style={cellStyle}>{summary.createdAtLabel}</td>
                    <td style={cellStyle}>{summary.total}</td>
                    <td style={cellStyle}>{summary.imported}</td>
                    <td style={{ ...cellStyle, color: summary.rejected > 0 ? '#b91c1c' : undefined }}>
                      {summary.rejected}
                    </td>
                    <td style={cellStyle}>
                      {/* #792 retention is best-effort, so "not retained" is a
                          real state worth showing rather than hiding. */}
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
            // #806: a FAILED batch (throw at header level) also has zero
            // records -- "nenhuma linha rejeitada" would misleadingly read as
            // a clean import instead of an import that never got past its
            // headers.
            selectedBatch?.status === 'FAILED' ? (
              <p style={{ color: '#b91c1c' }}>
                Esta importação falhou antes de processar qualquer linha
                {selectedBatch?.error ? `: ${selectedBatch.error}` : '.'}
              </p>
            ) : (
              <p style={{ color: '#4b5563' }}>Nenhuma linha rejeitada neste lote.</p>
            )
          ) : (
            records.map((record) => {
              const errors = formatRecordErrors(record);
              const fields = describeRowFields(record);
              return (
                <div
                  key={String(record._id || record.rowNumber)}
                  style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, marginTop: 12 }}
                >
                  <strong>Linha {record.rowNumber ?? '--'}</strong>

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
                </div>
              );
            })
          )}
        </Card>
      )}
    </div>
  );
}
