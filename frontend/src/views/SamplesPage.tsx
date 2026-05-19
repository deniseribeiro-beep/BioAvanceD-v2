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
    const patientID = String(sample.patientID || (sample as any).patient?.patientID || '').trim();
    if (!patientID) {
      alert('Amostra sem paciente válido para envio de TCLE.');
      return;
    }

    try {
      await patientService.resendConsentNotification(patientID);
      refreshSamples();
      alert('TCLE enviado/reenviado com sucesso.');
    } catch (error: any) {
      alert(error?.response?.data?.message || error?.message || 'Falha ao enviar/reenviar TCLE.');
    }
  };

  const handleAttachExternalDocument = async (sample: SampleWithId) => {
    if (!canEdit) {
      alert('Somente Coordenador ou Administrador pode anexar documento externo.');
      return;
    }

    const note = window.prompt('Descreva o documento externo anexado (opcional):', '') || '';
    try {
      await sampleService.update(sample.id, {
        consentStatus: 'EXTERNAL_ATTACHED',
        quarantineStatus: 'RELEASED',
        availabilityStatus: 'AVAILABLE',
        quarantineReason: null,
        release_status: 'AVAILABLE',
        importedBy: user?.userID || user?.id || user?.username || null,
      } as any);
      refreshSamples();
      alert(note ? `Documento externo anexado. ${note}` : 'Documento externo anexado e amostra liberada.');
    } catch (error: any) {
      alert(error?.response?.data?.message || error?.message || 'Falha ao anexar documento externo.');
    }
  };

  const handleViewPending = (sample: SampleWithId) => {
    const quarantineStatus = String((sample as any).quarantineStatus || '').toUpperCase() || 'N/A';
    const quarantineReason = String((sample as any).quarantineReason || '').toUpperCase() || 'N/A';
    const consentStatus = String((sample as any).consentStatus || '').toUpperCase() || 'N/A';
    alert(`Pendência da amostra:\nStatus: ${quarantineStatus}\nConsentimento: ${consentStatus}\nMotivo: ${quarantineReason}`);
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
          Inventário de Amostras
        </button>
        <button
          type="button"
          className={`samples-view-switch__button ${activeSection === 'storage' ? 'active' : ''}`}
          onClick={() => setActiveSection('storage')}
          data-testid="samples-view-storage-button"
        >
          Armazenagem Física
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
      />
      )}
    </>
  );
}
