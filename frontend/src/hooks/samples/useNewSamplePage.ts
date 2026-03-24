import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { patientService } from '@/services/api';
import { BiomarkerXai, Patient, Sample } from '@/types/models';
import { MIABIS_QUALITY_IDS } from '@/config/constants/specimen.constants';
import { useSamples } from '../useSamples';
import { useLocations } from '../useLocations';

type NewSampleFormData = Partial<Sample> & { registerDate?: string; quality?: string };
type XaiAlert = {
  ruleVersion: string;
  severity: 'medium' | 'high';
  justification: string;
} | null;

function buildXaiAlert(biomarkerXai: BiomarkerXai | null | undefined): XaiAlert {
  if (!biomarkerXai || !Array.isArray(biomarkerXai.evidence) || biomarkerXai.evidence.length === 0) {
    return null;
  }

  const priority = { high: 2, medium: 1, low: 0 } as const;
  const relevantEvidence = biomarkerXai.evidence
    .filter((item) => item && (item.severity === 'medium' || item.severity === 'high'))
    .sort((a, b) => priority[b.severity] - priority[a.severity]);

  if (relevantEvidence.length === 0) {
    return null;
  }

  const topEvidence = relevantEvidence[0];
  const justificationParts = [biomarkerXai.summary, topEvidence.rationale, biomarkerXai.recommendation]
    .filter(Boolean)
    .map((part) => String(part).trim())
    .filter((part) => part.length > 0);

  return {
    ruleVersion: biomarkerXai.version,
    severity: topEvidence.severity,
    justification: justificationParts.join(' '),
  };
}

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
    isRareDisease: false,
  });

  const [selectedUnit, setSelectedUnit] = useState<string>('');
  const [patientIDValid, setPatientIDValid] = useState<boolean | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [patientFetchLoading, setPatientFetchLoading] = useState(false);
  const [resendingConsent, setResendingConsent] = useState(false);
  const [strictModeActivated, setStrictModeActivated] = useState(false);
  const [xaiAlert, setXaiAlert] = useState<XaiAlert>(null);

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
      setXaiAlert(null);
      return;
    }

    fetchPatientConsentStatus(patientIDStr);
  }, [formData.patientID, patientIDValid, fetchPatientConsentStatus]);

  useEffect(() => {
    setXaiAlert(buildXaiAlert(selectedPatient?.biomarkerXai));
  }, [selectedPatient]);

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

    if (typeof qualityValue !== 'string' || !MIABIS_QUALITY_IDS.includes(qualityValue)) {
      alert(t('samples.invalidQuality') || 'Qualidade deve estar na escala MIABIS: GOOD, COMPROMISED ou UNKNOWN');
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
      setStrictModeActivated(false);

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
        isRareDisease: formData.isRareDisease === true,
      };

      const result = await createSample(dataToSave);
      const strictMode = (result as any)?.operationMode === 'STRICT';

      if (strictMode) {
        setStrictModeActivated(true);
      }

      alert(t('samples.createSuccess') || 'Amostra cadastrada com sucesso');
      await loadSamples();
      if (!strictMode) {
        onCreated?.();
      }
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
  };
}
