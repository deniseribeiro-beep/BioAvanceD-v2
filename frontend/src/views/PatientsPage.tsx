import { useState, useMemo, useRef, Fragment, CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import { Plus, Edit, Trash2, Search, ArrowLeft, Upload } from 'lucide-react';
import StatusBadge, { ConsentStatus } from '../components/Consent/StatusBadge';
import SignaturePad from '../components/Consent/SignaturePad';
import { Patient } from '../types/models';
import { usePatients } from '../hooks/usePatients';
import { useAuth } from '../contexts/AuthContext';
import { consentService, importLGPDService, patientService } from '../services/api';
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
  },
  importInfoPanel: {
    marginBottom: '1rem',
    padding: '0.9rem 1rem',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    backgroundColor: 'var(--surface)'
  },
  importWarningText: {
    margin: 0,
    color: 'var(--warning)',
    fontSize: '0.9rem',
    fontWeight: 600
  },
  importPanelActions: {
    marginTop: '0.6rem',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.75rem',
    alignItems: 'center'
  },
  importHelpButton: {
    background: 'none',
    border: 'none',
    color: 'var(--text)',
    textDecoration: 'underline',
    cursor: 'pointer',
    padding: 0,
    fontSize: '0.875rem'
  }
};

type SmartImportMetadata = {
  acceptedExtensions?: string[];
  invalidRowPolicy?: {
    code?: string;
    message?: string;
  };
  requiredFields?: Array<{
    field: string;
    label: string;
    description?: string;
  }>;
  conditionalRules?: Array<{
    when: string;
    requiredFields?: string[];
    message?: string;
  }>;
  consentTemplates?: {
    available?: boolean;
    count?: number;
    items?: Array<{
      _id: string;
      title?: string;
      version?: string;
      caae?: string;
      active?: boolean;
    }>;
  };
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
  const [isSmartImportingPatients, setIsSmartImportingPatients] = useState(false);
  const [isBulkImportSummaryModalOpen, setIsBulkImportSummaryModalOpen] = useState(false);
  const [isBulkImportConfigModalOpen, setIsBulkImportConfigModalOpen] = useState(false);
  const [smartImportMetadata, setSmartImportMetadata] = useState<SmartImportMetadata | null>(null);
  const [selectedBulkImportConsentTemplateId, setSelectedBulkImportConsentTemplateId] = useState('');
  const [bulkConsentTemplateSearch, setBulkConsentTemplateSearch] = useState('');
  const [pendingBulkImportFile, setPendingBulkImportFile] = useState<File | null>(null);
  const [bulkImportSummary, setBulkImportSummary] = useState<{
    fileName: string;
    totalProcessed: number;
    totalFailures: number;
    hash: string;
    errorMessage?: string;
    firstErrorDetail?: string;
    summaryReportId?: string;
    errorsDetails?: string[];
  } | null>(null);
  const [showImportErrorDetails, setShowImportErrorDetails] = useState(false);
  const [loadingImportErrorDetails, setLoadingImportErrorDetails] = useState(false);
  const [importErrorDetails, setImportErrorDetails] = useState<string[]>([]);
  const [copyingImportErrors, setCopyingImportErrors] = useState(false);
  const bulkImportInputRef = useRef<HTMLInputElement | null>(null);
  const canImportPatients = user?.roleName === 'Administrador' || user?.roleName === 'Coordenador' || user?.accessType === 3 || user?.accessType === 4;
  const hasSelectableConsentTemplates = Array.isArray(smartImportMetadata?.consentTemplates?.items) && smartImportMetadata.consentTemplates.items.length > 0;
  const filteredBulkConsentTemplates = useMemo(() => {
    const items = Array.isArray(smartImportMetadata?.consentTemplates?.items)
      ? smartImportMetadata.consentTemplates.items
      : [];
    const term = String(bulkConsentTemplateSearch || '').trim().toLowerCase();
    if (!term) return items;

    return items.filter((template) => {
      const version = String(template.version || '').toLowerCase();
      const title = String(template.title || '').toLowerCase();
      const caae = String(template.caae || '').toLowerCase();
      return version.includes(term) || title.includes(term) || caae.includes(term);
    });
  }, [smartImportMetadata, bulkConsentTemplateSearch]);

  const fallbackRequiredFields = useMemo(() => ([
    { field: 'patientName', label: 'Nome do paciente', description: 'Nome completo do paciente.' },
    { field: 'birthDate', label: 'Data de nascimento', description: 'Preenchimento obrigatório no formato DD/MM/AAAA (ex.: 31/12/1990). Também aceito: AAAA-MM-DD (ex.: 1990-12-31).' },
    { field: 'sex', label: 'Sexo', description: 'Valores aceitos: M, F ou O.' },
    { field: 'email', label: 'Email', description: 'Email válido para envio de TCLE e notificações.' },
    { field: 'consentTemplateId', label: 'Template de consentimento (TCLE)', description: 'Selecione um TCLE existente no próprio sistema para aplicar na importação em lote.' },
  ]), []);

  const fallbackConditionalRules = useMemo(() => ([
    {
      when: 'Paciente falecido = Sim',
      requiredFields: ['representativeName', 'representativeEmail'],
      message: 'Para paciente falecido, nome e email do responsável são obrigatórios.'
    }
  ]), []);

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

  const loadSmartImportMetadataWithFallback = async () => {
    try {
      const policiesResponse = await consentService.getAllPolicies();
      const policies = Array.isArray((policiesResponse as any)?.data?.data)
        ? (policiesResponse as any).data.data
        : [];

      const items = policies
        .filter((policy: any) => policy && policy._id)
        .map((policy: any) => ({
          _id: String(policy._id),
          title: String(policy.title || ''),
          version: String(policy.version || ''),
          caae: String(policy.caae || '--'),
          active: Boolean(policy.active)
        }));

      setSmartImportMetadata((prev) => ({
        ...(prev || {}),
        consentTemplates: {
          available: items.length > 0,
          count: items.length,
          items
        }
      }));
    } catch {
      setSmartImportMetadata(null);
    }
  };

  const handleOpenBulkImport = async () => {
    if (!canImportPatients) {
      alert(t('import.patients.noPermission'));
      return;
    }
    if (isSmartImportingPatients) return;
    bulkImportInputRef.current?.click();
  };

  const mapErrorsToMessages = (errorsDetails: any[]): string[] => {
    if (!Array.isArray(errorsDetails)) return [];

    return errorsDetails
      .flatMap((entry) => {
        const row = entry?.row ? `Linha ${entry.row}: ` : '';
        if (Array.isArray(entry?.errors) && entry.errors.length > 0) {
          return entry.errors.map((message: any) => `${row}${String(message || '').trim()}`.trim());
        }
        if (entry?.error) {
          return [`${row}${String(entry.error || '').trim()}`.trim()];
        }
        return [];
      })
      .filter((message) => Boolean(String(message || '').trim()));
  };

  const handleOpenImportErrorDetails = async () => {
    if (!bulkImportSummary || (bulkImportSummary.totalFailures || 0) <= 0) return;

    setShowImportErrorDetails(true);

    if (Array.isArray(bulkImportSummary.errorsDetails) && bulkImportSummary.errorsDetails.length > 0) {
      setImportErrorDetails(bulkImportSummary.errorsDetails);
      return;
    }

    const summaryReportId = String(bulkImportSummary.summaryReportId || '').trim();
    if (!summaryReportId) {
      setImportErrorDetails(['Detalhes dos erros indisponíveis para este relatório.']);
      return;
    }

    setLoadingImportErrorDetails(true);
    try {
      const response = await importLGPDService.getSmartImportReports({ page: 1, limit: 20 });
      const reports = Array.isArray((response as any)?.data?.data) ? (response as any).data.data : [];
      const selectedReport = reports.find((item: any) => String(item?._id || '') === summaryReportId);
      const persistedDetails = mapErrorsToMessages(Array.isArray(selectedReport?.errorsDetails) ? selectedReport.errorsDetails : []);
      setImportErrorDetails(persistedDetails.length > 0 ? persistedDetails : ['Detalhes dos erros indisponíveis para este relatório.']);
    } catch {
      setImportErrorDetails(['Não foi possível carregar os detalhes dos erros no momento.']);
    } finally {
      setLoadingImportErrorDetails(false);
    }
  };

  const handleCopyImportErrors = async () => {
    const details = importErrorDetails.length > 0
      ? importErrorDetails
      : (bulkImportSummary?.firstErrorDetail ? [bulkImportSummary.firstErrorDetail] : []);

    if (details.length === 0) {
      alert('Nenhum detalhe de erro disponível para copiar.');
      return;
    }

    setCopyingImportErrors(true);
    try {
      await navigator.clipboard.writeText(details.join('\n'));
      alert('Detalhes de erro copiados para a área de transferência.');
    } catch {
      alert('Não foi possível copiar os detalhes automaticamente.');
    } finally {
      setCopyingImportErrors(false);
    }
  };

  const handleConfirmBulkImportConfig = async () => {
    if (!pendingBulkImportFile) {
      alert(t('import.errors.fileRequired'));
      return;
    }

    if (hasSelectableConsentTemplates && !selectedBulkImportConsentTemplateId) {
      alert(t('patients.consentTemplateRequired'));
      return;
    }

    setIsBulkImportConfigModalOpen(false);
    const selectedFile = pendingBulkImportFile;
    const formData = new FormData();
    formData.append('file', selectedFile);

    setIsSmartImportingPatients(true);
    try {
      let suggestedMapping: Record<string, string> = {};
      try {
        const mappingResponse = await importLGPDService.predictPatientsMapping(formData);
        suggestedMapping = (mappingResponse as any)?.data?.data?.suggestedMapping || {};
      } catch {
        suggestedMapping = {};
      }

      const importFormData = new FormData();
      importFormData.append('file', selectedFile);
      if (Object.keys(suggestedMapping).length > 0) {
        importFormData.append('mapping', JSON.stringify(suggestedMapping));
      }
      if (selectedBulkImportConsentTemplateId) {
        importFormData.append('groupFields', JSON.stringify({ consentTemplateId: selectedBulkImportConsentTemplateId }));
      }

      const response = await importLGPDService.smartImportPatients(importFormData);
      const payload = (response as any)?.data || {};
      const summary = payload?.data?.summaryReport || {};
      const summaryReportId = String(payload?.data?.summaryReportId || '').trim();
      const errorsDetails = Array.isArray(payload?.data?.errorsDetails) ? payload.data.errorsDetails : [];
      const detailedMessages = mapErrorsToMessages(errorsDetails);
      const firstErrorEntry = errorsDetails[0] || null;
      const firstErrorDetail = firstErrorEntry
        ? (Array.isArray(firstErrorEntry.errors) ? String(firstErrorEntry.errors[0] || '') : String(firstErrorEntry.error || ''))
        : undefined;
      const totalProcessed = Number(summary.totalProcessado || 0);
      const totalFailures = Number(summary.totalFalhas || 0);
      const hash = String(summary.hashSHA256ArquivoOriginal || '--');
      const fileName = String(payload?.data?.fileName || selectedFile.name || '--');

      setBulkImportSummary({
        fileName,
        totalProcessed,
        totalFailures,
        hash,
        firstErrorDetail,
        summaryReportId: summaryReportId || undefined,
        errorsDetails: detailedMessages
      });
      setShowImportErrorDetails(false);
      setImportErrorDetails([]);
      setIsBulkImportSummaryModalOpen(true);

      await loadPatients();
      setShowSearchResults(false);
      setSearchResults([]);
    } catch (err: any) {
      const errorMessage = err?.response?.data?.message || err?.response?.data?.error || err?.message || t('import.errors.importError');
      setBulkImportSummary({
        fileName: selectedFile.name,
        totalProcessed: 0,
        totalFailures: 0,
        hash: '--',
        errorMessage
      });
      setShowImportErrorDetails(false);
      setImportErrorDetails([]);
      setIsBulkImportSummaryModalOpen(true);
    } finally {
      setIsSmartImportingPatients(false);
      setPendingBulkImportFile(null);
    }
  };

  const handleBulkImportChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    event.target.value = '';

    if (!selectedFile) return;

    const ext = selectedFile.name.toLowerCase().split('.').pop();
    const validExtensions = ['csv', 'xlsx', 'txt'];
    if (!ext || !validExtensions.includes(ext)) {
      alert(t('import.errors.invalidFileType'));
      return;
    }

    if (!smartImportMetadata) {
      await loadSmartImportMetadataWithFallback();
    }

    setPendingBulkImportFile(selectedFile);
    setBulkConsentTemplateSearch('');
    setIsBulkImportConfigModalOpen(true);
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
          <input
            ref={bulkImportInputRef}
            type="file"
            accept=".csv,.xlsx,.txt"
            onChange={handleBulkImportChange}
            aria-label={getButtonLabel('import.patients.import', 'Import Patients', 'Importar pacientes')}
            title={getButtonLabel('import.patients.import', 'Import Patients', 'Importar pacientes')}
            style={{ display: 'none' }}
          />
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
          <Button onClick={handleOpenBulkImport} disabled={isSmartImportingPatients}>
            <Upload size={18} />
            {isSmartImportingPatients
              ? t('import.patients.importing')
              : getButtonLabel('import.patients.import', 'Import Patients', 'Importar pacientes')}
          </Button>
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
        isOpen={isBulkImportSummaryModalOpen}
        onClose={() => {
          setIsBulkImportSummaryModalOpen(false);
          setShowImportErrorDetails(false);
          setImportErrorDetails([]);
        }}
        title={t('import.result.title')}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {bulkImportSummary?.errorMessage ? (
            <>
              <p style={{ margin: 0, color: 'var(--danger)' }}>{bulkImportSummary.errorMessage}</p>
              <p style={{ margin: 0, color: 'var(--text-light)', fontSize: '0.85rem' }}>
                {t('import.result.fileLabel')}: {bulkImportSummary.fileName}
              </p>
            </>
          ) : (
            <>
              <p style={{ margin: 0 }}>
                <strong>{t('import.result.fileLabel')}:</strong> {bulkImportSummary?.fileName || '--'}
              </p>
              <p style={{ margin: 0 }}>
                <strong>{t('import.result.totalRecords')}:</strong> {bulkImportSummary?.totalProcessed ?? 0}
              </p>
              <p style={{ margin: 0 }}>
                <strong>{t('import.result.errors')}:</strong> {bulkImportSummary?.totalFailures ?? 0}
              </p>
              <p style={{ margin: 0, color: 'var(--text-light)', fontSize: '0.85rem', wordBreak: 'break-all' }}>
                <strong>SHA-256:</strong> {bulkImportSummary?.hash || '--'}
              </p>
              {(bulkImportSummary?.totalFailures || 0) > 0 && (
                <p style={{ margin: 0, color: 'var(--warning)' }}>
                  {t('patients.importInvalidSummary').replace('{count}', String(bulkImportSummary?.totalFailures || 0))}
                </p>
              )}
              {bulkImportSummary?.firstErrorDetail && (
                <p style={{ margin: 0, color: 'var(--danger)' }}>
                  <strong>Primeiro erro:</strong> {bulkImportSummary.firstErrorDetail}
                </p>
              )}

              {(bulkImportSummary?.totalFailures || 0) > 0 && (
                <Button variant="secondary" onClick={handleOpenImportErrorDetails} disabled={loadingImportErrorDetails}>
                  {loadingImportErrorDetails ? 'Carregando detalhes...' : 'Ver detalhes dos erros'}
                </Button>
              )}

              {showImportErrorDetails && (
                <div style={{
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  padding: '0.75rem',
                  maxHeight: '220px',
                  overflowY: 'auto',
                  backgroundColor: 'var(--surface)'
                }}>
                  <strong style={{ display: 'block', marginBottom: '0.5rem' }}>Detalhes dos erros</strong>
                  <ul style={{ margin: 0, paddingLeft: '1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {importErrorDetails.slice(0, 50).map((item, index) => (
                      <li key={`${index}-${item}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {(showImportErrorDetails || bulkImportSummary?.firstErrorDetail) && (
                <Button variant="secondary" onClick={handleCopyImportErrors} disabled={copyingImportErrors}>
                  {copyingImportErrors ? 'Copiando...' : 'Copiar erros'}
                </Button>
              )}
            </>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setIsBulkImportSummaryModalOpen(false)}>
              {t('common.close')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isBulkImportConfigModalOpen}
        onClose={() => {
          if (isSmartImportingPatients) return;
          setIsBulkImportConfigModalOpen(false);
          setPendingBulkImportFile(null);
        }}
        title={t('patients.importHelpTitle')}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          <p style={{ margin: 0 }}>
            <strong>{t('import.result.fileLabel')}:</strong> {pendingBulkImportFile?.name || '--'}
          </p>

          <p style={styles.importWarningText}>
            {smartImportMetadata?.invalidRowPolicy?.message || t('patients.importInvalidRowsNotSaved')}
          </p>

          <p style={{ margin: 0, color: 'var(--text-light)' }}>
            {t('patients.importHelpDescription')}
          </p>

          <div>
            <strong>{t('patients.importMinimumFieldsTitle')}</strong>
            <ul style={{ marginTop: '0.5rem', paddingLeft: '1rem' }}>
              {(smartImportMetadata?.requiredFields?.length ? smartImportMetadata.requiredFields : fallbackRequiredFields).map((field) => (
                <li key={field.field} style={{ marginBottom: '0.35rem' }}>
                  <strong>{field.label}:</strong> {field.description || field.field}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <strong>{t('patients.importConditionalRulesTitle')}</strong>
            <ul style={{ marginTop: '0.5rem', paddingLeft: '1rem' }}>
              {(smartImportMetadata?.conditionalRules?.length ? smartImportMetadata.conditionalRules : fallbackConditionalRules).map((rule, index) => (
                <li key={`${rule.when}-${index}`}>
                  <strong>{rule.when}:</strong> {rule.message}
                </li>
              ))}
            </ul>
          </div>

          {Array.isArray(smartImportMetadata?.consentTemplates?.items) && smartImportMetadata.consentTemplates.items.length > 0 && (
            <div style={styles.importPanelActions}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>
                {t('patients.importConsentTemplateLabel')}
              </label>
              <input
                type="text"
                value={bulkConsentTemplateSearch}
                onChange={(event) => setBulkConsentTemplateSearch(event.target.value)}
                placeholder={t('patients.consentTemplateSearchPlaceholder')}
                style={{
                  width: '100%',
                  padding: '0.4rem 0.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)'
                }}
              />

              <div style={{
                width: '100%',
                maxHeight: '180px',
                overflowY: 'auto',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                padding: '0.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.45rem'
              }}>
                <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.85rem' }}>
                  <input
                    type="radio"
                    name="bulk-consent-template"
                    checked={!selectedBulkImportConsentTemplateId}
                    onChange={() => setSelectedBulkImportConsentTemplateId('')}
                  />
                  <span>{t('patients.importConsentTemplateAuto')}</span>
                </label>

                {filteredBulkConsentTemplates.length > 0 ? (
                  filteredBulkConsentTemplates.map((template) => {
                    const templateLabel = `${template.version || '--'} - ${template.title || '--'} (${t('patients.caaeLabel')}: ${template.caae || '--'})`;
                    return (
                      <label key={template._id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.85rem' }}>
                        <input
                          type="radio"
                          name="bulk-consent-template"
                          checked={selectedBulkImportConsentTemplateId === template._id}
                          onChange={() => setSelectedBulkImportConsentTemplateId(template._id)}
                        />
                        <span title={templateLabel}>{templateLabel}</span>
                      </label>
                    );
                  })
                ) : (
                  <span style={{ color: 'var(--text-light)', fontSize: '0.82rem' }}>{t('patients.consentTemplateEmpty')}</span>
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <Button
              variant="secondary"
              onClick={() => {
                setIsBulkImportConfigModalOpen(false);
                setPendingBulkImportFile(null);
              }}
              disabled={isSmartImportingPatients}
            >
              {t('common.close')}
            </Button>
            <Button onClick={handleConfirmBulkImportConfig} disabled={isSmartImportingPatients || !pendingBulkImportFile}>
              {getButtonLabel('import.patients.import', 'Import Patients', 'Importar pacientes')}
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
