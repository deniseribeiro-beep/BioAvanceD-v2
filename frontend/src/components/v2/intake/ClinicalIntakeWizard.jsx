import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { z } from 'zod';
import { ArrowLeft, ArrowRight, CheckCircle2, FlaskConical, Pill, PlusCircle, Send, ShieldCheck, Stethoscope } from 'lucide-react';
import Button from '../../../components/UI/Button';
import Card from '../../../components/UI/Card';
import Input from '../../../components/UI/Input';
import Select from '../../../components/UI/Select';
import Modal from '../../../components/UI/Modal';
import Textarea from '../../../components/UI/Textarea';
import CidAsyncAutocomplete from '../../../components/CidAsyncAutocomplete';
import { apiClient, notifyApiToast } from '../../../api/client';

// Exemplo de uso do componente CidAsyncAutocomplete:
// <CidAsyncAutocomplete
//   value={formData.diagnosisCid}
//   onChange={cid => setFormData(prev => ({ ...prev, diagnosisCid: cid }))}
//   placeholder="Buscar CID por código ou descrição..."
// />
import intakeService from '../../../api/intake.service';
import { cidService, consentService } from '../../../services/api';
import { LIMITS } from '../../../config/constants/limits.constants';
import { VALIDATION_MESSAGES, VALIDATION_RULES } from '../../../config/constants/validation.constants';
import './ClinicalIntakeWizard.css';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateAcronym(name) {
  const stopWords = new Set(['de', 'da', 'do', 'das', 'dos']);

  return String(name || '')
    .trim()
    .split(/[\s-]+/)
    .filter((word) => word && word.length > 2 && !stopWords.has(word.toLowerCase()))
    .map((word) => word[0].toUpperCase())
    .join('');
}

const patientStepSchema = z.object({
  patientName: z.string().trim().min(2, VALIDATION_MESSAGES.required).max(LIMITS.FULL_NAME_MAX_LENGTH, 'Nome muito longo'),
  birthDate: z
    .string()
    .trim()
    .regex(VALIDATION_RULES.birthDate.pattern, 'Informe a data no formato DD/MM/AAAA'),
  gender: z.string().trim().min(1, 'Selecione o sexo'),
  email: z.string().trim().optional().or(z.literal('')),
  isDeceased: z.boolean(),
  representativeName: z.string().trim().optional().or(z.literal('')),
  representativeEmail: z.string().trim().optional().or(z.literal('')),
  representativeCpf: z.string().trim().optional().or(z.literal('')),
  representativePhone: z.string().trim().optional().or(z.literal('')),
  phone: z
    .string()
    .trim()
    .refine((value) => {
      const digits = value.replace(/\D/g, '');
      return digits.length >= 10 && digits.length <= 15;
    }, VALIDATION_MESSAGES.phoneDigits),
  cpf: z
    .string()
    .trim()
    .refine((value) => {
      const digits = value.replace(/\D/g, '');
      return digits.length === 11;
    }, VALIDATION_MESSAGES.cpf),
}).superRefine((data, ctx) => {
  const patientEmail = String(data.email || '').trim();
  const representativeName = String(data.representativeName || '').trim();
  const representativeEmail = String(data.representativeEmail || '').trim();
  const representativeCpf = String(data.representativeCpf || '').trim();
  const representativePhone = String(data.representativePhone || '').trim();

  if (!data.isDeceased) {
    if (!patientEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['email'],
        message: VALIDATION_MESSAGES.email,
      });
    } else if (!emailPattern.test(patientEmail)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['email'],
        message: VALIDATION_MESSAGES.email,
      });
    }
  } else if (patientEmail && !emailPattern.test(patientEmail)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['email'],
      message: VALIDATION_MESSAGES.email,
    });
  }

  if (data.isDeceased) {
    if (!representativeName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['representativeName'],
        message: VALIDATION_MESSAGES.required,
      });
    }

    if (!representativeEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['representativeEmail'],
        message: VALIDATION_MESSAGES.email,
      });
    } else if (!emailPattern.test(representativeEmail)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['representativeEmail'],
        message: VALIDATION_MESSAGES.email,
      });
    }

    if (!representativeCpf || representativeCpf.replace(/\D/g, '').length !== 11) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['representativeCpf'],
        message: VALIDATION_MESSAGES.cpf,
      });
    }

    const representativePhoneDigits = representativePhone.replace(/\D/g, '');
    if (!representativePhone || representativePhoneDigits.length < 10 || representativePhoneDigits.length > 15) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['representativePhone'],
        message: VALIDATION_MESSAGES.phoneDigits,
      });
    }
  }
});

const clinicalStepSchema = z.object({
  bloodPressure: z.string().trim().max(30, 'Pressão arterial muito longa').optional().or(z.literal('')),
  clinicalObservations: z.string().trim().max(LIMITS.GENERIC_TEXT_MAX_LENGTH, 'Observações clínicas muito longas').optional().or(z.literal('')),
});

const consentStepSchema = z.object({
  selectedConsentTemplateId: z.string().trim().min(1, 'Selecione um TCLE antes de finalizar o cadastro'),
});

const biomarkerRequestSchema = z.object({
  biomarkerName: z.string().trim().min(2, 'Informe o nome do biomarcador'),
  measurementUnit: z.string().trim().min(1, 'Informe a unidade de medida'),
  justification: z.string().trim().min(10, 'Informe a justificativa científica'),
});

const stepMeta = [
  {
    key: 'patient',
    label: 'Passo 1',
    title: 'Dados Demográficos',
    icon: Stethoscope,
    helper: 'Valide o paciente antes de seguir para a amostra.',
  },
  {
    key: 'sample',
    label: 'Passo 2',
    title: 'Amostra Pré-analítica',
    icon: FlaskConical,
    helper: 'Selecione os ids canônicos de origem, extração e qualidade.',
  },
  {
    key: 'biomarkers',
    label: 'Passo 3',
    title: 'Biomarcadores & Clínica',
    icon: ShieldCheck,
    helper: 'Inclua os biomarcadores para concluir o cadastro integrado.',
  },
];

const initialState = {
  patientName: '',
  birthDate: '',
  email: '',
  gender: '',
  isDeceased: false,
  isHealthyControl: false,
  diagnosisCidId: '',
  diagnosisCidCode: '',
  diagnosisOrphaCode: '',
  diagnosisOmimCode: '',
  diagnosisCodesManualMode: false,
  diagnosisCidDescription: '',
  representativeName: '',
  representativeEmail: '',
  representativeCpf: '',
  representativePhone: '',
  hypertension: false,
  diabetesType1: false,
  diabetesType2: false,
  obesity: false,
  copd: false,
  ckd: false,
  asthma: false,
  smoking: false,
  alcoholUse: false,
  antibioticUse: false,
  insulinUse: false,
  antiviralUse: false,
  bloodPressure: '',
  clinicalObservations: '',
  phone: '',
  cpf: '',
  sampleType: '',
  sampleOrigin: '',
  extractionProtocol: '',
  quantity: '',
  quality: '',
  linkedProject: '',
  collectionInstitution: '',
  collectionInstitutionAcronym: '',
  selectedConsentTemplateId: '',
};

const CONSENT_PLACEHOLDERS = {
  '{{NOME_PACIENTE}}': (formData) => String(formData.patientName || '').trim() || 'Nome não informado',
  '{{DOC_PACIENTE}}': (formData) => String(formData.patientID || formData.patientId || formData.sampleID || formData.sampleId || '').trim() || 'ID do paciente/amostra será gerado no submit',
  '{{ID_PACIENTE_SISTEMA}}': (formData) => String(formData.patientID || formData.patientId || '').trim() || 'Será gerado no submit',
  '{{ID_AMOSTRA}}': (formData) => String(formData.sampleID || formData.sampleId || '').trim() || 'Será gerado no submit',
  '{{NOME_REPRESENTANTE}}': (formData) => (formData.isDeceased ? String(formData.representativeName || '').trim() : 'Não aplicável') || 'Não aplicável',
};

function getConsentTemplateBody(template) {
  if (!template) {
    return '';
  }

  return String(template.content || template.htmlContent || '').trim();
}

function buildConsentPreview(template, formData) {
  const baseText = getConsentTemplateBody(template);

  if (!baseText) {
    return 'Nenhum conteúdo de TCLE disponível para visualização.';
  }

  return Object.entries(CONSENT_PLACEHOLDERS).reduce((currentText, [placeholder, resolver]) => {
    return currentText.split(placeholder).join(resolver(formData));
  }, baseText);
}

function getFirstSchemaError(error) {
  return error?.issues?.[0]?.message || '';
}

function getDictionarySlug(item) {
  return String(item?.slug || item?.value || item?.code || '').trim();
}

function getDictionaryLabel(item) {
  return String(item?.label || item?.name || '').trim();
}

function mapDictionaryOptions(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      value: getDictionarySlug(item),
      label: getDictionaryLabel(item),
    }))
    .filter((option) => option.value && option.label);
}

function getCidDisplayLabel(item) {
  const code = String(item?.Codigo_Tabulacao || item?.Codigos_CID10 || item?.code || '').trim();
  const description = String(item?.Descricao || item?.description || '').trim();

  if (code && description) {
    return `${code} - ${description}`;
  }

  return description || code || 'Doença sem descrição';
}

function getCidLocalizedNames(item) {
  const translationNames = item?.translations && typeof item.translations === 'object'
    ? [item.translations.pt, item.translations.en, item.translations.es]
    : [];
  const objectNames = item?.names && typeof item.names === 'object'
    ? [item.names.pt, item.names.en, item.names.es]
    : [];

  return [
    item?.namePt,
    item?.nameEn,
    item?.nameEs,
    item?.nomePt,
    item?.nomeEn,
    item?.nomeEs,
    item?.Descricao,
    item?.description,
    item?.name,
    ...translationNames,
    ...objectNames,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function getCidAliases(item) {
  return [
    ...(Array.isArray(item?.aliases) ? item.aliases : []),
    ...(Array.isArray(item?.synonyms) ? item.synonyms : []),
    ...(Array.isArray(item?.alternativeNames) ? item.alternativeNames : []),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function getCidDisplayTitle(item) {
  const localizedNames = getCidLocalizedNames(item);
  if (localizedNames.length > 0) {
    return localizedNames.slice(0, 3).join(' / ');
  }

  return getCidDisplayLabel(item);
}

function getCidDisplayMeta(item) {
  const code = String(item?.Codigos_CID10 || item?.icd_code || item?.icdCode || item?.Codigo_Tabulacao || item?.code || '').trim();
  const orphaCode = String(item?.ORPHA || item?.orpha || item?.orphaCode || item?.orpha_code || '').trim();

  return [
    code ? `CID: ${code}` : 'CID: -',
    orphaCode ? `ORPHA: ${orphaCode}` : 'ORPHA: -',
  ].join(' | ');
}

function getCidAliasPreview(item) {
  const aliases = getCidAliases(item);
  if (aliases.length === 0) {
    return '';
  }

  return `Aliases: ${aliases.slice(0, 3).join(' • ')}`;
}

function normalizeCidOption(item) {
  const id = String(item?._id || '').trim();
  const code = String(item?.Codigos_CID10 || item?.icdCode || item?.code || item?.Codigo_Tabulacao || '').trim();
  const description = String(item?.Descricao || item?.description || '').trim();
  const orphaCode = String(item?.ORPHA || item?.orpha || item?.orphaCode || item?.orpha_code || '').trim();
  const omimCode = String(item?.OMIM || item?.omim || item?.omimCode || item?.omim_code || '').trim();
  const localizedNames = getCidLocalizedNames(item);
  const aliases = getCidAliases(item);
  const displayName = getCidDisplayTitle(item);

  return {
    id,
    code,
    description,
    label: displayName,
    displayName,
    metaLabel: getCidDisplayMeta(item),
    aliasLabel: getCidAliasPreview(item),
    chapter: String(item?.Capitulo || item?.chapter || '').trim(),
    orphaCode,
    omimCode,
    aliases,
    localizedNames,
  };
}

function createSampleStepSchema(sampleTypeValues, sampleOriginValues, extractionProtocolValues, qualityValues) {
  return z.object({
    sampleType: z.string().refine((value) => sampleTypeValues.includes(value), 'Selecione o tipo de amostra'),
    sampleOrigin: z.string().refine((value) => sampleOriginValues.includes(value), 'Selecione a origem da amostra'),
    collectionInstitution: z
      .string()
      .trim()
      .min(2, 'Informe a Clínica / Hospital de Origem')
      .max(LIMITS.GENERIC_TEXT_MAX_LENGTH, 'Clínica / Hospital de Origem muito longo'),
    collectionInstitutionAcronym: z.string().trim().optional().or(z.literal('')),
    extractionProtocol: z
      .string()
      .refine((value) => extractionProtocolValues.includes(value), 'Selecione o protocolo de extração'),
    quantity: z
      .string()
      .trim()
      .refine((value) => Number(value) > 0, 'Informe um volume maior que zero'),
    quality: z.string().refine((value) => qualityValues.includes(value), 'Selecione a qualidade'),
    linkedProject: z
      .string()
      .trim()
      .min(2, 'Informe o projeto vinculado')
      .max(LIMITS.GENERIC_TEXT_MAX_LENGTH, 'Projeto muito longo'),
  });
}

function createClinicalStepSchema(clinicalItems = []) {
  return z.object({
    isHealthyControl: z.boolean(),
    diagnosisCidId: z.string().trim().optional().or(z.literal('')),
    diagnosisCidCode: z.string().trim().optional().or(z.literal('')),
    diagnosisCidDescription: z.string().trim().optional().or(z.literal('')),
    bloodPressure: z.string().trim().max(30, 'Pressão arterial muito longa').optional().or(z.literal('')),
    clinicalObservations: z.string().trim().max(LIMITS.GENERIC_TEXT_MAX_LENGTH, 'Observações clínicas muito longas').optional().or(z.literal('')),
    ...Object.fromEntries((Array.isArray(clinicalItems) ? clinicalItems : []).map((item) => [getDictionarySlug(item), z.boolean()])),
  }).superRefine((data, ctx) => {
    if (!data.isHealthyControl && !String(data.diagnosisCidId || '').trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['diagnosisCidId'],
        message: 'Selecione a doença / diagnóstico da amostra',
      });
    }
  });
}

function createBiomarkerStepSchema(biomarkerItems = []) {
  return z.object(
    Object.fromEntries((Array.isArray(biomarkerItems) ? biomarkerItems : []).map((item) => [
      getDictionarySlug(item),
      z
        .string()
        .trim()
        .refine((value) => value === '' || !Number.isNaN(Number(value.replace(',', '.'))), 'Informe um valor numérico'),
    ]))
  );
}

function getStepError(error) {
  return error?.issues?.[0]?.message || '';
}

function getFieldError(validation, fieldName) {
  return validation?.error?.issues?.find((issue) => issue.path?.[0] === fieldName)?.message || '';
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function formatBirthDateInput(value) {
  const digits = digitsOnly(value).slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function formatCpfInput(value) {
  const digits = digitsOnly(value).slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function formatPhoneInput(value) {
  const digits = digitsOnly(value).slice(0, 11);
  if (digits.length <= 2) return digits;

  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);

  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  if (digits.length <= 10) {
    return `(${ddd}) ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
  }

  return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
}

function normalizeEmailInput(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeBirthDateForPayload(value) {
  const digits = digitsOnly(value);
  if (digits.length !== 8) {
    return String(value || '').trim();
  }

  const day = digits.slice(0, 2);
  const month = digits.slice(2, 4);
  const year = digits.slice(4, 8);
  return `${year}-${month}-${day}T00:00:00.000Z`;
}

function buildSubmissionPayload(formData, clinicalComorbidityItems = [], biomarkerItems = []) {
  const now = new Date().toISOString();
  const diagnosis = formData.isHealthyControl ? null : {
    icd_code: String(formData.diagnosisCidCode || '').trim() || null,
    orpha_code: String(formData.diagnosisOrphaCode || '').trim() || null,
    omim_code: String(formData.diagnosisOmimCode || '').trim() || null,
    icdCode: String(formData.diagnosisCidCode || '').trim() || null,
    orphaCode: String(formData.diagnosisOrphaCode || '').trim() || null,
    omimCode: String(formData.diagnosisOmimCode || '').trim() || null,
  };
  const biomarkers = (Array.isArray(biomarkerItems) ? biomarkerItems : []).flatMap((biomarker) => {
    const biomarkerSlug = getDictionarySlug(biomarker);
    const rawValue = String(formData[biomarkerSlug] || '').trim();

    if (rawValue === '') {
      return [];
    }

    const value = Number(rawValue.replace(',', '.'));
    if (Number.isNaN(value)) {
      return [];
    }

    return [{
      biomarkerType: biomarkerSlug,
      value,
      unit: biomarker.unit || biomarker.measurementUnit || '',
      collectedAt: now,
      source: 'patient',
      status: 'final',
      eventType: 'manual',
    }];
  });

  const clinical = {
    comorbidities: (Array.isArray(clinicalComorbidityItems) ? clinicalComorbidityItems : []).reduce((accumulator, option) => {
      const field = getDictionarySlug(option);
      accumulator[field] = Boolean(formData[field]);
      return accumulator;
    }, {}),
    bloodPressure: String(formData.bloodPressure || '').trim(),
    clinicalObservations: String(formData.clinicalObservations || '').trim(),
  };

  return {
    demographic: {
      patientName: formData.patientName.trim(),
      birthDate: normalizeBirthDateForPayload(formData.birthDate),
      email: normalizeEmailInput(formData.email),
      isDeceased: Boolean(formData.isDeceased),
      isHealthyControl: Boolean(formData.isHealthyControl),
      is_healthy_control: Boolean(formData.isHealthyControl),
      cidId: formData.isHealthyControl ? null : String(formData.diagnosisCidId || '').trim() || null,
      ...(diagnosis || {}),
      diagnosticHypothesis: formData.isHealthyControl ? null : String(formData.diagnosisCidDescription || '').trim() || null,
      phone: digitsOnly(formData.phone),
      cpf: digitsOnly(formData.cpf),
    },
    diagnosis,
    representativeLegal: formData.isDeceased ? {
      name: String(formData.representativeName || '').trim(),
      email: normalizeEmailInput(formData.representativeEmail),
      cpf: digitsOnly(formData.representativeCpf),
      phone: digitsOnly(formData.representativePhone),
    } : null,
    sample: {
      sampleType: formData.sampleType,
      sampleOrigin: formData.sampleOrigin.trim(),
      collectionInstitution: formData.collectionInstitution.trim(),
      collectionInstitutionAcronym: formData.collectionInstitutionAcronym.trim() || generateAcronym(formData.collectionInstitution),
      extractionProtocol: formData.extractionProtocol.trim(),
      barcode: undefined,
      quantity: Number(formData.quantity),
      unit: 'µL',
      quality: formData.quality,
      linkedProject: formData.linkedProject.trim(),
      specimenCollection: {
        institution: formData.collectionInstitution.trim(),
        acronym: formData.collectionInstitutionAcronym.trim() || generateAcronym(formData.collectionInstitution),
      },
      registerDate: now,
      registrationDate: now,
      currentStatus: 'Available',
      isRareDisease: false,
    },
    clinical,
    consent: {
      tcle_template_id: formData.selectedConsentTemplateId,
      consent_granted: true,
      consent_accepted_at: now,
    },
    biomarkers,
  };
}

export default function ClinicalIntakeWizard({
    const { t } = useLanguage();
  onStepChange,
  onValidityChange,
  submitLabel = t('intake.finalizeRegistration', 'Finalizar Cadastro Integrado'),
  className = '',
  dictionaries = {},
  dictionariesLoading = true,
  dictionariesError = '',
}) {
  const [activeStep, setActiveStep] = useState(0);
  const [formData, setFormData] = useState(initialState);
  const [touched, setTouched] = useState(false);
  const [step1Attempted, setStep1Attempted] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [consentTemplates, setConsentTemplates] = useState([]);
  const [consentTemplatesLoading, setConsentTemplatesLoading] = useState(false);
  const [consentTemplatesError, setConsentTemplatesError] = useState('');
  const [diagnosisQuery, setDiagnosisQuery] = useState('');
  const [diagnosisResults, setDiagnosisResults] = useState([]);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [diagnosisError, setDiagnosisError] = useState('');
  const [diagnosisOpen, setDiagnosisOpen] = useState(false);
  const [isConsentPreviewOpen, setIsConsentPreviewOpen] = useState(false);
  const [isBiomarkerRequestOpen, setIsBiomarkerRequestOpen] = useState(false);
  const [isBiomarkerRequestSubmitting, setIsBiomarkerRequestSubmitting] = useState(false);
  const [biomarkerRequestForm, setBiomarkerRequestForm] = useState({
    biomarkerName: '',
    measurementUnit: '',
    justification: '',
  });
  const [biomarkerRequestError, setBiomarkerRequestError] = useState('');

  const sampleTypeDefinitions = useMemo(() => (Array.isArray(dictionaries.sampleTypes) ? dictionaries.sampleTypes : []), [dictionaries.sampleTypes]);
  const anatomicalOriginDefinitions = useMemo(() => (Array.isArray(dictionaries.anatomicalOrigins) ? dictionaries.anatomicalOrigins : []), [dictionaries.anatomicalOrigins]);
  const extractionProtocolDefinitions = useMemo(() => (Array.isArray(dictionaries.extractionProtocols) ? dictionaries.extractionProtocols : []), [dictionaries.extractionProtocols]);
  const clinicalComorbidityDefinitions = useMemo(() => (Array.isArray(dictionaries.clinicalComorbidities) ? dictionaries.clinicalComorbidities : []), [dictionaries.clinicalComorbidities]);
  const biomarkerDefinitions = useMemo(() => (Array.isArray(dictionaries.biomarkers) ? dictionaries.biomarkers : []), [dictionaries.biomarkers]);
  const qualityDefinitions = useMemo(() => (Array.isArray(dictionaries.preAnalyticalQualities) ? dictionaries.preAnalyticalQualities : []), [dictionaries.preAnalyticalQualities]);

  const sampleTypeOptions = useMemo(() => mapDictionaryOptions(sampleTypeDefinitions), [sampleTypeDefinitions]);
  const sampleOriginOptions = useMemo(() => mapDictionaryOptions(anatomicalOriginDefinitions), [anatomicalOriginDefinitions]);
  const extractionProtocolOptions = useMemo(() => mapDictionaryOptions(extractionProtocolDefinitions), [extractionProtocolDefinitions]);
  const clinicalComorbidityOptions = useMemo(() => mapDictionaryOptions(clinicalComorbidityDefinitions), [clinicalComorbidityDefinitions]);
  const biomarkerOptions = useMemo(() => mapDictionaryOptions(biomarkerDefinitions), [biomarkerDefinitions]);
  const qualityOptions = useMemo(() => mapDictionaryOptions(qualityDefinitions), [qualityDefinitions]);

  const sampleStepSchemaDynamic = useMemo(
    () => createSampleStepSchema(
      sampleTypeOptions.map((option) => option.value),
      sampleOriginOptions.map((option) => option.value),
      extractionProtocolOptions.map((option) => option.value),
      qualityOptions.map((option) => option.value)
    ),
    [sampleTypeOptions, sampleOriginOptions, extractionProtocolOptions, qualityOptions]
  );

  const clinicalStepSchemaDynamic = useMemo(
    () => createClinicalStepSchema(clinicalComorbidityDefinitions),
    [clinicalComorbidityDefinitions]
  );

  const biomarkerStepSchemaDynamic = useMemo(
    () => createBiomarkerStepSchema(biomarkerDefinitions),
    [biomarkerDefinitions]
  );

  const patientValidation = useMemo(() => patientStepSchema.safeParse(formData), [formData]);
  const sampleValidation = useMemo(() => sampleStepSchemaDynamic.safeParse(formData), [formData, sampleStepSchemaDynamic]);
  const clinicalValidation = useMemo(() => clinicalStepSchemaDynamic.safeParse(formData), [formData, clinicalStepSchemaDynamic]);
  const biomarkerValidation = useMemo(() => biomarkerStepSchemaDynamic.safeParse(formData), [formData, biomarkerStepSchemaDynamic]);
  const consentValidation = useMemo(() => consentStepSchema.safeParse(formData), [formData]);

  const showPatientErrors = step1Attempted || touched;
  const showSampleErrors = touched;
  const showBiomarkerErrors = touched;
  const showConsentErrors = touched;

  const isStep1Valid = patientValidation.success;
  const dictionariesReady = !dictionariesLoading && !dictionariesError && sampleTypeOptions.length > 0 && sampleOriginOptions.length > 0 && extractionProtocolOptions.length > 0 && qualityOptions.length > 0 && clinicalComorbidityDefinitions.length > 0 && biomarkerDefinitions.length > 0;

  const isStep2Valid = dictionariesReady && sampleValidation.success;
  const isStep3Valid = dictionariesReady && clinicalValidation.success && biomarkerValidation.success && consentValidation.success && consentTemplates.length > 0;

  const selectedConsentTemplate = useMemo(() => {
    return consentTemplates.find((template) => template._id === formData.selectedConsentTemplateId) || null;
  }, [consentTemplates, formData.selectedConsentTemplateId]);

  const consentPreview = useMemo(() => buildConsentPreview(selectedConsentTemplate, formData), [selectedConsentTemplate, formData]);
  const biomarkerRequestValidation = useMemo(
    () => biomarkerRequestSchema.safeParse(biomarkerRequestForm),
    [biomarkerRequestForm]
  );

  const biomarkerRequestValidationError = biomarkerRequestValidation.success ? '' : getFirstSchemaError(biomarkerRequestValidation.error);
  const selectedDiagnosis = useMemo(
    () => diagnosisResults.find((item) => item.id === String(formData.diagnosisCidId || '').trim()) || null,
    [diagnosisResults, formData.diagnosisCidId]
  );
  const diagnosisHasAutoFill = Boolean(selectedDiagnosis);
  const diagnosisOrphaLocked = Boolean(selectedDiagnosis);
  const diagnosisOmimLocked = Boolean(selectedDiagnosis);

  useEffect(() => {
    let active = true;

    const loadDiagnoses = async () => {
      if (formData.isHealthyControl) {
        setDiagnosisResults([]);
        setDiagnosisLoading(false);
        setDiagnosisError('');
        return;
      }

      const term = String(diagnosisQuery || '').trim();
      if (term.length === 1) {
        setDiagnosisResults([]);
        setDiagnosisLoading(false);
        setDiagnosisError('');
        return;
      }

      setDiagnosisLoading(true);
      setDiagnosisError('');

      try {
        const response = term.length === 0
          ? await apiClient.get('/cids', { suppressErrorToast: true })
          : await cidService.search(term, 12);
        const payload = term.length === 0
          ? response?.data?.data ?? response?.data ?? []
          : response?.data?.data ?? response?.data ?? [];
        const nextResults = Array.isArray(payload)
          ? payload.map((item) => normalizeCidOption(item)).filter((item) => item.id || item.code || item.description)
          : [];

        if (!active) {
          return;
        }

        setDiagnosisResults(nextResults);
      } catch (error) {
        if (!active) {
          return;
        }

        setDiagnosisResults([]);
        setDiagnosisError(error?.response?.data?.message || error?.response?.data?.error || error?.message || 'Não foi possível carregar as doenças.');
      } finally {
        if (active) {
          setDiagnosisLoading(false);
        }
      }
    };

    const timer = setTimeout(() => {
      void loadDiagnoses();
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [diagnosisQuery, formData.isHealthyControl]);

  useEffect(() => {
    setFormData((current) => {
      const next = { ...current };

      clinicalComorbidityDefinitions.forEach((item) => {
        const field = getDictionarySlug(item);
        if (field && next[field] === undefined) {
          next[field] = false;
        }
      });

      biomarkerDefinitions.forEach((item) => {
        const field = getDictionarySlug(item);
        if (field && next[field] === undefined) {
          next[field] = '';
        }
      });

      if (next.isHealthyControl) {
        next.diagnosisCidId = '';
        next.diagnosisCidCode = '';
        next.diagnosisOrphaCode = '';
        next.diagnosisOmimCode = '';
        next.diagnosisCodesManualMode = false;
        next.diagnosisCidDescription = '';
      }

      return next;
    });
  }, [clinicalComorbidityDefinitions, biomarkerDefinitions]);

  useEffect(() => {
    let active = true;

    const loadConsentTemplates = async () => {
      setConsentTemplatesLoading(true);
      setConsentTemplatesError('');

      try {
        const response = await consentService.getAllPolicies();
        const payload = response?.data?.data ?? response?.data ?? [];
        const nextTemplates = Array.isArray(payload)
          ? payload.filter((template) => template && typeof template === 'object' && template.active)
          : [];

        if (!active) {
          return;
        }

        if (nextTemplates.length > 0) {
          setConsentTemplates(nextTemplates);
          setFormData((current) => {
            if (current.selectedConsentTemplateId) {
              return current;
            }

            return {
              ...current,
              selectedConsentTemplateId: String(nextTemplates[0]._id || '').trim(),
            };
          });
        } else {
          setConsentTemplates([]);
          setConsentTemplatesError('Nenhum TCLE ativo foi encontrado.');
        }
      } catch (error) {
        if (!active) {
          return;
        }

        try {
          const activeTemplateResponse = await consentService.getActiveTemplate();
          const activeTemplatePayload = activeTemplateResponse?.data?.data ?? activeTemplateResponse?.data ?? null;

          if (!active) {
            return;
          }

          if (activeTemplatePayload && typeof activeTemplatePayload === 'object') {
            setConsentTemplates([activeTemplatePayload]);
            setFormData((current) => {
              if (current.selectedConsentTemplateId) {
                return current;
              }

              return {
                ...current,
                selectedConsentTemplateId: String(activeTemplatePayload._id || '').trim(),
              };
            });
          } else {
            setConsentTemplates([]);
            setConsentTemplatesError(error?.message || 'Erro ao carregar os TCLEs ativos.');
          }
        } catch (fallbackError) {
          setConsentTemplates([]);
          setConsentTemplatesError(fallbackError?.message || error?.message || 'Erro ao carregar os TCLEs ativos.');
        }
      } finally {
        if (active) {
          setConsentTemplatesLoading(false);
        }
      }
    };

    void loadConsentTemplates();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    onValidityChange?.({
      step1: isStep1Valid,
      step2: isStep2Valid,
      step3: isStep3Valid,
      canFinalize: isStep1Valid && isStep2Valid && isStep3Valid,
    });
  }, [isStep1Valid, isStep2Valid, isStep3Valid, onValidityChange]);

  const updateField = (field) => (event) => {
    const value = event.target.value;
    setTouched(true);
    setSubmitError('');
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const updateMaskedField = (field, formatter) => (event) => {
    const value = formatter(event.target.value);
    setTouched(true);
    setSubmitError('');
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const updateCheckboxField = (field) => (event) => {
    const value = event.target.checked;
    setTouched(true);
    setSubmitError('');
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleHealthyControlChange = (event) => {
    const value = event.target.checked;
    setTouched(true);
    setSubmitError('');
    setFormData((prev) => ({
      ...prev,
      isHealthyControl: value,
      diagnosisCidId: value ? '' : prev.diagnosisCidId,
      diagnosisCidCode: value ? '' : prev.diagnosisCidCode,
      diagnosisOrphaCode: value ? '' : prev.diagnosisOrphaCode,
      diagnosisOmimCode: value ? '' : prev.diagnosisOmimCode,
      diagnosisCodesManualMode: value ? false : prev.diagnosisCodesManualMode,
      diagnosisCidDescription: value ? '' : prev.diagnosisCidDescription,
    }));

    if (value) {
      setDiagnosisQuery('');
      setDiagnosisResults([]);
      setDiagnosisOpen(false);
      setDiagnosisError('');
    }
  };

  const handleDiagnosisInputChange = (event) => {
    const value = event.target.value;
    setTouched(true);
    setSubmitError('');
    setDiagnosisQuery(value);
    setDiagnosisOpen(true);
    setFormData((prev) => ({
      ...prev,
      diagnosisCidId: '',
      diagnosisCidCode: '',
      diagnosisOrphaCode: '',
      diagnosisOmimCode: '',
      diagnosisCodesManualMode: false,
      diagnosisCidDescription: '',
    }));
  };

  const handleDiagnosisCodeChange = (field) => (event) => {
    const value = event.target.value;
    setTouched(true);
    setSubmitError('');
    setFormData((prev) => ({
      ...prev,
      [field]: value,
      diagnosisCodesManualMode: true,
    }));
  };

  const handleSelectDiagnosis = (item) => {
    setTouched(true);
    setSubmitError('');
    setFormData((prev) => ({
      ...prev,
      isHealthyControl: false,
      diagnosisCidId: item.id,
      diagnosisCidCode: item.code,
      diagnosisOrphaCode: item.orphaCode || '',
      diagnosisOmimCode: item.omimCode || '',
      diagnosisCodesManualMode: false,
      diagnosisCidDescription: item.description,
    }));
    setDiagnosisQuery(item.displayName || item.label);
    setDiagnosisOpen(false);
    setDiagnosisError('');
  };

  const openBiomarkerRequestModal = () => {
    setBiomarkerRequestError('');
    setIsBiomarkerRequestOpen(true);
  };

  const closeBiomarkerRequestModal = () => {
    if (isBiomarkerRequestSubmitting) {
      return;
    }

    setIsBiomarkerRequestOpen(false);
    setBiomarkerRequestError('');
  };

  const updateBiomarkerRequestField = (field) => (event) => {
    const value = event.target.value;
    setBiomarkerRequestError('');
    setBiomarkerRequestForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const submitBiomarkerRequest = async (event) => {
    event.preventDefault();

    const validation = biomarkerRequestSchema.safeParse(biomarkerRequestForm);
    if (!validation.success) {
      setBiomarkerRequestError(getFirstSchemaError(validation.error));
      return;
    }

    try {
      setIsBiomarkerRequestSubmitting(true);
      setBiomarkerRequestError('');

      await apiClient.post('/biomarker-requests', {
        biomarkerName: validation.data.biomarkerName,
        measurementUnit: validation.data.measurementUnit,
        justification: validation.data.justification,
        source: 'clinical-intake-wizard',
        requestedAt: new Date().toISOString(),
      });

      notifyApiToast({
        message: 'Solicitação enviada ao coordenador',
        type: 'success',
        duration: 4000,
      });

      setBiomarkerRequestForm({
        biomarkerName: '',
        measurementUnit: '',
        justification: '',
      });
      setIsBiomarkerRequestOpen(false);
    } catch (error) {
      const message = error?.response?.data?.message || error?.response?.data?.error || error?.message || 'Não foi possível enviar a solicitação';
      setBiomarkerRequestError(message);
      notifyApiToast({
        message,
        type: 'error',
        duration: 4500,
      });
    } finally {
      setIsBiomarkerRequestSubmitting(false);
    }
  };

  const handleCollectionInstitutionChange = (event) => {
    const collectionInstitution = event.target.value;
    const collectionInstitutionAcronym = generateAcronym(collectionInstitution);

    setTouched(true);
    setSubmitError('');
    setFormData((prev) => ({
      ...prev,
      collectionInstitution,
      collectionInstitutionAcronym,
    }));
  };

  const setStep = (nextStep) => {
    setActiveStep(nextStep);
    onStepChange?.(nextStep);
  };

  const goNext = () => {
    const nextStep = Math.min(activeStep + 1, 2);

    if (activeStep === 0 && !isStep1Valid) {
      setStep1Attempted(true);
      return;
    }

    if (activeStep === 1 && !isStep2Valid) {
      setTouched(true);
      return;
    }

    setStep(nextStep);
  };

  const goBack = () => {
    setStep(Math.max(activeStep - 1, 0));
  };

  const goToStep = (index) => {
    if (index > activeStep) {
      return;
    }

    setStep(index);
  };

  const resetWizard = () => {
    setFormData({
      ...initialState,
      selectedConsentTemplateId: consentTemplates[0]?._id ? String(consentTemplates[0]._id).trim() : '',
    });
    setTouched(false);
    setStep1Attempted(false);
    setSubmitError('');
    setActiveStep(0);
    onStepChange?.(0);
  };

  const handleFinalize = async (event) => {
    event.preventDefault();
    setTouched(true);
    setStep1Attempted(true);

    if (!isStep1Valid || !isStep2Valid || !isStep3Valid) {
      setSubmitError('Revise os campos obrigatórios antes de finalizar o cadastro integrado.');
      notifyApiToast({
        message: 'Revise os campos obrigatórios antes de finalizar o cadastro integrado.',
        type: 'error',
        duration: 4500,
      });
      return;
    }

    try {
      setSubmitError('');
      setIsSubmitting(true);

      const submissionPayload = buildSubmissionPayload(formData, clinicalComorbidityDefinitions, biomarkerDefinitions);
      const result = await intakeService.registerClinicalIntake(submissionPayload, { notify: false });

      if (!result?.success && !result?.partial) {
        throw new Error(result?.message || 'Não foi possível concluir o cadastro integrado.');
      }

      const successMessage = result.partial
        ? 'Paciente e amostra criados. Alguns biomarcadores não puderam ser registrados.'
        : 'Cadastro clínico concluído com sucesso.';

      notifyApiToast({
        message: successMessage,
        type: result.partial ? 'warning' : 'success',
        duration: result.partial ? 5500 : 4000,
      });

      if (result.partial && Array.isArray(result.biomarkerErrors) && result.biomarkerErrors.length > 0) {
        setSubmitError(result.biomarkerErrors.map((item) => item.message).join(' | '));
        return;
      }

      resetWizard();
    } catch (error) {
      const message = error?.message || 'Não foi possível concluir o cadastro integrado.';
      setSubmitError(message);
      notifyApiToast({
        message,
        type: 'error',
        duration: 5000,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeMeta = stepMeta[activeStep];
  const ActiveIcon = activeMeta.icon;
  const stepProgress = ((activeStep + 1) / stepMeta.length) * 100;
  const biomarkerSummary = biomarkerOptions.map((biomarker) => ({
    ...biomarker,
    value: formData[biomarker.value],
  }));

  const consentOptions = [
    { value: '', label: consentTemplatesLoading ? 'Carregando TCLEs...' : 'Selecione a versão do TCLE' },
    ...consentTemplates.map((template) => ({
      value: String(template._id || '').trim(),
      label: `${template.version || '--'} - ${template.title || 'TCLE sem título'}`,
    })),
  ];

  return (
    <form className={`clinical-intake-wizard ${className}`} onSubmit={handleFinalize} noValidate>
      <header className="clinical-intake-wizard__header">
        <div>
          <p className="clinical-intake-wizard__eyebrow">{t('intake.headerTitle', 'Cadastro Integrado')}</p>
          <h3>{t('intake.headerSubtitle', 'Wizard clínico em três etapas')}</h3>
          <p>
            {t('intake.headerDescription', 'O fluxo impede avanço prematuro no Passo 1 e só exibe a finalização no Passo 3.')}
          </p>
        </div>
        <div className="clinical-intake-wizard__badge">
          <Pill size={16} />
          <span>{t('intake.safeStep', 'Passo a passo seguro')}</span>
        </div>
      </header>

      <section className="clinical-intake-wizard__stepper" aria-label={t('intake.stepperAria', 'Etapas do cadastro integrado')}>
        {stepMeta.map((step, index) => {
          const Icon = step.icon;
          const isActive = index === activeStep;
          const isComplete = index < activeStep;

          return (
            <button
              key={step.key}
              type="button"
              disabled={index > activeStep}
              className={`clinical-intake-wizard__step ${isActive ? 'is-active' : ''} ${isComplete ? 'is-complete' : ''}`}
              onClick={() => goToStep(index)}
            >
              <span className="clinical-intake-wizard__step-icon">
                {isComplete ? <CheckCircle2 size={16} /> : <Icon size={16} />}
              </span>
              <span>
                <strong>{t(`intake.step${index+1}Label`, step.label)}</strong>
                <small>{t(`intake.step${index+1}Title`, step.title)}</small>
              </span>
            </button>
          );
        })}
      </section>

      <div className="clinical-intake-wizard__progress" aria-hidden="true">
        <div className="clinical-intake-wizard__progress-track">
          <div className="clinical-intake-wizard__progress-fill" style={{ width: `${stepProgress}%` }} />
        </div>
        <span>{t('intake.progress', `${activeStep + 1} de 3`, { step: activeStep + 1, total: 3 })}</span>
      </div>

      <Card className="clinical-intake-wizard__panel">
        <div className="clinical-intake-wizard__panel-header">
          <div className="clinical-intake-wizard__panel-eyebrow">
            <ActiveIcon size={18} />
            <span>{t(`intake.step${activeStep+1}Label`, activeMeta.label)}</span>
          </div>
          <h4>{t(`intake.step${activeStep+1}Title`, activeMeta.title)}</h4>
          <p>{t(`intake.step${activeStep+1}Helper`, activeMeta.helper)}</p>
        </div>

        {dictionariesError && (
          <div className="clinical-intake-wizard__step-warning" role="alert">
            {dictionariesError}
          </div>
        )}

        {activeStep === 0 && (
          <div className="clinical-intake-wizard__grid">
            <label className="clinical-intake-wizard__switch clinical-intake-wizard__switch--wide">
              <input
                type="checkbox"
                checked={formData.isDeceased}
                onChange={updateCheckboxField('isDeceased')}
              />
              <span>
                <strong>Paciente em Óbito (Amostra Retrospectiva/Póstuma)</strong>
                <small>Quando marcado, o e-mail do paciente passa a ser opcional e os dados do representante legal são exibidos.</small>
              </span>
            </label>

            <Input
              label="Nome completo"
              value={formData.patientName}
              onChange={updateField('patientName')}
              placeholder="Nome do paciente"
              constraintKey="name"
              required
              error={showPatientErrors ? getFieldError(patientValidation, 'patientName') : ''}
            />
            <Input
              label="Data de nascimento"
              value={formData.birthDate}
              onChange={updateMaskedField('birthDate', formatBirthDateInput)}
              placeholder="DD/MM/AAAA"
              inputMode="numeric"
              maxLength={10}
              required
              error={showPatientErrors ? getFieldError(patientValidation, 'birthDate') : ''}
            />
            <Select
              label="Sexo"
              value={formData.gender}
              onChange={updateField('gender')}
              options={[
                { value: '', label: 'Selecione o sexo' },
                { value: 'feminino', label: 'Feminino' },
                { value: 'masculino', label: 'Masculino' },
              ]}
              required
              error={showPatientErrors ? getFieldError(patientValidation, 'gender') : ''}
            />
            <Input
              label="Email"
              type="email"
              value={formData.email}
              onChange={updateField('email')}
              placeholder="paciente@exemplo.com"
              constraintKey="email"
              required={!formData.isDeceased}
              helperText={formData.isDeceased ? 'Opcional quando o paciente estiver marcado como óbito.' : undefined}
              error={showPatientErrors ? getFieldError(patientValidation, 'email') : ''}
            />
            <Input
              label="Contato"
              value={formData.phone}
              onChange={updateMaskedField('phone', formatPhoneInput)}
              placeholder="(11) 99999-9999"
              inputMode="numeric"
              maxLength={15}
              required
              error={showPatientErrors ? getFieldError(patientValidation, 'phone') : ''}
            />
            <Input
              label="CPF"
              value={formData.cpf}
              onChange={updateMaskedField('cpf', formatCpfInput)}
              placeholder="000.000.000-00"
              inputMode="numeric"
              maxLength={14}
              required
              error={showPatientErrors ? getFieldError(patientValidation, 'cpf') : ''}
            />

            {formData.isDeceased && (
              <div className="clinical-intake-wizard__representative-section">
                <div className="clinical-intake-wizard__representative-header">
                  <strong>Dados do Representante Legal</strong>
                  <p>Os dados abaixo são exigidos para o contrato de TCLE e para a persistência do cadastro de paciente falecido.</p>
                </div>

                <div className="clinical-intake-wizard__representative-grid">
                  <Input
                    label="Nome do Representante Familiar"
                    value={formData.representativeName}
                    onChange={updateField('representativeName')}
                    placeholder="Nome do representante"
                    constraintKey="name"
                    required
                    error={showPatientErrors ? getFieldError(patientValidation, 'representativeName') : ''}
                  />
                  <Input
                    label="E-mail do Representante"
                    type="email"
                    value={formData.representativeEmail}
                    onChange={updateField('representativeEmail')}
                    placeholder="representante@exemplo.com"
                    constraintKey="email"
                    required
                    helperText="Usado para envio do TCLE ao responsável legal."
                    error={showPatientErrors ? getFieldError(patientValidation, 'representativeEmail') : ''}
                  />
                  <Input
                    label="CPF do Representante"
                    value={formData.representativeCpf}
                    onChange={updateMaskedField('representativeCpf', formatCpfInput)}
                    placeholder="000.000.000-00"
                    inputMode="numeric"
                    maxLength={14}
                    required
                    error={showPatientErrors ? getFieldError(patientValidation, 'representativeCpf') : ''}
                  />
                  <Input
                    label="Telefone do Representante"
                    value={formData.representativePhone}
                    onChange={updateMaskedField('representativePhone', formatPhoneInput)}
                    placeholder="(11) 99999-9999"
                    inputMode="numeric"
                    maxLength={15}
                    required
                    error={showPatientErrors ? getFieldError(patientValidation, 'representativePhone') : ''}
                  />
                </div>
              </div>
            )}

            <div className="clinical-intake-wizard__hint-box clinical-intake-wizard__hint-box--wide">
              <strong>ID automático e anonimização</strong>
              <p>
                O identificador do paciente será gerado automaticamente pelo backend após o cadastro, garantindo
                unicidade e evitando preenchimento manual.
              </p>
            </div>
          </div>
        )}

        {activeStep === 1 && (
          <div className="clinical-intake-wizard__grid">
            <Select
              label="Tipo de amostra"
              value={formData.sampleType}
              onChange={updateField('sampleType')}
              options={dictionariesLoading ? [{ value: '', label: 'Carregando tipos de amostra...' }] : [{ value: '', label: 'Selecione o tipo de amostra' }, ...sampleTypeOptions]}
              disabled={dictionariesLoading || sampleTypeOptions.length === 0}
              error={showSampleErrors ? getFieldError(sampleValidation, 'sampleType') : ''}
            />
            <Select
              label="Origem pré-analítica"
              value={formData.sampleOrigin}
              onChange={updateField('sampleOrigin')}
              options={dictionariesLoading ? [{ value: '', label: 'Carregando origens pré-analíticas...' }] : [{ value: '', label: 'Selecione a origem da amostra' }, ...sampleOriginOptions]}
              disabled={dictionariesLoading || sampleOriginOptions.length === 0}
              error={showSampleErrors ? getFieldError(sampleValidation, 'sampleOrigin') : ''}
            />
            <Select
              label="Protocolo de extração"
              value={formData.extractionProtocol}
              onChange={updateField('extractionProtocol')}
              options={dictionariesLoading ? [{ value: '', label: 'Carregando protocolos de extração...' }] : [{ value: '', label: 'Selecione o protocolo de extração' }, ...extractionProtocolOptions]}
              disabled={dictionariesLoading || extractionProtocolOptions.length === 0}
              error={showSampleErrors ? getFieldError(sampleValidation, 'extractionProtocol') : ''}
            />
            <Input
              label="Quantidade (µL)"
              type="number"
              value={formData.quantity}
              onChange={updateField('quantity')}
              placeholder="Ex.: 20"
              min="0"
              step="0.01"
              required
              disabled={dictionariesLoading}
              error={showSampleErrors ? getFieldError(sampleValidation, 'quantity') : ''}
            />
            <Input
              label="Clínica / Hospital de Origem"
              value={formData.collectionInstitution}
              onChange={handleCollectionInstitutionChange}
              placeholder="Ex.: Hospital Sírio-Libanês"
              constraintKey="genericText"
              required
              disabled={dictionariesLoading}
              error={showSampleErrors ? getFieldError(sampleValidation, 'collectionInstitution') : ''}
            />
            <Input
              label="Sigla da Unidade"
              value={formData.collectionInstitutionAcronym}
              placeholder="Gerada automaticamente"
              readOnly
              disabled
              helperText="Gerada automaticamente a partir da Clínica / Hospital de Origem."
            />
            <Select
              label="Qualidade pré-analítica MIABIS"
              value={formData.quality}
              onChange={updateField('quality')}
              options={dictionariesLoading ? [{ value: '', label: 'Carregando qualidade MIABIS...' }] : [{ value: '', label: 'Selecione a qualidade' }, ...qualityOptions]}
              disabled={dictionariesLoading || qualityOptions.length === 0}
              error={showSampleErrors ? getFieldError(sampleValidation, 'quality') : ''}
            />
            <Input
              label="Projeto vinculado"
              value={formData.linkedProject}
              onChange={updateField('linkedProject')}
              placeholder="Ex.: Intake Wizard"
              constraintKey="genericText"
              required
              disabled={dictionariesLoading}
              error={showSampleErrors ? getFieldError(sampleValidation, 'linkedProject') : ''}
            />

            <div className="clinical-intake-wizard__hint-box">
              <strong>Validação aplicada</strong>
              <p>O sistema exige tipo e origem da amostra, quantidade maior que zero, qualidade MIABIS e projeto vinculado antes de avançar. A armazenagem física será feita depois, no fluxo do inventário.</p>
            </div>
          </div>
        )}

        {activeStep === 2 && (
          <div className="clinical-intake-wizard__step3-layout">
            <section className="clinical-intake-wizard__subsection clinical-intake-wizard__diagnosis-section">
              <div className="clinical-intake-wizard__subsection-header">
                <p className="clinical-intake-wizard__subsection-eyebrow">Seção 0</p>
                <h5>Diagnóstico Principal</h5>
                <p>Associe a amostra ao CID principal ou marque o caso como controle saudável.</p>
              </div>

              <div className="clinical-intake-wizard__diagnosis-grid">
                <label className="clinical-intake-wizard__switch clinical-intake-wizard__switch--wide">
                  <input
                    type="checkbox"
                    checked={formData.isHealthyControl}
                    onChange={handleHealthyControlChange}
                  />
                  <span>
                    <strong>Amostra de Controle (Indivíduo Saudável)</strong>
                    <small>Quando marcado, a seleção de doença fica desabilitada e o payload é enviado com is_healthy_control=true.</small>
                  </span>
                </label>

                <div className="clinical-intake-wizard__combobox-wrap">
                  <Input
                    label="Diagnóstico Principal / Doença"
                    value={diagnosisQuery}
                    onChange={handleDiagnosisInputChange}
                    onFocus={() => {
                      if (!formData.isHealthyControl) {
                        setDiagnosisOpen(true);
                      }
                    }}
                    onBlur={() => {
                      window.setTimeout(() => setDiagnosisOpen(false), 120);
                    }}
                    placeholder="Busque por CID, ORPHA, nome ou alias"
                    disabled={formData.isHealthyControl}
                    helperText={formData.isHealthyControl ? 'Campo desabilitado para amostras de controle saudável.' : 'Digite ao menos 2 caracteres para buscar.'}
                    error={showBiomarkerErrors ? getFieldError(clinicalValidation, 'diagnosisCidId') : ''}
                  />

                  {diagnosisOpen && !formData.isHealthyControl && (
                    <div className="clinical-intake-wizard__combobox-panel" role="listbox" aria-label="Resultados de CID">
                      {diagnosisLoading ? (
                        <div className="clinical-intake-wizard__combobox-skeleton" aria-live="polite">
                          <div className="clinical-intake-wizard__skeleton-line clinical-intake-wizard__skeleton-line--title" />
                          <div className="clinical-intake-wizard__skeleton-line" />
                          <div className="clinical-intake-wizard__skeleton-line" />
                          <div className="clinical-intake-wizard__skeleton-line" />
                        </div>
                      ) : diagnosisError ? (
                        <div className="clinical-intake-wizard__combobox-empty" role="alert">
                          {diagnosisError}
                        </div>
                      ) : diagnosisResults.length > 0 ? (
                        diagnosisResults.map((item) => (
                          <button
                            key={item.id || item.code || item.label}
                            type="button"
                            className={`clinical-intake-wizard__combobox-option ${selectedDiagnosis?.id === item.id ? 'is-selected' : ''}`}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => handleSelectDiagnosis(item)}
                          >
                            <strong>{item.displayName || item.label}</strong>
                            <small>{item.metaLabel}</small>
                            {item.aliasLabel && <small>{item.aliasLabel}</small>}
                            {item.chapter && <small>Capítulo: {item.chapter}</small>}
                          </button>
                        ))
                      ) : (
                        <div className="clinical-intake-wizard__combobox-empty">
                          {diagnosisQuery.trim().length < 2 ? 'Digite pelo menos 2 caracteres para buscar.' : 'Nenhuma doença encontrada.'}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="clinical-intake-wizard__diagnosis-triad">
                  <div className="clinical-intake-wizard__diagnosis-triad-header">
                    <div>
                      <strong>Tríade de interoperabilidade</strong>
                      <p>ORPHA e OMIM vêm pré-populados pela netorpha; o CID pode ser ajustado manualmente para um recorte mais específico.</p>
                    </div>
                  </div>

                  <div className="clinical-intake-wizard__diagnosis-triad-grid">
                    <Input
                      label="Código CID-10"
                      value={formData.diagnosisCidCode}
                      onChange={handleDiagnosisCodeChange('diagnosisCidCode')}
                      placeholder="Ex.: Q77.3"
                      disabled={formData.isHealthyControl}
                      className="clinical-intake-wizard__diagnosis-code-input"
                      helperText={diagnosisHasAutoFill ? 'Preenchido automaticamente e disponível para ajuste manual mais específico.' : 'Pode ser preenchido manualmente.'}
                    />
                    <Input
                      label="Código ORPHA"
                      value={formData.diagnosisOrphaCode}
                      onChange={handleDiagnosisCodeChange('diagnosisOrphaCode')}
                      placeholder="Ex.: 166024"
                      disabled={true}
                      readOnly={true}
                      className="clinical-intake-wizard__diagnosis-code-input"
                      helperText={'Preenchido automaticamente pela netorpha e mantido como padrão.'}
                    />
                    <Input
                      label="Código OMIM"
                      value={formData.diagnosisOmimCode}
                      onChange={handleDiagnosisCodeChange('diagnosisOmimCode')}
                      placeholder="Ex.: 607131"
                      disabled={true}
                      readOnly={true}
                      className="clinical-intake-wizard__diagnosis-code-input"
                      helperText={'Preenchido automaticamente pela netorpha e mantido como padrão.'}
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="clinical-intake-wizard__subsection">
              <div className="clinical-intake-wizard__subsection-header">
                <p className="clinical-intake-wizard__subsection-eyebrow">Seção 1</p>
                <h5>Anamnese e Dados Clínicos</h5>
                <p>Rastreie comorbidades e anotações clínicas do paciente antes de finalizar o cadastro integrado.</p>
              </div>

              <div className="clinical-intake-wizard__clinical-grid">
                <div className="clinical-intake-wizard__checkbox-panel">
                  <strong>Comorbidades</strong>
                  {dictionariesLoading ? (
                    <div className="clinical-intake-wizard__loading-state" aria-live="polite">
                      <span className="clinical-intake-wizard__spinner" />
                      <span>Carregando comorbidades ativas...</span>
                    </div>
                  ) : (
                    <div className="clinical-intake-wizard__checkbox-grid">
                      {clinicalComorbidityOptions.map((option) => (
                        <label key={option.value} className="clinical-intake-wizard__checkbox-item">
                          <input
                            type="checkbox"
                            checked={Boolean(formData[option.value])}
                            onChange={updateCheckboxField(option.value)}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <Input
                  label="Pressão Arterial"
                  value={formData.bloodPressure}
                  onChange={updateField('bloodPressure')}
                  placeholder="Ex.: 120/80 mmHg"
                  maxLength={30}
                  disabled={dictionariesLoading}
                  error={showBiomarkerErrors ? getFieldError(clinicalValidation, 'bloodPressure') : ''}
                />

                <Textarea
                  label="Observações Clínicas"
                  value={formData.clinicalObservations}
                  onChange={updateField('clinicalObservations')}
                  placeholder="Descreva histórico, sinais, queixas ou observações relevantes."
                  rows={4}
                  disabled={dictionariesLoading}
                  error={showBiomarkerErrors ? getFieldError(clinicalValidation, 'clinicalObservations') : ''}
                />
              </div>
            </section>

            <section className="clinical-intake-wizard__subsection">
              <div className="clinical-intake-wizard__subsection-header">
                <p className="clinical-intake-wizard__subsection-eyebrow">Seção 2</p>
                <h5>Biomarcadores Laboratoriais</h5>
                <p>Mantenha a renderização dinâmica dos biomarcadores pelo dicionário atual do sistema.</p>
              </div>

              {dictionariesLoading ? (
                <div className="clinical-intake-wizard__loading-state clinical-intake-wizard__loading-state--panel" aria-live="polite">
                  <span className="clinical-intake-wizard__spinner" />
                  <span>Carregando biomarcadores dinâmicos...</span>
                </div>
              ) : (
                <div className="clinical-intake-wizard__biomarkers-grid">
                  {biomarkerOptions.map((biomarker) => (
                    <Input
                      key={biomarker.value}
                      label={biomarker.label}
                      type="number"
                      value={formData[biomarker.value]}
                      onChange={updateField(biomarker.value)}
                      placeholder={biomarker.placeholder || 'Valor numérico'}
                      min="0"
                      step={biomarker.step || '0.01'}
                      disabled={dictionariesLoading}
                      error={showBiomarkerErrors ? getFieldError(biomarkerValidation, biomarker.value) : ''}
                    />
                  ))}
                </div>
              )}

              <div className="clinical-intake-wizard__request-action">
                <Button type="button" variant="secondary" className="clinical-intake-wizard__request-button" onClick={openBiomarkerRequestModal}>
                  <PlusCircle size={16} />
                  <span>+ Solicitar inclusão de novo biomarcador</span>
                </Button>
              </div>
            </section>

            <div className="clinical-intake-wizard__summary-card">
              <strong>Resumo da jornada</strong>
              <ul>
                <li>{formData.patientName || 'Paciente sem nome informado'}</li>
                <li>{formData.sampleType || 'Amostra não definida'}</li>
                <li>{formData.isHealthyControl ? 'Amostra de controle saudável' : (formData.diagnosisCidDescription || formData.diagnosisCidCode || 'Diagnóstico não definido')}</li>
                {biomarkerSummary.map((biomarker) => (
                  <li key={biomarker.id}>
                    {biomarker.value || `${biomarker.label} pendente`}
                  </li>
                ))}
              </ul>
            </div>

            <section className="clinical-intake-wizard__consent-section">
              <div className="clinical-intake-wizard__consent-header">
                <div>
                  <p className="clinical-intake-wizard__subsection-eyebrow">TCLE</p>
                  <h5>Termo de Consentimento (TCLE) - Obrigatório</h5>
                  <p>Selecione a versão que será aplicada no aceite final e enviada ao email cadastrado.</p>
                </div>
                <Button type="button" variant="secondary" onClick={() => setIsConsentPreviewOpen(true)} disabled={!selectedConsentTemplate}>
                  Visualizar TCLE
                </Button>
              </div>

              <div className="clinical-intake-wizard__consent-grid">
                <Select
                  label="Versão do TCLE"
                  value={formData.selectedConsentTemplateId}
                  onChange={updateField('selectedConsentTemplateId')}
                  options={consentOptions}
                  error={showConsentErrors ? getFieldError(consentValidation, 'selectedConsentTemplateId') : ''}
                  disabled={consentTemplatesLoading || consentTemplates.length === 0}
                />

                <div className="clinical-intake-wizard__consent-summary">
                  <strong>Rastreabilidade</strong>
                  <p>
                    O aceite será salvo com <strong>consent_granted: true</strong> e timestamp no momento da submissão.
                  </p>
                  <ul>
                    <li>ID do paciente: será gerado no submit</li>
                    <li>ID da amostra: será gerado no submit</li>
                    <li>TCLE escolhido: {selectedConsentTemplate ? `${selectedConsentTemplate.version || '--'} - ${selectedConsentTemplate.title || 'TCLE sem título'}` : 'aguardando seleção'}</li>
                  </ul>
                </div>
              </div>

              {consentTemplatesError && (
                <div className="clinical-intake-wizard__step-warning" role="alert">
                  {consentTemplatesError}
                </div>
              )}
            </section>

            {submitError && (
              <div className="clinical-intake-wizard__error" role="alert">
                {submitError}
              </div>
            )}
          </div>
        )}

        <div className="clinical-intake-wizard__actions">

          <Button variant="secondary" type="button" onClick={goBack} disabled={activeStep === 0}>
            <ArrowLeft size={16} />
            {t('common.back', 'Voltar')}
          </Button>

          {activeStep < 2 ? (
            <Button type="button" onClick={goNext} disabled={isSubmitting || (activeStep === 0 ? !isStep1Valid : !isStep2Valid)}>
              {t('common.next', 'Próximo')}
              <ArrowRight size={16} />
            </Button>
          ) : (
            <Button type="submit" variant="success" disabled={isSubmitting || !isStep1Valid || !isStep2Valid || !isStep3Valid}>
              {isSubmitting ? t('common.saving', 'Salvando...') : submitLabel}
            </Button>
          )}
        </div>

        <Modal
          isOpen={isConsentPreviewOpen}
          onClose={() => setIsConsentPreviewOpen(false)}
          title="Pré-visualização do TCLE"
        >
          <div className="clinical-intake-wizard__consent-preview-modal">
            <div className="clinical-intake-wizard__consent-preview-meta">
              <strong>{selectedConsentTemplate ? selectedConsentTemplate.title : 'Nenhum TCLE selecionado'}</strong>
              <p>
                {selectedConsentTemplate
                  ? `Versão ${selectedConsentTemplate.version || '--'} • CAAE ${selectedConsentTemplate.caae || '--'}`
                  : 'Selecione uma versão antes de visualizar o documento gerado.'}
              </p>
            </div>

            <div className="clinical-intake-wizard__consent-preview-body">
              <pre>{selectedConsentTemplate ? consentPreview : 'Sem documento para exibir.'}</pre>
            </div>
          </div>
        </Modal>

        <Modal
          isOpen={isBiomarkerRequestOpen}
          onClose={closeBiomarkerRequestModal}
          title="Solicitação de Novo Biomarcador"
        >
          <form className="clinical-intake-wizard__request-modal" onSubmit={submitBiomarkerRequest}>
            <div className="clinical-intake-wizard__request-grid">
              <Input
                label="Nome do Biomarcador"
                value={biomarkerRequestForm.biomarkerName}
                onChange={updateBiomarkerRequestField('biomarkerName')}
                placeholder="Ex.: miR-21"
                required
              />

              <Input
                label="Unidade de Medida"
                value={biomarkerRequestForm.measurementUnit}
                onChange={updateBiomarkerRequestField('measurementUnit')}
                placeholder="Ex.: U/mL, mg/dL"
                required
              />

              <div className="clinical-intake-wizard__request-textarea">
                <Textarea
                  label="Justificativa / Prova Científica"
                  value={biomarkerRequestForm.justification}
                  onChange={updateBiomarkerRequestField('justification')}
                  placeholder="Informe o DOI, link de artigo ou justificativa técnica"
                  rows={5}
                  required
                />
              </div>
            </div>

            {(biomarkerRequestError || biomarkerRequestValidationError) && (
              <div className="clinical-intake-wizard__request-error" role="alert">
                {biomarkerRequestError || biomarkerRequestValidationError}
              </div>
            )}

            <div className="clinical-intake-wizard__request-actions">
              <Button type="button" variant="secondary" onClick={closeBiomarkerRequestModal} disabled={isBiomarkerRequestSubmitting}>
                Cancelar
              </Button>
              <Button type="submit" variant="success" disabled={isBiomarkerRequestSubmitting}>
                <Send size={16} />
                <span>{isBiomarkerRequestSubmitting ? 'Enviando...' : 'Enviar para Aprovação'}</span>
              </Button>
            </div>
          </form>
        </Modal>

        {activeStep === 0 && !isStep1Valid && step1Attempted && (
          <div className="clinical-intake-wizard__step-warning" role="alert">
            Corrija os campos do Passo 1 para liberar o Passo 2.
          </div>
        )}
      </Card>
    </form>
  );
}