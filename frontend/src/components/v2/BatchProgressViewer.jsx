import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, Download, RefreshCw, XCircle } from 'lucide-react';
import Card from '../UI/Card';
import Button from '../UI/Button';
import Spinner from '../UI/Spinner';
import ProgressBar from '../UI/ProgressBar';
import { getBatchImportStatus } from '../../api/import.service';

const POLLING_INTERVAL_MS = 3000;
const FINAL_STATUSES = new Set(['COMPLETED', 'FAILED']);

function normalizeStatus(status) {
  const value = String(status || '').trim().toUpperCase();

  if (value === 'PROCESSING') return 'PROCESSING';
  if (value === 'COMPLETED') return 'COMPLETED';
  if (value === 'FAILED') return 'FAILED';
  return 'PENDING';
}

function deriveProgress(totalRows, processedRows) {
  const total = Number(totalRows || 0);
  const processed = Number(processedRows || 0);

  if (!total) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
}

function buildSnapshot(payload = {}, fallbackFileName = '') {
  const totalRows = Number(payload.totalRows || 0);
  const processedRows = Number(payload.processedRows || 0);
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  const rawSummary = payload.rawData?.summary || payload.summary || {};
  const summaryValidRows = Number(rawSummary.validRows);
  const summaryInvalidRows = Number(rawSummary.invalidRows);
  const validRows = Number.isFinite(summaryValidRows)
    ? summaryValidRows
    : Math.max(0, processedRows - errors.length);
  const invalidRows = Number.isFinite(summaryInvalidRows)
    ? summaryInvalidRows
    : Math.max(0, errors.length);

  return {
    jobId: String(payload.jobId || ''),
    fileName: payload.fileName || fallbackFileName,
    status: normalizeStatus(payload.status || payload.rawStatus),
    rawStatus: payload.rawStatus || payload.status || 'PENDING',
    totalRows,
    processedRows,
    progress: deriveProgress(totalRows, processedRows),
    validRows,
    invalidRows,
    errors,
    rawData: payload.rawData || {},
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
  };
}

function getStatusLabel(status) {
  if (status === 'PROCESSING') return 'Processando';
  if (status === 'COMPLETED') return 'Concluído';
  if (status === 'FAILED') return 'Falhou';
  return 'Pendente';
}

function downloadErrorLog(snapshot) {
  const fileName = snapshot.fileName || 'batch-import';
  const payload = {
    jobId: snapshot.jobId,
    fileName,
    status: snapshot.status,
    totalRows: snapshot.totalRows,
    processedRows: snapshot.processedRows,
    validRows: snapshot.validRows,
    invalidRows: snapshot.invalidRows,
    errors: snapshot.errors,
    rawData: snapshot.rawData,
    generatedAt: new Date().toISOString(),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `batch-import-${snapshot.jobId}-error-log.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export default function BatchProgressViewer({ jobId, fileName, onReset, className = '' }) {
  const [snapshot, setSnapshot] = useState(() => buildSnapshot({ jobId, fileName }));
  const [isPolling, setIsPolling] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [pollingError, setPollingError] = useState('');
  const timeoutRef = useRef(null);

  const isFinal = FINAL_STATUSES.has(snapshot.status);

  const clearPollingTimer = () => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  useEffect(() => {
    let cancelled = false;

    const scheduleNext = () => {
      clearPollingTimer();
      timeoutRef.current = window.setTimeout(() => {
        void pollStatus();
      }, POLLING_INTERVAL_MS);
    };

    const pollStatus = async () => {
      try {
        const response = await getBatchImportStatus(jobId);
        if (cancelled) {
          return;
        }

        const nextSnapshot = buildSnapshot(response?.data?.data || response?.data || response, fileName);
        setSnapshot(nextSnapshot);
        setPollingError('');
        setIsLoading(false);

        if (FINAL_STATUSES.has(nextSnapshot.status)) {
          clearPollingTimer();
          setIsPolling(false);
          return;
        }

        setIsPolling(true);
        scheduleNext();
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error?.response?.data?.message || error?.response?.data?.error || error?.message || 'Não foi possível atualizar o status do lote';
        setPollingError(message);
        setIsLoading(false);
        setIsPolling(true);
        scheduleNext();
      }
    };

    setIsLoading(true);
    setIsPolling(true);
    void pollStatus();

    return () => {
      cancelled = true;
      clearPollingTimer();
    };
  }, [jobId, fileName]);

  const statusLabel = useMemo(() => getStatusLabel(snapshot.status), [snapshot.status]);
  const lastUpdatedLabel = snapshot.updatedAt
    ? new Date(snapshot.updatedAt).toLocaleString('pt-BR')
    : 'Aguardando atualização';

  const summaryCards = [
    { label: 'Processados', value: snapshot.processedRows, tone: 'success', icon: CheckCircle2 },
    { label: 'Válidos', value: snapshot.validRows, tone: 'success', icon: CheckCircle2 },
    { label: 'Inválidos', value: snapshot.invalidRows, tone: 'danger', icon: XCircle },
    { label: 'Total', value: snapshot.totalRows, tone: 'neutral', icon: Clock3 },
  ];

  return (
    <Card
      className={className}
      style={{
        border: '1px solid rgba(15, 118, 110, 0.18)',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(240,253,250,0.92))',
        boxShadow: '0 18px 50px rgba(15, 23, 42, 0.08)',
      }}
    >
      <div style={{ display: 'grid', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: '0.35rem' }}>
            <p style={{ margin: 0, color: 'var(--text-light)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Acompanhamento do ETL
            </p>
            <h3 style={{ margin: 0, color: 'var(--text)' }}>{snapshot.fileName || fileName || 'Importação em lote'}</h3>
            <span style={{ color: 'var(--text-light)', fontSize: '0.92rem' }}>Job: {snapshot.jobId}</span>
          </div>

          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.45rem 0.8rem',
              borderRadius: '999px',
              fontSize: '0.82rem',
              fontWeight: 700,
              color: snapshot.status === 'FAILED' ? '#991b1b' : snapshot.status === 'COMPLETED' ? '#166534' : '#0f766e',
              background: snapshot.status === 'FAILED' ? 'rgba(254, 226, 226, 0.9)' : snapshot.status === 'COMPLETED' ? 'rgba(220, 252, 231, 0.9)' : 'rgba(204, 251, 241, 0.9)',
            }}
          >
            {isPolling && !isFinal ? <Spinner size="sm" label="Atualizando status" /> : null}
            {statusLabel}
          </span>
        </div>

        <ProgressBar
          value={snapshot.progress}
          label="Progresso do lote"
          status={`${statusLabel} • ${snapshot.processedRows}/${snapshot.totalRows} registros`}
        />

        {pollingError && !isFinal && (
          <div
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.6rem',
              padding: '0.85rem 1rem',
              borderRadius: '0.9rem',
              background: 'rgba(254, 243, 199, 0.92)',
              border: '1px solid rgba(245, 158, 11, 0.24)',
              color: '#92400e',
            }}
          >
            <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
            <div style={{ display: 'grid', gap: '0.15rem' }}>
              <strong style={{ fontSize: '0.9rem' }}>O status ainda não pôde ser atualizado</strong>
              <span style={{ fontSize: '0.88rem' }}>{pollingError}</span>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
          {summaryCards.map((item) => {
            const Icon = item.icon;
            const isPositive = item.tone === 'success';
            const isNegative = item.tone === 'danger';

            return (
              <div
                key={item.label}
                style={{
                  padding: '1rem',
                  borderRadius: '1rem',
                  background: 'rgba(255,255,255,0.9)',
                  border: '1px solid rgba(15, 23, 42, 0.06)',
                  display: 'grid',
                  gap: '0.35rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', color: isPositive ? '#166534' : isNegative ? '#991b1b' : 'var(--text-light)' }}>
                  <Icon size={16} />
                  <span style={{ fontSize: '0.84rem', fontWeight: 700 }}>{item.label}</span>
                </div>
                <strong style={{ fontSize: '1.35rem', color: 'var(--text)' }}>{item.value}</strong>
              </div>
            );
          })}
        </div>

        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', color: 'var(--text-light)' }}>
            <Spinner size="sm" label="Carregando status do lote" />
            <span>Buscando o estado inicial do job...</span>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: '0.8rem',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'grid', gap: '0.2rem', color: 'var(--text-light)', fontSize: '0.88rem' }}>
            <span>Última atualização: {lastUpdatedLabel}</span>
            <span>ID do job: {snapshot.jobId}</span>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={onReset} type="button">
              <RefreshCw size={16} />
              Nova importação
            </Button>

            <Button type="button" onClick={() => downloadErrorLog(snapshot)} disabled={!isFinal}>
              <Download size={16} />
              Baixar log de erros
            </Button>
          </div>
        </div>

        {isFinal && (
          <div
            style={{
              padding: '1rem',
              borderRadius: '1rem',
              background: snapshot.status === 'FAILED' ? 'rgba(254, 226, 226, 0.8)' : 'rgba(220, 252, 231, 0.8)',
              border: snapshot.status === 'FAILED' ? '1px solid rgba(248, 113, 113, 0.24)' : '1px solid rgba(74, 222, 128, 0.22)',
              display: 'grid',
              gap: '0.5rem',
            }}
          >
            <strong style={{ color: snapshot.status === 'FAILED' ? '#991b1b' : '#166534' }}>
              Resumo final da importação
            </strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>Válidos</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>{snapshot.validRows}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>Inválidos</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>{snapshot.invalidRows}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>Status final</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>{snapshot.status}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}