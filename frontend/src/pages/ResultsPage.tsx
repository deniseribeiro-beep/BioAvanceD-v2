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
import { resultService, importService } from '../services/api';
import AnalysisUploadModal from '../components/AnalysisUploadModal';
import AnalysisUpload from '../components/AnalysisUpload.jsx';
import './ResultsPage.css';

export default function ResultsPage() {
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
      // Backend retorna { success: true, data: [] }
      // Axios já extrai o body, então response.data é { success: true, data: [] }
      let jobs: ImportJob[] = [];
      if (response.data) {
        if (Array.isArray(response.data)) {
          // Se response.data já é um array (caso direto)
          jobs = response.data;
        } else if (response.data.data && Array.isArray(response.data.data)) {
          // Se response.data é { success: true, data: [] }
          jobs = response.data.data;
        } else if (response.data.jobs && Array.isArray(response.data.jobs)) {
          // Se response.data é { jobs: [] }
          jobs = response.data.jobs;
        } else {
          // Se não for array, assume que é um objeto vazio ou estrutura diferente
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
      setSelectedJob(response.data);
      setShowReportModal(true);
    } catch (err: any) {
      setImportError('Erro ao carregar relatório');
    }
  };


  const getStatusIcon = (status: ImportJobStatus) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="status-icon completed" />;
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
      pending: 'Pendente',
      processing: 'Processando',
      completed: 'Concluído',
      failed: 'Falhou',
      cancelled: 'Cancelado'
    };
    return labels[status] || status;
  };

  return (
    <div className="page">
      <div className="page-header">

        <div>
          <h1 className="page-title">Arquivos de Análise</h1>
          <p className="page-subtitle">
            {importJobID 
              ? `Arquivos de análise da importação ${importJobID}` 
              : 'Arquivos de análises laboratoriais'}
          </p>
          {importJobID && (
            <div className="results-filter">
              <Button
                variant="secondary"
                onClick={clearFilter}
              >
                <X size={16} /> Limpar Filtro
              </Button>
            </div>
          )}
        </div>
        <div className="results-header-actions" />
      </div>

      {/* Seção de Importação */}
      <Card className="import-section">
        <h2 className="import-title">Importar Arquivos de Análise</h2>

        <AnalysisUpload sampleId={sampleIdParam} />

        {importError && (
          <div className="error-message import-error">
            <AlertCircle size={16} /> {importError}
          </div>
        )}

        <div className="import-history">
          <h3 className="import-history-title">Histórico de Importações</h3>
          {importJobs.length === 0 ? (
            <p className="import-empty">Nenhuma importação realizada ainda</p>
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
                          {new Date(job.createdAt || '').toLocaleString('pt-BR')}
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
                          <ExternalLink size={16} /> Ver
                        </Button>
                      )}
                      {(job.status === 'completed' || job.status === 'failed') && (
                        <Button
                          variant="secondary"
                          onClick={() => handleViewReport(job)}
                        >
                          <Download size={16} /> Relatório
                        </Button>
                      )}
                    </div>
                  </div>
                  {job.metrics && (
                    <div className="job-metrics">
                      <span>Total: {job.metrics.totalRecords}</span>
                      <span className="metric-success">Sucesso: {job.metrics.successfulRecords}</span>
                      {job.metrics.failedRecords > 0 && (
                        <span className="metric-failure">Falhas: {job.metrics.failedRecords}</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {loading && <p>Carregando...</p>}
      {error && <p style={{ color: 'var(--danger)' }}>Erro: {error}</p>}

      <Card className="results-table-card">
        <Table
          headers={[
            'ID',
            'Tipo de Arquivo',
            'Descrição',
            'Método',
            'Pesquisador Responsável',
            'Equipamento',
            'Amostra',
            'Ações',
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
                        ?.equipmentDescription || `Equipamento #${result.equipmentID}`
                    : result.equipmentName || 'Não vinculado'}
                </td>
                <td>
                  <span className="sample-tag">Amostra #{result.sampleID}</span>
                </td>
                <td>
                  <div className="table-actions">
                    <Button 
                      variant="secondary"
                      onClick={async () => {
                        try {
                          await resultService.download(result._id || result.resultID);
                        } catch (err: any) {
                          alert(`Erro ao fazer download: ${err.message || 'Erro desconhecido'}`);
                        }
                      }}
                    >
                      <Download size={16} />
                      Download
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
          title="Relatório de Importação"
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
                <h4 className="report-subtitle">Métricas</h4>
                <div className="metrics-grid">
                  <div className="metric-item">
                    <label className="metric-label">Total de Registros</label>
                    <span className="metric-value">{selectedJob.metrics.totalRecords}</span>
                  </div>
                  <div className="metric-item">
                    <label className="metric-label">Sucesso</label>
                    <span className="metric-value metric-success">{selectedJob.metrics.successfulRecords}</span>
                  </div>
                  <div className="metric-item">
                    <label className="metric-label">Falhas</label>
                    <span className="metric-value metric-failure">{selectedJob.metrics.failedRecords}</span>
                  </div>
                  <div className="metric-item">
                    <label className="metric-label">Duplicados</label>
                    <span className="metric-value">{selectedJob.metrics.duplicatesFound}</span>
                  </div>
                  {selectedJob.metrics.processingTime && (
                    <div className="metric-item">
                      <label className="metric-label">Tempo de Processamento</label>
                      <span className="metric-value">{selectedJob.metrics.processingTime.toFixed(2)}s</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {selectedJob.validationErrors && selectedJob.validationErrors.length > 0 && (
              <div className="report-errors">
                <h4 className="report-subtitle">Erros de Validação</h4>
                <div className="errors-list">
                  {selectedJob.validationErrors.slice(0, 10).map((error, index) => (
                    <div key={index} className="error-item">
                      {error.row && <span>Linha {error.row}: </span>}
                      {error.field && <span>{error.field}: </span>}
                      {error.message}
                    </div>
                  ))}
                  {selectedJob.validationErrors.length > 10 && (
                    <p className="errors-more">... e mais {selectedJob.validationErrors.length - 10} erros</p>
                  )}
                </div>
              </div>
            )}

            {selectedJob.processingErrors && selectedJob.processingErrors.length > 0 && (
              <div className="report-errors">
                <h4 className="report-subtitle">Erros de Processamento</h4>
                <div className="errors-list">
                  {selectedJob.processingErrors.map((error, index) => (
                    <div key={index} className="error-item">{error}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

