import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useNewSamplePage } from '../hooks/samples/useNewSamplePage';
import NewSamplePageView from '../components/samples/NewSamplePageView';

export default function NewSamplePage() {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const {
    formData,
    setFormData,
    selectedUnit,
    setSelectedUnit,
    selectedPatient,
    xaiAlert,
    patientFetchLoading,
    resendingConsent,
    strictModeActivated,
    locations,
    locationsLoading,
    handlePatientIDChange,
    handleValidationChange,
    handleSave,
    resendConsentNotifications,
  } = useNewSamplePage(() => navigate('/samples'));

  return (
    <NewSamplePageView
      t={t}
      formData={formData}
      selectedUnit={selectedUnit}
      selectedPatient={selectedPatient}
      xaiAlert={xaiAlert}
      patientFetchLoading={patientFetchLoading}
      resendingConsent={resendingConsent}
      strictModeActivated={strictModeActivated}
      locations={locations}
      locationsLoading={locationsLoading}
      onBack={() => navigate('/samples')}
      onSubmit={handleSave}
      onFormDataChange={(updater) => setFormData((prev) => updater(prev))}
      onUnitChange={(unit) => {
        setSelectedUnit(unit);
        if (unit !== selectedUnit) {
          setFormData((prev) => ({ ...prev, quantity: undefined }));
        }
      }}
      onPatientIDChange={handlePatientIDChange}
      onValidationChange={handleValidationChange}
      onResendConsent={resendConsentNotifications}
    />
  );
}
