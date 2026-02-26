import { useCallback, useEffect, useState } from 'react';
import { Patient, Sample } from '../../types/models';
import { useSamples } from '../useSamples';
import { useLocations } from '../useLocations';
import { patientService } from '../../services/api';
import { useLanguage } from '../../contexts/LanguageContext';

type NewSampleFormData = Partial<Sample> & { registerDate?: string; quality?: number };

export function useNewSamplePage(onCreated?: () => void) {
  const { t } = useLanguage();
  const { createSample, loadSamples } = useSamples();
  const { locations = [], loadLocations, loading: locationsLoading } = useLocations();

  const [formData, setFormData] = useState<NewSampleFormData>({
    patientID: '',
    sampleType: '',
    sampleOrigin: '',
    extractionProtocol: '',
    barcode: '',
    registerDate: new Date().toISOString().split('T')[0],
    registrationDate: new Date().toISOString(),
    quantity: undefined,
    quality: undefined,
    qualityID: undefined,
    linkedProject: '',
    locationID: undefined,
    currentStatus: 'Available',
  });

  const [selectedUnit, setSelectedUnit] = useState<string>('');
  const [patientIDValid, setPatientIDValid] = useState<boolean | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [patientFetchLoading, setPatientFetchLoading] = useState(false);
  const [resendingConsent, setResendingConsent] = useState(false);

  useEffect(() => {
    if (loadLocations && locations.length === 0) {
      loadLocations().catch((err) => {
        console.error('Erro ao carregar localizações:', err);
      });
    }
  }, [loadLocations, locations.length]);

  const handlePatientIDChange = (patientID: string) => {
    setFormData((prev) => ({ ...prev, patientID }));
  };

  const handleValidationChange = (isValid: boolean | null) => {
    setPatientIDValid(isValid);
  };

  const fetchPatientConsentStatus = useCallback(async (patientID: string) => {
    setPatientFetchLoading(true);
    try {
      const response = await patientService.getById(patientID);
      const payload = (response as any)?.data?.data ?? (response as any)?.data;
      setSelectedPatient(payload || null);
    } catch {
      setSelectedPatient(null);
    } finally {
      setPatientFetchLoading(false);
    }
  }, []);

  useEffect(() => {
    const patientIDStr = String(formData.patientID || '').trim();
    if (!patientIDValid || patientIDStr.length !== 8 || !/^\d{8}$/.test(patientIDStr)) {
      setSelectedPatient(null);
      return;
    }

    fetchPatientConsentStatus(patientIDStr);
  }, [formData.patientID, patientIDValid, fetchPatientConsentStatus]);

  const resendConsentNotifications = async () => {
    const patientIDStr = String(formData.patientID || '').trim();
    if (!patientIDStr) return;

    setResendingConsent(true);
    try {
      await patientService.resendConsentNotification(patientIDStr);
      await fetchPatientConsentStatus(patientIDStr);
      alert('Notificações de consentimento reenviadas.');
    } catch (err: any) {
      const errorMsg = err.response?.data?.message || err.message || 'Erro ao reenviar notificações.';
      alert(errorMsg);
    } finally {
      setResendingConsent(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    const patientIDStr = String(formData.patientID || '');
    if (!patientIDStr || patientIDStr.length !== 8 || !/^\d{8}$/.test(patientIDStr)) {
      alert(t('samples.patientIDInvalid') || 'ID de paciente inválido');
      return;
    }

    if (!patientIDValid) {
      alert(t('samples.patientIDNotFound') || 'ID de paciente não encontrado');
      return;
    }

    if (selectedPatient?.status === 'PENDING_CONSENT') {
      alert('Paciente com consentimento pendente. Reenvie as notificações e aguarde a confirmação.');
      return;
    }

    if (!formData.sampleType) {
      alert((t('samples.requiredField') || 'Campo obrigatório') + ': ' + (t('samples.sampleType') || 'Tipo de Amostra'));
      return;
    }

    if (!formData.sampleOrigin) {
      alert((t('samples.requiredField') || 'Campo obrigatório') + ': ' + (t('samples.sampleOrigin') || 'Origem da Amostra'));
      return;
    }

    if (!formData.extractionProtocol) {
      alert((t('samples.requiredField') || 'Campo obrigatório') + ': ' + (t('samples.extractionProtocol') || 'Protocolo de Extração'));
      return;
    }

    if (!formData.registerDate && !formData.registrationDate) {
      alert((t('samples.requiredField') || 'Campo obrigatório') + ': ' + (t('samples.registerDate') || 'Data de Registro'));
      return;
    }

    if (!selectedUnit) {
      alert(t('samples.unitRequired') || 'Selecione uma unidade de medida');
      return;
    }

    if (!formData.quantity || formData.quantity <= 0) {
      alert(t('samples.invalidQuantity') || 'Quantidade deve ser maior que zero');
      return;
    }

    const qualityValue = formData.quality;
    if (qualityValue === undefined || qualityValue === null) {
      alert((t('samples.requiredField') || 'Campo obrigatório') + ': ' + (t('samples.quality') || 'Qualidade'));
      return;
    }

    if (!Number.isInteger(qualityValue) || (qualityValue !== 0 && qualityValue !== 1 && qualityValue !== 2)) {
      alert(t('samples.invalidQuality') || 'Qualidade deve estar na escala MIABIS: 0 (Não avaliada), 1 (Adequada) ou 2 (Inadequada)');
      return;
    }

    if (!formData.linkedProject || formData.linkedProject.trim() === '') {
      alert((t('samples.requiredField') || 'Campo obrigatório') + ': ' + (t('samples.linkedProject') || 'Projeto Vinculado'));
      return;
    }

    if (!formData.locationID) {
      alert((t('samples.requiredField') || 'Campo obrigatório') + ': ' + (t('samples.locationID') || 'Localização'));
      return;
    }

    try {
      let registerDateISO: string;
      const dateToUse = formData.registerDate || formData.registrationDate;
      if (dateToUse) {
        if (typeof dateToUse === 'string') {
          const date = new Date(dateToUse);
          if (!isNaN(date.getTime())) {
            registerDateISO = date.toISOString();
          } else {
            registerDateISO = new Date().toISOString();
          }
        } else if (dateToUse instanceof Date) {
          registerDateISO = dateToUse.toISOString();
        } else {
          registerDateISO = new Date().toISOString();
        }
      } else {
        registerDateISO = new Date().toISOString();
      }

      const dataToSave: any = {
        patientID: patientIDStr,
        sampleType: formData.sampleType,
        sampleOrigin: formData.sampleOrigin,
        extractionProtocol: formData.extractionProtocol,
        barcode: formData.barcode ? String(formData.barcode).trim() : undefined,
        registerDate: registerDateISO,
        registrationDate: registerDateISO,
        quantity: formData.quantity,
        unit: selectedUnit,
        quality: formData.quality,
        linkedProject: formData.linkedProject,
        locationID: formData.locationID,
        currentStatus: formData.currentStatus || 'Available',
      };

      await createSample(dataToSave);
      alert(t('samples.createSuccess') || 'Amostra cadastrada com sucesso');
      await loadSamples();
      onCreated?.();
    } catch (err: any) {
      const errorMsg =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        (t('samples.createError') || 'Erro ao cadastrar amostra');
      alert(errorMsg);
    }
  };

  return {
    formData,
    setFormData,
    selectedUnit,
    setSelectedUnit,
    patientIDValid,
    selectedPatient,
    patientFetchLoading,
    resendingConsent,
    locations,
    locationsLoading,
    handlePatientIDChange,
    handleValidationChange,
    handleSave,
    resendConsentNotifications,
  };
}
