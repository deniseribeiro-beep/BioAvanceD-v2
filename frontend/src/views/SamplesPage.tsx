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
import { attachExternalDocument, type ExternalDocumentSampleApi } from '../hooks/samples/attachExternalDocument';

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
    searchInput,
    setSearchInput,
    submitSearch,
    selectedSampleIds,
    filteredSamples,
    pagedSamples,
    selectedSamples,
    allSelected,
    toggleSelectAll,
    toggleSelect,
    handleBatchDelete,
    printModalOpen,
    openPrintModal,
    closePrintModal,
    refreshSamples,
    currentPage,
    totalPages,
    pageSize,
    setCurrentPage,
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
      await attachExternalDocument(sampleService as unknown as ExternalDocumentSampleApi, {
        id: sample.id,
        specimenStatus: (sample as any).specimenStatus,
      }, {
        actor: user?.userID || user?.id || user?.username || null,
        reason: note || t('samples.alerts.externalDocumentReleaseReason', 'Documento externo de consentimento anexado'),
      });
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
    <div className="page-shell">
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
        pagedSamples={pagedSamples}
        selectedSamples={selectedSamples}
        allSelected={allSelected}
        canEdit={canEdit}
        printModalOpen={printModalOpen}
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={pageSize}
        onSearchChange={setSearchInput}
        onSearchSubmit={submitSearch}
        onToggleSelectAll={toggleSelectAll}
        onToggleSelect={toggleSelect}
        onBatchDelete={handleBatchDelete}
        onOpenPrintModal={openPrintModal}
        onClosePrintModal={closePrintModal}
        onPrint={() => window.print()}
        onEditSample={(sampleId) => navigate(`/samples/${sampleId}`)}
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
        onPageChange={setCurrentPage}
      />
      )}
    </div>
  );
}

