import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import { Download, X, Upload, CheckCircle, XCircle, Clock, AlertCircle, ExternalLink } from 'lucide-react';
import { ImportDataType, ImportJob, ImportJobStatus } from '../types/models';
import { useResults } from '../hooks/useResults';
import { useEquipment } from '../hooks/useEquipment';
import { useLanguage } from '../contexts/LanguageContext';
import { resultService, importService } from '../services/api';
import { extractResponseEntity } from '../api/response.adapters';
import AnalysisUploadModal from '../components/AnalysisUploadModal';
import AnalysisUpload from '../components/AnalysisUpload.jsx';

// #905: the jobs-list endpoint returns the worker's flat counts
// (totalRecords/successCount/errorCount) verbatim -- there is no nested
// `metrics` object on listed jobs, so the strip that read job.metrics
// never rendered for any job. Derive the display shape from the flat
// fields instead. Exported for the co-located unit test.
export function deriveJobMetrics(job: ImportJob): { totalRecords: number; successfulRecords: number; failedRecords: number } | null {
  if (typeof job.totalRecords !== 'number') {
    return null;
  }
  return {
    totalRecords: job.totalRecords,
    successfulRecords: typeof job.successCount === 'number' ? job.successCount : 0,
    failedRecords: typeof job.errorCount === 'number' ? job.errorCount : 0,
  };
}

// #905: the report modal read `validationErrors`/`processingErrors`, fields
// no backend path has ever returned (getJobReport returns `errors`, see
// import-async.service.js:595). The worker writes the human-readable text
// under the `error` key (result-worker.js:90,111,147,316,329,343), not
// `message` -- reading `message` here would render every row blank.
// Exported for the co-located unit test.
export function formatImportErrorRow(item: NonNullable<ImportJob['errors']>[number]): {
  row: number | undefined;
  code: string | undefined;
  file: string | undefined;
  message: string;
} {
  return {
    row: item.row,
    code: item.code,
    file: item.fileName ?? item.filePath,
    message: item.error,
  };
}

export default function ResultsPage() {
  const { t, language } = useLanguage();
  const locale = language;
  const [searchParams, setSearchParams] = useSearchParams();
  const importJobID = searchParams.get('importJobID') || undefined;
  const sampleIdParam = searchParams.get('sampleId') || searchParams.get('sampleID') || '';
  const { results, loading, error, loadResults } = useResults(importJobID);
  const { equipment } = useEquipment();
  // Estados para importação
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<ImportJob | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [importError, setImportError] = useState('');

  const clearFilter = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('importJobID');
    setSearchParams(newParams);
  };

  // Funções de importação
  useEffect(() => {
    loadImportJobs();
    // Atualiza jobs a cada 10 segundos - reduzido de 3s para respeitar rate limiting
    const interval = setInterval(() => {
      loadImportJobs();
    }, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadImportJobs = async () => {
    try {
      const response = await importService.listJobs({ limit: 20 });
      // #895: GET /api/import/jobs returns { success, data: { jobs, total, limit,
      // skip } } -- see import-async.controller.js. Axios unwraps the HTTP body,
      // so the array lives at response.data.data.jobs.
      //
      // The three fallbacks below are kept for older/other response shapes, but
      // the canonical one MUST come first: response.data.data is a non-array
      // object here, so the old `Array.isArray(response.data.data)` branch fell
      // through to `jobs = []` on every single call. The page therefore rendered
      // "no imports yet" unconditionally and the per-job "Ver" button -- the only
      // entry point to the importJobID flow (#861, #889) -- could never appear.
      let jobs: ImportJob[] = [];
      if (response.data) {
        if (response.data.data?.jobs && Array.isArray(response.data.data.jobs)) {
          // Canonical: { success, data: { jobs: [] } }
          jobs = response.data.data.jobs;
        } else if (Array.isArray(response.data)) {
          jobs = response.data;
        } else if (response.data.data && Array.isArray(response.data.data)) {
          jobs = response.data.data;
        } else if (response.data.jobs && Array.isArray(response.data.jobs)) {
          jobs = response.data.jobs;
        } else {
          // #895: never fail silently again. An unrecognised shape is a bug, and
          // an empty list is indistinguishable from "no imports yet" to a user.
          console.error(
            '[ResultsPage] Unrecognised /api/import/jobs response shape; ' +
            'import history will render empty. Received keys:',
            Object.keys(response.data ?? {})
          );
          jobs = [];
        }
      }
      // Filtra apenas importações de arquivos de analise
      const resultsJobs = jobs.filter(job => job.dataType === ImportDataType.RESULTS);
      setImportJobs(resultsJobs);
    } catch (err: any) {
      console.error('Erro ao carregar jobs:', err);
      setImportJobs([]); // Define array vazio em caso de erro
    }
  };


  const handleViewReport = async (job: ImportJob) => {
    try {
      const response = await importService.getImportReport(job.jobID);
      // #905: the controller wraps the report in { success, data } -- setting
      // response.data directly made selectedJob the envelope, so every
      // modal field (fileName, status, metrics) read undefined.
      setSelectedJob(extractResponseEntity<ImportJob>(response, job));
      setShowReportModal(true);
    } catch (err: any) {
      setImportError(t('results.reportLoadError', 'Erro ao carregar relatório'));
    }
  };


  const getStatusIcon = (status: ImportJobStatus) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="status-icon completed" />;
      // #890: a run that finished normally but wrote nothing (every
      // processed entry hit an unimplemented/unsupported format stub) is
      // not a plain success -- flag it visually like failed/pending states
      // rather than the green completed checkmark.
      case 'completed_no_data':
        return <AlertCircle className="status-icon completed_no_data" />;
      case 'failed':
        return <XCircle className="status-icon failed" />;
      case 'processing':
        return <Clock className="status-icon processing" />;
      case 'pending':
        return <Clock className="status-icon pending" />;
      default:
        return <AlertCircle className="status-icon" />;
    }
  };
  const getStatusLabel = (status: ImportJobStatus) => {
    const labels = {
      pending: t('results.status.pending', 'Pendente'),
      processing: t('results.status.processing', 'Processando'),
      completed: t('results.status.completed', 'Concluído'),
      completed_no_data: t('results.status.completed_no_data', 'Concluído sem dados'),
      failed: t('results.status.failed', 'Falhou'),
      cancelled: t('results.status.cancelled', 'Cancelado')
    };
    return labels[status] || status;
  };

  return (
    <div className="page-shell">
      <div className="page-header">

        <div>
          <h1 className="page-title">{t('results.title', 'Arquivos de Análise')}</h1>
          <p className="page-subtitle">
            {importJobID 
              ? t('results.subtitleImportJob', 'Arquivos de análise da importação {importJobID}').replace('{importJobID}', importJobID)
              : t('results.subtitle', 'Arquivos de análises laboratoriais')}
          </p>
          {importJobID && (
            <div className="results-filter">
              <Button
                variant="secondary"
                onClick={clearFilter}
              >
                <X size={16} /> {t('results.clearFilter', 'Limpar Filtro')}
              </Button>
            </div>
          )}
        </div>
        <div className="results-header-actions" />
      </div>

      {/* Seção de Importação */}
      <Card className="import-section">
        <h2 className="import-title">{t('results.import', 'Importar Arquivos de Análise')}</h2>

        <AnalysisUpload sampleId={sampleIdParam} />

        {importError && (
          <div className="error-message import-error">
            <AlertCircle size={16} /> {importError}
          </div>
        )}

        <div className="import-history">
        <h3 className="import-history-title">{t('results.historyTitle', 'Histórico de Importações')}</h3>
          {importJobs.length === 0 ? (
            <p className="import-empty">{t('results.noHistory', 'Nenhuma importação realizada ainda')}</p>
          ) : (
            <div className="jobs-list">
              {importJobs.map((job) => (
                <div key={job.jobID} className="job-item">
                  <div className="job-header">
                    <div className="job-info">
                      {getStatusIcon(job.status)}
                      <div>
                        <h4 className="job-title">{job.fileName}</h4>
                        <p className="job-date">
                          {new Date(job.createdAt || '').toLocaleString(locale)}
                        </p>
                      </div>
                    </div>
                    <div className="job-status">
                      <span className={`status-badge ${job.status}`}>
                        {getStatusLabel(job.status)}
                      </span>
                      {job.status === 'completed' && (
                        <Button
                          variant="primary"
                          onClick={() => {
                            const newParams = new URLSearchParams(searchParams);
                            newParams.set('importJobID', job.jobID);
                            setSearchParams(newParams);
                          }}
                        >
                          <ExternalLink size={16} /> {t('results.view', 'Ver')}
                        </Button>
                      )}
                      {/* #890: completed_no_data is a terminal status whose
                          only user-facing route to the underlying error text
                          is the report -- there is nothing to "Ver" (no
                          results were written), but the report must remain
                          reachable. */}
                      {(job.status === 'completed' || job.status === 'completed_no_data' || job.status === 'failed') && (
                        <Button
                          variant="secondary"
                          onClick={() => handleViewReport(job)}
                        >
                          <Download size={16} /> {t('results.report', 'Relatório')}
                        </Button>
                      )}
                    </div>
                  </div>
                  {(() => {
                    // #905: derived from the flat fields the API actually
                    // returns; job.metrics never existed on listed jobs.
                    const jobMetrics = deriveJobMetrics(job);
                    return jobMetrics && (
                      <div className="job-metrics">
                        <span>{t('results.metrics.total', 'Total')}: {jobMetrics.totalRecords}</span>
                        <span className="metric-success">{t('results.metrics.success', 'Sucesso')}: {jobMetrics.successfulRecords}</span>
                        {jobMetrics.failedRecords > 0 && (
                          <span className="metric-failure">{t('results.metrics.failures', 'Falhas')}: {jobMetrics.failedRecords}</span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {loading && <p>{t('common.loading')}</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{t('common.error')}: {error}</p>}

      <Card className="results-table-card">
        <Table
          headers={[
            t('results.tableHeaders.id', 'ID'),
            t('results.tableHeaders.fileType', 'Tipo de Arquivo'),
            t('results.tableHeaders.description', 'Descrição'),
            t('results.tableHeaders.method', 'Método'),
            t('results.tableHeaders.researcher', 'Pesquisador Responsável'),
            t('results.tableHeaders.equipment', 'Equipamento'),
            t('results.tableHeaders.sample', 'Amostra'),
            t('results.tableHeaders.actions', 'Ações'),
          ]}
        >
          {results.map((result) => {
            return (
              <tr key={result._id || result.resultID}>
                <td>{result.resultID || result._id}</td>
                <td>
                  <span className="file-type-badge">{result.fileType}</span>
                </td>
                <td>{result.description}</td>
                <td>{result.method}</td>
                <td>{result.responsibleResearcher}</td>
                <td>
                  {result.equipmentID
                    ? equipment.find((e) => e.equipmentID === result.equipmentID)
                        ?.equipmentDescription || t('results.equipmentFallback', 'Equipamento #{id}').replace('{id}', String(result.equipmentID))
                    : result.equipmentName || t('results.notLinked', 'Não vinculado')}
                </td>
                <td>
                  <span className="sample-tag">{t('results.sampleFallback', 'Amostra #{id}').replace('{id}', String(result.specimenId))}</span>
                </td>
                <td>
                  <div className="table-actions">
                    <Button 
                      variant="secondary"
                      onClick={async () => {
                        try {
                          await resultService.download(result._id || result.resultID);
                        } catch (err: any) {
                          alert(t('results.downloadError', 'Erro ao fazer download: {error}').replace('{error}', err.message || t('common.unknown', 'Erro desconhecido')));
                        }
                      }}
                    >
                      <Download size={16} />
                      {t('results.download', 'Download')}
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>

      {/* Modal de Relatório de Importação */}
      {showReportModal && selectedJob && (
        <Modal
          isOpen={showReportModal}
          onClose={() => setShowReportModal(false)}
          title={t('results.reportModalTitle', 'Relatório de Importação')}
        >
          <div className="import-report">
            <div className="report-header">
              <h3 className="report-title">{selectedJob.fileName}</h3>
              <span className={`status-badge ${selectedJob.status}`}>
                {getStatusLabel(selectedJob.status)}
              </span>
            </div>

            {selectedJob.metrics && (
              <div className="report-metrics">
                <h4 className="report-subtitle">{t('results.metricsTitle', 'Métricas')}</h4>
                <div className="metrics-grid">
                  <div className="metric-item">
                    <label className="metric-label">{t('results.metrics.totalRecords', 'Total de Registros')}</label>
                    <span className="metric-value">{selectedJob.metrics.totalRecords}</span>
                  </div>
                  <div className="metric-item">
                    <label className="metric-label">{t('results.metrics.successLabel', 'Sucesso')}</label>
                    <span className="metric-value metric-success">{selectedJob.metrics.successfulRecords}</span>
                  </div>
                  <div className="metric-item">
                    <label className="metric-label">{t('results.metrics.failureLabel', 'Falhas')}</label>
                    <span className="metric-value metric-failure">{selectedJob.metrics.failedRecords}</span>
                  </div>
                  {/* #925 made this conditional: nothing wrote duplicatesFound,
                      so a `?? 0` default was turning "nobody counted" into
                      "there were none". #931 gave it a writer, and the
                      condition stays for jobs that completed before that --
                      they still have no field and must still omit the tile.

                      #931: the label says "dos quais" because this is a
                      LABELLED SUBSET of Falhas, not a sibling of it. A
                      duplicate row is pushed onto `errors` at all three
                      detection sites, so it is already inside failedRecords;
                      without the qualifier the grid reads as
                      success + failures + duplicates = total, which it is
                      deliberately not. */}
                  {selectedJob.metrics.duplicatesFound !== undefined && (
                    <div className="metric-item" data-testid="results-metric-duplicates">
                      <label className="metric-label">
                        {t('results.metrics.duplicates', 'Duplicados (dos quais)')}
                      </label>
                      <span className="metric-value">{selectedJob.metrics.duplicatesFound}</span>
                    </div>
                  )}
                  {/* #991: skippedRecords is written by import-worker.js and
                      carried through import-async.service.js's report metrics,
                      but nothing rendered it until now. Gated the same way as
                      duplicatesFound above: older jobs never had this field
                      written, and an absent count must stay absent rather than
                      being shown as a false zero. */}
                  {selectedJob.metrics.skippedRecords !== undefined && (
                    <div className="metric-item" data-testid="results-metric-skipped">
                      <label className="metric-label">
                        {t('results.metrics.skipped', 'Ignorados')}
                      </label>
                      <span className="metric-value">{selectedJob.metrics.skippedRecords}</span>
                    </div>
                  )}
                  {!!selectedJob.metrics.processingTime && (
                    <div className="metric-item">
                      <label className="metric-label">{t('results.metrics.processingTime', 'Tempo de Processamento')}</label>
                      <span className="metric-value">{selectedJob.metrics.processingTime.toFixed(2)}s</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {selectedJob.errors && selectedJob.errors.length > 0 && (
              <div className="report-errors">
                <h4 className="report-subtitle">{t('results.errorsTitle', 'Erros')}</h4>
                <div className="errors-list">
                  {selectedJob.errors.slice(0, 10).map((error, index) => {
                    const row = formatImportErrorRow(error);
                    return (
                      <div key={index} className="error-item">
                        {row.row !== undefined && <span>{t('results.rowLabel', 'Linha')} {row.row}: </span>}
                        {row.code && <span>{row.code}: </span>}
                        {row.file && <span>{row.file}: </span>}
                        {row.message}
                      </div>
                    );
                  })}
                  {selectedJob.errors.length > 10 && (
                <p className="errors-more">{t('results.moreErrors', '... e mais {count} erros').replace('{count}', String(selectedJob.errors.length - 10))}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

