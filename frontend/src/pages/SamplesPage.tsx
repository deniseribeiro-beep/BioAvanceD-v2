import { useNavigate } from 'react-router-dom';
import SamplesPageView from '../components/samples/SamplesPageView';
import { useSamplesPage } from '../hooks/samples/useSamplesPage';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';

export default function SamplesPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user } = useAuth();
  const {
    loading,
    error,
    search,
    setSearch,
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
    importJob,
    importError,
    isImporting,
    downloadTemplate,
  } = useSamplesPage();

  const canEdit = user?.roleName === 'Administrador' || user?.roleName === 'Coordenador';

  return (
    <SamplesPageView
      t={t}
      loading={loading}
      error={error}
      search={search}
      selectedSampleIds={selectedSampleIds}
      filteredSamples={filteredSamples}
      selectedSamples={selectedSamples}
      allSelected={allSelected}
      canEdit={canEdit}
      printModalOpen={printModalOpen}
      isImporting={isImporting}
      importProgress={importJob?.progress}
      importCompleted={importJob?.status === 'completed'}
      importError={importError}
      onSearchChange={setSearch}
      onToggleSelectAll={toggleSelectAll}
      onToggleSelect={toggleSelect}
      onBatchDelete={handleBatchDelete}
      onOpenPrintModal={openPrintModal}
      onClosePrintModal={closePrintModal}
      onPrint={() => window.print()}
      onNewSample={() => navigate('/samples/new')}
      onImport={() => navigate('/import')}
      onDownloadTemplate={downloadTemplate}
      onEditSample={(sampleId) => navigate(`/samples/${sampleId}`)}
    />
  );
}
