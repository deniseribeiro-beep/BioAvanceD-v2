import { useState, useMemo, Fragment, CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import { Edit, Trash2, Search, ArrowLeft } from 'lucide-react';
import StatusBadge, { ConsentStatus } from '../components/Consent/StatusBadge';
import SignaturePad from '../components/Consent/SignaturePad';
import { Patient } from '../types/models';
import { usePatients } from '../hooks/usePatients';
import { useAuth } from '../contexts/AuthContext';
import { dataImportService, patientService } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';
import ImportResultSummary, { type ImportResultSummaryData } from '../components/ImportResultSummary';
import { convertExcelFileToFhirBundle, downloadFhirExcelTemplate } from '../utils/fhirExcelImport';
import './PatientsPage.css';

const styles: Record<string, CSSProperties> = {
  consentActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  consentActionButton: {
    padding: '0.3rem 0.6rem',
    fontSize: '0.75rem'
  },
  consentStatusCell: {
    display: 'flex',
    alignItems: 'center'
  },
  consentHint: {
    fontSize: '0.8rem',
    color: 'var(--text-light)'
  },
  importInfoPanel: {
    marginBottom: '1rem',
    padding: '0.9rem 1rem',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    backgroundColor: 'var(--surface)'
  }
};

export default function PatientsPage() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { patients, loading, error, deletePatient, loadPatients } = usePatients();
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [searchResults, setSearchResults] = useState<Patient[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [resendingConsentFor, setResendingConsentFor] = useState<string | null>(null);
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [activePatientId, setActivePatientId] = useState<string | null>(null);
  const [consentOverrides, setConsentOverrides] = useState<Record<string, ConsentStatus>>({});
  const canImportPatients = user?.roleName === 'Administrador' || user?.roleName === 'Coordenador' || user?.accessType === 3 || user?.accessType === 4;

  const isConnectionError = (errorMessage?: string) => {
    const normalized = String(errorMessage || '').toLowerCase();
    return normalized.includes('econnrefused') || normalized.includes('network error') || normalized.includes('backend não está disponível') || normalized.includes('backend is unavailable');
  };

  const normalizeConsentStatus = (value?: string): ConsentStatus => {
    const normalized = (value || '').trim().toUpperCase();
    if (normalized === 'GRANTED' || normalized === 'SIGNED') return 'GRANTED';
    if (normalized === 'REVOKED') return 'REVOKED';
    if (normalized === 'PENDING' || normalized === 'PENDING_CONSENT') return 'PENDING';
    return 'EXPIRED';
  };

  const handleOpenSignatureModal = (patientID: string) => {
    setActivePatientId(patientID);
    setIsSignatureModalOpen(true);
  };

  const handleCloseSignatureModal = () => {
    setIsSignatureModalOpen(false);
    setActivePatientId(null);
  };

  const handleConfirmSignature = (_dataUrl: string) => {
    if (!activePatientId) return;
    setConsentOverrides((prev) => ({
      ...prev,
      [activePatientId]: 'GRANTED'
    }));
    setIsSignatureModalOpen(false);
    setActivePatientId(null);
  };
  
  // Handler para busca de pacientes
  const handleSearch = async (term: string) => {
    if (!term || term.trim().length === 0) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    setIsSearching(true);
    try {
      const response = await patientService.search(term.trim());
      if (response.data) {
        const responseData = response.data as any;
        const data = responseData.data || responseData;
        const results = data.patients || [];
        setSearchResults(results);
        setShowSearchResults(true);
      } else {
        setSearchResults([]);
        setShowSearchResults(false);
      }
    } catch (err: any) {
      console.error('Erro ao buscar pacientes:', err);
      setSearchResults([]);
      setShowSearchResults(false);
      alert(t('patients.searchError'));
    } finally {
      setIsSearching(false);
    }
  };

  // Handler para limpar busca
  const handleClearSearch = () => {
    setSearchTerm('');
    setSearchResults([]);
    setShowSearchResults(false);
    loadPatients();
  };

  // Usa apenas pacientes reais do banco de dados ou resultados da busca
  const displayPatients = useMemo(() => {
    // Se há busca ativa e resultados, mostra os resultados da busca
    if (showSearchResults && searchResults.length > 0) {
      return searchResults.filter(p => p && (p.patientID || (p as any).id));
    }
    
    // Caso contrário, retorna pacientes normais
    if (patients && Array.isArray(patients) && patients.length > 0) {
      // Verifica se os pacientes têm patientID válido
      return patients.filter(p => p && (p.patientID || (p as any).id));
    }
    // Retorna array vazio se não houver pacientes
    return [];
  }, [patients, searchResults, showSearchResults]);

  const handleEdit = async (patient: Patient) => {
    try {
      const patientIDStr = patient?.patientID ? String(patient.patientID) : '';
      const fallbackId = (patient as any)?._id || (patient as any)?.id || '';

      const response = patientIDStr && /^\d{8}$/.test(patientIDStr)
        ? await patientService.findForEdit(patientIDStr)
        : fallbackId
          ? await patientService.getById(String(fallbackId))
          : null;

      if (!response) {
        throw new Error(t('patients.patientNotFound'));
      }
      
      // Verifica se a resposta foi bem-sucedida
      if (response && response.data) {
        // Se response.data tem uma propriedade data, usa ela
        const responseData = response.data as any;
        const patientData = responseData.data || responseData;
        
        // Verifica se não é um erro
        if (patientData && !patientData.error && patientData.patientID) {
          navigate('/next/intake', { state: { patient: patientData } });
        } else {
          throw new Error(patientData?.error || responseData?.error || t('patients.patientNotFound'));
        }
      } else {
        throw new Error(t('patients.invalidServerResponse'));
      }
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message || t('patients.editError');
      alert(errorMessage);
    }
  };

  const handleDelete = async (id: number | string) => {
    if (confirm(t('patients.deleteConfirm'))) {
      try {
        // Converte para string e garante que seja um patientID válido
        const patientIDStr = String(id);
        
        // Valida formato do ID (deve ser 8 dígitos)
        if (patientIDStr.length !== 8 || !/^\d{8}$/.test(patientIDStr)) {
          alert(t('patients.invalidPatientID'));
          return;
        }
        
        // Usa patientID como string para deletar
        await deletePatient(patientIDStr);
        setShowSearchResults(false);
        setSearchResults([]);
        // Recarrega a lista após deletar
        await loadPatients();
        alert(t('patients.deleteSuccess'));
      } catch (err: any) {
        const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message || t('patients.deleteError');
        alert(errorMessage);
      }
    }
  };

  const handleSendTcleLink = async (patientID: string) => {
    const normalizedPatientID = String(patientID || '').trim();
    if (!normalizedPatientID) {
      alert('Paciente sem ID válido para envio de link TCLE.');
      return;
    }

    setResendingConsentFor(normalizedPatientID);
    try {
      await patientService.resendConsentNotification(normalizedPatientID);
      await loadPatients();
      alert(t('patients.notificationsResent'));
    } catch (err: any) {
      const errorMsg = err.response?.data?.message || err.message || t('patients.notificationsResendError');
      alert(errorMsg);
    } finally {
      setResendingConsentFor(null);
    }
  };

  const getButtonLabel = (key: string, en: string, es: string) => {
    if (language === 'en-US') return en;
    if (language === 'es-ES') return es;
    return t(key);
  };

  const getPatientsActionLabel = (key: string, en: string, es: string) => {
    if (language === 'en-US') return en;
    if (language === 'es-ES') return es;
    return t(key);
  };

  // Estado para importação FHIR
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importedFile, setImportedFile] = useState<File | null>(null);
  const [importedJson, setImportedJson] = useState<any>(null);
  const [importExcelFile, setImportExcelFile] = useState<File | null>(null);
  const [fhirImportStep, setFhirImportStep] = useState(1);
  const [fhirBatchId, setFhirBatchId] = useState('');
  const [fhirBatch, setFhirBatch] = useState<any>(null);
  const [fhirStagingRows, setFhirStagingRows] = useState<any[]>([]);
  const [fhirConsentSummary, setFhirConsentSummary] = useState<any>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResultSummaryData | null>(null);

  const resetFhirImportState = () => {
    setIsImportModalOpen(false);
    setImportedFile(null);
    setImportedJson(null);
    setImportExcelFile(null);
    setFhirImportStep(1);
    setFhirBatchId('');
    setFhirBatch(null);
    setFhirStagingRows([]);
    setFhirConsentSummary(null);
    setImportResult(null);
  };

  const getFhirResourceCount = (resourceType: string) => {
    if (!importedJson?.entry || !Array.isArray(importedJson.entry)) return 0;
    return importedJson.entry.filter((entry: any) => entry?.resource?.resourceType === resourceType).length;
  };

  const getReadyToCommitCount = () => fhirStagingRows.filter((row) => row.status === 'READY_TO_COMMIT').length;
  const getValidWithEmailCount = () => fhirStagingRows.filter((row) => row.status === 'VALID' && row.normalized?.patientEmail).length;
  const getFhirValidationSummary = () => {
    const counts = fhirBatch?.counts || {};
    return {
      total: counts.total ?? fhirStagingRows.length,
      valid: counts.valid ?? fhirStagingRows.filter((row) => row.status === 'VALID').length,
      pendingConsent: counts.pendingConsent ?? fhirStagingRows.filter((row) => row.status === 'PENDING_CONSENT').length,
      errors: counts.errors ?? fhirStagingRows.filter((row) => row.status === 'ERROR' || row.status === 'NEEDS_EMAIL' || row.status === 'CONSENT_SEND_FAILED').length,
      readyToCommit: counts.readyToCommit ?? fhirStagingRows.filter((row) => row.status === 'READY_TO_COMMIT').length,
    };
  };

  const refreshFhirBatchState = (data: any) => {
    const batch = data?.batch || data?.data?.batch || null;
    const records = data?.records || data?.data?.records || [];
    setFhirBatch(batch);
    setFhirStagingRows(Array.isArray(records) ? records : []);
    const nextBatchId = String(batch?._id || batch?.id || data?.batchId || data?.data?.batchId || fhirBatchId || '');
    if (nextBatchId) setFhirBatchId(nextBatchId);
  };

  const handleExcelFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportExcelFile(e.target.files?.[0] || null);
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
    } catch (err: any) {
      alert(err?.message || 'Não foi possível converter o Excel para JSON FHIR.');
    } finally {
      setImportLoading(false);
    }
  };

  // Handler para leitura do arquivo
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/json') {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const json = JSON.parse(ev.target?.result as string);
          setImportedFile(file);
          setImportedJson(json);
          setFhirImportStep(2);
          setFhirBatchId('');
          setFhirBatch(null);
          setFhirStagingRows([]);
          setFhirConsentSummary(null);
        } catch (err) {
          alert('Arquivo JSON inválido');
          setImportedFile(null);
          setImportedJson(null);
        }
      };
      reader.readAsText(file);
    } else {
      alert('Selecione um arquivo .json válido');
      setImportedFile(null);
      setImportedJson(null);
    }
  };

  const handleValidateFhirBatch = async () => {
    if (!importedJson) return;
    setImportLoading(true);
    setImportResult(null);
    try {
      const stagedResponse = fhirBatchId
        ? await dataImportService.validateFhirBatch(fhirBatchId)
        : await dataImportService.stageFhirBundle(importedJson);
      const data = stagedResponse?.data || {};
      refreshFhirBatchState(data);
      setFhirImportStep(3);
    } catch (err: any) {
      const errorMessage = err?.response?.data?.error || err?.response?.data?.message || err?.message;
      setImportResult({ success: false, error: errorMessage || 'A importação em lote exige um FHIR R4 Bundle JSON.' });
      alert('Erro ao validar lote: ' + (errorMessage || 'A importação em lote exige um FHIR R4 Bundle JSON.'));
    } finally {
      setImportLoading(false);
    }
  };

  const handleSendFhirConsents = async () => {
    if (!fhirBatchId) return;
    setImportLoading(true);
    try {
      const response = await dataImportService.sendFhirBatchConsents(fhirBatchId);
      const data = response?.data || {};
      refreshFhirBatchState(data);
      const results = data.consentResults || [];
      setFhirConsentSummary({
        sent: results.filter((item: any) => item.sent).length,
        failed: results.filter((item: any) => item.sent === false).length,
        pending: (data.records || []).filter((row: any) => row.status === 'PENDING_CONSENT').length,
      });
      setFhirImportStep(5);
    } catch (err: any) {
      const errorMessage = err?.response?.data?.error || err?.response?.data?.message || err?.message;
      setImportResult({ success: false, error: errorMessage || 'Erro ao enviar TCLEs' });
      alert('Erro ao enviar TCLEs: ' + (errorMessage || 'Erro desconhecido'));
    } finally {
      setImportLoading(false);
    }
  };

  const handleCommitFhirBatch = async () => {
    if (!fhirBatchId || getReadyToCommitCount() === 0) return;
    setImportLoading(true);
    try {
      const response = await dataImportService.commitFhirBatch(fhirBatchId);
      refreshFhirBatchState(response?.data || {});
      setImportResult({ success: true, message: 'Registros assinados salvos com sucesso.' });
      await loadPatients();
    } catch (err: any) {
      const errorMessage = err?.response?.data?.error || err?.response?.data?.message || err?.message;
      setImportResult({ success: false, error: errorMessage || 'Erro ao salvar registros assinados' });
    } finally {
      setImportLoading(false);
    }
  };

  return (
    <div className="page patients-page" data-testid="patients-page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Button data-testid="patients-back-button" onClick={() => navigate('/dashboard')} variant="secondary" style={{ minWidth: 'auto' }}>
            <ArrowLeft size={18} />
          </Button>
          <div>
            <h1 className="page-title">{t('patients.title')}</h1>
            <p className="page-subtitle">{t('patients.subtitle')}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {canImportPatients && (
            <Button data-testid="patients-import-fhir-button" variant="primary" onClick={() => navigate('/patients/import-fhir')}>
              Importar FHIR
            </Button>
          )}
          <div style={{ 
            position: 'relative', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.5rem',
            minWidth: '300px',
            flex: 1,
            maxWidth: '400px'
          }}>
            <Search size={18} style={{ color: 'var(--text-light)', flexShrink: 0 }} />
            <input
              data-testid="patients-search-input"
              type="text"
              placeholder={t('patients.searchPlaceholder')}
              value={searchTerm}
              onChange={(e) => {
                const value = e.target.value;
                setSearchTerm(value);
                if (value.trim().length >= 2) {
                  const timeoutId = setTimeout(() => {
                    handleSearch(value);
                  }, 500);
                  return () => clearTimeout(timeoutId);
                } else if (value.trim().length === 0) {
                  handleClearSearch();
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSearch(searchTerm);
                } else if (e.key === 'Escape') {
                  handleClearSearch();
                }
              }}
              style={{
                flex: 1,
                padding: '0.5rem 0.75rem',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontSize: '0.875rem',
                backgroundColor: 'var(--surface)',
                color: 'var(--text)',
                outline: 'none'
              }}
            />
            {searchTerm && (
              <button
                data-testid="patients-clear-search-button"
                onClick={handleClearSearch}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0.25rem',
                  display: 'flex',
                  alignItems: 'center',
                  color: 'var(--text-light)',
                  fontSize: '1.25rem',
                  lineHeight: 1
                }}
                title={t('patients.clearSearch')}
              >
                ×
              </button>
            )}
            {isSearching && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', whiteSpace: 'nowrap' }}>{t('common.searching')}</span>
            )}
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <p>{t('patients.loading')}</p>
        </div>
      )}
      
      {error && !isConnectionError(error) && (
        <div style={{ 
          padding: '1rem', 
          backgroundColor: '#fee2e2', 
          border: '1px solid #fca5a5', 
          borderRadius: '6px', 
          marginBottom: '1rem',
          color: '#dc2626'
        }}>
          <strong>{t('patients.loadErrorLabel')}:</strong> {error}
        </div>
      )}

      {error && isConnectionError(error) && (
        <div style={{ 
          padding: '1rem', 
          backgroundColor: '#fee2e2', 
          border: '1px solid #fca5a5', 
          borderRadius: '6px', 
          marginBottom: '1rem',
          color: '#dc2626'
        }}>
          <strong>{t('patients.connectionErrorTitle')}:</strong> {t('patients.connectionErrorMessage')}
        </div>
      )}

      {!loading && !error && patients.length === 0 && (
        <Card>
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <p>{t('patients.noPatients')}</p>
            <p style={{ marginTop: '1rem', color: 'var(--text-light)', fontSize: '0.875rem' }}>
              {t('patients.noPatientsHint')}
            </p>
          </div>
        </Card>
      )}

      {!loading && displayPatients && Array.isArray(displayPatients) && displayPatients.length > 0 && (
      <Card>
        <Table
          data-testid="patients-table"
          headers={[
            t('patients.tableId'),
            t('patients.tableConsent'),
            t('patients.actions'),
          ]}
        >
          {displayPatients.map((patient, index) => {
            const canViewFullData = user?.roleName === 'Administrador' || user?.roleName === 'Coordenador' || user?.accessType === 3 || user?.accessType === 4;
            const patientID = patient.patientID 
              ? String(patient.patientID) 
              : ((patient as any).id ? String((patient as any).id) : `patient-${index}`);
            const rawConsentStatus = consentOverrides[patientID] || (patient as any).consentStatus || (patient as any).status;
            const consentStatus = normalizeConsentStatus(String(rawConsentStatus || ''));
            const isConsentPending = consentStatus === 'PENDING';
            const canCollectSignature = consentStatus !== 'GRANTED';
            
            return (
              <Fragment key={`patient-fragment-${patientID}`}>
                <tr key={`patient-row-${index}-${patientID}`} data-testid={`patient-row-${patientID}`}>
                  <td>{patientID}</td>
                  <td>
                    <div style={styles.consentStatusCell}>
                      <StatusBadge status={consentStatus} />
                    </div>
                  </td>
                  {canViewFullData ? (
                    <td>
                      <div style={styles.consentActions} className="consent-actions">
                        {canCollectSignature ? (
                          <Button
                            data-testid={`collect-signature-button-${patientID}`}
                            variant="primary"
                            onClick={() => handleOpenSignatureModal(patientID)}
                            style={styles.consentActionButton}
                            className="consent-action-button"
                          >
                            {getPatientsActionLabel('patients.collectSignature', 'Collect Signature', 'Recolectar firma')}
                          </Button>
                        ) : (
                          <span style={styles.consentHint}>{t('patients.signed')}</span>
                        )}
                        <Button
                          data-testid={`send-tcle-link-button-${patientID}`}
                          variant="secondary"
                          onClick={() => handleSendTcleLink(patientID)}
                          disabled={resendingConsentFor === patientID}
                          style={styles.consentActionButton}
                          className="consent-action-button"
                        >
                          {resendingConsentFor === patientID
                            ? getPatientsActionLabel('patients.resending', 'Resending...', 'Reenviando...')
                            : 'Enviar Link TCLE'}
                        </Button>
                        {isConsentPending && (
                          <Button
                            data-testid={`resend-consent-button-${patientID}`}
                            variant="secondary"
                            onClick={async () => {
                              setResendingConsentFor(patientID);
                              try {
                                await patientService.resendConsentNotification(patientID);
                                await loadPatients();
                                alert(t('patients.notificationsResent'));
                              } catch (err: any) {
                                const errorMsg = err.response?.data?.message || err.message || t('patients.notificationsResendError');
                                alert(errorMsg);
                              } finally {
                                setResendingConsentFor(null);
                              }
                            }}
                            disabled={resendingConsentFor === patientID}
                            style={styles.consentActionButton}
                            className="consent-action-button"
                          >
                            {resendingConsentFor === patientID
                              ? getPatientsActionLabel('patients.resending', 'Resending...', 'Reenviando...')
                              : getPatientsActionLabel('patients.resendNotifications', 'Resend Notifications', 'Reenviar notificaciones')}
                          </Button>
                        )}
                        <div className="table-actions">
                          <button
                            data-testid={`edit-patient-button-${patientID}`}
                            className="action-button"
                            onClick={() => handleEdit(patient)}
                            title="Editar dados demográficos"
                          >
                            <Edit size={16} />
                          </button>
                          <button
                            data-testid={`delete-patient-button-${patientID}`}
                            className="action-button danger"
                            onClick={() => handleDelete(patientID)}
                            title={t('common.delete')}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </td>
                  ) : (
                    <td>
                      <span style={{ color: 'var(--text-light)', fontSize: '0.875rem' }}>
                        {t('patients.viewOnly')}
                      </span>
                    </td>
                  )}
                </tr>
              </Fragment>
            );
          })}
        </Table>
      </Card>
      )}

      <Modal isOpen={isSignatureModalOpen} onClose={handleCloseSignatureModal} title={t('patients.digitalSignature')}>
        <SignaturePad onConfirm={handleConfirmSignature} onCancel={handleCloseSignatureModal} />
      </Modal>

      {showSearchResults && (
        <div style={{ 
          marginBottom: '1rem',
          padding: '0.75rem 1rem', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          backgroundColor: 'transparent',
          borderBottom: '1px solid var(--border)',
          fontSize: '0.875rem',
          color: 'var(--text-secondary)'
        }}>
          <span>
            <span style={{ color: 'var(--text-light)', marginRight: '0.5rem' }}>{t('patients.search')}</span>
            <span style={{ color: 'var(--text)', fontWeight: 500 }}>"{searchTerm}"</span>
            <span style={{ color: 'var(--text-light)', marginLeft: '0.5rem' }}>
              ({searchResults.length} {searchResults.length === 1 ? t('patients.result') : t('patients.results')})
            </span>
          </span>
          <button
            onClick={handleClearSearch}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-light)',
              cursor: 'pointer',
              fontSize: '0.875rem',
              padding: '0.25rem 0.5rem',
              borderRadius: '4px',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text)';
              e.currentTarget.style.backgroundColor = 'var(--surface)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-light)';
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            title={t('patients.clearSearch')}
          >
            {t('patients.clear')}
          </button>
        </div>
      )}

    </div>
  );
}
