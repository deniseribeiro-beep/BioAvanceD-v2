import { useState, useEffect, useMemo, CSSProperties } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import Modal from '../components/UI/Modal';
import { ArrowLeft } from 'lucide-react';
import SignaturePad from '../components/Consent/SignaturePad';
import { Patient, ConsentPermission, ConsentTemplate, ConsentPolicy } from '../types/models';
import { usePatients } from '../hooks/usePatients';
import { consentService, patientService } from '../services/api';
import { validateUnit } from '../utils/validations';
import { useLanguage } from '../contexts/LanguageContext';

const styles: Record<string, CSSProperties> = {
  consentModalContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  consentHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '1rem',
    flexWrap: 'wrap'
  },
  consentModalTitle: {
    margin: 0,
    fontSize: '1.1rem',
    fontWeight: 600,
    color: 'var(--text)'
  },
  consentModalText: {
    margin: 0,
    color: 'var(--text-light)',
    fontSize: '0.9rem'
  },
  consentProject: {
    margin: 0,
    color: 'var(--text-light)',
    fontSize: '0.85rem'
  },
  consentGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
    gap: '1.25rem'
  },
  consentDocument: {
    border: '1px solid var(--border)',
    borderRadius: '8px',
    backgroundColor: 'var(--surface)',
    padding: '1rem',
    maxHeight: '60vh',
    overflowY: 'auto'
  },
  consentDocumentText: {
    margin: 0,
    whiteSpace: 'pre-wrap',
    color: 'var(--text)',
    fontSize: '0.9rem',
    lineHeight: 1.6
  },
  consentPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  consentPermissions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem'
  },
  consentPermissionItem: {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'flex-start',
    fontSize: '0.9rem',
    color: 'var(--text)'
  },
  consentRequired: {
    color: 'var(--danger)',
    fontWeight: 600
  },
  consentError: {
    color: '#b00020',
    fontSize: '0.85rem'
  },
  consentModalActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.75rem',
    justifyContent: 'flex-end'
  },
  consentSelectionContainer: {
    border: '1px solid var(--border)',
    borderRadius: '8px',
    padding: '1rem',
    backgroundColor: 'var(--surface)',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem'
  },
  consentSelectionList: {
    maxHeight: '200px',
    overflowY: 'auto',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '0.75rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  consentSelectionItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.5rem',
    color: 'var(--text)',
    fontSize: '0.875rem'
  }
};

export default function NewPatientPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language } = useLanguage();
  const { createPatient, updatePatient, loadPatients } = usePatients();
  
  // Verifica se há paciente para edição (vindo da navegação)
  const editingPatient = (location.state as any)?.patient as Patient | null;
  
  // Função para formatar data
  const formatDate = (date: Date | string | undefined): string => {
    const localeByLanguage: Record<string, string> = {
      'pt-BR': 'pt-BR',
      'en-US': 'en-US',
      'es-ES': 'es-ES'
    };
    const locale = localeByLanguage[language] || 'pt-BR';
    if (!date) return '';
    if (date instanceof Date) {
      return date.toLocaleDateString(locale);
    }
    if (typeof date === 'string') {
      const d = new Date(date);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString(locale);
      }
      return date;
    }
    return '';
  };
  
  // Função para converter sexo do backend (M/F/O) para frontend
  const convertSexFromBackend = (sex: string | undefined): string => {
    if (!sex) return t('patients.sexMale');
    const sexMap: { [key: string]: string } = {
      'M': t('patients.sexMale'),
      'F': t('patients.sexFemale'),
      'O': t('patients.sexOther')
    };
    return sexMap[sex] || t('patients.sexMale');
  };
  
  const [formData, setFormData] = useState<Partial<Patient>>({
    patientName: editingPatient?.patientName || '',
    email: editingPatient?.email || '',
    phone: editingPatient?.phone || '',
    birthDate: editingPatient?.birthDate ? formatDate(editingPatient.birthDate) : '',
    sex: editingPatient?.sex ? convertSexFromBackend(editingPatient.sex) : t('patients.sexMale'),
    weight: editingPatient?.weight || undefined,
    heightCm: editingPatient?.heightCm || undefined,
    recordNumber: editingPatient?.recordNumber || undefined,
    clinicalUnit: editingPatient?.clinicalUnit || '',
    unitAcronym: editingPatient?.unitAcronym || '',
    diagnosticHypothesis: editingPatient?.diagnosticHypothesis || '',
    icdCode: editingPatient?.icdCode || '',
    linkedProject: editingPatient?.linkedProject || '',
    hypertension: editingPatient?.hypertension ? t('common.yes') : t('common.no'),
    obesity: editingPatient?.obesity ? t('common.yes') : t('common.no'),
    diabetesType1: editingPatient?.diabetesType1 ? t('common.yes') : t('common.no'),
    diabetesType2: editingPatient?.diabetesType2 ? t('common.yes') : t('common.no'),
    copd: editingPatient?.copd ? t('common.yes') : t('common.no'),
    ckd: editingPatient?.ckd ? t('common.yes') : t('common.no'),
    smoking: editingPatient?.smoking ? t('common.yes') : t('common.no'),
    alcoholUse: editingPatient?.alcoholUse ? t('common.yes') : t('common.no'),
    asthma: editingPatient?.asthma ? t('common.yes') : t('common.no'),
    antibioticUse: editingPatient?.antibioticUse ? t('common.yes') : t('common.no'),
    insulinUse: editingPatient?.insulinUse ? t('common.yes') : t('common.no'),
    antiviralUse: editingPatient?.antiviralUse ? t('common.yes') : t('common.no'),
    geneticVariant: editingPatient?.geneticVariant || '',
    alphaGal: editingPatient?.alphaGal || undefined,
    lysoGb3: editingPatient?.lysoGb3 || undefined,
    notes: editingPatient?.notes || ''
  });
  const [isConsentModalOpen, setIsConsentModalOpen] = useState(false);
  const [createdPatientId, setCreatedPatientId] = useState<string | null>(null);
  const [sendingConsent, setSendingConsent] = useState(false);
  const [consentSent, setConsentSent] = useState(false);
  const [consentTemplate, setConsentTemplate] = useState<ConsentTemplate | null>(null);
  const [consentPolicies, setConsentPolicies] = useState<ConsentPolicy[]>([]);
  const [selectedConsentTemplateId, setSelectedConsentTemplateId] = useState<string>(editingPatient?.consentTemplateId || '');
  const [consentTemplateSearch, setConsentTemplateSearch] = useState('');
  const [consentLoading, setConsentLoading] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [consentResponses, setConsentResponses] = useState<Record<string, boolean>>({});
  const [signatureName, setSignatureName] = useState('');
  const [isSubmittingConsent, setIsSubmittingConsent] = useState(false);

  // Funções de conversão
  const convertSexToBackend = (sex: string | undefined): string => {
    if (!sex) return 'M';
    const sexMap: { [key: string]: string } = {
      [t('patients.sexMale')]: 'M',
      [t('patients.sexFemale')]: 'F',
      [t('patients.sexOther')]: 'O'
    };
    return sexMap[sex] || 'M';
  };

  const convertBooleanToBackend = (value: string | boolean | undefined): boolean | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lower = value.toLowerCase().trim();
      const yesLower = t('common.yes').toLowerCase();
      return lower === yesLower || lower === 'sim' || lower === 's' || lower === 'yes' || lower === 'y' || lower === 'true' || lower === '1';
    }
    return false;
  };

  const parseDDMMYYYYToDate = (dateStr: string): Date | null => {
    if (!dateStr) return null;
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);
      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        return new Date(year, month, day);
      }
    }
    return null;
  };

  const normalizePhone = (value: string): string => {
    return value.replace(/\D/g, '').slice(0, 15);
  };

  const isValidEmail = (email?: string): boolean => {
    if (!email) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  };

  const isValidPhone = (phone?: string): boolean => {
    if (!phone) return true;
    const digits = normalizePhone(phone);
    return digits.length >= 10 && digits.length <= 15;
  };

  const normalizePolicyToTemplate = (policy: ConsentPolicy): ConsentTemplate => {
    const permissions = Array.isArray(policy.granularPermissions)
      ? policy.granularPermissions.map((permission) => ({
          key: permission.key,
          label: permission.label,
          required: permission.required
        }))
      : [];

    return {
      _id: policy._id,
      title: policy.title,
      content: policy.htmlContent,
      htmlContent: policy.htmlContent,
      version: policy.version,
      caae: policy.caae,
      active: policy.active,
      permissions,
      granularPermissions: policy.granularPermissions,
      validFrom: policy.validFrom,
      createdAt: policy.createdAt
    };
  };

  const resolveCreatedPatientID = (payload: any): string | null => {
    if (!payload) return null;
    const data = payload.data || payload;
    if (!data) return null;
    if (data.patientID) return String(data.patientID);
    if (data.patient?.patientID) return String(data.patient.patientID);
    if (data.data?.patientID) return String(data.data.patientID);
    if (data.data?.patient?.patientID) return String(data.data.patient.patientID);
    return null;
  };

  const sendConsentNotification = async (patientID: string, showFeedback = true) => {
    setSendingConsent(true);
    try {
      await patientService.resendConsentNotification(patientID);
      setConsentSent(true);
      if (showFeedback) {
        alert(t('patients.consentSentSuccess'));
      }
    } catch (consentError: any) {
      const consentMessage = consentError?.response?.data?.message || consentError?.message || t('patients.consentSendError');
      if (showFeedback) {
        alert(consentMessage);
      }
    } finally {
      setSendingConsent(false);
    }
  };

  const handleTogglePermission = (key: string) => {
    setConsentResponses((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const requiredPermissionKeys = useMemo(() => {
    const permissions = consentTemplate?.permissions || [];
    const explicitRequired = permissions
      .filter((permission) => permission.required)
      .map((permission) => permission.key);

    if (explicitRequired.length > 0) {
      return explicitRequired;
    }

    const normalized = permissions.find((permission) =>
      permission.key?.toLowerCase().includes('terms') ||
      permission.key?.toLowerCase().includes('termos') ||
      permission.label?.toLowerCase().includes('termos gerais')
    );
    return normalized?.key ? [normalized.key] : permissions?.[0]?.key ? [permissions[0].key] : [];
  }, [consentTemplate]);

  const hasRequiredConsent = useMemo(() => {
    if (requiredPermissionKeys.length === 0) return false;
    return requiredPermissionKeys.every((key) => consentResponses[key] === true);
  }, [requiredPermissionKeys, consentResponses]);

  const canSubmitConsent = useMemo(() => {
    const hasSignatureName = signatureName.trim().length > 3;
    return hasRequiredConsent && hasSignatureName && !!consentTemplate && !isSubmittingConsent;
  }, [hasRequiredConsent, signatureName, consentTemplate, isSubmittingConsent]);

  const isHtmlContent = useMemo(() => {
    if (!consentTemplate) return false;
    const content = consentTemplate.htmlContent || consentTemplate.content;
    return /<\/?[a-z][\s\S]*>/i.test(content || '');
  }, [consentTemplate]);

  const loadConsentTemplate = async () => {
    setConsentLoading(true);
    setConsentError(null);
    try {
      const response = await consentService.getAllPolicies();
      const policies = response.data?.data || [];
      const normalizedPolicies = Array.isArray(policies) ? policies : [];
      setConsentPolicies(normalizedPolicies);

      const selectedPolicy = normalizedPolicies.find((policy: ConsentPolicy) => String(policy._id) === String(selectedConsentTemplateId));
      const template = selectedPolicy ? normalizePolicyToTemplate(selectedPolicy) : null;
      setConsentTemplate(template);

      const permissions: ConsentPermission[] = template?.permissions || [];
      const initialResponses: Record<string, boolean> = {};
      permissions.forEach((permission) => {
        initialResponses[permission.key] = false;
      });
      setConsentResponses(initialResponses);
      setSignatureName('');
    } catch (err: any) {
      const message = err?.message || t('patients.consentLoadError');
      setConsentError(message);
    } finally {
      setConsentLoading(false);
    }
  };

  const handleConfirmSignature = async (dataUrl: string) => {
    if (!createdPatientId || !consentTemplate?._id) {
      setConsentError(t('patients.consentUnavailableError'));
      return;
    }

    if (!canSubmitConsent) {
      setConsentError(t('patients.consentRequiredError'));
      return;
    }

    setIsSubmittingConsent(true);
    setConsentError(null);
    try {
      await consentService.createPatientConsent({
        patientId: createdPatientId,
        templateId: consentTemplate._id,
        responses: consentResponses,
        signatureName,
        signatureImage: dataUrl
      } as any);
      alert(t('patients.consentRegisteredSuccess'));
      setIsConsentModalOpen(false);
      navigate('/patients');
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.message || t('patients.consentRegisterError');
      setConsentError(message);
    } finally {
      setIsSubmittingConsent(false);
    }
  };

  useEffect(() => {
    loadConsentTemplate();
  }, [selectedConsentTemplateId]);

  const filteredConsentPolicies = useMemo(() => {
    const term = consentTemplateSearch.trim().toLowerCase();
    if (!term) return consentPolicies;
    return consentPolicies.filter((policy) => {
      const titleValue = String(policy.title || '').toLowerCase();
      const versionValue = String(policy.version || '').toLowerCase();
      const caaeValue = String(policy.caae || '').toLowerCase();
      return titleValue.includes(term) || versionValue.includes(term) || caaeValue.includes(term);
    });
  }, [consentPolicies, consentTemplateSearch]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validações antes de salvar
    if (formData.clinicalUnit && !validateUnit(formData.clinicalUnit)) {
      alert(t('patients.invalidClinicalUnit'));
      return;
    }
    
    // Validação: VARIANTE_GENETICA é obrigatório
    if (!formData.geneticVariant || !formData.geneticVariant.trim()) {
      alert(t('patients.geneticVariantRequired'));
      return;
    }

    if (!formData.email || !isValidEmail(formData.email)) {
      alert(t('patients.invalidEmail'));
      return;
    }

    if (!isValidPhone(String(formData.phone || ''))) {
      alert(t('patients.invalidPhone'));
      return;
    }

    if (!editingPatient && !selectedConsentTemplateId) {
      alert(t('patients.consentTemplateRequired'));
      return;
    }

    // Remove patientID se fornecido - será gerado automaticamente pelo backend
    const dataToSave: any = { ...formData };
    delete dataToSave.patientID;
    dataToSave.email = String(formData.email || '').trim().toLowerCase();
    dataToSave.phone = normalizePhone(String(formData.phone || '')) || null;
    if (selectedConsentTemplateId) {
      dataToSave.consentTemplateId = selectedConsentTemplateId;
    }
    
    // Remove patientName ao editar para não exibir dados sensíveis
    if (editingPatient) {
      delete dataToSave.patientName;
    }
    
    // Converte sexo do frontend para backend
    dataToSave.sex = convertSexToBackend(formData.sex);
    
    // Converte campos booleanos do frontend para backend
    const booleanFields = [
      'hypertension', 'obesity', 'diabetesType1', 'diabetesType2',
      'copd', 'ckd', 'smoking', 'alcoholUse', 'asthma',
      'antibioticUse', 'insulinUse', 'antiviralUse'
    ];
    
    booleanFields.forEach(field => {
      if (dataToSave[field] !== undefined) {
        dataToSave[field] = convertBooleanToBackend(dataToSave[field]);
      }
    });
    
    // Converte birthDate de string DD/MM/YYYY para Date se necessário
    if (dataToSave.birthDate && typeof dataToSave.birthDate === 'string') {
      const date = parseDDMMYYYYToDate(dataToSave.birthDate);
      if (date) {
        dataToSave.birthDate = date.toISOString();
      }
    }

    try {
      if (editingPatient) {
        const patientIDStr = typeof editingPatient.patientID === 'string' ? editingPatient.patientID : String(editingPatient.patientID);
        await updatePatient(patientIDStr, dataToSave);
        alert(t('patients.updateSuccess'));
      } else {
        const createdPayload = await createPatient(dataToSave);
        const createdPatientID = resolveCreatedPatientID(createdPayload);

        if (createdPatientID) {
          const selectedPolicy = consentPolicies.find((policy) => String(policy._id) === String(selectedConsentTemplateId));
          if (!selectedPolicy) {
            alert(t('patients.consentTemplateNotFound'));
            return;
          }

          setConsentTemplate(normalizePolicyToTemplate(selectedPolicy));
          setCreatedPatientId(createdPatientID);
          setConsentSent(false);
          setIsConsentModalOpen(true);
          await sendConsentNotification(createdPatientID, false);
        } else {
          alert(t('patients.patientIdResolveError'));
        }

        alert(t('patients.createSuccess'));
      }
      
      // Recarrega a lista e volta para a página de pacientes
      await loadPatients();
      if (editingPatient) {
        navigate('/patients');
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.response?.data?.message || err.message || t('patients.saveError');
      alert(errorMsg);
    }
  };

  return (
    <div style={{ 
      maxWidth: '900px', 
      margin: '0 auto', 
      padding: '2rem',
      minHeight: '100vh'
    }}>
      {/* Header minimalista */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '1rem',
        marginBottom: '2rem'
      }}>
        <Button 
          onClick={() => navigate('/patients')} 
          variant="secondary" 
          style={{ minWidth: 'auto', padding: '0.5rem' }}
        >
          <ArrowLeft size={18} />
        </Button>
        <div>
          <h1 style={{ 
            margin: 0, 
            fontSize: '1.5rem', 
            fontWeight: 600,
            color: 'var(--text)'
          }}>
            {editingPatient ? t('patients.editTitle') : t('patients.newTitle')}
          </h1>
          <p style={{ 
            margin: '0.25rem 0 0 0', 
            fontSize: '0.875rem', 
            color: 'var(--text-light)'
          }}>
            {editingPatient ? t('patients.editSubtitle') : t('patients.newSubtitle')}
          </p>
        </div>
      </div>

      {/* Formulário */}
      <form onSubmit={handleSave} style={{ 
        backgroundColor: 'var(--surface)',
        borderRadius: '8px',
        padding: '2rem',
        border: '1px solid var(--border)'
      }}>
        {/* Seção 1: Dados Básicos */}
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ 
            fontSize: '1.125rem', 
            fontWeight: 600, 
            marginBottom: '1rem',
            color: 'var(--text)'
          }}>
            {t('patients.basicData')}
          </h2>
          
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', 
            gap: '1rem' 
          }}>
            {!editingPatient && (
              <Input
                label={`${t('patients.patientName')} *`}
                type="text"
                value={formData.patientName || ''}
                onChange={(e) => setFormData({ ...formData, patientName: e.target.value })}
                required
              />
            )}
            
            <Input
              label={`${t('patients.birthDate')} *`}
              type="text"
              placeholder="DD/MM/YYYY"
              value={formData.birthDate || ''}
              onChange={(e) => setFormData({ ...formData, birthDate: e.target.value })}
              required
            />
            
            <div>
              <label style={{ 
                display: 'block', 
                marginBottom: '0.5rem', 
                fontSize: '0.875rem',
                fontWeight: 500,
                color: 'var(--text)'
              }}>
                {t('patients.sex')} *
              </label>
              <select
                value={formData.sex || t('patients.sexMale')}
                onChange={(e) => setFormData({ ...formData, sex: e.target.value })}
                required
                title={t('patients.sex')}
                aria-label={t('patients.sex')}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)'
                }}
              >
                <option value={t('patients.sexMale')}>{t('patients.sexMale')}</option>
                <option value={t('patients.sexFemale')}>{t('patients.sexFemale')}</option>
                <option value={t('patients.sexOther')}>{t('patients.sexOther')}</option>
              </select>
            </div>

            <Input
              label={`${t('patients.email')} *`}
              type="email"
              value={formData.email || ''}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              required
            />

            <Input
              label={t('patients.phone')}
              type="text"
              value={formData.phone || ''}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="5511999999999"
            />
            
            <Input
              label={t('patients.weight')}
              type="number"
              step="0.1"
              value={formData.weight || ''}
              onChange={(e) => setFormData({ ...formData, weight: parseFloat(e.target.value) || undefined })}
            />
            
            <Input
              label={t('patients.height')}
              type="number"
              step="0.1"
              value={formData.heightCm || ''}
              onChange={(e) => setFormData({ ...formData, heightCm: parseFloat(e.target.value) || undefined })}
            />
            
            <Input
              label={t('patients.recordNumber')}
              type="text"
              value={formData.recordNumber || ''}
              onChange={(e) => setFormData({ ...formData, recordNumber: e.target.value })}
            />
          </div>
        </div>

        {/* Seção 2: Informações Clínicas */}
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ 
            fontSize: '1.125rem', 
            fontWeight: 600, 
            marginBottom: '1rem',
            color: 'var(--text)'
          }}>
            {t('patients.clinicalInfo')}
          </h2>
          
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', 
            gap: '1rem' 
          }}>
            <Input
              label={t('patients.clinicalUnit')}
              type="text"
              value={formData.clinicalUnit || ''}
              onChange={(e) => setFormData({ ...formData, clinicalUnit: e.target.value })}
            />
            
            <Input
              label={t('patients.unitAcronym')}
              type="text"
              value={formData.unitAcronym || ''}
              onChange={(e) => setFormData({ ...formData, unitAcronym: e.target.value })}
            />
            
            <Input
              label={t('patients.diagnosticHypothesis')}
              type="text"
              value={formData.diagnosticHypothesis || ''}
              onChange={(e) => setFormData({ ...formData, diagnosticHypothesis: e.target.value })}
            />
            
            <Input
              label={t('patients.icdCode')}
              type="text"
              value={formData.icdCode || ''}
              onChange={(e) => setFormData({ ...formData, icdCode: e.target.value })}
            />

            <Input
              label={t('patients.linkedProjectConsent')}
              type="text"
              value={formData.linkedProject || ''}
              onChange={(e) => setFormData({ ...formData, linkedProject: e.target.value })}
              placeholder={t('patients.linkedProjectConsentPlaceholder')}
            />
            
            <Input
              label={`${t('patients.geneticVariant')} *`}
              type="text"
              value={formData.geneticVariant || ''}
              onChange={(e) => setFormData({ ...formData, geneticVariant: e.target.value })}
              required
            />
            
            <Input
              label={t('patients.alphaGal')}
              type="number"
              step="0.01"
              value={formData.alphaGal || ''}
              onChange={(e) => setFormData({ ...formData, alphaGal: parseFloat(e.target.value) || undefined })}
            />
            
            <Input
              label={t('patients.lysoGb3')}
              type="number"
              step="0.1"
              value={formData.lysoGb3 || ''}
              onChange={(e) => setFormData({ ...formData, lysoGb3: parseFloat(e.target.value) || undefined })}
            />
          </div>
        </div>

        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ 
            fontSize: '1.125rem', 
            fontWeight: 600, 
            marginBottom: '1rem',
            color: 'var(--text)'
          }}>
            {t('patients.consentTemplateSelection')}
          </h2>

          <div style={styles.consentSelectionContainer}>
            <Input
              label={t('patients.consentTemplateSearch')}
              value={consentTemplateSearch}
              onChange={(event) => setConsentTemplateSearch(event.target.value)}
              placeholder={t('patients.consentTemplateSearchPlaceholder')}
            />

            <div style={styles.consentSelectionList}>
              {filteredConsentPolicies.length === 0 ? (
                <span style={{ color: 'var(--text-light)', fontSize: '0.875rem' }}>{t('patients.consentTemplateEmpty')}</span>
              ) : (
                filteredConsentPolicies.map((policy) => {
                  const policyId = String(policy._id || `${policy.version}-${policy.title}`);
                  const isChecked = selectedConsentTemplateId === policyId;
                  return (
                    <label key={policyId} style={styles.consentSelectionItem}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => setSelectedConsentTemplateId(isChecked ? '' : policyId)}
                      />
                      <span>{policy.version} - {policy.title} ({t('patients.caaeLabel')}: {policy.caae || '--'})</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Seção 3: Fatores de Risco */}
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ 
            fontSize: '1.125rem', 
            fontWeight: 600, 
            marginBottom: '1rem',
            color: 'var(--text)'
          }}>
            {t('patients.riskFactors')}
          </h2>
          
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
            gap: '1rem' 
          }}>
            {[
              { key: 'hypertension', labelKey: 'patients.hypertension' },
              { key: 'obesity', labelKey: 'patients.obesity' },
              { key: 'diabetesType1', labelKey: 'patients.diabetesType1' },
              { key: 'diabetesType2', labelKey: 'patients.diabetesType2' },
              { key: 'copd', labelKey: 'patients.copd' },
              { key: 'ckd', labelKey: 'patients.ckd' },
              { key: 'smoking', labelKey: 'patients.smoking' },
              { key: 'alcoholUse', labelKey: 'patients.alcoholUse' },
              { key: 'asthma', labelKey: 'patients.asthma' },
              { key: 'antibioticUse', labelKey: 'patients.antibioticUse' },
              { key: 'insulinUse', labelKey: 'patients.insulinUse' },
              { key: 'antiviralUse', labelKey: 'patients.antiviralUse' },
            ].map(({ key, labelKey }) => {
              const currentValue = (formData[key as keyof Patient] as string) || t('common.no');
              const yesValue = t('common.yes');
              const noValue = t('common.no');
              return (
                <div key={key}>
                  <label style={{ 
                    display: 'block', 
                    marginBottom: '0.5rem', 
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: 'var(--text)'
                  }}>
                    {t(labelKey)}
                  </label>
                  <div style={{ display: 'flex', gap: '1rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name={key}
                        value={yesValue}
                        checked={currentValue === yesValue}
                        onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
                      />
                      <span>{yesValue}</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name={key}
                        value={noValue}
                        checked={currentValue === noValue}
                        onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
                      />
                      <span>{noValue}</span>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Seção 4: Observações */}
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ 
            fontSize: '1.125rem', 
            fontWeight: 600, 
            marginBottom: '1rem',
            color: 'var(--text)'
          }}>
            {t('patients.observations')}
          </h2>
          
          <textarea
            value={formData.notes || ''}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            rows={4}
            style={{
              width: '100%',
              padding: '0.75rem',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: '0.875rem',
              backgroundColor: 'var(--surface)',
              color: 'var(--text)',
              fontFamily: 'inherit',
              resize: 'vertical'
            }}
            placeholder={t('patients.observationsPlaceholder')}
          />
        </div>

        {/* Botões de ação */}
        <div style={{ 
          display: 'flex', 
          gap: '1rem', 
          justifyContent: 'flex-end',
          paddingTop: '1rem',
          borderTop: '1px solid var(--border)'
        }}>
          <Button 
            type="button" 
            variant="secondary" 
            onClick={() => navigate('/patients')}
          >
            {t('common.cancel')}
          </Button>
          <Button type="submit">
            {editingPatient ? t('patients.saveChanges') : t('patients.registerPatient')}
          </Button>
        </div>
      </form>

      <Modal
        isOpen={isConsentModalOpen}
        onClose={() => setIsConsentModalOpen(false)}
        title={t('patients.consentModalTitle')}
      >
        <div style={styles.consentModalContent}>
          <div style={styles.consentHeader}>
            <div>
              <h3 style={styles.consentModalTitle}>{t('patients.consentReadyTitle')}</h3>
              <p style={styles.consentModalText}>
                {consentSent
                  ? t('patients.consentAutoSentMessage')
                  : t('patients.consentCollectMessage')}
              </p>
              {formData.linkedProject && (
                <p style={styles.consentProject}>{t('patients.selectedProjectLabel')}: {formData.linkedProject}</p>
              )}
            </div>
            <div style={styles.consentModalActions}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => createdPatientId && sendConsentNotification(createdPatientId)}
                disabled={!createdPatientId || sendingConsent}
              >
                {sendingConsent ? t('patients.sendingConsent') : t('patients.resendConsent')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setIsConsentModalOpen(false)}
              >
                {t('common.close')}
              </Button>
            </div>
          </div>

          {consentLoading && <span>{t('patients.loadingConsent')}</span>}
          {consentError && <span style={styles.consentError}>{consentError}</span>}

          {consentTemplate && !consentLoading && (
            <div style={styles.consentGrid}>
              <div style={styles.consentDocument}>
                {isHtmlContent ? (
                  <div dangerouslySetInnerHTML={{ __html: consentTemplate.htmlContent || consentTemplate.content }} />
                ) : (
                  <p style={styles.consentDocumentText}>{consentTemplate.content}</p>
                )}
              </div>
              <div style={styles.consentPanel}>
                <div style={styles.consentPermissions}>
                  {(consentTemplate.permissions || []).map((permission) => {
                    const isRequired = requiredPermissionKeys.includes(permission.key);
                    return (
                      <label key={permission.key} style={styles.consentPermissionItem}>
                        <input
                          type="checkbox"
                          checked={!!consentResponses[permission.key]}
                          onChange={() => handleTogglePermission(permission.key)}
                        />
                        <span>
                          {permission.label}
                          {isRequired && <span style={styles.consentRequired}> ({t('patients.requiredTag')})</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>

                <Input
                  label={t('patients.signatureName')}
                  value={signatureName}
                  onChange={(event) => setSignatureName(event.target.value)}
                  placeholder={t('patients.signatureNamePlaceholder')}
                />

                <SignaturePad
                  onConfirm={handleConfirmSignature}
                  onCancel={() => setIsConsentModalOpen(false)}
                  confirmDisabled={!canSubmitConsent}
                  confirmLabel={isSubmittingConsent ? t('patients.savingConsent') : t('patients.confirmSignature')}
                />
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

