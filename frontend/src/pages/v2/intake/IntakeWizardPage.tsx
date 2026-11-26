
// @ts-ignore: No type definitions for ClinicalIntakeWizard
import ClinicalIntakeWizard from '../../../components/v2/intake/ClinicalIntakeWizard';
import { useIntakeDictionaryData } from '../../../hooks/useIntakeDictionaryData';

export default function IntakeWizardPage() {
  const { dictionaries, loading, error } = useIntakeDictionaryData();

  return (
    <section className="intake-wizard-page">
      <ClinicalIntakeWizard
        dictionaries={dictionaries}
        dictionariesLoading={loading}
        dictionariesError={error}
      />
    </section>
  );
}