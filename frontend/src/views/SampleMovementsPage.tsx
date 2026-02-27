import { useParams } from 'react-router-dom';
import SampleMovementsView from '../components/samples/SampleMovementsView';
import { useLanguage } from '../contexts/LanguageContext';
import { useSampleMovements } from '../hooks/samples/useSampleMovements';

export default function SampleMovementsPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLanguage();
  const { items, loading, error, errorCode } = useSampleMovements(id);

  return (
    <SampleMovementsView
      t={t}
      loading={loading}
      error={error}
      errorCode={errorCode}
      movements={items}
    />
  );
}
