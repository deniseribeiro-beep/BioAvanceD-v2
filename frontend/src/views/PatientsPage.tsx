import { useState, useMemo, Fragment, CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import { Plus, Edit, Trash2, Search, ArrowLeft, Upload, FileSpreadsheet } from 'lucide-react';
import StatusBadge, { ConsentStatus } from '../components/Consent/StatusBadge';
import SignaturePad from '../components/Consent/SignaturePad';
import { Patient, ConsentPolicy } from '../types/models';
import { usePatients } from '../hooks/usePatients';
import { useAuth } from '../contexts/AuthContext';
import { importLGPDService } from '../services/api';
import { patientService, consentService } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';
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
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importProgress, setImportProgress] = useState<string>('');
  const [resendingConsentFor, setResendingConsentFor] = useState<string | null>(null);
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [activePatientId, setActivePatientId] = useState<string | null>(null);
  const [consentOverrides, setConsentOverrides] = useState<Record<string, ConsentStatus>>({});
  const [isBatchImportModalOpen, setIsBatchImportModalOpen] = useState(false);
  const [consentPolicies, setConsentPolicies] = useState<ConsentPolicy[]>([]);
  const [consentPolicySearch, setConsentPolicySearch] = useState('');
  const [selectedConsentTemplateId, setSelectedConsentTemplateId] = useState('');
  const [loadingConsentPolicies, setLoadingConsentPolicies] = useState(false);
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

  const handleConfirmSignature = (dataUrl: string) => {
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

  const handleAdd = () => {
    navigate('/patients/new');
  };

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
          navigate('/patients/new', { state: { patient: patientData } });
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

  const handleImportPatients = async (file?: File) => {
    const fileToImport = file || importFile;
    
    if (!fileToImport) {
      alert(t('patients.selectFile'));
      return;
    }

    setImporting(true);
    setImportProgress(`${t('patients.importFileLabel')}: ${fileToImport.name} (${(fileToImport.size / 1024).toFixed(1)} KB)`);
    
    try {
      if (!selectedConsentTemplateId) {
        alert(t('patients.consentTemplateRequired'));
        return;
      }

      const formData = new FormData();
      formData.append('file', fileToImport);
      formData.append('groupFields', JSON.stringify({ consentTemplateId: selectedConsentTemplateId }));

      setImportProgress(`${t('patients.importProcessingLabel')}: ${fileToImport.name}`);

      const response = await importLGPDService.import('patients', formData);
      
      setImportProgress('');
      
      if (response && response.data) {
        if (response.data.success === false) {
          const errorMsg = response.data.error || response.data.message || t('patients.importErrorGeneric');
          throw new Error(errorMsg);
        }
        
        const importData = response.data.data || response.data;
        const message = response.data.message || t('patients.importCompleted');
        
        if (importData) {
          const total = importData.total || 0;
          const success = importData.success || 0;
          const errors = importData.errors || 0;
          const errorsDetails = importData.errorsDetails || [];
          
          if (errors > 0) {
            const isPartial = success > 0;
            let errorMessage = message;
            
            const duplicateErrors = errorsDetails.filter((err: any) => {
              const errorList = Array.isArray(err.errors) ? err.errors : [err.errors || ''];
              return errorList.some((e: string) => e.toLowerCase().includes('duplicado') || e.toLowerCase().includes('duplicate'));
            });
            
            const hasDuplicates = duplicateErrors.length > 0;
            
            if (hasDuplicates && !isPartial) {
              errorMessage = t('patients.importDuplicateBlocked').replace('{count}', String(duplicateErrors.length));
            } else if (hasDuplicates && isPartial) {
              errorMessage += `\n\n${t('patients.importDuplicateWarning').replace('{count}', String(duplicateErrors.length))}`;
            }
            
            if (errorsDetails && errorsDetails.length > 0) {
              errorMessage += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
              errorMessage += `\n${t('patients.importErrorsDetailTitle')}`;
              errorMessage += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
              
              const errorsToShow = errorsDetails.slice(0, 15);
              errorsToShow.forEach((err: any) => {
                const errorList = Array.isArray(err.errors) ? err.errors : [err.errors || t('patients.importUnknownError')];
                const isDuplicate = errorList.some((e: string) => e.toLowerCase().includes('duplicado') || e.toLowerCase().includes('duplicate'));
                
                errorMessage += `\n\n${isDuplicate ? '🔄' : '📌'} ${t('patients.importLineLabel')} ${err.row || 'N/A'}:`;
                errorList.forEach((errorText: string) => {
                  const prefix = errorText.toLowerCase().includes('duplicado') || errorText.toLowerCase().includes('duplicate') ? '   ⚠️ ' : '   • ';
                  errorMessage += `\n${prefix}${errorText}`;
                });
              });
              
              if (errorsDetails.length > 15) {
                errorMessage += `\n\n${t('patients.importMoreErrorsHidden').replace('{count}', String(errorsDetails.length - 15))}`;
              }
              
              errorMessage += '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
              errorMessage += `\n${t('patients.importHowToFix')}`;
              if (hasDuplicates) {
                errorMessage += `\n${t('patients.importFixDuplicatesStep1')}`;
                errorMessage += `\n${t('patients.importFixDuplicatesStep2')}`;
                errorMessage += `\n${t('patients.importFixDuplicatesStep3')}`;
                errorMessage += `\n\n${t('patients.importDuplicateDefinition')}`;
              } else {
                errorMessage += `\n${t('patients.importFixDataStep1')}`;
                errorMessage += `\n${t('patients.importFixDataStep2')}`;
                errorMessage += `\n${t('patients.importFixDataStep3')}`;
              }
            }
            
            setTimeout(() => {
              alert(errorMessage);
            }, 100);
          } else {
            setTimeout(() => {
              alert(t('patients.importSuccessSummary')
                .replace('{total}', String(total))
                .replace('{success}', String(success))
                .replace('{errors}', String(errors))
              );
            }, 100);
          }
        }
        
        setShowSearchResults(false);
        setSearchResults([]);
        await loadPatients();
        
        setTimeout(() => {
          setImportFile(null);
          setImportProgress('');
          const fileInput = document.getElementById('import-file') as HTMLInputElement;
          if (fileInput) {
            fileInput.value = '';
          }
        }, 3000);
      }
    } catch (err: any) {
      console.error('Erro ao importar pacientes:', err);
      let errorMessage = t('patients.importErrorGeneric');
        
        if (err.response) {
          const errorData = err.response.data;
          if (errorData) {
            errorMessage = errorData.message || errorData.error || errorMessage;
          } else {
            errorMessage = t('patients.importServerError')
              .replace('{status}', String(err.response.status || ''))
              .replace('{statusText}', String(err.response.statusText || t('patients.importServerErrorFallback')));
          }
        } else if (err.request) {
          errorMessage = t('patients.importConnectionError');
        } else {
          errorMessage = err.message || errorMessage;
        }
        
        alert(`${t('patients.importErrorTitle')}\n\n${errorMessage}`);
        
        setTimeout(() => {
          setImportFile(null);
          setImportProgress('');
          const fileInput = document.getElementById('import-file') as HTMLInputElement;
          if (fileInput) {
            fileInput.value = '';
          }
        }, 5000);
    } finally {
      setImporting(false);
    }
  };

  const filteredConsentPolicies = useMemo(() => {
    const term = consentPolicySearch.trim().toLowerCase();
    if (!term) return consentPolicies;
    return consentPolicies.filter((policy) => {
      const titleValue = String(policy.title || '').toLowerCase();
      const versionValue = String(policy.version || '').toLowerCase();
      const caaeValue = String(policy.caae || '').toLowerCase();
      return titleValue.includes(term) || versionValue.includes(term) || caaeValue.includes(term);
    });
  }, [consentPolicies, consentPolicySearch]);

  const loadConsentPolicies = async () => {
    setLoadingConsentPolicies(true);
    try {
      const response = await consentService.getAllPolicies();
      const data = (response as any)?.data?.data || [];
      setConsentPolicies(Array.isArray(data) ? data : []);
    } catch (err: any) {
      alert(err?.message || t('patients.consentLoadError'));
      setConsentPolicies([]);
    } finally {
      setLoadingConsentPolicies(false);
    }
  };

  const openBatchImportModal = async (file: File) => {
    setImportFile(file);
    setSelectedConsentTemplateId('');
    setConsentPolicySearch('');
    setIsBatchImportModalOpen(true);
    await loadConsentPolicies();
  };

  const confirmBatchImport = async () => {
    if (!selectedConsentTemplateId) {
      alert(t('patients.consentTemplateRequired'));
      return;
    }
    setIsBatchImportModalOpen(false);
    await handleImportPatients();
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

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Button onClick={() => navigate('/dashboard')} variant="secondary" style={{ minWidth: 'auto' }}>
            <ArrowLeft size={18} />
          </Button>
          <div>
            <h1 className="page-title">{t('patients.title')}</h1>
            <p className="page-subtitle">{t('patients.subtitle')}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
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
          <Button 
            onClick={() => {
              importLGPDService.downloadTemplate('patients', 'xlsx')
                .then((response) => {
                  const url = window.URL.createObjectURL(new Blob([response.data]));
                  const link = document.createElement('a');
                  link.href = url;
                  link.setAttribute('download', 'patients_template.xlsx');
                  document.body.appendChild(link);
                  link.click();
                  link.remove();
                  window.URL.revokeObjectURL(url);
                })
                .catch(() => {
                  alert(t('patients.importErrorGeneric'));
                });
            }}
            variant="secondary"
          >
            <FileSpreadsheet size={18} />
            {getButtonLabel('patients.downloadTemplate', 'Download Excel Template', 'Descargar plantilla Excel')}
          </Button>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <input
              type="file"
              id="import-file"
              accept=".csv,.xlsx"
              title={t('patients.importFileTitle')}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const ext = file.name.toLowerCase().split('.').pop();
                  if (ext !== 'csv' && ext !== 'xlsx') {
                    alert(t('patients.importFileTypeError'));
                    e.target.value = '';
                    return;
                  }
                  setImportFile(file);
                  setImportProgress('');
                  setTimeout(() => {
                    openBatchImportModal(file);
                  }, 100);
                }
              }}
              style={{ display: 'none' }}
            />
            <div style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
            <Button
                onClick={(e) => {
                  e.preventDefault();
                  if (importing) {
                    return;
                  }
                  document.getElementById('import-file')?.click();
              }}
              variant="secondary"
              disabled={importing}
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}
            >
              <Upload size={18} />
                {getButtonLabel('patients.importPatients', 'Import Patients', 'Importar pacientes')}
            </Button>
              {importProgress && (
                <div style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-light)',
                  textAlign: 'left',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '250px',
                  paddingLeft: '0.25rem'
                }}>
                  {importProgress}
                </div>
              )}
            </div>
          </div>
          <Button onClick={handleAdd}>
            <Plus size={18} />
            {getButtonLabel('patients.new', 'New Patient', 'Nuevo paciente')}
          </Button>
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
                <tr key={`patient-row-${index}-${patientID}`}>
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
                        {isConsentPending && (
                          <Button
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
                            className="action-button"
                            onClick={() => handleEdit(patient)}
                            title={t('common.edit')}
                          >
                            <Edit size={16} />
                          </button>
                          <button
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

      <Modal
        isOpen={isBatchImportModalOpen}
        onClose={() => setIsBatchImportModalOpen(false)}
        title={t('patients.batchImportModalTitle')}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <p style={{ margin: 0, color: 'var(--text-light)', fontSize: '0.9rem' }}>
            {t('patients.batchImportModalSubtitle')}
          </p>

          <input
            type="text"
            value={consentPolicySearch}
            onChange={(event) => setConsentPolicySearch(event.target.value)}
            placeholder={t('patients.consentTemplateSearchPlaceholder')}
            style={{
              width: '100%',
              padding: '0.5rem',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: '0.875rem',
              backgroundColor: 'var(--surface)',
              color: 'var(--text)'
            }}
          />

          <div style={{
            border: '1px solid var(--border)',
            borderRadius: '8px',
            maxHeight: '220px',
            overflowY: 'auto',
            padding: '0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem'
          }}>
            {loadingConsentPolicies ? (
              <span style={{ color: 'var(--text-light)' }}>{t('patients.loadingConsent')}</span>
            ) : filteredConsentPolicies.length === 0 ? (
              <span style={{ color: 'var(--text-light)' }}>{t('patients.consentTemplateEmpty')}</span>
            ) : (
              filteredConsentPolicies.map((policy) => {
                const policyId = String(policy._id || `${policy.version}-${policy.title}`);
                const isChecked = selectedConsentTemplateId === policyId;
                return (
                  <label key={policyId} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => setSelectedConsentTemplateId(isChecked ? '' : policyId)}
                    />
                    <span>{policy.version} - {policy.title} ({t('patients.caaeLabel')}: {policy.caae || '--'})</span>
                  </label>
                );
              })
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <Button type="button" variant="secondary" onClick={() => setIsBatchImportModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={confirmBatchImport} disabled={!selectedConsentTemplateId || importing}>
              {t('patients.confirmBatchImport')}
            </Button>
          </div>
        </div>
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
