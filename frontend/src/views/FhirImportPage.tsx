import { useState, type ChangeEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileJson2, ShieldAlert, CheckCircle2, Clock3, Activity } from 'lucide-react';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import ImportResultSummary, { type ImportResultSummaryData } from '../components/ImportResultSummary';
import { convertExcelFileToFhirBundle, downloadFhirExcelTemplate } from '../utils/fhirExcelImport';
import { dataImportService } from '../services/api';

const statusOrder = ['PENDING_CONSENT', 'TCLE_SENT', 'SIGNED', 'EXTERNAL_ATTACHED', 'QUARANTINED', 'RELEASED', 'NEEDS_REVIEW'] as const;

type DisplayStatus = (typeof statusOrder)[number];

// This page reads import_staging_records (buildWorkflowSnapshot in
// fhir-import-staging.service.js), a pre-commit workflow snapshot on the
// FHIR import record itself — not a Sample. It has no specimenStatus
// equivalent (that field only exists on samples), so #407's read
// migration to specimenStatus does not apply here; confirmed out of
// scope the same way the backend write-site side of it was for #409
// (see that service's buildWorkflowSnapshot comment).
type FhirRecord = {
  _id?: string;
  rowNumber?: number;
  status?: string;
  workflowStatus?: string;
  consentStatus?: string;
  quarantineStatus?: string;
  quarantineReason?: string | null;
  availabilityStatus?: string;
  consentTracking?: { sentAt?: string | Date | null; failedAt?: string | Date | null } | null;
  normalized?: {
    patientName?: string;
    patientID?: string;
    patientEmail?: string;
    sampleID?: string;
    consentSigned?: boolean;
  };
  errors?: Array<{ field?: string; message?: string; code?: string }>;
  validationErrors?: Array<{ field?: string; message?: string; code?: string }>;
  warnings?: Array<{ field?: string; message?: string; code?: string }>;
};

function isValidEmail(email?: string | null) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function getDisplayStatus(record: FhirRecord): DisplayStatus {
  const normalized = record.normalized || {};
  const consentStatus = String(record.consentStatus || '').toUpperCase();
  const workflowStatus = String(record.workflowStatus || record.status || '').toUpperCase();
  const quarantineStatus = String(record.quarantineStatus || '').toUpperCase();
  const availabilityStatus = String(record.availabilityStatus || '').toUpperCase();
  const consentSent = Boolean(record.consentTracking?.sentAt);
  const hasEmail = isValidEmail(normalized.patientEmail);
  const signed = Boolean(normalized.consentSigned) || consentStatus === 'SIGNED';

  if (signed) return 'SIGNED';
  if (consentStatus === 'EXTERNAL_ATTACHED') return 'EXTERNAL_ATTACHED';
  if (quarantineStatus === 'RELEASED' || availabilityStatus === 'AVAILABLE') return 'RELEASED';
  if (consentSent || workflowStatus === 'TCLE_SENT') return 'TCLE_SENT';
  if (!hasEmail || workflowStatus === 'NEEDS_REVIEW' || consentStatus === 'NOT_REQUIRED') return 'NEEDS_REVIEW';
  if (workflowStatus === 'PENDING_CONSENT' || consentStatus === 'PENDING') return 'PENDING_CONSENT';
  if (quarantineStatus === 'QUARANTINED' || availabilityStatus === 'BLOCKED') return 'QUARANTINED';
  return 'PENDING_CONSENT';
}

function StatusPill({ status }: { status: DisplayStatus }) {
  const palette: Record<DisplayStatus, { bg: string; fg: string; label: string }> = {
    PENDING_CONSENT: { bg: '#fff6d8', fg: '#946200', label: 'PENDING_CONSENT' },
    TCLE_SENT: { bg: '#e7f0ff', fg: '#2557b7', label: 'TCLE_SENT' },
    SIGNED: { bg: '#e1f5eb', fg: '#0f7a42', label: 'SIGNED' },
    EXTERNAL_ATTACHED: { bg: '#e8f7f4', fg: '#0b7d72', label: 'EXTERNAL_ATTACHED' },
    QUARANTINED: { bg: '#fff1d6', fg: '#9a6700', label: 'QUARANTINED' },
    RELEASED: { bg: '#ecfdf3', fg: '#0b7a3b', label: 'RELEASED' },
    NEEDS_REVIEW: { bg: '#fee2e2', fg: '#b42318', label: 'NEEDS_REVIEW' },
  };
  const colors = palette[status];

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0.28rem 0.55rem', borderRadius: 999, fontSize: 12, fontWeight: 800, letterSpacing: '0.02em', background: colors.bg, color: colors.fg }}>
      {colors.label}
    </span>
  );
}

export default function FhirImportPage() {
  const navigate = useNavigate();
  const [importedFile, setImportedFile] = useState<File | null>(null);
  const [importedJson, setImportedJson] = useState<any>(null);
  const [importExcelFile, setImportExcelFile] = useState<File | null>(null);
  const [fhirImportStep, setFhirImportStep] = useState(1);
  const [fhirBatchId, setFhirBatchId] = useState('');
  const [fhirBatch, setFhirBatch] = useState<any>(null);
  const [fhirStagingRows, setFhirStagingRows] = useState<FhirRecord[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResultSummaryData | null>(null);

  const refreshBatchState = (data: any) => {
    const batch = data?.batch || data?.data?.batch || null;
    const records = data?.records || data?.data?.records || [];
    setFhirBatch(batch);
    setFhirStagingRows(Array.isArray(records) ? records : []);
    const nextBatchId = String(batch?._id || batch?.id || data?.batchId || data?.data?.batchId || fhirBatchId || '');
    if (nextBatchId) setFhirBatchId(nextBatchId);
  };

  const resetPageState = () => {
    setImportedFile(null);
    setImportedJson(null);
    setImportExcelFile(null);
    setFhirImportStep(1);
    setFhirBatchId('');
    setFhirBatch(null);
    setFhirStagingRows([]);
    setImportResult(null);
  };

  const getRelevantRows = () => fhirStagingRows.filter((row) => row.status !== 'ERROR');
  const getValidCount = () => getRelevantRows().length;
  const getQuarantineCount = () => getRelevantRows().filter((row) => !row.normalized?.consentSigned).length;
  const getEmailCount = () => getRelevantRows().filter((row) => isValidEmail(row.normalized?.patientEmail)).length;
  const getNoEmailCount = () => getRelevantRows().filter((row) => !isValidEmail(row.normalized?.patientEmail)).length;
  const getNeedsReviewCount = () => getRelevantRows().filter((row) => getDisplayStatus(row) === 'NEEDS_REVIEW').length;
  const getDisplayStatusCounts = () => {
    return statusOrder.reduce<Record<DisplayStatus, number>>((acc, status) => {
      acc[status] = fhirStagingRows.filter((row) => getDisplayStatus(row) === status).length;
      return acc;
    }, {
      PENDING_CONSENT: 0,
      TCLE_SENT: 0,
      SIGNED: 0,
      EXTERNAL_ATTACHED: 0,
      QUARANTINED: 0,
      RELEASED: 0,
      NEEDS_REVIEW: 0,
    });
  };

  const handleExcelFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setImportExcelFile(event.target.files?.[0] || null);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const looksJson = file.type === 'application/json' || file.name.toLowerCase().endsWith('.json') || file.type === 'application/fhir+json';
    if (!looksJson) {
      alert('Selecione um arquivo JSON FHIR válido.');
      setImportedFile(null);
      setImportedJson(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      try {
        const json = JSON.parse(String(readerEvent.target?.result || 'null'));
        setImportedFile(file);
        setImportedJson(json);
        setFhirImportStep(2);
        setFhirBatchId('');
        setFhirBatch(null);
        setFhirStagingRows([]);
        setImportResult(null);
      } catch (error) {
        alert('Arquivo JSON inválido.');
        setImportedFile(null);
        setImportedJson(null);
      }
    };
    reader.readAsText(file);
  };

  const handleConvertExcelToFhir = async () => {
    if (!importExcelFile) {
      alert('Selecione um arquivo Excel preenchido com o modelo.');
      return;
    }

    setImportLoading(true);
    try {
      const bundle = await convertExcelFileToFhirBundle(importExcelFile);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/fhir+json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'importacao-fhir-bundle.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setImportedJson(bundle);
      setImportedFile(new File([blob], 'importacao-fhir-bundle.json', { type: 'application/fhir+json' }));
      setFhirImportStep(2);
      setImportResult({ success: true, message: 'Bundle FHIR gerado a partir do Excel.' });
    } catch (error: any) {
      setImportResult({ success: false, error: error?.message || 'Não foi possível converter o Excel para JSON FHIR.' });
    } finally {
      setImportLoading(false);
    }
  };

  const handleValidateBatch = async () => {
    if (!importedJson) {
      alert('Selecione um Bundle FHIR JSON para continuar.');
      return;
    }

    setImportLoading(true);
    setImportResult(null);
    try {
      const stagedResponse = fhirBatchId
        ? await dataImportService.validateFhirBatch(fhirBatchId)
        : await dataImportService.stageFhirBundle(importedJson);
      refreshBatchState(stagedResponse?.data || {});
      setFhirImportStep(3);
      setImportResult({ success: true, message: 'Lote validado e pronto para revisão.' });
    } catch (error: any) {
      const errorMessage = error?.response?.data?.error || error?.response?.data?.message || error?.message;
      setImportResult({ success: false, error: errorMessage || 'A importação em lote exige um FHIR R4 Bundle JSON.' });
    } finally {
      setImportLoading(false);
    }
  };

  const handleSaveQuarantineAndSendConsents = async () => {
    if (!fhirBatchId) {
      alert('Valide o lote antes de salvar em quarentena.');
      return;
    }

    setImportLoading(true);
    setImportResult(null);
    try {
      const consentResponse = await dataImportService.sendFhirBatchConsents(fhirBatchId);
      refreshBatchState(consentResponse?.data || {});
      const commitResponse = await dataImportService.commitFhirBatch(fhirBatchId);
      refreshBatchState(commitResponse?.data || {});
      setFhirImportStep(5);
      setImportResult({ success: true, message: 'Lote salvo em quarentena e TCLEs enviados quando aplicável.' });
    } catch (error: any) {
      const errorMessage = error?.response?.data?.error || error?.response?.data?.message || error?.message;
      setImportResult({ success: false, error: errorMessage || 'Erro ao salvar em quarentena e enviar TCLEs.' });
    } finally {
      setImportLoading(false);
    }
  };

  const displayStatusCounts = getDisplayStatusCounts();
  const rowsToReview = getRelevantRows();

  return (
    <div className="page-shell" data-testid="fhir-import-page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Button variant="secondary" onClick={() => navigate('/patients')} style={{ minWidth: 'auto' }} data-testid="fhir-import-back-button">
            <ArrowLeft size={18} />
          </Button>
          <div>
            <h1 className="page-title">Importação em lote</h1>
            <p className="page-subtitle">
              Importação em lote FHIR R4: participantes e amostras entram em quarentena até TCLE assinado ou documentação autorizada. Salvar não libera a amostra para uso. Rotas antigas <code>/import</code> e <code>/import/lgpd</code> redirecionam para esta página.
            </p>
          </div>
        </div>
        <Button variant="secondary" onClick={resetPageState} disabled={importLoading} data-testid="fhir-import-reset-button">
          Limpar fluxo
        </Button>
      </div>

      <div style={{ display: 'grid', gap: '1rem' }}>
        <Card title="Etapa 1 — Preparar arquivo" style={{ width: '100%' }}>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <p style={{ margin: 0, color: 'var(--text-light)' }}>
              JSON FHIR R4 Bundle é o padrão principal. Excel é apenas apoio: ele precisa ser convertido para JSON FHIR antes do staging.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <Button type="button" onClick={downloadFhirExcelTemplate} disabled={importLoading} data-testid="fhir-import-download-template">
                Baixar modelo Excel
              </Button>
              <input type="file" accept=".xlsx,.xls" onChange={handleExcelFileChange} disabled={importLoading} aria-label="Selecionar arquivo Excel" title="Selecionar arquivo Excel" />
              <Button type="button" onClick={handleConvertExcelToFhir} disabled={!importExcelFile || importLoading} data-testid="fhir-import-convert-excel">
                Converter Excel para JSON FHIR
              </Button>
              <input type="file" accept="application/json,.json,application/fhir+json" onChange={handleFileChange} disabled={importLoading} data-testid="fhir-import-json-input" aria-label="Selecionar arquivo JSON FHIR" title="Selecionar arquivo JSON FHIR" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
              <div style={{ padding: '0.9rem 1rem', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
                <div style={{ fontSize: 12, color: 'var(--text-light)' }}>Arquivo selecionado</div>
                <strong>{importedFile?.name || 'Nenhum JSON FHIR selecionado'}</strong>
              </div>
              <div style={{ padding: '0.9rem 1rem', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }} data-testid="fhir-import-patient-count">
                <div style={{ fontSize: 12, color: 'var(--text-light)' }}>Pacientes detectados</div>
                <strong>{importedJson?.entry?.filter?.((entry: any) => entry?.resource?.resourceType === 'Patient')?.length || 0}</strong>
              </div>
              <div style={{ padding: '0.9rem 1rem', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }} data-testid="fhir-import-specimen-count">
                <div style={{ fontSize: 12, color: 'var(--text-light)' }}>Amostras detectadas</div>
                <strong>{importedJson?.entry?.filter?.((entry: any) => entry?.resource?.resourceType === 'Specimen')?.length || 0}</strong>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Etapa 2 — Validar lote" style={{ width: '100%' }}>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button type="button" onClick={handleValidateBatch} disabled={!importedJson || importLoading} data-testid="fhir-import-validate-button">
              {importLoading && fhirImportStep <= 2 ? 'Validando...' : 'Validar lote'}
            </Button>
            <span style={{ color: 'var(--text-light)' }}>A validação prepara a revisão, mas o salvamento final permanece em quarentena até regularização ética.</span>
          </div>
        </Card>

        <Card title="Etapa 3 — Revisar inconsistências" style={{ width: '100%' }}>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {fhirBatch?.counts && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }} data-testid="fhir-import-validation-summary">
                <div style={{ padding: '0.85rem 1rem', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>Total<br /><strong>{fhirBatch.counts.total ?? rowsToReview.length}</strong></div>
                <div style={{ padding: '0.85rem 1rem', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>Válidos<br /><strong>{fhirBatch.counts.valid ?? getValidCount()}</strong></div>
                <div style={{ padding: '0.85rem 1rem', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>Revisão<br /><strong>{fhirBatch.counts.needsReview ?? getNeedsReviewCount()}</strong></div>
                <div style={{ padding: '0.85rem 1rem', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>Erros<br /><strong>{fhirBatch.counts.errors ?? rowsToReview.filter((row) => row.status === 'ERROR').length}</strong></div>
              </div>
            )}
            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }} data-testid="fhir-import-staging-table">
                <thead>
                  <tr style={{ background: 'var(--surface)' }}>
                    <th style={thStyle}>Linha</th>
                    <th style={thStyle}>Paciente</th>
                    <th style={thStyle}>Amostra</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Mensagens</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsToReview.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={emptyCellStyle}>Valide o lote para visualizar as linhas staging.</td>
                    </tr>
                  ) : rowsToReview.map((row) => {
                    const messages = [...(row.validationErrors || row.errors || []), ...(row.warnings || [])].map((item) => `${item.field || 'registro'}: ${item.message}`).join(' | ');
                    return (
                      <tr key={row._id || row.rowNumber}>
                        <td style={tdStyle}>{row.rowNumber}</td>
                        <td style={tdStyle}>{row.normalized?.patientName || row.normalized?.patientID || '-'}</td>
                        <td style={tdStyle}>{row.normalized?.sampleID || '-'}</td>
                        <td style={{ ...tdStyle, fontWeight: 800 }}>{getDisplayStatus(row)}</td>
                        <td style={tdStyle}>{messages || 'Sem inconsistências'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </Card>

        <Card title="Etapa 4 — Salvar em quarentena e enviar TCLEs" style={{ width: '100%' }}>
          <div style={{ display: 'grid', gap: '1rem' }}>
            <p style={{ margin: 0, color: 'var(--text-light)' }}>
              Amostras transferidas de outro biobanco podem receber documentação externa anexada por Coordenador. As amostras importadas serão salvas em quarentena até assinatura do TCLE ou anexação de documentação autorizada.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
              <StatBox label="Registros válidos" value={getValidCount()} icon={<CheckCircle2 size={16} />} />
              <StatBox label="Amostras em quarentena" value={getQuarantineCount()} icon={<ShieldAlert size={16} />} />
              <StatBox label="E-mails com TCLE" value={getEmailCount()} icon={<Activity size={16} />} />
              <StatBox label="Sem e-mail" value={getNoEmailCount()} icon={<Clock3 size={16} />} />
              <StatBox label="Exigem anexo documental" value={getNeedsReviewCount()} icon={<FileJson2 size={16} />} />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <Button type="button" onClick={handleSaveQuarantineAndSendConsents} disabled={!fhirBatchId || importLoading || getValidCount() === 0} data-testid="fhir-import-save-quarantine-button">
                Salvar em quarentena e enviar TCLEs
              </Button>
              <span style={{ color: 'var(--text-light)' }}>Salvar não libera a amostra para uso.</span>
            </div>
          </div>
        </Card>

        <Card title="Etapa 5 — Acompanhar pendências/liberação" style={{ width: '100%' }}>
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
              {statusOrder.map((status) => (
                <div key={status} style={{ padding: '0.85rem 1rem', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-light)' }}>{status}</div>
                  <strong>{displayStatusCounts[status]}</strong>
                </div>
              ))}
            </div>
            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }} data-testid="fhir-import-status-table">
                <thead>
                  <tr style={{ background: 'var(--surface)' }}>
                    <th style={thStyle}>Linha</th>
                    <th style={thStyle}>Paciente</th>
                    <th style={thStyle}>Amostra</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Consentimento</th>
                    <th style={thStyle}>Quarentena</th>
                    <th style={thStyle}>Disponibilidade</th>
                  </tr>
                </thead>
                <tbody>
                  {fhirStagingRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={emptyCellStyle}>Os status finais aparecerão após validar, enviar TCLEs e salvar em quarentena.</td>
                    </tr>
                  ) : fhirStagingRows.map((row) => (
                    <tr key={`status-${row._id || row.rowNumber}`}>
                      <td style={tdStyle}>{row.rowNumber}</td>
                      <td style={tdStyle}>{row.normalized?.patientName || row.normalized?.patientID || '-'}</td>
                      <td style={tdStyle}>{row.normalized?.sampleID || '-'}</td>
                      <td style={tdStyle}><StatusPill status={getDisplayStatus(row)} /></td>
                      <td style={tdStyle}>{formatConsentDisplay(row)}</td>
                      <td style={tdStyle}>{String(row.quarantineStatus || (getDisplayStatus(row) === 'RELEASED' || getDisplayStatus(row) === 'SIGNED' || getDisplayStatus(row) === 'EXTERNAL_ATTACHED' ? 'RELEASED' : 'QUARANTINED')).toUpperCase()}</td>
                      <td style={tdStyle}>{String(row.availabilityStatus || (getDisplayStatus(row) === 'RELEASED' || getDisplayStatus(row) === 'SIGNED' || getDisplayStatus(row) === 'EXTERNAL_ATTACHED' ? 'AVAILABLE' : 'BLOCKED')).toUpperCase()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>

        <ImportResultSummary result={importResult} style={{ marginTop: 4, fontSize: 14 }} />
      </div>
    </div>
  );
}

function StatBox({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div style={{ padding: '0.9rem 1rem', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-light)', fontSize: 12 }}>{icon}{label}</div>
      <strong style={{ fontSize: '1.15rem' }}>{value}</strong>
    </div>
  );
}

const thStyle = {
  textAlign: 'left' as const,
  padding: '0.8rem 0.9rem',
  fontSize: 13,
  whiteSpace: 'nowrap' as const,
};

const tdStyle = {
  padding: '0.85rem 0.9rem',
  borderTop: '1px solid var(--border)',
  fontSize: 13,
  verticalAlign: 'top' as const,
};

const emptyCellStyle = {
  padding: '1rem',
  textAlign: 'center' as const,
  color: 'var(--text-light)',
};

function formatConsentDisplay(record: FhirRecord) {
  const consentStatus = String(record.consentStatus || '').toUpperCase();
  if (consentStatus) return consentStatus;
  if (record.consentTracking?.sentAt) return 'TCLE_SENT';
  if (record.normalized?.consentSigned) return 'SIGNED';
  if (isValidEmail(record.normalized?.patientEmail)) return 'PENDING_CONSENT';
  return 'NOT_REQUIRED';
}
