import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import { FileText, Download, X, Upload, CheckCircle, XCircle, Clock, AlertCircle, ExternalLink } from 'lucide-react';
import { ImportDataType, ImportJob, ImportJobStatus } from '../types/models';
import { useResults } from '../hooks/useResults';
import { useEquipment } from '../hooks/useEquipment';
import { resultService, importService } from '../services/api';
import { useAsyncImport } from '../hooks/useAsyncImport';
import AnalysisUploadModal from '../components/AnalysisUploadModal';
import './ResultsPage.css';

export default function ResultsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const importJobID = searchParams.get('importJobID') || undefined;
  const { results, loading, error, loadResults } = useResults(importJobID);
  const { equipment } = useEquipment();
  // Estados para importação
  const [showImportSection, setShowImportSection] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<ImportJob | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [importError, setImportError] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showOutcomeModal, setShowOutcomeModal] = useState(false);

  // Hook de importação assíncrona
  const {
    validating,
    creating,
    validationError,
    validationOutcome,
    job: currentJob,
    isPolling,
    importFile,
    reset,
  } = useAsyncImport();

  const clearFilter = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('importJobID');
    setSearchParams(newParams);
  };

  // Funções de importação
  useEffect(() => {
    loadImportJobs();
    // Atualiza jobs a cada 3 segundos se houver jobs em processamento
    const interval = setInterval(() => {
      loadImportJobs();
    }, 3000);
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
      // Filtra apenas importações de resultados
      const resultsJobs = jobs.filter(job => job.dataType === ImportDataType.RESULTS);
      setImportJobs(resultsJobs);
    } catch (err: any) {
      console.error('Erro ao carregar jobs:', err);
      setImportJobs([]); // Define array vazio em caso de erro
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setImportError('');
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setImportError('Selecione um arquivo');
      return;
    }

    setImportError('');
    reset();

    try {
      await importFile(selectedFile, ImportDataType.RESULTS, {
        onCompleted: (job) => {
          console.log('Importação de resultados concluída:', job);
          // Recarrega jobs e resultados
          loadImportJobs();
          loadResults();
          setSelectedFile(null);
          setShowImportSection(false);
          // Limpa input
          const fileInput = document.getElementById('result-file-input') as HTMLInputElement;
          if (fileInput) fileInput.value = '';
        },
        onFailed: (job) => {
          console.error('Importação de resultados falhou:', job);
          setImportError(job.errors?.[0]?.error || 'Erro ao fazer upload do arquivo');
        },
      });
    } catch (err: any) {
      setImportError(err.message || 'Erro ao fazer upload do arquivo');
      if (err.response?.data?.errors) {
        console.error('Erros de validação:', err.response.data.errors);
      }
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

              {validationError && (
                <div className="error-message" style={{ marginBottom: '1rem' }}>
                  <AlertCircle size={16} /> {validationError}
                  {validationOutcome && (
                    <Button
                      variant="secondary"
                      onClick={() => setShowOutcomeModal(true)}
                      style={{ marginLeft: '0.75rem' }}
                    >
                      Ver Detalhes Técnicos
                    </Button>
                  )}
                </div>
              )}
        <div>
          <h1 className="page-title">Resultados</h1>
          <p className="page-subtitle">
            {importJobID 
              ? `Resultados da importação ${importJobID}` 
              : 'Resultados de análises laboratoriais'}
          </p>

          {showOutcomeModal && validationOutcome && (
            <Modal
              isOpen={showOutcomeModal}
              onClose={() => setShowOutcomeModal(false)}
              title="Detalhes Técnicos (FHIR)"
            >
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem' }}>
                {JSON.stringify(validationOutcome, null, 2)}
              </pre>
            </Modal>
          )}
          {importJobID && (
            <div style={{ marginTop: '0.5rem' }}>
              <Button
                variant="secondary"
                onClick={clearFilter}
              >
                <X size={16} /> Limpar Filtro
              </Button>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button
            onClick={() => setShowUploadModal(true)}
            variant="primary"
          >
            <Upload size={18} />
            Importar Resultados
          </Button>
          <Button
            onClick={() => setShowImportSection(!showImportSection)}
            variant="secondary"
          >
            {showImportSection ? 'Ocultar Importação em Lote' : 'Importação em Lote'}
          </Button>
        </div>
      </div>

      {/* Seção de Importação */}
      {showImportSection && (
        <Card style={{ marginBottom: '2rem' }}>
          <h2 style={{ marginBottom: '1.5rem' }}>Importar Resultados</h2>

          {importError && (
            <div className="error-message" style={{ marginBottom: '1rem' }}>
              <AlertCircle size={16} /> {importError}
            </div>
          )}

          <div className="upload-form" style={{ marginBottom: '2rem' }}>
            <div className="form-group">
              <label htmlFor="result-file-input">Arquivo</label>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                Formatos aceitos: .zip, .csv, .raw
              </p>
              <div className="file-input-wrapper">
                <input
                  id="result-file-input"
                  name="result-file"
                  type="file"
                  onChange={handleFileSelect}
                  disabled={validating || creating || isPolling}
                  accept=".zip,.csv,.raw"
                />
                {selectedFile && (
                  <div className="file-info" style={{ marginTop: '0.5rem', padding: '0.5rem', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
                    <FileText size={16} /> {selectedFile.name} ({(selectedFile.size / 1024).toFixed(2)} KB)
                  </div>
                )}
                {validationError && (
                  <div style={{ marginTop: '0.5rem', padding: '0.5rem', backgroundColor: '#ffebee', borderRadius: '4px', color: '#c62828', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <AlertCircle size={16} /> {validationError}
                  </div>
                )}
                {currentJob && isPolling && (
                  <div style={{ marginTop: '0.5rem', padding: '0.5rem', backgroundColor: '#e3f2fd', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Clock size={16} /> Status: {currentJob.status} - Progresso: {currentJob.progress}%
                  </div>
                )}
              </div>
            </div>

            <Button
              onClick={handleUpload}
              disabled={!selectedFile || validating || creating || isPolling}
              style={{ marginTop: '1rem' }}
            >
              {validating ? (
                <>Validando...</>
              ) : creating ? (
                <>Criando job...</>
              ) : isPolling && currentJob ? (
                <>Processando... {currentJob.progress}%</>
              ) : (
                <>
                  <Upload size={18} /> Fazer Upload
                </>
              )}
            </Button>

            <h3 style={{ marginBottom: '1rem' }}>Histórico de Importações</h3>
            {importJobs.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)' }}>Nenhuma importação realizada ainda</p>
            ) : (
              <div className="jobs-list">
                {importJobs.map((job) => (
                  <div key={job.jobID} className="job-item" style={{ 
                    padding: '1rem', 
                    border: '1px solid #e0e0e0', 
                    borderRadius: '6px', 
                    marginBottom: '0.75rem' 
                  }}>
                    <div className="job-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div className="job-info" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        {getStatusIcon(job.status)}
                        <div>
                          <h4 style={{ margin: 0, fontSize: '0.95rem' }}>{job.fileName}</h4>
                          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {new Date(job.createdAt || '').toLocaleString('pt-BR')}
                          </p>
                        </div>
                      </div>
                      <div className="job-status" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <span className={`status-badge ${job.status}`} style={{
                          padding: '0.25rem 0.75rem',
                          borderRadius: '9999px',
                          fontSize: '0.75rem',
                          fontWeight: 500,
                          backgroundColor: job.status === 'completed' ? '#d1fae5' : job.status === 'failed' ? '#fee2e2' : '#fef3c7',
                          color: job.status === 'completed' ? '#065f46' : job.status === 'failed' ? '#991b1b' : '#92400e'
                        }}>
                          {getStatusLabel(job.status)}
                        </span>
                        {job.status === 'completed' && (
                          <Button
                            variant="primary"
                            onClick={() => {
                              const newParams = new URLSearchParams(searchParams);
                              newParams.set('importJobID', job.jobID);
                              setSearchParams(newParams);
                              setShowImportSection(false);
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
                      <div className="job-metrics" style={{ 
                        marginTop: '0.75rem', 
                        display: 'flex', 
                        gap: '1rem', 
                        fontSize: '0.85rem',
                        color: 'var(--text-secondary)'
                      }}>
                        <span>Total: {job.metrics.totalRecords}</span>
                        <span style={{ color: 'var(--success)' }}>Sucesso: {job.metrics.successfulRecords}</span>
                        {job.metrics.failedRecords > 0 && (
                          <span style={{ color: 'var(--danger)' }}>Falhas: {job.metrics.failedRecords}</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {loading && <p>Carregando...</p>}
      {error && <p style={{ color: 'var(--danger)' }}>Erro: {error}</p>}

      <Card>
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
                  <span style={{ color: 'var(--success)', fontSize: '0.875rem' }}>
                    Amostra #{result.sampleID}
                  </span>
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

      <AnalysisUploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onSuccess={() => {
          loadResults();
        }}
      />

      {/* Modal de Relatório de Importação */}
      {showReportModal && selectedJob && (
        <Modal
          isOpen={showReportModal}
          onClose={() => setShowReportModal(false)}
          title="Relatório de Importação"
        >
          <div className="import-report">
            <div className="report-header" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ margin: 0 }}>{selectedJob.fileName}</h3>
              <span className={`status-badge ${selectedJob.status}`} style={{
                padding: '0.25rem 0.75rem',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                fontWeight: 500,
                backgroundColor: selectedJob.status === 'completed' ? '#d1fae5' : selectedJob.status === 'failed' ? '#fee2e2' : '#fef3c7',
                color: selectedJob.status === 'completed' ? '#065f46' : selectedJob.status === 'failed' ? '#991b1b' : '#92400e'
              }}>
                {getStatusLabel(selectedJob.status)}
              </span>
            </div>

            {selectedJob.metrics && (
              <div className="report-metrics" style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.75rem' }}>Métricas</h4>
                <div className="metrics-grid" style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', 
                  gap: '1rem' 
                }}>
                  <div className="metric-item">
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Total de Registros</label>
                    <span style={{ fontSize: '1.25rem', fontWeight: 600 }}>{selectedJob.metrics.totalRecords}</span>
                  </div>
                  <div className="metric-item">
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Sucesso</label>
                    <span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--success)' }}>{selectedJob.metrics.successfulRecords}</span>
                  </div>
                  <div className="metric-item">
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Falhas</label>
                    <span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--danger)' }}>{selectedJob.metrics.failedRecords}</span>
                  </div>
                  <div className="metric-item">
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Duplicados</label>
                    <span style={{ fontSize: '1.25rem', fontWeight: 600 }}>{selectedJob.metrics.duplicatesFound}</span>
                  </div>
                  {selectedJob.metrics.processingTime && (
                    <div className="metric-item">
                      <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Tempo de Processamento</label>
                      <span style={{ fontSize: '1.25rem', fontWeight: 600 }}>{selectedJob.metrics.processingTime.toFixed(2)}s</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {selectedJob.validationErrors && selectedJob.validationErrors.length > 0 && (
              <div className="report-errors" style={{ marginBottom: '1rem' }}>
                <h4 style={{ marginBottom: '0.75rem' }}>Erros de Validação</h4>
                <div className="errors-list" style={{ 
                  maxHeight: '200px', 
                  overflowY: 'auto',
                  padding: '0.75rem',
                  backgroundColor: '#fee2e2',
                  borderRadius: '4px'
                }}>
                  {selectedJob.validationErrors.slice(0, 10).map((error, index) => (
                    <div key={index} style={{ marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                      {error.row && <span>Linha {error.row}: </span>}
                      {error.field && <span>{error.field}: </span>}
                      {error.message}
                    </div>
                  ))}
                  {selectedJob.validationErrors.length > 10 && (
                    <p style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>... e mais {selectedJob.validationErrors.length - 10} erros</p>
                  )}
                </div>
              </div>
            )}

            {selectedJob.processingErrors && selectedJob.processingErrors.length > 0 && (
              <div className="report-errors">
                <h4 style={{ marginBottom: '0.75rem' }}>Erros de Processamento</h4>
                <div className="errors-list" style={{ 
                  maxHeight: '200px', 
                  overflowY: 'auto',
                  padding: '0.75rem',
                  backgroundColor: '#fee2e2',
                  borderRadius: '4px'
                }}>
                  {selectedJob.processingErrors.map((error, index) => (
                    <div key={index} style={{ marginBottom: '0.5rem', fontSize: '0.85rem' }}>{error}</div>
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

