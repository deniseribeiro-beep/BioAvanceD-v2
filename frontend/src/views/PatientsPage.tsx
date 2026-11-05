import { useState, useMemo, useEffect, Fragment, CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import { Edit, Trash2, Search, ArrowLeft } from 'lucide-react';
import StatusBadge from '../components/Consent/StatusBadge';
import InPersonConsentModal from '../components/Consent/InPersonConsentModal';
import { Patient } from '../types/models';
import { usePatients } from '../hooks/usePatients';
import { useAuth } from '../contexts/AuthContext';
import { patientService } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';
import { hasConsentRecord, normalizeConsentStatus } from './patientsConsentStatus';

const DIRECTORY_REFRESH_MS = 15_000;

const styles: Record<string, CSSProperties> = {
  consentActions: {
    display: 'grid',
    gridTemplateColumns: '11rem 13.5rem 11rem auto',
    alignItems: 'center',
    columnGap: '0.5rem'
  },
  consentActionButton: {
    padding: '0.3rem 0.6rem',
    fontSize: '0.75rem'
  },
  consentStatusCell: {
    display: 'flex',
    alignItems: 'center'
  }
};

export default function PatientsPage() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { patients, loading, error, deletePatient, loadPatients, refreshPatients } = usePatients();
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [searchResults, setSearchResults] = useState<Patient[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [resendingConsentFor, setResendingConsentFor] = useState<string | null>(null);
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [activeParticipantId, setActiveParticipantId] = useState<string | null>(null);
  const canImportPatients = user?.roleName === 'Administrador' || user?.roleName === 'Coordenador' || user?.accessType === 3 || user?.accessType === 4;

  useEffect(() => {
    let intervalId = 0;
    const stop = () => window.clearInterval(intervalId);
    const start = () => {
      stop();
      intervalId = window.setInterval(() => {
        if (!document.hidden) void refreshPatients();
      }, DIRECTORY_REFRESH_MS);
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
        return;
      }
      void refreshPatients();
      start();
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshPatients]);

  const isConnectionError = (errorMessage?: string) => {
    const normalized = String(errorMessage || '').toLowerCase();
    return normalized.includes('econnrefused') || normalized.includes('network error') || normalized.includes('backend não está disponível') || normalized.includes('backend is unavailable');
  };

  const handleOpenSignatureModal = (participantId: string) => {
    setActiveParticipantId(participantId);
    setIsSignatureModalOpen(true);
  };

  const handleCloseSignatureModal = () => {
    setIsSignatureModalOpen(false);
    setActiveParticipantId(null);
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
      return searchResults.filter(p => p && (p.participantId || (p as any).id));
    }
    
    // Caso contrário, retorna pacientes normais
    if (patients && Array.isArray(patients) && patients.length > 0) {
      // Verifica se os pacientes têm participantId válido
      return patients.filter(p => p && (p.participantId || (p as any).id));
    }
    // Retorna array vazio se não houver pacientes
    return [];
  }, [patients, searchResults, showSearchResults]);

  const handleEdit = async (patient: Patient) => {
    try {
      const participantIdStr = patient?.participantId ? String(patient.participantId) : '';
      const fallbackId = (patient as any)?._id || (patient as any)?.id || '';

      const response = participantIdStr && /^\d{8}$/.test(participantIdStr)
        ? await patientService.findForEdit(participantIdStr)
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
        if (patientData && !patientData.error && patientData.participantId) {
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
        // Converte para string e garante que seja um participantId válido
        const participantIdStr = String(id);
        
        // Valida formato do ID (deve ser 8 dígitos)
        if (participantIdStr.length !== 8 || !/^\d{8}$/.test(participantIdStr)) {
          alert(t('patients.invalidparticipantId'));
          return;
        }
        
        // Usa participantId como string para deletar
        await deletePatient(participantIdStr);
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

  const handleSendTcleLink = async (participantId: string) => {
    const normalizedparticipantId = String(participantId || '').trim();
    if (!normalizedparticipantId) {
      alert('Paciente sem ID válido para envio de link TCLE.');
      return;
    }

    setResendingConsentFor(normalizedparticipantId);
    try {
      await patientService.resendConsentNotification(normalizedparticipantId);
      await loadPatients();
      alert(t('patients.notificationsResent'));
    } catch (err: any) {
      const errorMsg = err.response?.data?.message || err.message || t('patients.notificationsResendError');
      alert(errorMsg);
    } finally {
      setResendingConsentFor(null);
    }
  };

  const getPatientsActionLabel = (key: string, en: string, es: string) => {
    if (language === 'en-US') return en;
    if (language === 'es-ES') return es;
    return t(key);
  };

  return (
    <div className="page-shell patients-page" data-testid="patients-page">
      <div className="page-header" style={{ alignItems: 'center', flexWrap: 'nowrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
          <Button data-testid="patients-back-button" aria-label={t('common.back')} onClick={() => navigate('/dashboard')} variant="secondary" style={{ minWidth: 'auto' }}>
            <ArrowLeft size={18} />
          </Button>
          <div>
            <h1 className="page-title">{t('patients.title')}</h1>
            <p className="page-subtitle">{t('patients.subtitle')}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {canImportPatients && (
            <Button data-testid="patients-import-fhir-button" variant="primary" onClick={() => navigate('/import/lgpd')}>
              Importar dados
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
          // RNF027 C2 (#1324): #dc2626 on #fee2e2 is 3.9:1; this is 6.8:1.
          color: '#991b1b'
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
          // RNF027 C2 (#1324): #dc2626 on #fee2e2 is 3.9:1; this is 6.8:1.
          color: '#991b1b'
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
            t('patients.recordNumber'),
            t('patients.birthDate'),
            t('patients.tableConsent'),
            t('patients.actions'),
          ]}
        >
          {displayPatients.map((patient, index) => {
            const canViewFullData = user?.roleName === 'Administrador' || user?.roleName === 'Coordenador' || user?.accessType === 3 || user?.accessType === 4;
            const participantId = patient.participantId 
              ? String(patient.participantId) 
              : ((patient as any).id ? String((patient as any).id) : `patient-${index}`);
            const rawConsentStatus = (patient as any).consentStatus || (patient as any).status;
            const consentStatus = normalizeConsentStatus(String(rawConsentStatus || ''));
            const isConsentPending = consentStatus === 'PENDING';
            const canCollectSignature = consentStatus !== 'GRANTED';
            
            return (
              <Fragment key={`patient-fragment-${participantId}`}>
                <tr key={`patient-row-${index}-${participantId}`} data-testid={`patient-row-${participantId}`}>
                  <td>{participantId}</td>
                  <td>{patient.recordNumber || ''}</td>
                  <td>{patient.birthDate || ''}</td>
                  <td>
                    <div style={styles.consentStatusCell}>
                      <StatusBadge status={consentStatus} />
                    </div>
                  </td>
                  {canViewFullData ? (
                    <td>
                      <div style={styles.consentActions} className="consent-actions">
                        <div>
                          {canCollectSignature && (
                            <Button
                              data-testid={`collect-signature-button-${participantId}`}
                              variant="primary"
                              onClick={() => handleOpenSignatureModal(participantId)}
                              style={styles.consentActionButton}
                              className="consent-action-button"
                            >
                              {getPatientsActionLabel('patients.collectSignature', 'Collect Signature', 'Recolectar firma')}
                            </Button>
                          )}
                        </div>
                        <div>
                          {isConsentPending && (
                            <Button
                              data-testid={`send-tcle-link-button-${participantId}`}
                              variant="secondary"
                              onClick={() => handleSendTcleLink(participantId)}
                              disabled={resendingConsentFor === participantId}
                              style={styles.consentActionButton}
                              className="consent-action-button"
                            >
                              {resendingConsentFor === participantId
                                ? getPatientsActionLabel('patients.resending', 'Resending...', 'Reenviando...')
                                : 'Enviar TCLE por e-mail'}
                            </Button>
                          )}
                        </div>
                        <div>
                          {hasConsentRecord(String(rawConsentStatus || '')) && (
                            <Button
                              data-testid={`consent-history-button-${participantId}`}
                              variant="secondary"
                              onClick={() => navigate(`/consents?participantId=${encodeURIComponent(participantId)}`)}
                              style={styles.consentActionButton}
                              className="consent-action-button"
                            >
                              Histórico do TCLE
                            </Button>
                          )}
                        </div>
                        <div className="table-actions">
                          <button
                            data-testid={`edit-patient-button-${participantId}`}
                            className="action-button"
                            onClick={() => handleEdit(patient)}
                            title="Editar dados demográficos"
                          >
                            <Edit size={16} />
                          </button>
                          <button
                            data-testid={`delete-patient-button-${participantId}`}
                            className="action-button danger"
                            onClick={() => handleDelete(participantId)}
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

      <InPersonConsentModal
        isOpen={isSignatureModalOpen}
        participantId={activeParticipantId}
        title={t('patients.digitalSignature')}
        onClose={handleCloseSignatureModal}
        onSaved={loadPatients}
      />

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

