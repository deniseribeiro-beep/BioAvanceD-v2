import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import BarcodeLabel from '../components/BarcodeLabel';
import { Upload, FileText, FileSpreadsheet, ArrowLeft, CheckCircle, XCircle, AlertCircle, Clock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { importLGPDService } from '../services/api';
import { useAsyncImport } from '../hooks/useAsyncImport';
import { useLanguage } from '../contexts/LanguageContext';
import './ImportPage.css';

export default function ImportPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [importType, setImportType] = useState<'patients' | 'samples' | 'locations' | null>(null);
  
  // Hook de importação assíncrona
  const {
    validating,
    creating,
    validationError,
    validationOutcome,
    job,
    isPolling,
    importFile,
    getReport,
    reset,
  } = useAsyncImport();
  const [showBatchLabels, setShowBatchLabels] = useState(false);
  const [batchSamples, setBatchSamples] = useState<Array<{ sampleId: string | number; barcode: string; acronym?: string }>>([]);
  const [loadingLabels, setLoadingLabels] = useState(false);
  const [labelsError, setLabelsError] = useState<string | null>(null);
  const [showOutcomeModal, setShowOutcomeModal] = useState(false);

  const canImportPatients = user?.roleName === 'Administrador' || user?.roleName === 'Coordenador' || user?.accessType === 3 || user?.accessType === 4;
  const canImportSamples = user?.roleName === 'Administrador' || user?.roleName === 'Coordenador' || user?.roleName === 'Técnico' || user?.accessType === 2 || user?.accessType === 3 || user?.accessType === 4;
  const canImportLocations = canImportSamples;

  const normalizeSamplesFromReport = (report: any) => {
    const candidates = [
      report?.samples,
      report?.createdSamples,
      report?.successfulSamples,
      report?.records,
      report?.data?.samples,
      report?.data?.records,
    ];

    const firstList = candidates.find(Array.isArray) || [];

    const mapped = firstList.map((entry: any, index: number) => {
      const fallbackId = `amostra-${index + 1}`;
      const sampleId =
        entry?.sampleID ??
        entry?.sampleId ??
        entry?._id ??
        entry?.id ??
        entry?.resource?.id ??
        entry?.resource?.identifier?.[0]?.value ??
        fallbackId;

      const barcodeValue =
        entry?.barcode ??
        entry?.sampleID ??
        entry?.sampleId ??
        entry?._id ??
        entry?.id ??
        entry?.resource?.identifier?.[0]?.value ??
        sampleId;

      const acronym =
        entry?.acronym ??
        entry?.sampleType ??
        entry?.type ??
        (entry?.patientID ? `P${entry.patientID}` : undefined) ??
        (entry?.resource?.subject?.reference || undefined);

      return {
        sampleId: sampleId || fallbackId,
        barcode: String(barcodeValue || sampleId || fallbackId),
        acronym,
      };
    });

    if (mapped.length > 0) {
      return mapped;
    }

    if (Array.isArray(report?.fhirResources)) {
      return report.fhirResources.map((resource: any, index: number) => {
        const fallbackId = `fhir-${index + 1}`;
        const sampleId = resource?.id || resource?.resource?.id || fallbackId;
        const barcodeValue =
          resource?.identifier?.[0]?.value ||
          resource?.resource?.identifier?.[0]?.value ||
          sampleId;
        const acronym = resource?.resourceType || resource?.resource?.resourceType;
        return {
          sampleId,
          barcode: String(barcodeValue || sampleId || fallbackId),
          acronym,
        };
      });
    }

    return [];
  };

  const handleFileChange = (allowedExtensions: string[]) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      const ext = selectedFile.name.toLowerCase().split('.').pop();
      if (!ext || !allowedExtensions.includes(ext)) {
        setFile(null);
        return;
      }
      setFile(selectedFile);
      reset(); // Reseta estado anterior ao selecionar novo arquivo
    }
  };

  const handleImport = async (type: 'patients' | 'samples' | 'locations') => {
    if (!file) {
      return;
    }

    setImportType(type);
    reset(); // Reseta estado anterior

    try {
      await importFile(file, type, {
        onCompleted: (job) => {
          // Sucesso - job já contém os resultados
          console.log('Importação concluída:', job);
        },
        onFailed: (job) => {
          // Falha - job contém os erros
          console.error('Importação falhou:', job);
        },
      });
    } catch (err: any) {
      console.error('Erro ao iniciar importação:', err);
    }
  };

  // Reseta quando arquivo muda
  useEffect(() => {
    if (!file) {
      reset();
    }
  }, [file, reset]);

  const handleDownloadTemplate = async (type: 'patients' | 'samples', format: 'csv' | 'xlsx') => {
    try {
      const response = await importLGPDService.downloadTemplate(type, format);
      
      // Cria link de download
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${type}_template.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.response?.data?.error || t('import.errors.templateError'));
    }
  };

  const handleDownloadLocationTemplate = () => {
    const headers = ['locationID', 'equipmentType', 'equipmentID', 'block', 'rack', 'drawer', 'box', 'wellPosition'];
    const csvContent = `${headers.join(',')}\n`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'locations_template.csv');
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const handleOpenBatchLabels = async () => {
    if (!job?.jobID) return;
    setLabelsError(null);
    setLoadingLabels(true);
    try {
      const response = await getReport();
      const reportData = (response as any)?.data?.data || (response as any)?.data || response;
      const parsed = normalizeSamplesFromReport(reportData || {});
      setBatchSamples(parsed);
      setShowBatchLabels(true);
      if (!parsed || parsed.length === 0) {
        setLabelsError('Nenhuma amostra retornada para este lote.');
      }
    } catch (err: any) {
      setLabelsError(err?.message || 'Erro ao carregar etiquetas');
    } finally {
      setLoadingLabels(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Button onClick={() => navigate('/dashboard')} variant="secondary" style={{ minWidth: 'auto' }}>
            <ArrowLeft size={18} />
          </Button>
          <div>
            <h1 className="page-title">{t('import.title')}</h1>
            <p className="page-subtitle">{t('import.subtitle')}</p>
          </div>
        </div>
      </div>

      <div className="import-container">
        {/* Importação de Pacientes */}
        <Card className="import-card">
          <div className="import-card-header">
            <h2>{t('import.patients.title')}</h2>
            <p>{t('import.patients.description')}</p>
          </div>

          {!canImportPatients && (
            <div className="import-warning">
              <AlertCircle size={20} />
              <span>{t('import.patients.noPermission')}</span>
            </div>
          )}

          {canImportPatients && (
            <>
              <div className="import-actions">
                <div className="template-downloads">
                  <span>Baixar template:</span>
                  <Button
                    variant="secondary"
                    onClick={() => handleDownloadTemplate('patients', 'xlsx')}
                  >
                    <FileSpreadsheet size={16} />
                    Excel
                  </Button>
                </div>
              </div>

              <div className="import-upload">
                <input
                  type="file"
                  id="patients-file"
                  accept=".csv,.xlsx"
                  onChange={handleFileChange(['csv', 'xlsx'])}
                  disabled={isPolling && importType === 'patients'}
                  style={{ display: 'none' }}
                />
                <label htmlFor="patients-file" className="file-input-label">
                  <Upload size={20} />
                  {file ? file.name : 'Selecione um arquivo CSV ou Excel'}
                </label>
              </div>

              <Button
                onClick={() => handleImport('patients')}
                disabled={!file || validating || creating || (isPolling && importType === 'patients')}
                style={{ marginTop: '1rem', width: '100%' }}
              >
                {validating && importType === 'patients' && 'Validando...'}
                {creating && importType === 'patients' && 'Criando job...'}
                {isPolling && importType === 'patients' && job && `Processando... ${job.progress}%`}
                {!validating && !creating && !(isPolling && importType === 'patients') && t('import.patients.import')}
              </Button>
            </>
          )}
        </Card>

        {/* Importação de Amostras */}
        <Card className="import-card">
          <div className="import-card-header">
            <h2>{t('import.samples.title')}</h2>
            <p>{t('import.samples.description')}</p>
          </div>

          {!canImportSamples && (
            <div className="import-warning">
              <AlertCircle size={20} />
              <span>{t('import.samples.noPermission')}</span>
            </div>
          )}

          {canImportSamples && (
            <>
              <div className="import-actions">
                <div className="template-downloads">
                  <span>{t('import.samples.downloadTemplate')}</span>
                  <Button
                    variant="secondary"
                    onClick={() => handleDownloadTemplate('samples', 'csv')}
                  >
                    <FileText size={16} />
                    CSV
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => handleDownloadTemplate('samples', 'xlsx')}
                  >
                    <FileSpreadsheet size={16} />
                    Excel
                  </Button>
                </div>
              </div>

              <div className="import-upload">
                <input
                  type="file"
                  id="samples-file"
                  accept=".csv,.xlsx"
                  onChange={handleFileChange(['csv', 'xlsx'])}
                  disabled={isPolling && importType === 'samples'}
                  style={{ display: 'none' }}
                />
                <label htmlFor="samples-file" className="file-input-label">
                  <Upload size={20} />
                  {file ? file.name : t('import.samples.selectFile')}
                </label>
              </div>

              <Button
                onClick={() => handleImport('samples')}
                disabled={!file || validating || creating || (isPolling && importType === 'samples')}
                style={{ marginTop: '1rem', width: '100%' }}
              >
                {validating && importType === 'samples' && 'Validando...'}
                {creating && importType === 'samples' && 'Criando job...'}
                {isPolling && importType === 'samples' && job && `Processando... ${job.progress}%`}
                {!validating && !creating && !(isPolling && importType === 'samples') && t('import.samples.import')}
              </Button>
            </>
          )}
        </Card>

        {/* Importação de Localizações */}
        <Card className="import-card">
          <div className="import-card-header">
            <h2>Importação de Localizações</h2>
            <p>Importe localizações em lote via CSV.</p>
          </div>

          {!canImportLocations && (
            <div className="import-warning">
              <AlertCircle size={20} />
              <span>Você não tem permissão para importar localizações.</span>
            </div>
          )}

          {canImportLocations && (
            <>
              <div className="import-actions">
                <div className="template-downloads">
                  <span>Baixar template:</span>
                  <Button
                    variant="secondary"
                    onClick={handleDownloadLocationTemplate}
                  >
                    <FileText size={16} />
                    CSV
                  </Button>
                </div>
              </div>

              <div className="import-upload">
                <input
                  type="file"
                  id="locations-file"
                  accept=".csv"
                  onChange={handleFileChange(['csv'])}
                  disabled={isPolling && importType === 'locations'}
                  style={{ display: 'none' }}
                />
                <label htmlFor="locations-file" className="file-input-label">
                  <Upload size={20} />
                  {file ? file.name : 'Selecione um arquivo CSV'}
                </label>
              </div>

              <Button
                onClick={() => handleImport('locations')}
                disabled={!file || validating || creating || (isPolling && importType === 'locations')}
                style={{ marginTop: '1rem', width: '100%' }}
              >
                {validating && importType === 'locations' && 'Validando...'}
                {creating && importType === 'locations' && 'Criando job...'}
                {isPolling && importType === 'locations' && job && `Processando... ${job.progress}%`}
                {!validating && !creating && !(isPolling && importType === 'locations') && 'Importar Localizações'}
              </Button>
            </>
          )}
        </Card>

        {/* Status do Job de Importação */}
        {job && importType && (
          <Card className="import-result-card">
            <h3>{t('import.result.title')}</h3>
            
            {/* Indicador de Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              {job.status === 'completed' && <CheckCircle size={20} className="status-icon completed" style={{ color: '#4CAF50' }} />}
              {job.status === 'failed' && <XCircle size={20} className="status-icon failed" style={{ color: '#f44336' }} />}
              {(job.status === 'processing' || job.status === 'pending') && <Clock size={20} className="status-icon processing" style={{ color: '#FF9800' }} />}
              <span style={{ fontWeight: 'bold', textTransform: 'capitalize' }}>
                {job.status === 'completed' && 'Concluído'}
                {job.status === 'failed' && 'Falhou'}
                {job.status === 'processing' && 'Processando'}
                {job.status === 'pending' && 'Pendente'}
              </span>
            </div>

            {/* Barra de Progresso */}
            {(job.status === 'processing' || job.status === 'pending') && (
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ 
                  width: '100%', 
                  height: '8px', 
                  backgroundColor: '#e0e0e0', 
                  borderRadius: '4px',
                  overflow: 'hidden'
                }}>
                  <div style={{ 
                    width: `${job.progress}%`, 
                    height: '100%', 
                    backgroundColor: '#4CAF50',
                    transition: 'width 0.3s ease'
                  }} />
                </div>
                <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#666' }}>
                  Progresso: {job.progress}%
                </p>
              </div>
            )}

            {/* Estatísticas */}
            <div className="result-stats">
              <div className="result-stat">
                <span className="stat-label">{t('import.result.totalRecords')}:</span>
                <span className="stat-value">{job.totalRecords}</span>
              </div>
              <div className="result-stat success">
                <CheckCircle size={20} />
                <span className="stat-label">{t('import.result.successful')}:</span>
                <span className="stat-value">{job.successCount}</span>
              </div>
              {job.errorCount > 0 && (
                <div className="result-stat error">
                  <XCircle size={20} />
                  <span className="stat-label">{t('import.result.errors')}:</span>
                  <span className="stat-value">{job.errorCount}</span>
                </div>
              )}
            </div>

            {job.status === 'completed' && importType === 'samples' && (
              <div className="label-print-actions">
                <Button
                  variant="primary"
                  onClick={handleOpenBatchLabels}
                  disabled={loadingLabels}
                  title="Imprimir etiquetas das amostras importadas"
                >
                  🖨️ Imprimir Etiquetas do Lote
                </Button>
                {labelsError && <p className="label-print-error">{labelsError}</p>}
              </div>
            )}

            {/* Detalhes de Erros */}
            {job.errors && job.errors.length > 0 && (
              <div className="errors-details" style={{ marginTop: '1rem' }}>
                <h4>{t('import.result.errorDetails')}:</h4>
                <div className="errors-list">
                  {job.errors.slice(0, 10).map((err: any, index: number) => (
                    <div key={index} className="error-item">
                      <strong>{err.row ? `${t('import.result.row')} ${err.row}:` : 'Erro:'}</strong>
                      <ul>
                        <li>{err.error || (Array.isArray(err.errors) ? err.errors.join(', ') : String(err.errors))}</li>
                      </ul>
                    </div>
                  ))}
                  {job.errors.length > 10 && (
                    <p style={{ fontStyle: 'italic', color: '#666' }}>
                      ... e mais {job.errors.length - 10} erro(s)
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Mensagem de Sucesso */}
            {job.status === 'completed' && job.errorCount === 0 && (
              <div style={{ 
                marginTop: '1rem', 
                padding: '1rem', 
                backgroundColor: '#e8f5e9', 
                borderRadius: '4px',
                color: '#2e7d32'
              }}>
                ✅ {t('import.result.successful')}: Todos os registros foram importados com sucesso!
              </div>
            )}
          </Card>
        )}

        {/* Mensagem de Erro de Validação */}
        {validationError && (
          <Card className="import-error-card">
            <AlertCircle size={20} />
            <span>{validationError}</span>
            {validationOutcome && (
              <Button
                variant="secondary"
                onClick={() => setShowOutcomeModal(true)}
                style={{ marginLeft: '0.75rem' }}
              >
                Ver Detalhes Técnicos
              </Button>
            )}
          </Card>
        )}

        {showBatchLabels && (
          <Modal
            isOpen={showBatchLabels}
            onClose={() => setShowBatchLabels(false)}
            title="Etiquetas das amostras importadas"
          >
            <div className="label-print-scope">
              {loadingLabels ? (
                <p>Carregando etiquetas...</p>
              ) : batchSamples.length === 0 ? (
                <p>Nenhuma amostra retornada para este lote.</p>
              ) : (
                <div className="label-print-grid">
                  {batchSamples.map((sample) => (
                    <div key={String(sample.sampleId)} className="label-item">
                      <BarcodeLabel
                        sampleId={sample.sampleId}
                        barcode={sample.barcode}
                        acronym={sample.acronym}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="label-modal-actions">
                <Button variant="secondary" onClick={() => setShowBatchLabels(false)}>
                  Fechar
                </Button>
                <Button onClick={() => window.print()} disabled={loadingLabels || batchSamples.length === 0}>
                  Imprimir
                </Button>
              </div>
            </div>
          </Modal>
        )}

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
      </div>
    </div>
  );
}
