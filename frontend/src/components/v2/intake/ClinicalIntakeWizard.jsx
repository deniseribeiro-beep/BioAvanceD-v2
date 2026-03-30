import { useEffect, useMemo, useState } from 'react';
import HPOAutocomplete from '../../HPOAutocomplete';
import React from 'react';
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
  documento: z.string().trim().min(5, 'Informe um documento válido (CPF, Passaporte ou Prontuário)'),
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
    // Documento obrigatório para vivos
    if (!data.documento) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['documento'],
        message: 'Informe um documento válido (CPF, Passaporte ou Prontuário)',
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

// CORREÇÃO: Removidas as declarações de função daqui. 
// initialState deve ser apenas um objeto com os valores iniciais.
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
  documento: '',
  sampleType: '',
  sampleOrigin: '',
  extractionProtocol: '',
  quantity: '',
  quality: '',
  linkedProject: '',
  collectionInstitution: '',
  collectionInstitutionAcronym: '',
  selectedConsentTemplateId: '',
  phenotypes: [], // [{ hpoId, label }]
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

export default function ClinicalIntakeWizard(props) {
  const { t } = useLanguage();
  const {
    onStepChange,
    onValidityChange,
    submitLabel = t('intake.finalizeRegistration', 'Finalizar Cadastro Integrado'),
    className = '',
    dictionaries = {},
    dictionariesLoading = true,
    dictionariesError = '',
  } = props;
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

  // CORREÇÃO: As funções de manipular os fenótipos agora estão declaradas 
  // aqui dentro do componente, onde elas têm acesso ao setFormData.
  
  // Adiciona função para remover fenótipo
  const handleRemovePhenotype = (hpoId) => {
    setFormData((prev) => ({
      ...prev,
      phenotypes: prev.phenotypes.filter((item) => item.hpoId !== hpoId),
    }));
  };

  // Adiciona função para adicionar fenótipo (evita duplicados)
  const handleAddPhenotype = (item) => {
    setFormData((prev) => {
      if (prev.phenotypes.some((p) => p.hpoId === item.hpoId)) return prev;
      return {
        ...prev,
        phenotypes: [...prev.phenotypes, item],
      };
    });
    setTouched(true);
  };

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
          setConsentTemplatesError(fallbackError?.message || error?.message || 'Erro ao comunicar com o servidor de consentimentos.');
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

  // ...existing code...
  return (
    <form>
      {/* Passo 1: Dados do paciente */}
      <div>
        <label htmlFor="patientName">Nome completo</label>
        <Input
          id="patientName"
          name="patientName"
          value={formData.patientName}
          onChange={e => setFormData(prev => ({ ...prev, patientName: e.target.value }))}
          required
        />
        {/* ...outros campos do passo 1... */}
      </div>
      {/* ...outros passos e campos do wizard... */}
    </form>
  );
}