import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import SamplesPageView from '../components/samples/SamplesPageView';
import SamplesStorageSection from '../components/samples/SamplesStorageSection';
import SampleDetailsPage from './SampleDetailsPage';
import { useSamplesPage } from '../hooks/samples/useSamplesPage';
import type { SampleWithId } from '../hooks/samples/useSamplesPage';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { patientService, sampleService } from '../services/api';
import './SamplesPage.css';

export default function SamplesPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const [activeSection, setActiveSection] = useState<'inventory' | 'storage'>('inventory');
  const [expandedStorageSample, setExpandedStorageSample] = useState<SampleWithId | null>(null);
  const {
    loading,
    error,
    search,
    searchInput,
    setSearchInput,
    submitSearch,
    selectedSampleIds,
    filteredSamples,
    selectedSamples,
    allSelected,
    toggleSelectAll,
    toggleSelect,
    handleBatchDelete,
    printModalOpen,
    openPrintModal,
    closePrintModal,
    refreshSamples,
  } = useSamplesPage();

  const canEdit = user?.roleName === 'Administrador' || user?.roleName === 'Coordenador';

  const handleResendConsent = async (sample: SampleWithId) => {
    const participantId = String(sample.participantId || (sample as any).patient?.participantId || '').trim();
    if (!participantId) {
      alert(t('samples.alerts.noValidPatientForConsent', 'Amostra sem paciente válido para envio de TCLE.'));
      return;
    }

    try {
      await patientService.resendConsentNotification(participantId);
      refreshSamples();
      alert(t('samples.alerts.consentResentSuccess', 'TCLE enviado/reenviado com sucesso.'));
    } catch (error: any) {
      alert(error?.response?.data?.message || error?.message || t('samples.alerts.consentResentError', 'Falha ao enviar/reenviar TCLE.'));
    }
  };

  const handleAttachExternalDocument = async (sample: SampleWithId) => {
    if (!canEdit) {
      alert(t('samples.alerts.onlyCoordinatorAdminAttach', 'Somente Coordenador ou Administrador pode anexar documento externo.'));
      return;
    }

    const note = window.prompt(t('samples.alerts.externalDocumentPrompt', 'Descreva o documento externo anexado (opcional):'), '') || '';
    try {
      await sampleService.update(sample.id, {
        consentStatus: 'EXTERNAL_ATTACHED',
        // specimenStatus must be sent explicitly — the backend's generic
        // update path (sample.service.js updateSample) is sticky for
        // blocked statuses (computeStatus) and won't move off 'quarantined'
        // on its own. quarantineReason has no specimenStatus equivalent
        // and stays legacy-sourced (#407/#408).
        specimenStatus: 'available',
        quarantineReason: null,
        importedBy: user?.userID || user?.id || user?.username || null,
      } as any);
      refreshSamples();
      alert(note ? t('samples.alerts.externalDocumentAttachedWithNote', 'Documento externo anexado. {note}').replace('{note}', note) : t('samples.alerts.externalDocumentAttachedSuccess', 'Documento externo anexado e amostra liberada.'));
    } catch (error: any) {
      alert(error?.response?.data?.message || error?.message || t('samples.alerts.externalDocumentAttachError', 'Falha ao anexar documento externo.'));
    }
  };

  const handleViewPending = (sample: SampleWithId) => {
    const specimenStatus = String((sample as any).specimenStatus || '').toUpperCase() || 'N/A';
    const quarantineReason = String((sample as any).quarantineReason || '').toUpperCase() || 'N/A';
    const consentStatus = String((sample as any).consentStatus || '').toUpperCase() || 'N/A';
    alert(
      t('samples.alerts.pendingSummary', 'Pendência da amostra:\nStatus: {status}\nConsentimento: {consent}\nMotivo: {reason}')
        .replace('{status}', specimenStatus)
        .replace('{consent}', consentStatus)
        .replace('{reason}', quarantineReason),
    );
  };

  if (/^\/samples\/[^/]+$/.test(pathname)) {
    return <SampleDetailsPage />;
  }

  return (
    <>
      <div className="samples-view-switch" data-testid="samples-view-switch">
        <button
          type="button"
          className={`samples-view-switch__button ${activeSection === 'inventory' ? 'active' : ''}`}
          onClick={() => setActiveSection('inventory')}
          data-testid="samples-view-inventory-button"
        >
          {t('samples.inventoryTab', 'Inventário de Amostras')}
        </button>
        <button
          type="button"
          className={`samples-view-switch__button ${activeSection === 'storage' ? 'active' : ''}`}
          onClick={() => setActiveSection('storage')}
          data-testid="samples-view-storage-button"
        >
          {t('samples.storageTab', 'Armazenagem Física')}
        </button>
      </div>

      {activeSection === 'storage' ? (
        <SamplesStorageSection />
      ) : (
      <SamplesPageView
        t={t}
        language={language}
        loading={loading}
        error={error}
        search={searchInput}
        selectedSampleIds={selectedSampleIds}
        filteredSamples={filteredSamples}
        selectedSamples={selectedSamples}
        allSelected={allSelected}
        canEdit={canEdit}
        printModalOpen={printModalOpen}
        onSearchChange={setSearchInput}
        onSearchSubmit={submitSearch}
        onToggleSelectAll={toggleSelectAll}
        onToggleSelect={toggleSelect}
        onBatchDelete={handleBatchDelete}
        onOpenPrintModal={openPrintModal}
        onClosePrintModal={closePrintModal}
        onPrint={() => window.print()}
        onEditSample={(specimenId) => navigate(`/samples/${specimenId}`)}
        onOpenStorage={(sample) => {
          setExpandedStorageSample((current) => (current?.id === sample.id ? null : sample));
        }}
        expandedStorageSample={expandedStorageSample}
        onCloseExpandedStorage={() => setExpandedStorageSample(null)}
        onStorageCompleted={() => {
          refreshSamples();
          setExpandedStorageSample(null);
        }}
        onResendConsent={handleResendConsent}
        onAttachExternalDocument={handleAttachExternalDocument}
        onViewPending={handleViewPending}
      />
      )}
    </>
  );
}

