import SampleCustodyReportsView from '../components/samples/SampleCustodyReportsView';
import { useLanguage } from '../contexts/LanguageContext';
import { useSampleCustodyReports } from '../hooks/samples/useSampleCustodyReports';

export default function SampleCustodyReportsPage() {
  const { t } = useLanguage();
  const { loading, rows, movementBySpecimenId, toggleMovements } = useSampleCustodyReports();

  return (
    <SampleCustodyReportsView
      t={t}
      loading={loading}
      rows={rows}
      movementBySpecimenId={movementBySpecimenId}
      onToggleMovements={toggleMovements}
    />
  );
}
