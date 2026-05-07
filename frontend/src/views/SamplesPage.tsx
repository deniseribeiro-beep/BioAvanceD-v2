import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import SamplesPageView from '../components/samples/SamplesPageView';
import SamplesStorageSection from '../components/samples/SamplesStorageSection';
import SampleDetailsPage from './SampleDetailsPage';
import { useSamplesPage } from '../hooks/samples/useSamplesPage';
import type { SampleWithId } from '../hooks/samples/useSamplesPage';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
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
      />
      )}
    </>
  );
}
