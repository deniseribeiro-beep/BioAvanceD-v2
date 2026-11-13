import { useEffect, useMemo, useState } from 'react';
import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { z } from 'zod';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, FlaskConical, Microscope, Pill, PlusCircle, Send, ShieldCheck, Stethoscope } from 'lucide-react';
import Button from '../../../components/UI/Button';
import Card from '../../../components/UI/Card';
import Input from '../../../components/UI/Input';
import Select from '../../../components/UI/Select';
import Modal from '../../../components/UI/Modal';
import Textarea from '../../../components/UI/Textarea';
// CidAsyncAutocomplete não está disponível nesta árvore; o wizard usa busca manual de CID.
import { apiClient, notifyApiToast } from '../../../api/client';
import { extractResponseItems } from '../../../api/response.adapters';
import { useSemanticCascade } from '../../../hooks/useSemanticCascade';

// Exemplo de uso do componente CidAsyncAutocomplete:
// <CidAsyncAutocomplete
//   value={formData.diagnosisCid}
//   onChange={cid => setFormData(prev => ({ ...prev, diagnosisCid: cid }))}
//   placeholder="Buscar CID por código ou descrição..."
// />
import intakeService from '../../../api/intake.service';
import { collectionsService, consentService } from '../../../services/api';
import { LIMITS } from '../../../config/constants/limits.constants';
import { VALIDATION_MESSAGES, VALIDATION_RULES } from '../../../config/constants/validation.constants';
import { SPREC_FLUID_DICTIONARY, SPREC_SOLID_DICTIONARY } from '../../../constants/sprecDictionary';
import { SPECIMEN_TYPES, SAMPLE_ORIGINS, EXTRACTION_PROTOCOLS } from '../../../config/constants/specimen.constants';
import { buildSampleMerkleRoot } from '../../../utils/sampleMerkleIntegrity';
import { useCreateOrganizationChoice } from '../../../hooks/useCreateOrganizationChoice';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function normalizeDocumentValue(value) {
  return String(value || '').trim();
}

function isCpfLikeDocument(value) {
  const normalized = normalizeDocumentValue(value);
  return Boolean(normalized) && /^[\d.\-\s]+$/.test(normalized);
}

function isValidCpfDocument(value) {
  const cleanCpf = normalizeDocumentValue(value).replace(/\D/g, '');

  if (!/^\d{11}$/.test(cleanCpf)) {
    return false;
  }

  if (/^(\d)\1{10}$/.test(cleanCpf)) {
    return false;
  }

  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    sum += Number(cleanCpf.charAt(index)) * (10 - index);
  }

  let remainder = sum % 11;
  const firstDigit = remainder < 2 ? 0 : 11 - remainder;
  if (Number(cleanCpf.charAt(9)) !== firstDigit) {
    return false;
  }

  sum = 0;
  for (let index = 0; index < 10; index += 1) {
    sum += Number(cleanCpf.charAt(index)) * (11 - index);
  }

  remainder = sum % 11;
  const secondDigit = remainder < 2 ? 0 : 11 - remainder;
  return Number(cleanCpf.charAt(10)) === secondDigit;
}

function isValidPassportDocument(value) {
  const normalized = normalizeDocumentValue(value);
  return /^\d{5,20}$/.test(normalized);
}

function isValidCpfOrPassportDocument(value) {
  const normalized = normalizeDocumentValue(value);

  if (!normalized) {
    return false;
  }

  if (isCpfLikeDocument(normalized)) {
    return isValidCpfDocument(normalized);
  }

  return isValidPassportDocument(normalized);
}

function generateAcronym(name) {
  const stopWords = new Set(['de', 'da', 'do', 'das', 'dos']);

  return String(name || '')
    .trim()
    .split(/[\s-]+/)
    .filter((word) => word && !stopWords.has(word.toLowerCase()))
    .map((word) => word[0].toUpperCase())
    .join('');
}

function getSampleQuantityUnit(sampleTypeValue, sampleTypeOptions = []) {
  const selected = sampleTypeOptions.find((option) => option.value === sampleTypeValue);
  const sourceText = String(selected?.label || sampleTypeValue || '').toLowerCase();

  const fluidKeywords = ['sangue', 'soro', 'plasma', 'liquido', 'líquido', 'urina', 'saliva', 'swab'];
  const solidKeywords = ['tecido', 'biópsia', 'biopsia', 'fragmento', 'tumor', 'osso'];

  if (solidKeywords.some((keyword) => sourceText.includes(keyword))) {
    return 'mg';
  }

  if (fluidKeywords.some((keyword) => sourceText.includes(keyword))) {
    return 'mL';
  }

  return 'mL';
}

function buildSprecCode(formData) {
  const parts = [
    formData.sprecSampleType,
    formData.sprecPrimaryContainer,
    formData.sprecPreCentrifugation,
    formData.sprecCentrifugation,
    formData.sprecSecondCentrifugation,
    formData.sprecPostCentrifugationDelay,
    formData.sprecLongTermStorage,
  ].map((part) => String(part || '').trim().toUpperCase());

  if (parts.some((part) => !part)) {
    return '';
  }

  return parts.join('-');
}

function resolveUnknownAxisCode(options = []) {
  const normalizedValues = new Set(options.map((option) => String(option.value).trim().toUpperCase()));
  return normalizedValues.has('X') ? 'X' : 'XXX';
}

function createPatientStepSchema(t) {
  return z.object({
    patientName: z.string().trim().min(2, t('wizard.validation.required', VALIDATION_MESSAGES.required)).max(LIMITS.FULL_NAME_MAX_LENGTH, t('wizard.validation.nameTooLong', 'Nome muito longo')),
    birthDate: z
      .string()
      .trim()
      .regex(VALIDATION_RULES.birthDate.pattern, t('wizard.validation.birthDateFormat', 'Informe a data no formato DD/MM/AAAA')),
    gender: z.string().trim().min(1, t('wizard.validation.selectGender', 'Selecione o sexo')),
    email: z.string().trim().optional().or(z.literal('')),
    isDeceased: z.boolean(),
    representativeName: z.string().trim().optional().or(z.literal('')),
    representativeEmail: z.string().trim().optional().or(z.literal('')),
    representativeCpf: z.string().trim().optional().or(z.literal('')),
    documento: z.string().trim().min(5, t('wizard.validation.validDocument', 'Informe um documento válido (CPF ou passaporte)')),
    prontuario: z.string().trim().max(80, t('wizard.validation.genericTooLong', 'Texto muito longo')).optional().or(z.literal('')),
  }).superRefine((data, ctx) => {
  const patientEmail = String(data.email || '').trim();
  const representativeName = String(data.representativeName || '').trim();
  const representativeEmail = String(data.representativeEmail || '').trim();
  const representativeCpf = String(data.representativeCpf || '').trim();
  const documentValue = normalizeDocumentValue(data.documento);

  if (!data.isDeceased) {
    if (!patientEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['email'],
        message: t('wizard.validation.invalidEmail', VALIDATION_MESSAGES.email),
      });
    } else if (!emailPattern.test(patientEmail)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['email'],
        message: t('wizard.validation.invalidEmail', VALIDATION_MESSAGES.email),
      });
    }
    // Documento obrigatório para vivos
    if (!documentValue || !isValidCpfOrPassportDocument(documentValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['documento'],
        message: t('wizard.validation.validDocument', 'Informe um documento válido (CPF ou passaporte)'),
      });
    }
  } else if (patientEmail && !emailPattern.test(patientEmail)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['email'],
      message: t('wizard.validation.invalidEmail', VALIDATION_MESSAGES.email),
    });
  }

  if (data.isDeceased) {
    if (!representativeName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['representativeName'],
        message: t('wizard.validation.required', VALIDATION_MESSAGES.required),
      });
    }
    if (!representativeEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['representativeEmail'],
        message: t('wizard.validation.invalidEmail', VALIDATION_MESSAGES.email),
      });
    } else if (!emailPattern.test(representativeEmail)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['representativeEmail'],
        message: t('wizard.validation.invalidEmail', VALIDATION_MESSAGES.email),
      });
    }
    if (!representativeCpf || !isValidCpfOrPassportDocument(representativeCpf)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['representativeCpf'],
        message: t('wizard.validation.validDocument', 'Informe um documento válido (CPF ou passaporte)'),
      });
    }
  }
  });
}

function createConsentStepSchema(t) {
  return z.object({
    selectedConsentTemplateId: z.string().trim().min(1, t('wizard.validation.selectTcle', 'Selecione um TCLE antes de finalizar o cadastro')),
  });
}

const STEP_META_BASE = [
  {
    key: 'patient',
    icon: Stethoscope,
  },
  {
    key: 'sample',
    icon: FlaskConical,
  },
  {
    key: 'biomarkers',
    icon: ShieldCheck,
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
  diagnosisDefinition: '',
  diagnosisCodesManualMode: false,
  diagnosisCidDescription: '',
  representativeName: '',
  representativeEmail: '',
  representativeCpf: '',
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
  // #715: the rest of the Charlson index's categories (CLINICAL_COMORBIDITIES).
  myocardialInfarction: false,
  congestiveHeartFailure: false,
  peripheralVascularDisease: false,
  cerebrovascularDisease: false,
  dementia: false,
  connectiveTissueDisease: false,
  pepticUlcerDisease: false,
  mildLiverDisease: false,
  moderateSevereLiverDisease: false,
  hemiplegia: false,
  diabetesWithEndOrganDamage: false,
  solidTumor: false,
  metastaticSolidTumor: false,
  leukemia: false,
  lymphoma: false,
  aids: false,
  bloodPressure: '',
  clinicalObservations: '',
  documento: '',
  prontuario: '',
  sampleType: '',
  sprecMatrixType: 'fluid',
  sampleOrigin: '',
  extractionProtocol: '',
  sprecSampleType: '',
  sprecPrimaryContainer: '',
  sprecPreCentrifugation: '',
  sprecCentrifugation: '',
  sprecSecondCentrifugation: '',
  sprecPostCentrifugationDelay: '',
  sprecLongTermStorage: '',
  sprecCode: '',
  quantity: '',
  quality: '',
  rcs_score: '',
  final_grade: '',
  p_bio: null,
  calculation_trace: {},
  collectionDateTime: '',
  processingDateTime: '',
  transportTemperature: '',
  ischemiaTimeMinutes: '',
  preAnalyticalUnknown: false,
  linkedProject: '',
  parentSpecimenIds: '',
  collectionInstitution: '',
  collectionInstitutionAcronym: '',
  selectedConsentTemplateId: '',
  diseasePhenotypes: [],
  diseaseBiomarkers: [],
  biomarkers_values: {},
  phenotypes: [], // [{ hpoId, label }]
  allergies: [], // [{ allergenName, allergenCode, reaction }]
  familyHistories: [], // [{ relationship, conditionName, orphaCode, onset }]
  procedures: [], // [{ procedureName, procedureCode, performed, bodySite }]
  observationRecords: [], // [{ testName, loincCode, value, unit, effectiveDate }]
  clinicalOutcomes: [], // [{ outcomeType, outcomeDate }]
  treatmentStatus: '',
  medicationName: '',
  medicationCode: '',
  medicationDrugClass: '',
  lastDoseDate: '',
  washoutStartDate: '',
  washoutEndDate: '',
  medicationSearchQuery: '',
};

const CONSENT_PLACEHOLDERS = {
  '{{NOME_PACIENTE}}': (formData) => String(formData.patientName).trim(),
  '{{DOC_PACIENTE}}': (formData, fallbackValues) => String(formData.participantId || '').trim() || fallbackValues.patientDocMissing,
  '{{ID_PACIENTE_SISTEMA}}': (formData, fallbackValues) => String(formData.participantId || '').trim() || fallbackValues.patientSystemIdMissing,
  '{{ID_AMOSTRA}}': (formData, fallbackValues) => String(formData.specimenId || '').trim() || fallbackValues.sampleIdMissing,
  '{{NOME_REPRESENTANTE}}': (formData, fallbackValues) => (formData.isDeceased ? String(formData.representativeName).trim() : fallbackValues.notApplicable),
};

function getConsentTemplateBody(template) {
  return String(template.content || template.htmlContent || '').trim();
}

function buildConsentPreview(template, formData, t) {
  const baseText = getConsentTemplateBody(template);

  if (!baseText) {
    return t('wizard.labels.noConsentPreview', 'No informed consent content is available for preview.');
  }

  const fallbackValues = {
    patientDocMissing: t('wizard.labels.patientDocMissing', 'Patient/sample ID will be generated on submit'),
    patientSystemIdMissing: t('wizard.labels.patientSystemIdMissing', 'Will be generated on submit'),
    sampleIdMissing: t('wizard.labels.sampleIdMissing', 'Will be generated on submit'),
    notApplicable: t('common.notApplicable', 'Not applicable'),
  };

  return Object.entries(CONSENT_PLACEHOLDERS).reduce((currentText, [placeholder, resolver]) => {
    return currentText.split(placeholder).join(resolver(formData, fallbackValues));
  }, baseText);
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

const DIAGNOSIS_PRIMARY_LANGUAGE = 'pt';
const DIAGNOSIS_EN_MARKER = '[EN]';

function getFirstText(values = []) {
  return values
    .map((value) => String(value || '').trim())
    .find((value) => value) || '';
}

function getDiagnosisLocalizedLabel(item) {
  const preferredPortuguese = getFirstText([
    item?.namePt,
    item?.nomePt,
    item?.translations?.pt,
    item?.names?.pt,
    item?.Descricao,
    item?.descricao,
  ]);
  const englishFallback = getFirstText([
    item?.nameEn,
    item?.nomeEn,
    item?.translations?.en,
    item?.names?.en,
    item?.description,
    item?.label,
    item?.name,
  ]);
  const existingLabel = getFirstText([
    item?.label,
    item?.displayName,
    item?.description,
    item?.Descricao,
    item?.descricao,
    item?.name,
  ]);
  const language = String(item?.lang || item?.language || '').trim().toLowerCase();

  if (preferredPortuguese) {
    return {
      label: preferredPortuguese,
      language: DIAGNOSIS_PRIMARY_LANGUAGE,
      isEnglishFallback: false,
    };
  }

  const fallbackLabel = englishFallback || existingLabel;
  if (!fallbackLabel) {
    return {
      label: '',
      language: language || '',
      isEnglishFallback: false,
    };
  }

  return {
    label: language === DIAGNOSIS_PRIMARY_LANGUAGE ? fallbackLabel : `${DIAGNOSIS_EN_MARKER} ${fallbackLabel}`,
    language: language || 'en',
    isEnglishFallback: language !== DIAGNOSIS_PRIMARY_LANGUAGE,
  };
}

function getCidDisplayLabel(item) {
  const code = String(item?.Codigo_Tabulacao || item?.Codigos_CID10 || item?.codigo || item?.code || '').trim();
  const description = getDiagnosisLocalizedLabel(item).label || String(item?.Descricao || item?.descricao || item?.description || item?.label || '').trim();

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
    item?.descricao,
    item?.description,
    item?.name,
    item?.label,
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
  const localizedLabel = getDiagnosisLocalizedLabel(item).label;
  const localizedNames = Array.from(new Set([
    localizedLabel,
    ...getCidLocalizedNames(item),
  ].filter(Boolean)));
  if (localizedNames.length > 0) {
    return localizedNames.slice(0, 3).join(' / ');
  }

  return getCidDisplayLabel(item);
}

function getCidDisplayMeta(item) {
  const code = normalizeCidCode(
    item?.Codigos_CID10 || item?.icd_code || item?.icdCode || item?.Codigo_Tabulacao || item?.cidCode || item?.relacoes?.cid10 || item?.relacoes?.cid || ''
  );
  const orphaCode = normalizeOrphaCode(item?.ORPHA || item?.orpha || item?.orphaCode || item?.orpha_code || item?.ORPHAcode || item?.relacoes?.orpha || '');
  const omimCode = normalizeOmimCode(item?.OMIM || item?.omim || item?.omimCode || item?.omim_code || item?.relacoes?.omim || '');

  return [
    code ? `CID: ${code}` : 'CID: -',
    orphaCode ? `ORPHA: ${orphaCode}` : 'ORPHA: -',
    omimCode ? `OMIM: ${omimCode}` : 'OMIM: -',
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
  const baseCode = String(item?.codigo || item?.code || item?.ORPHAcode || item?.orphaCode || item?.ORPHA || item?.orpha || item?.Codigo_Tabulacao || item?.Codigos_CID10 || '').trim();
  const id = String(item?.id || item?._id || baseCode || '').trim();
  const cidCode = normalizeCidCode(item?.relacoes?.cid10 || item?.relacoes?.cid || item?.cid || item?.Codigos_CID10 || item?.cid10 || item?.icdCode || item?.Codigo_Tabulacao || item?.code || '');
  const code = String(baseCode || cidCode).trim();
  const localizedLabel = getDiagnosisLocalizedLabel(item);
  const description = String(localizedLabel.label || item?.descricao || item?.Descricao || item?.description || item?.label || '').trim();
  const system = String(item?.sistema || item?.system || item?.source || '').trim().toUpperCase();
  const orphaCode = normalizeOrphaCode(item?.relacoes?.orpha || item?.ORPHA || item?.orpha || item?.orphaCode || item?.orpha_code || item?.ORPHAcode || (system === 'ORPHA' ? code : '') || '');
  const omimCode = normalizeOmimCode(item?.relacoes?.omim || item?.OMIM || item?.omim || item?.omimCode || item?.omim_code || '');
  const definition = [
    item?.definition,
    item?.definicao,
    item?.descricaoDetalhada,
    item?.summary,
    item?.descricao,
    item?.Descricao,
    description,
  ]
    .map((value) => String(value || '').trim())
    .find((value) => value && !/^\d+$/.test(value)) || '';
  const localizedNames = getCidLocalizedNames(item);
  const aliases = getCidAliases(item);
  const synonyms = [
    ...(Array.isArray(item?.sinonimos) ? item.sinonimos : []),
    ...(Array.isArray(item?.synonyms) ? item.synonyms : []),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const displayName = getCidDisplayTitle(item);

  return {
    id,
    code,
    cidCode,
    description,
    label: displayName,
    displayName,
    metaLabel: getCidDisplayMeta(item),
    aliasLabel: getCidAliasPreview(item),
    chapter: String(item?.Capitulo || item?.chapter || '').trim(),
    orphaCode,
    omimCode,
    definition,
    aliases,
    synonyms,
    localizedNames,
    language: String(item?.lang || item?.language || localizedLabel.language || '').trim().toLowerCase(),
    isEnglishFallback: localizedLabel.isEnglishFallback,
    raw: item,
  };
}

function normalizeDiseaseBiomarker(item) {
  return {
    code: String(item?.code || item?.biomarkerType || item?.hpoId || '').trim(),
    label: String(item?.display || item?.label || item?.name || '').trim(),
    unit: String(item?.unit || '').trim(),
    value: String(item?.value ?? '').trim(),
  };
}

function normalizeDiseasePhenotype(item) {
  // #885: keep the terminology version /dictionary/suggest resolved, so the
  // operator sees which HPO release the code is recorded against.
  const version = String(item?.version || '').trim();
  return {
    hpoId: String(item?.hpoId || item?.code || '').trim(),
    label: String(item?.label || item?.display || '').trim(),
    ...(version ? { version } : {}),
  };
}

function getDiseaseBiomarkerKey(item) {
  return String(item?.code || item?.label || '').trim();
}

function buildBiomarkerValuesMap(biomarkers = [], currentValues = {}) {
  const nextValues = { ...(currentValues && typeof currentValues === 'object' ? currentValues : {}) };
  (Array.isArray(biomarkers) ? biomarkers : []).forEach((item) => {
    const key = getDiseaseBiomarkerKey(item);
    if (!key) {
      return;
    }
    if (nextValues[key] === undefined) {
      nextValues[key] = String(item?.value ?? '').trim();
    }
  });
  return nextValues;
}

function normalizeOrphaCode(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  return /^ORPHA:/i.test(raw) ? raw.replace(/^orpha:/i, 'ORPHA:') : `ORPHA:${raw}`;
}

function getOrphaNumeric(value) {
  return String(normalizeOrphaCode(value) || '').replace(/^ORPHA:/i, '');
}

function normalizeOmimCode(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '-') {
    return '';
  }
  return /^OMIM:/i.test(raw) ? raw.replace(/^omim:/i, 'OMIM:') : `OMIM:${raw}`;
}

function normalizeCidCode(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const candidates = raw
    .split(/[;,|]/)
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  const firstValid = candidates.find((candidate) => {
    if (!candidate || /^ORPHA:/i.test(candidate) || /^OMIM:/i.test(candidate)) {
      return false;
    }

    // CID-10 típico (letra + 2 dígitos com sufixo opcional) e variações já existentes no legado.
    if (/^[A-TV-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/i.test(candidate)) {
      return true;
    }

    // Evita gravar código ORPHA numérico puro como CID.
    if (/^\d+$/.test(candidate)) {
      return false;
    }

    return /^[A-Z0-9][A-Z0-9.\-]{1,12}$/i.test(candidate);
  });

  return firstValid || '';
}

function pickBestOrphaCandidate(candidates = [], orphaNumeric = '') {
  const normalizedOrpha = String(orphaNumeric || '').trim();
  if (!normalizedOrpha || !Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const scoped = candidates.filter((candidate) => getOrphaNumeric(candidate?.orphaCode) === normalizedOrpha);
  const pool = scoped.length > 0 ? scoped : candidates;

  const score = (candidate) => {
    let points = 0;
    if (normalizeCidCode(candidate?.cidCode || candidate?.raw?.relacoes?.cid10 || candidate?.raw?.relacoes?.cid || '')) points += 2;
    if (normalizeOmimCode(candidate?.omimCode || candidate?.raw?.relacoes?.omim || candidate?.raw?.OMIM || '')) points += 2;
    if (String(candidate?.definition || '').trim()) points += 1;
    if (String(candidate?.displayName || '').trim()) points += 1;
    return points;
  };

  return pool
    .map((candidate) => ({ candidate, score: score(candidate) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.candidate)[0];
}

function tokenizeSearch(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function buildDiagnosisSearchIndex(item) {
  return [
    item?.displayName,
    item?.label,
    item?.description,
    item?.definition,
    item?.cidCode,
    item?.orphaCode,
    item?.omimCode,
    item?.code,
    item?.language,
    ...(Array.isArray(item?.aliases) ? item.aliases : []),
    ...(Array.isArray(item?.synonyms) ? item.synonyms : []),
    ...(Array.isArray(item?.sinonimos) ? item.sinonimos : []),
    ...(Array.isArray(item?.localizedNames) ? item.localizedNames : []),
  ]
    .map((value) => String(value || '').toLowerCase().trim())
    .filter(Boolean)
    .join(' | ');
}

function filterAndRankDiagnosisResults(items = [], term = '', max = 6) {
  const query = String(term || '').toLowerCase().trim();
  const tokens = tokenizeSearch(query);
  if (!query || tokens.length === 0) {
    return [];
  }

  const normalized = (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    _searchIndex: buildDiagnosisSearchIndex(item),
  }));

  const filtered = normalized.filter((item) => item._searchIndex && tokens.every((token) => item._searchIndex.includes(token)));

  const scored = filtered.map((item) => {
    let score = 0;
    const title = String(item.displayName || '').toLowerCase();
    const cid = String(item.cidCode || '').toLowerCase();
    const orpha = String(item.orphaCode || '').toLowerCase();
    const omim = String(item.omimCode || '').toLowerCase();
    const code = String(item.code || '').toLowerCase();

    if (title === query) score += 100;
    if (cid === query || orpha === query || omim === query || code === query) score += 80;
    if (title.startsWith(query)) score += 30;
    if (code.startsWith(query) || cid.startsWith(query) || orpha.startsWith(query) || omim.startsWith(query)) score += 25;
    if (title.includes(query)) score += 15;
    if (item.cidCode) score += 3;
    if (item.omimCode) score += 3;

    return { item, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Number(max) || 6))
    .map((entry) => {
      const next = { ...entry.item };
      delete next._searchIndex;
      return next;
    });
}

function consolidateDiagnosisCandidates(items = []) {
  const grouped = new Map();

  (Array.isArray(items) ? items : []).forEach((item) => {
    const key = getOrphaNumeric(item?.orphaCode)
      || normalizeCidCode(item?.cidCode)
      || normalizeOmimCode(item?.omimCode)
      || String(item?.displayName || item?.code || item?.id || '').toLowerCase().trim();
    if (!key) {
      return;
    }

    const previous = grouped.get(key);
    const score = (candidate) => {
      let points = 0;
      if (normalizeCidCode(candidate?.cidCode)) points += 2;
      if (normalizeOmimCode(candidate?.omimCode)) points += 2;
      if (String(candidate?.displayName || '').trim()) points += 1;
      if (String(candidate?.definition || '').trim()) points += 1;
      return points;
    };

    if (!previous || score(item) > score(previous)) {
      grouped.set(key, item);
    }
  });

  return Array.from(grouped.values());
}

function formatBloodPressureInput(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 6);
  if (!digits) {
    return '';
  }
  if (digits.length <= 3) {
    return digits;
  }
  return `${digits.slice(0, 3)}/${digits.slice(3)}`;
}

function createSampleStepSchema(t) {
  return z.object({
    sampleType: z.string().trim().min(1, t('wizard.validation.sampleType', 'Select the MIABIS sample type')),
    sampleOrigin: z.string().trim().min(1, t('wizard.validation.sampleOrigin', 'Select the MIABIS sample origin')),
    sprecSampleType: z.string().trim().min(1, t('wizard.validation.sprecSampleType', 'Select the SPREC sample type')),
    sprecPrimaryContainer: z.string().trim().min(1, t('wizard.validation.sprecPrimaryContainer', 'Select the SPREC primary container')),
    sprecPreCentrifugation: z.string().trim().min(1, t('wizard.validation.sprecPreCentrifugation', 'Select SPREC pre-centrifugation')),
    sprecCentrifugation: z.string().trim().min(1, t('wizard.validation.sprecCentrifugation', 'Select SPREC centrifugation')),
    sprecSecondCentrifugation: z.string().trim().min(1, t('wizard.validation.sprecSecondCentrifugation', 'Select SPREC second centrifugation')),
    sprecPostCentrifugationDelay: z.string().trim().min(1, t('wizard.validation.sprecPostCentrifugationDelay', 'Select SPREC post-centrifugation delay')),
    sprecLongTermStorage: z.string().trim().min(1, t('wizard.validation.sprecLongTermStorage', 'Select SPREC long-term storage')),
    collectionInstitution: z
      .string()
      .trim()
      .min(2, t('wizard.validation.collectionInstitution', 'Enter the source clinic / hospital'))
      .max(LIMITS.GENERIC_TEXT_MAX_LENGTH, t('wizard.validation.collectionInstitutionTooLong', 'Source clinic / hospital is too long')),
    collectionInstitutionAcronym: z.string().trim().optional().or(z.literal('')),
    extractionProtocol: z.string().trim().min(1, t('wizard.validation.extractionProtocol', 'Select the MIABIS extraction protocol')),
    quantity: z
      .string()
      .trim()
      .refine((value) => Number(value) > 0, t('wizard.validation.quantityGreaterThanZero', 'Enter a quantity greater than zero')),
    collectionDateTime: z.string().optional().or(z.literal('')),
    processingDateTime: z.string().optional().or(z.literal('')),
    transportTemperature: z.string().optional().or(z.literal('')),
    ischemiaTimeMinutes: z.string().optional().or(z.literal('')),
    preAnalyticalUnknown: z.boolean(),
    linkedProject: z
      .string()
      .trim()
      .min(2, t('wizard.validation.linkedProject', 'Enter the linked project'))
      .max(LIMITS.GENERIC_TEXT_MAX_LENGTH, t('wizard.validation.linkedProjectTooLong', 'Project name is too long')),
  }).superRefine((data, ctx) => {
    if (!data.preAnalyticalUnknown) {
      const requiredSprecFields = [
        'sprecPreCentrifugation',
        'sprecCentrifugation',
        'sprecSecondCentrifugation',
        'sprecPostCentrifugationDelay',
      ];

      requiredSprecFields.forEach((fieldName) => {
        if (!String(data[fieldName] || '').trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [fieldName],
            message: t('wizard.validation.selectValidSprec', 'Select a valid SPREC value'),
          });
        }
      });
    }
  });
}

function createClinicalStepSchema(t, clinicalItems = []) {
  return z.object({
    isHealthyControl: z.boolean(),
    diagnosisCidId: z.string().trim().optional().or(z.literal('')),
    diagnosisCidCode: z.string().trim().optional().or(z.literal('')),
    diagnosisOrphaCode: z.string().trim().optional().or(z.literal('')),
    diagnosisOmimCode: z.string().trim().optional().or(z.literal('')),
    diagnosisCidDescription: z.string().trim().optional().or(z.literal('')),
    diagnosisDefinition: z.string().trim().optional().or(z.literal('')),
    bloodPressure: z.string().trim().max(30, t('wizard.validation.bloodPressureTooLong', 'Blood pressure is too long')).optional().or(z.literal('')),
    clinicalObservations: z.string().trim().max(LIMITS.GENERIC_TEXT_MAX_LENGTH, t('wizard.validation.clinicalNotesTooLong', 'Clinical notes are too long')).optional().or(z.literal('')),
    selectedConsentTemplateId: z.string().trim().optional().or(z.literal('')),
    diseasePhenotypes: z.array(z.any()).optional(),
    diseaseBiomarkers: z.array(z.any()).optional(),
    allergies: z.array(z.any()).optional(),
    familyHistories: z.array(z.any()).optional(),
    procedures: z.array(z.any()).optional(),
    observationRecords: z.array(z.any()).optional(),
    clinicalOutcomes: z.array(z.any()).optional(),
    biomarkers_values: z.record(z.string(), z.string()).optional(),
    treatmentStatus: z.string().trim().optional().or(z.literal('')),
    medicationName: z.string().trim().max(180, t('wizard.validation.medicationNameTooLong', 'Medication name is too long')).optional().or(z.literal('')),
    medicationCode: z.string().trim().max(80, t('wizard.validation.medicationCodeTooLong', 'Medication code is too long')).optional().or(z.literal('')),
    medicationDrugClass: z.string().trim().max(120, t('wizard.validation.medicationClassTooLong', 'Drug class is too long')).optional().or(z.literal('')),
    medicationSearchQuery: z.string().trim().max(180, t('wizard.validation.medicationSearchTooLong', 'Medication search term is too long')).optional().or(z.literal('')),
    lastDoseDate: z.string().trim().optional().or(z.literal('')),
    washoutStartDate: z.string().trim().optional().or(z.literal('')),
    washoutEndDate: z.string().trim().optional().or(z.literal('')),
    ...Object.fromEntries((Array.isArray(clinicalItems) ? clinicalItems : []).map((item) => [getDictionarySlug(item), z.boolean()])),
  }).superRefine((data, ctx) => {
    if (!data.isHealthyControl && !String(data.diagnosisCidId || '').trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['diagnosisCidId'],
        message: t('wizard.validation.selectDiagnosis', 'Select the disease / sample diagnosis'),
      });
    }

    if (!data.isHealthyControl) {
      // Contract: autofill must leave a real ICD-10 or ORPHA code, not just the
      // list-row id (diagnosisCidId can be an opaque local id with neither code).
      const hasDiagnosisCode = [data.diagnosisCidCode, data.diagnosisOrphaCode].some((value) => String(value || '').trim().length > 0);
      if (!hasDiagnosisCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['diagnosisCidCode'],
          message: t('wizard.validation.requireCidOrOrpha', 'Disease search must fill ICD-10 or ORPHA'),
        });
      }

      if (!String(data.treatmentStatus || '').trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['treatmentStatus'],
          message: t('wizard.validation.treatmentStatusRequired', 'Treatment status is required for clinical samples (MIABIS).'),
        });
      }

      if (['TREATED', 'ON_TREATMENT'].includes(String(data.treatmentStatus || '').trim().toUpperCase())) {
        if (!String(data.medicationName || data.medicationSearchQuery || '').trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['medicationName'],
            message: t('wizard.validation.medicationRequiredWhenTreated', 'Provide medication when status is On treatment.'),
          });
        }
        if (!String(data.lastDoseDate || '').trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['lastDoseDate'],
            message: t('wizard.validation.lastDoseRequiredWhenTreated', 'Provide last dose date when status is On treatment.'),
          });
        }
      }
    }
  });
}

function createBiomarkerStepSchema(biomarkerItems = []) {
  return z.object(
    Object.fromEntries(biomarkerItems.map((item) => [
      getDictionarySlug(item),
      z
        .string()
        .trim()
        .refine((value) => value === '' || !Number.isNaN(Number(value.replace(',', '.'))), 'Informe um valor numérico'),
    ]))
  );
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

function formatDocumentInput(value) {
  return digitsOnly(value).slice(0, 20);
}

function normalizeDocumentForPayload(value) {
  return digitsOnly(value);
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
  // canonical.v1.participant's birthDate is format:'date' (bare YYYY-MM-DD,
  // #699) -- no time component, unlike a full ISO datetime.
  return `${year}-${month}-${day}`;
}

function findOption(options = [], value = '') {
  const normalizedValue = String(value || '').trim();
  return options.find((option) => String(option.value).trim() === normalizedValue) || null;
}

function buildSprecField(value, options = [], extra = {}) {
  const code = String(value || '').trim();
  const option = findOption(options, code);
  return {
    code: code || null,
    label: option?.label || '',
    ...extra,
  };
}

function buildCanonicalSprecPayload(formData, matrixType, dictionary) {
  const sampleType = buildSprecField(formData.sprecSampleType, dictionary.sampleType?.options);
  const axis2 = buildSprecField(formData.sprecPrimaryContainer, dictionary.primaryContainer?.options);
  const axis3 = buildSprecField(formData.sprecPreCentrifugation, dictionary.preCentrifugation?.options);
  const axis4 = buildSprecField(formData.sprecCentrifugation, dictionary.centrifugation?.options, {
    applicable: String(formData.sprecCentrifugation || '').trim().toUpperCase() !== 'N',
  });
  const axis5 = buildSprecField(formData.sprecSecondCentrifugation, dictionary.secondCentrifugation?.options, {
    required: String(formData.sprecSecondCentrifugation || '').trim().toUpperCase() !== 'N',
    applicable: String(formData.sprecSecondCentrifugation || '').trim().toUpperCase() !== 'N',
  });
  const axis6 = buildSprecField(formData.sprecPostCentrifugationDelay, dictionary.postCentrifugationDelay?.options);
  const longTermStorage = buildSprecField(formData.sprecLongTermStorage, dictionary.longTermStorage?.options);

  if (matrixType === 'solid') {
    return {
      matrixType,
      sampleType,
      collectionType: axis2,
      primaryContainer: axis2,
      warmIschemia: axis3,
      coldIschemia: axis4,
      fixationType: axis5,
      fixationTime: axis6,
      longTermStorage,
      preAnalyticalUnknown: Boolean(formData.preAnalyticalUnknown),
    };
  }

  return {
    matrixType,
    sampleType,
    primaryContainer: axis2,
    preCentrifugation: axis3,
    centrifugation1: axis4,
    centrifugation: axis4,
    primaryCentrifugationApplicable: axis4.applicable,
    centrifugationApplicable: axis4.applicable,
    centrifugation2: axis5,
    secondCentrifugation: axis5,
    secondCentrifugationRequired: axis5.required,
    secondCentrifugationApplicable: axis5.applicable,
    postCentrifugation: axis6,
    postCentrifugationDelay: axis6,
    longTermStorage,
    preAnalyticalUnknown: Boolean(formData.preAnalyticalUnknown),
  };
}

// dict-02 ELM-0146 -- SPREC standard version used to encode this profile.
// Mirrors api/backend/src/services/rcs-reference-data.js's SPREC_VERSION;
// no shared constant exists across the frontend/backend split.
const SPREC_VERSION = 'SPREC-2.0';

// canonical.v1.specimen's sprec (#699) is flat strings with required
// top-level code/version -- buildCanonicalSprecPayload's {code, label,
// ...extra} objects (shared with the sample-integrity caller below, which
// needs the fuller shape) don't match it. This
// flattens to just the axis codes, dropping the extra applicable/required
// flags and axis-object nesting the AJV schema doesn't allow.
function buildIntakeSprecPayload(formData, matrixType, dictionary) {
  const canonical = buildCanonicalSprecPayload(formData, matrixType, dictionary);
  const axisFields = matrixType === 'solid'
    ? ['sampleType', 'collectionType', 'warmIschemia', 'coldIschemia', 'fixationType', 'fixationTime', 'longTermStorage']
    : ['sampleType', 'primaryContainer', 'preCentrifugation', 'centrifugation', 'secondCentrifugation', 'postCentrifugationDelay', 'longTermStorage'];

  const flat = { matrixType };
  for (const key of axisFields) {
    const { code } = canonical[key];
    if (code) {
      flat[key] = code;
    }
  }

  return {
    code: String(formData.sprecCode || '').trim() || 'UNKNOWN',
    version: SPREC_VERSION,
    ...flat,
  };
}

// Array-of-checked-slugs shape buildClinicalData expects for charlsonComorbidities
// (api/backend/src/routes/intakeWizard.js#116), read from clinical.charlsonConditions.
function buildCharlsonConditions(formData, clinicalComorbidityDefinitions = []) {
  return clinicalComorbidityDefinitions
    .map((option) => getDictionarySlug(option))
    .filter((slug) => slug && Boolean(formData[slug]));
}

function buildSampleIntegrityInput(formData, clinicalComorbidityDefinitions = []) {
  const matrixType = formData.sprecMatrixType === 'solid' ? 'solid' : 'fluid';
  const dictionary = matrixType === 'solid' ? SPREC_SOLID_DICTIONARY : SPREC_FLUID_DICTIONARY;
  const charlsonComorbidities = buildCharlsonConditions(formData, clinicalComorbidityDefinitions);
  return {
    // Same field shape as MerkleService.generateSampleHash on the backend (#519) — rcsScore/
    // finalGrade/calculationTrace/axisPenalties are omitted (default to null) since RCS hasn't
    // been computed yet at intake-wizard submission time.
    participant_identity: {
      participantId: String(formData.patientID || '').trim(),
      participantName: String(formData.patientName || '').trim(),
    },
    clinicalData: {
      orphaCode: String(formData.diagnosisOrphaCode || '').trim(),
      omimCode: String(formData.diagnosisOmimCode || '').trim(),
      cid: String(formData.diagnosisCidCode || '').trim(),
      phenotypes: formData.diseasePhenotypes,
      charlsonComorbidities,
      biomarkerValues: formData.biomarkers_values,
    },
    sprec: {
      ...buildCanonicalSprecPayload(formData, matrixType, dictionary),
      matrix_type: matrixType,
    },
    pharmacologyData: {
      treatment_status: String(formData.treatmentStatus || '').trim(),
      drug_name: String(formData.medicationName || formData.medicationSearchQuery || '').trim(),
      atc_code: String(formData.medicationCode || '').trim().replace(/^ATC:/i, '').toUpperCase(),
      atc_level_1: String(formData.medicationDrugClass || '').trim().toUpperCase(),
      // Legacy aliases for backward compatibility.
      medication_name: String(formData.medicationName || formData.medicationSearchQuery || '').trim(),
      medication_code: String(formData.medicationCode || '').trim().replace(/^ATC:/i, '').toUpperCase(),
      medication_drug_class: String(formData.medicationDrugClass || '').trim().toUpperCase(),
      last_dose_date: String(formData.lastDoseDate || '').trim(),
      washout_start_date: String(formData.washoutStartDate || '').trim(),
      washout_end_date: String(formData.washoutEndDate || '').trim(),
    },
  };
}

function buildSampleLabelCode({ date = new Date(), patientID = '', sampleType = '' }) {
  const normalizedDate = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const normalizedPatient = String(patientID || '').trim() || 'NOID';
  const normalizedSampleType = String(sampleType || '').trim().replace(/\s+/g, '_').toUpperCase() || 'SAMPLE';
  return `${normalizedDate}-${normalizedPatient}-${normalizedSampleType}`;
}

function formatSampleLabelDate(value, fallbackDate = new Date()) {
  const date = new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return fallbackDate.toLocaleDateString('pt-BR');
  }

  return date.toLocaleDateString('pt-BR');
}

function buildSampleLabelData(createdSample = {}, payload = {}, formData = {}, date = new Date()) {
  const labelData = createdSample?.labelData && typeof createdSample.labelData === 'object' ? createdSample.labelData : {};
  const sampleType = String(
    labelData.sampleType
    || createdSample.sampleType
    || payload.specimen.sampleType
  ).trim();
  const patientID = String(
    labelData.participantId
    || labelData.patientCode
    || createdSample.participantId
    || createdSample.patientId
    || payload?.participant?.participantId
    || ''
  ).trim();
  const fallbackCode = buildSampleLabelCode({ date, patientID, sampleType });
  const sampleID = String(
    labelData.specimenId
    || labelData.sampleId
    || createdSample.specimenId
    || createdSample.sampleId
    || createdSample._id
    || ''
  ).trim();
  const barcode = String(labelData.barcode || createdSample.barcode || createdSample.qrCode || sampleID || fallbackCode).trim();
  const collectionDate = labelData.collectionDate
    || labelData.registeredAt
    || createdSample.collectionDate
    || createdSample.registeredAt
    || createdSample.createdAt
    || payload.specimen.registeredAt;

  return {
    code: barcode || sampleID || fallbackCode,
    specimenId: sampleID || barcode || fallbackCode,
    barcode: barcode || sampleID || fallbackCode,
    sprecCode: String(formData.sprecCode || payload?.specimen?.sprecCode || '').trim(),
    sampleType,
    participantId: patientID,
    collectionDate: formatSampleLabelDate(collectionDate, date),
  };
}

function buildSubmissionPayload(formData, clinicalComorbidityItems = [], biomarkerItems = [], sampleMerkleRoot = null) {
  const now = new Date().toISOString();
  const sprecMatrixType = String(formData.sprecMatrixType || 'fluid').trim().toLowerCase() === 'solid' ? 'solid' : 'fluid';
  const sprecDictionary = sprecMatrixType === 'solid' ? SPREC_SOLID_DICTIONARY : SPREC_FLUID_DICTIONARY;
  const canonicalSprec = buildIntakeSprecPayload(formData, sprecMatrixType, sprecDictionary);
  // canonical.v1.participant/specimen both require a non-empty
  // participantId (#699) even though the server always discards and
  // regenerates it for a new patient (intakeWizard.js's resolvePatientID
  // only accepts an existing 8-digit id) -- same "required by validation,
  // regenerated server-side" precedent tests/e2e/helpers/seedParticipant.ts's
  // createRealParticipant already documents for POST /api/patients.
  const participantId = String(formData.patientID || '').trim() || 'placeholder';
  const sampleUnit = getSampleQuantityUnit(formData.sprecSampleType, SPREC_FLUID_DICTIONARY.sampleType.options);
  const patientDocument = normalizeDocumentForPayload(formData.documento);
  const parentSpecimenIds = [...new Set(
    String(formData.parentSpecimenIds || '')
      .split(/[\s,;]+/)
      .map((value) => value.trim())
      .filter(Boolean),
  )];
  const diagnosis = formData.isHealthyControl ? null : {
    diagnosisName: String(formData.diagnosisCidDescription || formData.diagnosisDefinition || '').trim() || null,
    icdCode: String(formData.diagnosisCidCode || '').trim() || null,
    orphaCode: String(formData.diagnosisOrphaCode || '').trim() || null,
    omimCode: String(formData.diagnosisOmimCode || '').trim() || null,
    definition: String(formData.diagnosisDefinition || '').trim() || null,
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

  const diseaseBiomarkers = (Array.isArray(formData.diseaseBiomarkers) ? formData.diseaseBiomarkers : []).flatMap((biomarker) => {
    const biomarkerCode = String(biomarker?.code || '').trim();
    const rawValue = String(
      formData?.biomarkers_values?.[biomarkerCode]
      || formData?.biomarkers_values?.[String(biomarker?.label || '').trim()]
      || biomarker?.value
      || ''
    ).trim();

    if (!biomarkerCode || !rawValue) {
      return [];
    }

    const value = Number(rawValue.replace(',', '.'));
    if (Number.isNaN(value)) {
      return [];
    }

    return [{
      biomarkerType: biomarkerCode,
      biomarkerLabel: String(biomarker?.label || '').trim() || biomarkerCode,
      value,
      unit: String(biomarker?.unit || '').trim(),
      collectedAt: now,
      source: 'disease_cascade',
      status: 'final',
      eventType: 'semantic',
    }];
  });

  const clinical = {
    charlsonConditions: buildCharlsonConditions(formData, clinicalComorbidityItems),
    bloodPressure: String(formData.bloodPressure || '').trim(),
    clinicalObservations: String(formData.clinicalObservations || '').trim(),
    diseasePhenotypes: Array.isArray(formData.diseasePhenotypes) ? formData.diseasePhenotypes : [],
    diseaseBiomarkers: Array.isArray(formData.diseaseBiomarkers) ? formData.diseaseBiomarkers : [],
    biomarkersValues: formData.biomarkers_values && typeof formData.biomarkers_values === 'object' ? formData.biomarkers_values : {},
    diagnosisDefinition: String(formData.diagnosisDefinition || '').trim(),
    allergies: Array.isArray(formData.allergies) ? formData.allergies : [],
    familyHistories: Array.isArray(formData.familyHistories) ? formData.familyHistories : [],
    procedures: Array.isArray(formData.procedures) ? formData.procedures : [],
    observationRecords: Array.isArray(formData.observationRecords) ? formData.observationRecords : [],
    clinicalOutcomes: Array.isArray(formData.clinicalOutcomes) ? formData.clinicalOutcomes : [],
    pharmacologyData: {
      treatmentStatus: String(formData.treatmentStatus || '').trim(),
      medicationName: String(formData.medicationName || formData.medicationSearchQuery || '').trim(),
      atcCode: String(formData.medicationCode || '').trim().replace(/^ATC:/i, '').toUpperCase(),
      atcClass: String(formData.medicationDrugClass || '').trim().toUpperCase(),
      lastDoseDate: String(formData.lastDoseDate || '').trim(),
      washoutStartDate: String(formData.washoutStartDate || '').trim(),
      washoutEndDate: String(formData.washoutEndDate || '').trim(),
    },
  };

  return {
    participant: {
      participantId,
      patientName: formData.patientName.trim(),
      birthDate: normalizeBirthDateForPayload(formData.birthDate),
      email: normalizeEmailInput(formData.email),
      isDeceased: Boolean(formData.isDeceased),
      phone: digitsOnly(formData.phone),
      identityDocument: patientDocument,
      recordNumber: String(formData.prontuario || '').trim(),
    },
    diagnosis,
    legalRepresentative: formData.isDeceased ? {
      name: String(formData.representativeName || '').trim(),
      email: normalizeEmailInput(formData.representativeEmail),
      identityDocument: normalizeDocumentValue(formData.representativeCpf),
      phone: digitsOnly(formData.representativePhone || ''),
    } : null,
    specimen: {
      // Same "required by validation, regenerated server-side" precedent as
      // participantId above -- a new specimen has no id yet at submission
      // time, but canonical.v1.specimen requires a non-empty specimenId (#699).
      specimenId: String(formData.specimenId || formData.sampleId || formData.sampleID || '').trim() || 'placeholder',
      participantId,
      // Real MIABIS-coded selections (#701) -- a different, smaller
      // vocabulary than the SPREC axis fields under sprec.* below; never
      // derived from them (SPREC's ~30-value axis has no 1:1 mapping onto
      // MIABIS's closed enum, per SampleModel.validate()).
      sampleType: String(formData.sampleType || '').trim(),
      sampleOrigin: String(formData.sampleOrigin || '').trim(),
      // collectionInstitution/collectionInstitutionAcronym have no
      // equivalent in canonical.v1.specimen (#699) -- the schema's real
      // field, collectionSite, is an Organization reference the wizard has
      // no picker for; not sent here, still shown/edited in the UI as
      // formData.collectionInstitution(Acronym) for now.
      extractionProtocol: String(formData.extractionProtocol || '').trim(),
      barcode: undefined,
      quantity: Number(formData.quantity),
      unit: sampleUnit,
      registeredAt: now,
      // Creation default — intakeWizard.js's buildSampleDocumentFromIntake
      // reads this directly as of #415 to decide available vs quarantined.
      specimenStatus: 'available',
      linkedProject: formData.linkedProject.trim(),
      sprec: canonicalSprec,
      merkleRoot: sampleMerkleRoot,
      // dict-02 ELM-0120 parentSpecimenIds (Reference[], 0..*): sent only
      // when the operator names a parent, so a plain intake's payload is
      // unchanged; the server checks each id (#1371).
      ...(parentSpecimenIds.length > 0 ? { parentSpecimenIds } : {}),
    },
    clinical,
    consent: {
      consentTemplateId: formData.selectedConsentTemplateId,
      consentGranted: true,
      consentAcceptedAt: now,
    },
    biomarkers: biomarkers.concat(diseaseBiomarkers),
  };
}

// #1376: the organization pick travels in the intake's top-level
// organizationId; specimen.collectionSite (ELM-0128) is data and is left as
// the form built it.
function applyIntakeOrganization(payload, intakeOrganizationId) {
  if (intakeOrganizationId) {
    payload.organizationId = intakeOrganizationId;
  }
  return payload;
}

// RF004 AC2 (#1497): the specimen's collection (ELM-0118 Specimen.collectionId)
// travels in specimen.collectionId; with no pick the key is left out.
function applyIntakeCollection(payload, intakeCollectionId) {
  if (intakeCollectionId) {
    payload.specimen.collectionId = intakeCollectionId;
  }
  return payload;
}

export const _test = {
  buildSubmissionPayload,
  applyIntakeOrganization,
  applyIntakeCollection,
  createClinicalStepSchema,
  getDictionarySlug,
  mapDictionaryOptions,
  getDiagnosisLocalizedLabel,
  getCidDisplayLabel,
  getCidAliases,
  normalizeCidOption,
  normalizeDiseaseBiomarker,
  normalizeDiseasePhenotype,
  buildBiomarkerValuesMap,
  normalizeCidCode,
  pickBestOrphaCandidate,
  filterAndRankDiagnosisResults,
  consolidateDiagnosisCandidates,
};

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
  const { loadCascadeByDisease, loadingSuggest, suggestError } = useSemanticCascade();
  const [activeStep, setActiveStep] = useState(0);
  const [formData, setFormData] = useState(initialState);
  const [touched, setTouched] = useState(false);
  const [step1Attempted, setStep1Attempted] = useState(false);
  // RNF018 AC1 (#1525): the sample step shows its quantity message once Next was refused there.
  const [step2Attempted, setStep2Attempted] = useState(false);
  const [submitError, setSubmitError] = useState('');
  // #1354/#1355: the organization the intake stamps, sent as organizationId (#1376).
  // Asked only when the caller has a choice; a single-organization caller's
  // own is stamped by the backend.
  const organizationChoice = useCreateOrganizationChoice();
  const [intakeOrganizationId, setIntakeOrganizationId] = useState('');
  // RF004 AC2 (#1497): every specimen names its governed collection.
  const [collectionOptions, setCollectionOptions] = useState([]);
  const [collectionOptionsError, setCollectionOptionsError] = useState('');
  const [intakeCollectionId, setIntakeCollectionId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [consentTemplates, setConsentTemplates] = useState([]);
  const [consentTemplatesLoading, setConsentTemplatesLoading] = useState(false);
  const [consentTemplatesError, setConsentTemplatesError] = useState('');
  const [diagnosisQuery, setDiagnosisQuery] = useState('');
  const [diagnosisResults, setDiagnosisResults] = useState([]);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [diagnosisError, setDiagnosisError] = useState('');
  const [diagnosisOpen, setDiagnosisOpen] = useState(false);
  const [patientMatchInfo, setPatientMatchInfo] = useState(null);
  const [patientMatchLoading, setPatientMatchLoading] = useState(false);
  const [diseaseProfile, setDiseaseProfile] = useState(null);
  const [medicationResults, setMedicationResults] = useState([]);
  const [medicationLoading, setMedicationLoading] = useState(false);
  const [medicationError, setMedicationError] = useState('');
  const [allergyDraft, setAllergyDraft] = useState({ allergenName: '', allergenCode: '', reaction: '' });
  const [familyHistoryDraft, setFamilyHistoryDraft] = useState({ relationship: '', conditionName: '', orphaCode: '', onset: '' });
  const [procedureDraft, setProcedureDraft] = useState({ procedureName: '', procedureCode: '', performed: '', bodySite: '' });
  const [observationDraft, setObservationDraft] = useState({ testName: '', loincCode: '', value: '', unit: '', effectiveDate: '' });
  const [outcomeDraft, setOutcomeDraft] = useState({ outcomeType: '', outcomeDate: '' });
  const [sampleMerkleRoot, setSampleMerkleRoot] = useState('');
  const [sampleLabel, setSampleLabel] = useState(null);
  const [failedClinicalEntities, setFailedClinicalEntities] = useState([]);
  const preAnalyticalUnknownBackupRef = React.useRef(null);
  const lastSuggestionArgsRef = React.useRef(null);

  const stepMeta = useMemo(() => ([
    {
      ...STEP_META_BASE[0],
      label: t('wizard.steps.step1', 'Passo 1'),
      title: t('wizard.sections.demographic', 'Dados Demográficos'),
      helper: t('wizard.steps.step1Helper', 'Valide o paciente antes de seguir para a amostra.'),
    },
    {
      ...STEP_META_BASE[1],
      label: t('wizard.steps.step2', 'Passo 2'),
      title: t('wizard.sections.preAnalyticalSample', 'Amostra Pré-analítica'),
      helper: t('wizard.steps.step2Helper', 'Selecione os ids canônicos de origem, extração e qualidade.'),
    },
    {
      ...STEP_META_BASE[2],
      label: t('wizard.steps.step3', 'Passo 3'),
      title: t('wizard.steps.step3Title', 'Biomarcadores & Clínica'),
      helper: t('wizard.steps.step3Helper', 'Inclua os biomarcadores para concluir o cadastro integrado.'),
    },
  ]), [t]);

  const clinicalComorbidityDefinitions = useMemo(() => (Array.isArray(dictionaries.clinicalComorbidities) ? dictionaries.clinicalComorbidities : []), [dictionaries.clinicalComorbidities]);
  const biomarkerDefinitions = useMemo(() => (Array.isArray(dictionaries.biomarkers) ? dictionaries.biomarkers : []), [dictionaries.biomarkers]);

  // Real MIABIS-coded selections (#701) -- sourced from the same fixed
  // id/label list SampleModel.validate() checks against server-side
  // (mirrored at api/backend/src/config/constants/specimen.constants.js),
  // not from `dictionaries.*` (fed by GET /api/terminologies, which never
  // actually serves MIABIS data -- the essential seed writes it into
  // separate sampleTypes/sampleOrigins/extractionProtocols collections
  // that route never reads). Same source `SampleWithdrawalReturnPage.tsx`
  // already uses.
  const sampleTypeOptions = useMemo(() => SPECIMEN_TYPES.map((type) => ({ value: type.id, label: type.label })), []);
  const sampleOriginOptions = useMemo(() => SAMPLE_ORIGINS.map((origin) => ({ value: origin.id, label: origin.label })), []);
  const extractionProtocolOptions = useMemo(() => EXTRACTION_PROTOCOLS.map((protocol) => ({ value: protocol.id, label: protocol.label })), []);
  const clinicalComorbidityOptions = useMemo(() => mapDictionaryOptions(clinicalComorbidityDefinitions), [clinicalComorbidityDefinitions]);
  const sprecMatrixType = useMemo(
    () => (formData.sprecMatrixType === 'solid' ? 'solid' : 'fluid'),
    [formData.sprecMatrixType]
  );
  const activeSprecDictionary = useMemo(
    () => (sprecMatrixType === 'solid' ? SPREC_SOLID_DICTIONARY : SPREC_FLUID_DICTIONARY),
    [sprecMatrixType]
  );
  const sprecSampleTypeOptions = useMemo(() => activeSprecDictionary.sampleType.options, [activeSprecDictionary]);
  const sprecPrimaryContainerOptions = useMemo(() => activeSprecDictionary.primaryContainer.options, [activeSprecDictionary]);
  const sprecPreCentrifugationOptions = useMemo(() => activeSprecDictionary.preCentrifugation.options, [activeSprecDictionary]);
  const sprecCentrifugationOptions = useMemo(() => activeSprecDictionary.centrifugation.options, [activeSprecDictionary]);
  const sprecSecondCentrifugationOptions = useMemo(() => activeSprecDictionary.secondCentrifugation.options, [activeSprecDictionary]);
  const sprecPostCentrifugationDelayOptions = useMemo(() => activeSprecDictionary.postCentrifugationDelay.options, [activeSprecDictionary]);
  const sprecLongTermStorageOptions = useMemo(() => activeSprecDictionary.longTermStorage.options, [activeSprecDictionary]);
  const sprecAxis1Label = useMemo(() => `${t('wizard.labels.axis', 'Axis')} 1 - ${activeSprecDictionary.sampleType.label}`, [activeSprecDictionary, t]);
  const sprecAxis2Label = useMemo(() => `${t('wizard.labels.axis', 'Axis')} 2 - ${activeSprecDictionary.primaryContainer.label}`, [activeSprecDictionary, t]);
  const sprecAxis3Label = useMemo(() => `${t('wizard.labels.axis', 'Axis')} 3 - ${activeSprecDictionary.preCentrifugation.label}`, [activeSprecDictionary, t]);
  const sprecAxis4Label = useMemo(() => `${t('wizard.labels.axis', 'Axis')} 4 - ${activeSprecDictionary.centrifugation.label}`, [activeSprecDictionary, t]);
  const sprecAxis5Label = useMemo(() => `${t('wizard.labels.axis', 'Axis')} 5 - ${activeSprecDictionary.secondCentrifugation.label}`, [activeSprecDictionary, t]);
  const sprecAxis6Label = useMemo(() => `${t('wizard.labels.axis', 'Axis')} 6 - ${activeSprecDictionary.postCentrifugationDelay.label}`, [activeSprecDictionary, t]);
  const sprecAxis7Label = useMemo(() => `${t('wizard.labels.axis', 'Axis')} 7 - ${activeSprecDictionary.longTermStorage.label}`, [activeSprecDictionary, t]);
  const quantityUnit = useMemo(() => getSampleQuantityUnit(formData.sprecSampleType, sprecSampleTypeOptions), [formData.sprecSampleType, sprecSampleTypeOptions]);
  const sprecCode = useMemo(() => buildSprecCode(formData), [formData]);
  const shouldShowProtocolAlert = useMemo(() => {
    const code = String(formData.sprecCentrifugation || '').trim().toUpperCase();
    return code === 'I' || code === 'J';
  }, [formData.sprecCentrifugation]);
  const diseasePhenotypeSuggestions = useMemo(
    () => formData.diseasePhenotypes.map(normalizeDiseasePhenotype),
    [formData.diseasePhenotypes]
  );
  const diseaseBiomarkerSuggestions = useMemo(
    () => formData.diseaseBiomarkers.map(normalizeDiseaseBiomarker),
    [formData.diseaseBiomarkers]
  );
  const hasSelectedDisease = useMemo(() => {
    return [
      formData.diagnosisCidId,
      formData.diagnosisCidCode,
      formData.diagnosisOrphaCode,
      diagnosisQuery,
    ].some((value) => String(value || '').trim().length > 0);
  }, [formData.diagnosisCidId, formData.diagnosisCidCode, formData.diagnosisOrphaCode, diagnosisQuery]);
  const isFabryCase = useMemo(() => String(formData.diagnosisOrphaCode || '').replace(/\D/g, '') === '324', [formData.diagnosisOrphaCode]);

  const patientStepSchemaDynamic = useMemo(() => createPatientStepSchema(t), [t]);
  const sampleStepSchemaDynamic = useMemo(() => createSampleStepSchema(t), [t]);

  const clinicalStepSchemaDynamic = useMemo(
    () => createClinicalStepSchema(t, clinicalComorbidityDefinitions),
    [clinicalComorbidityDefinitions, t]
  );

  const biomarkerStepSchemaDynamic = useMemo(
    () => createBiomarkerStepSchema(biomarkerDefinitions),
    [biomarkerDefinitions]
  );

  const patientValidation = useMemo(() => patientStepSchemaDynamic.safeParse(formData), [formData, patientStepSchemaDynamic]);
  const sampleValidation = useMemo(() => sampleStepSchemaDynamic.safeParse(formData), [formData, sampleStepSchemaDynamic]);
  const clinicalValidation = useMemo(() => clinicalStepSchemaDynamic.safeParse(formData), [formData, clinicalStepSchemaDynamic]);
  const biomarkerValidation = useMemo(() => biomarkerStepSchemaDynamic.safeParse(formData), [formData, biomarkerStepSchemaDynamic]);
  const consentStepSchemaDynamic = useMemo(() => createConsentStepSchema(t), [t]);
  const consentValidation = useMemo(() => consentStepSchemaDynamic.safeParse(formData), [formData, consentStepSchemaDynamic]);

  const showPatientErrors = step1Attempted || touched;
  const showSampleErrors = touched;
  const showBiomarkerErrors = touched;
  const showConsentErrors = touched;

  const isStep1Valid = patientValidation.success;
  const dictionariesReady = !dictionariesLoading && !dictionariesError && clinicalComorbidityDefinitions.length > 0 && biomarkerDefinitions.length > 0;

  const isStep2Valid = dictionariesReady && sampleValidation.success;
  const isStep3Valid = dictionariesReady && clinicalValidation.success && biomarkerValidation.success && consentValidation.success && consentTemplates.length > 0;

  const selectedConsentTemplate = useMemo(() => {
    return consentTemplates.find((template) => template._id === formData.selectedConsentTemplateId) || null;
  }, [consentTemplates, formData.selectedConsentTemplateId]);

  const selectedDiagnosis = useMemo(
    () => ({
      id: String(formData.diagnosisCidId || '').trim(),
      code: String(formData.diagnosisCidCode || '').trim(),
      orphaCode: String(formData.diagnosisOrphaCode || '').trim(),
      omimCode: String(formData.diagnosisOmimCode || '').trim(),
      definition: String(formData.diagnosisDefinition || '').trim(),
      displayName: String(formData.diagnosisCidDescription || '').trim(),
    }),
    [formData.diagnosisCidId, formData.diagnosisCidCode, formData.diagnosisOrphaCode, formData.diagnosisOmimCode, formData.diagnosisDefinition, formData.diagnosisCidDescription]
  );

  useEffect(() => {
    const patientName = String(formData.patientName || '').trim();
    const birthDate = String(formData.birthDate || '').trim();

    if (patientName.length < 3 || digitsOnly(birthDate).length !== 8) {
      setPatientMatchInfo(null);
      setPatientMatchLoading(false);
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      try {
        setPatientMatchLoading(true);
        const response = await apiClient.get('/intake-wizard/patient-match', {
          params: {
            patientName,
            birthDate: normalizeBirthDateForPayload(birthDate),
          },
          suppressErrorToast: true,
        });

        if (!active) {
          return;
        }

        setPatientMatchInfo(response?.data?.matched ? response?.data : null);
      } catch (_) {
        if (active) {
          setPatientMatchInfo(null);
        }
      } finally {
        if (active) {
          setPatientMatchLoading(false);
        }
      }
    }, 350);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [formData.patientName, formData.birthDate]);

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
      if (term.length < 2) {
        setDiagnosisResults([]);
        setDiagnosisLoading(false);
        setDiagnosisError('');
        return;
      }

      setDiagnosisLoading(true);
      setDiagnosisError('');

      try {
        const requestParams = {
          q: term,
          limit: 40,
        };
        const terminologyResponse = await apiClient.get('/terminologies', {
          params: requestParams,
          suppressErrorToast: true,
        });
        const terminologyPayload = extractResponseItems(terminologyResponse);

        const normalized = terminologyPayload
          .map((item) => normalizeCidOption(item))
          .filter((item) => item.id || item.code || item.description || item.orphaCode);
        const consolidated = consolidateDiagnosisCandidates(normalized);
        const nextResults = filterAndRankDiagnosisResults(consolidated, term, 6);

        if (!active) {
          return;
        }

        setDiagnosisResults(nextResults);
      } catch (error) {
        if (!active) {
          return;
        }

        setDiagnosisResults([]);
        setDiagnosisError(error?.response?.data?.message || error?.response?.data?.error || error?.message || t('wizard.errors.loadDiseases', 'Não foi possível carregar as doenças.'));
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
        next.diagnosisDefinition = '';
        next.diagnosisCodesManualMode = false;
        next.diagnosisCidDescription = '';
        next.diseasePhenotypes = [];
        next.diseaseBiomarkers = [];
        next.biomarkers_values = {};
      }

      return next;
    });
  }, [clinicalComorbidityDefinitions, biomarkerDefinitions]);

  useEffect(() => {
    setFormData((previous) => {
      const nextAcronym = generateAcronym(previous.collectionInstitution);
      if (previous.collectionInstitutionAcronym === nextAcronym) {
        return previous;
      }

      return {
        ...previous,
        collectionInstitutionAcronym: nextAcronym,
      };
    });
  }, [formData.collectionInstitution]);

  useEffect(() => {
    setFormData((previous) => {
      const next = { ...previous };
      let hasChanges = false;

      if (previous.preAnalyticalUnknown) {
        const unknownValuesByField = {
          sprecPreCentrifugation: resolveUnknownAxisCode(sprecPreCentrifugationOptions),
          sprecCentrifugation: resolveUnknownAxisCode(sprecCentrifugationOptions),
          sprecSecondCentrifugation: resolveUnknownAxisCode(sprecSecondCentrifugationOptions),
          sprecPostCentrifugationDelay: resolveUnknownAxisCode(sprecPostCentrifugationDelayOptions),
        };

        Object.entries(unknownValuesByField).forEach(([fieldName, unknownValue]) => {
          if (String(next[fieldName] || '').trim().toUpperCase() !== unknownValue) {
            next[fieldName] = unknownValue;
            hasChanges = true;
          }
        });
      }

      if (previous.sprecCode !== sprecCode) {
        next.sprecCode = sprecCode;
        hasChanges = true;
      }

      if (!hasChanges) {
        return previous;
      }

      return next;
    });
  }, [formData.preAnalyticalUnknown, sprecCode, sprecPreCentrifugationOptions, sprecCentrifugationOptions, sprecSecondCentrifugationOptions, sprecPostCentrifugationDelayOptions]);

  useEffect(() => {
    let active = true;

    const recalculateMerkle = async () => {
      try {
        const integrityInput = buildSampleIntegrityInput(formData, clinicalComorbidityDefinitions);
        const result = await buildSampleMerkleRoot(integrityInput);
        if (!active) {
          return;
        }

        setSampleMerkleRoot(result.rootHash);
      } catch (_) {
        if (active) {
          setSampleMerkleRoot('');
        }
      }
    };

    void recalculateMerkle();

    return () => {
      active = false;
    };
  }, [
    formData,
    clinicalComorbidityDefinitions,
  ]);

  useEffect(() => {
    let active = true;

    const loadConsentTemplate = async () => {
      setConsentTemplatesLoading(true);
      setConsentTemplatesError('');

      try {
        // Prefetched here (mount) so it's ready by the consent step later in
        // the wizard, while the user is still on an earlier step — a failure
        // of this background call must not force-logout the user out from
        // under them (#395), so it opts out of the global 401 session-kill.
        const response = await consentService.getTemplates({ suppressAuthRedirect: true });
        const nextTemplates = extractResponseItems(response, ['templates']);

        if (!active) {
          return;
        }

        setConsentTemplates(nextTemplates);
        if (nextTemplates.length > 0) {
          setFormData((current) => {
            const activeTemplate = nextTemplates.find((template) => Boolean(template.active)) || nextTemplates[0];
            return {
              ...current,
              selectedConsentTemplateId: String(activeTemplate?._id || '').trim(),
            };
          });
        } else {
          setConsentTemplatesError('');
        }
      } catch (error) {
        if (!active) {
          return;
        }

        setConsentTemplates([]);
        setConsentTemplatesError(error?.message || t('wizard.errors.consentServer', 'Erro ao comunicar com o servidor de consentimentos.'));
      } finally {
        if (active) {
          setConsentTemplatesLoading(false);
        }
      }
    };

    void loadConsentTemplate();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadCollections = async () => {
      setCollectionOptionsError('');
      try {
        const response = await collectionsService.getAll();
        if (!active) {
          return;
        }
        setCollectionOptions(extractResponseItems(response));
      } catch (error) {
        if (!active) {
          return;
        }
        setCollectionOptions([]);
        setCollectionOptionsError(error?.message || t('wizard.errors.loadCollections', 'Não foi possível carregar as coleções.'));
      }
    };

    void loadCollections();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof onValidityChange === 'function') {
      onValidityChange(Boolean(isStep1Valid && isStep2Valid && isStep3Valid && !consentTemplatesLoading));
    }
  }, [isStep1Valid, isStep2Valid, isStep3Valid, consentTemplatesLoading, onValidityChange]);

  useEffect(() => {
    const status = String(formData.treatmentStatus || '').trim().toUpperCase();
    if (!status) {
      return;
    }

    if (!['TREATED', 'ON_TREATMENT'].includes(status)) {
      setFormData((previous) => ({
        ...previous,
        medicationName: '',
        medicationCode: '',
        medicationDrugClass: '',
        medicationSearchQuery: '',
        ...(status !== 'WASHOUT'
          ? {
            washoutStartDate: '',
            washoutEndDate: '',
          }
          : {}),
      }));
    }
  }, [formData.treatmentStatus]);

  const handleFieldChange = (field) => (event) => {
    const rawValue = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    const value = field === 'bloodPressure'
      ? formatBloodPressureInput(rawValue)
      : field === 'documento' || field === 'representativeCpf'
        ? formatDocumentInput(rawValue)
        : rawValue;
    setTouched(true);

    if (field === 'preAnalyticalUnknown') {
      setFormData((previous) => {
        const isUnknown = Boolean(value);

        if (isUnknown) {
          preAnalyticalUnknownBackupRef.current = {
            sprecPreCentrifugation: previous.sprecPreCentrifugation,
            sprecCentrifugation: previous.sprecCentrifugation,
            sprecSecondCentrifugation: previous.sprecSecondCentrifugation,
            sprecPostCentrifugationDelay: previous.sprecPostCentrifugationDelay,
            ischemiaTimeMinutes: previous.ischemiaTimeMinutes,
          };
          return {
            ...previous,
            preAnalyticalUnknown: true,
          };
        }

        const restoredValues = preAnalyticalUnknownBackupRef.current || {};
        preAnalyticalUnknownBackupRef.current = null;
        return {
          ...previous,
          preAnalyticalUnknown: false,
          sprecPreCentrifugation: restoredValues.sprecPreCentrifugation || '',
          sprecCentrifugation: restoredValues.sprecCentrifugation || '',
          sprecSecondCentrifugation: restoredValues.sprecSecondCentrifugation || '',
          sprecPostCentrifugationDelay: restoredValues.sprecPostCentrifugationDelay || '',
          ischemiaTimeMinutes: restoredValues.ischemiaTimeMinutes || '',
          qualityScore: '',
          qualityCategory: '',
          quality: '',
        };
      });
      return;
    }

    setFormData((previous) => ({
      ...previous,
      [field]: value,
    }));
  };

  const handleAllergyDraftChange = (field) => (event) => {
    const value = event.target.value;
    setAllergyDraft((previous) => ({ ...previous, [field]: value }));
  };

  const handleAddAllergy = () => {
    const allergenName = allergyDraft.allergenName.trim();
    const allergenCode = allergyDraft.allergenCode.trim();
    const reaction = String(allergyDraft.reaction || '').trim();
    setTouched(true);
    setFormData((previous) => ({
      ...previous,
      allergies: [...previous.allergies, { allergenName, allergenCode, reaction }],
    }));
    setAllergyDraft({ allergenName: '', allergenCode: '', reaction: '' });
  };

  const handleRemoveAllergy = (index) => {
    setTouched(true);
    setFormData((previous) => ({
      ...previous,
      allergies: previous.allergies.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const handleFamilyHistoryDraftChange = (field) => (event) => {
    const value = event.target.value;
    setFamilyHistoryDraft((previous) => ({ ...previous, [field]: value }));
  };

  const handleAddFamilyHistory = () => {
    const relationship = familyHistoryDraft.relationship.trim();
    const conditionName = String(familyHistoryDraft.conditionName || '').trim();
    const orphaCode = String(familyHistoryDraft.orphaCode || '').trim();
    const onset = String(familyHistoryDraft.onset || '').trim();
    setTouched(true);
    setFormData((previous) => ({
      ...previous,
      familyHistories: [...previous.familyHistories, { relationship, conditionName, orphaCode, onset }],
    }));
    setFamilyHistoryDraft({ relationship: '', conditionName: '', orphaCode: '', onset: '' });
  };

  const handleRemoveFamilyHistory = (index) => {
    setTouched(true);
    setFormData((previous) => ({
      ...previous,
      familyHistories: previous.familyHistories.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const handleProcedureDraftChange = (field) => (event) => {
    const value = event.target.value;
    setProcedureDraft((previous) => ({ ...previous, [field]: value }));
  };

  const handleAddProcedure = () => {
    const procedureName = String(procedureDraft.procedureName || '').trim();
    const procedureCode = procedureDraft.procedureCode.trim();
    const performed = procedureDraft.performed.trim();
    const bodySite = String(procedureDraft.bodySite || '').trim();
    setTouched(true);
    setFormData((previous) => ({
      ...previous,
      procedures: [...previous.procedures, { procedureName, procedureCode, performed, bodySite }],
    }));
    setProcedureDraft({ procedureName: '', procedureCode: '', performed: '', bodySite: '' });
  };

  const handleRemoveProcedure = (index) => {
    setTouched(true);
    setFormData((previous) => ({
      ...previous,
      procedures: previous.procedures.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const handleObservationDraftChange = (field) => (event) => {
    const value = event.target.value;
    setObservationDraft((previous) => ({ ...previous, [field]: value }));
  };

  const handleAddObservation = () => {
    const testName = String(observationDraft.testName || '').trim();
    const loincCode = observationDraft.loincCode.trim();
    const value = String(observationDraft.value || '').trim();
    const unit = String(observationDraft.unit || '').trim();
    const effectiveDate = observationDraft.effectiveDate.trim();
    setTouched(true);
    setFormData((previous) => ({
      ...previous,
      observationRecords: [...previous.observationRecords, { testName, loincCode, value, unit, effectiveDate }],
    }));
    setObservationDraft({ testName: '', loincCode: '', value: '', unit: '', effectiveDate: '' });
  };

  const handleRemoveObservation = (index) => {
    setTouched(true);
    setFormData((previous) => ({
      ...previous,
      observationRecords: previous.observationRecords.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const handleOutcomeDraftChange = (field) => (event) => {
    const value = event.target.value;
    setOutcomeDraft((previous) => ({ ...previous, [field]: value }));
  };

  const handleAddOutcome = () => {
    const outcomeType = outcomeDraft.outcomeType.trim();
    const outcomeDate = outcomeDraft.outcomeDate.trim();
    setTouched(true);
    setFormData((previous) => ({
      ...previous,
      clinicalOutcomes: [...previous.clinicalOutcomes, { outcomeType, outcomeDate }],
    }));
    setOutcomeDraft({ outcomeType: '', outcomeDate: '' });
  };

  const handleRemoveOutcome = (index) => {
    setTouched(true);
    setFormData((previous) => ({
      ...previous,
      clinicalOutcomes: previous.clinicalOutcomes.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const handleDiagnosisChange = (event) => {
    const value = event.target.value;
    setTouched(true);
    setDiagnosisQuery(value);
    setDiagnosisOpen(String(value || '').trim().length >= 2);
    setDiseaseProfile(null);
    setMedicationResults([]);
    setMedicationError('');
    setMedicationLoading(false);

    if (!String(value || '').trim()) {
      setFormData((previous) => ({
        ...previous,
        diagnosisCidId: '',
        diagnosisCidCode: '',
        diagnosisOrphaCode: '',
        diagnosisOmimCode: '',
        diagnosisDefinition: '',
        diagnosisCidDescription: '',
        diseasePhenotypes: [],
        diseaseBiomarkers: [],
        biomarkers_values: {},
        treatmentStatus: '',
        medicationName: '',
        medicationCode: '',
        medicationDrugClass: '',
        lastDoseDate: '',
        washoutStartDate: '',
        washoutEndDate: '',
        medicationSearchQuery: '',
      }));
      return;
    }

    setFormData((previous) => ({
      ...previous,
      diagnosisCidId: '',
      diagnosisCidCode: '',
      diagnosisOrphaCode: '',
      diagnosisOmimCode: '',
      diagnosisDefinition: '',
      diagnosisCidDescription: '',
      diseasePhenotypes: [],
      diseaseBiomarkers: [],
      biomarkers_values: {},
      treatmentStatus: '',
      medicationName: '',
      medicationCode: '',
      medicationDrugClass: '',
      lastDoseDate: '',
      washoutStartDate: '',
      washoutEndDate: '',
      medicationSearchQuery: '',
    }));
  };

  // Shared by handleDiagnosisSelect and the "suggest error" retry button so
  // a retry re-runs the exact same cascade fetch + formData mapping instead
  // of only the hook's retryLoadCascade (whose return value would otherwise
  // be discarded here).
  const loadDiseaseSuggestions = async ({ orphaNumeric, normalizedOrphaCode, displayLabel }) => {
    if (!orphaNumeric) return;

    let cascade = await loadCascadeByDisease({
      system: 'http://www.orpha.net',
      code: orphaNumeric,
      display: displayLabel,
    }, { suppressErrorToast: true });

    if ((!Array.isArray(cascade?.phenotypes) || cascade.phenotypes.length === 0) && (!Array.isArray(cascade?.biomarkers) || cascade.biomarkers.length === 0)) {
      cascade = await loadCascadeByDisease({
        system: 'http://www.orpha.net',
        code: normalizedOrphaCode,
        display: displayLabel,
      }, { suppressErrorToast: true });
    }

    const nextPhenotypes = cascade.phenotypes.map(normalizeDiseasePhenotype);
    const nextBiomarkers = cascade.biomarkers.map(normalizeDiseaseBiomarker);

    setFormData((previous) => ({
      ...previous,
      diseasePhenotypes: nextPhenotypes,
      diseaseBiomarkers: nextBiomarkers,
      biomarkers_values: buildBiomarkerValuesMap(nextBiomarkers, previous.biomarkers_values),
    }));
  };

  const handleRetrySuggest = () => {
    loadDiseaseSuggestions(lastSuggestionArgsRef.current);
  };

  const handleDiagnosisSelect = async (item) => {
    setTouched(true);
    const displayValue = item.displayName;
    setDiagnosisQuery(displayValue);
    setDiagnosisOpen(false);
    const normalizedOrphaCode = normalizeOrphaCode(item.orphaCode || item.raw?.ORPHA || '');
    const orphaNumeric = getOrphaNumeric(normalizedOrphaCode);
    let normalizedCidCode = normalizeCidCode(item.cidCode || item.raw?.relacoes?.cid10 || item.raw?.relacoes?.cid || item.raw?.Codigos_CID10 || '');
    let normalizedOmimCode = normalizeOmimCode(item.omimCode || item.raw?.relacoes?.omim || item.raw?.OMIM || '');
    const normalizedDefinition = [item.definition, item.description]
      .map((value) => String(value || '').trim())
      .find((value) => value && !/^\d+$/.test(value)) || '';
    const normalizedDescription = [item.description, item.displayName]
      .map((value) => String(value || '').trim())
      .find((value) => value && !/^\d+$/.test(value)) || '';
    const fallbackId = String(item.id || normalizedOrphaCode || normalizedCidCode || item.code || '').trim();
    setFormData((previous) => ({
      ...previous,
      diagnosisCidId: fallbackId,
      diagnosisCidCode: normalizedCidCode,
      diagnosisOrphaCode: normalizedOrphaCode,
      diagnosisOmimCode: normalizedOmimCode,
      diagnosisDefinition: normalizedDefinition,
      diagnosisCidDescription: normalizedDescription,
      diagnosisCodesManualMode: false,
      diseasePhenotypes: [],
      diseaseBiomarkers: [],
      biomarkers_values: {},
      treatmentStatus: '',
      medicationName: '',
      medicationCode: '',
      medicationDrugClass: '',
      lastDoseDate: '',
      washoutStartDate: '',
      washoutEndDate: '',
      medicationSearchQuery: '',
    }));

    if (orphaNumeric) {
      try {
        const diseaseProfileResponse = await apiClient.get('/dictionary/disease-profile', {
          params: { orphaCode: orphaNumeric },
          suppressErrorToast: true,
        });
        setDiseaseProfile(diseaseProfileResponse?.data?.disease || null);
      } catch (_) {
        setDiseaseProfile(null);
      }
    } else {
      setDiseaseProfile(null);
    }

    if (orphaNumeric && (!normalizedCidCode || !normalizedOmimCode)) {
      const localBest = pickBestOrphaCandidate(diagnosisResults, orphaNumeric);
      normalizedCidCode = normalizedCidCode || normalizeCidCode(localBest.cidCode || localBest.raw?.relacoes?.cid10 || localBest.raw?.relacoes?.cid || localBest.raw?.Codigos_CID10 || '');
      normalizedOmimCode = normalizedOmimCode || normalizeOmimCode(localBest.omimCode || localBest.raw?.relacoes?.omim || localBest.raw?.OMIM || '');

      try {
        const relationResponse = await apiClient.get('/terminologies', {
          params: {
            q: `ORPHA:${orphaNumeric}`,
            limit: 30,
          },
          suppressErrorToast: true,
        });

        const relationPayload = extractResponseItems(relationResponse);
        const normalizedCandidates = relationPayload.map((entry) => normalizeCidOption(entry));
        const matched = pickBestOrphaCandidate(normalizedCandidates, orphaNumeric)
          || normalizedCandidates.find((candidate) => String(candidate.code || '').includes(orphaNumeric))
          || normalizedCandidates[0]
          || null;

        if (matched) {
          normalizedCidCode = normalizedCidCode || normalizeCidCode(matched.cidCode || matched.raw?.relacoes?.cid10 || matched.raw?.relacoes?.cid || matched.raw?.Codigos_CID10 || '');
          normalizedOmimCode = normalizedOmimCode || normalizeOmimCode(matched.omimCode || matched.raw?.relacoes?.omim || matched.raw?.OMIM || '');

          setFormData((previous) => ({
            ...previous,
            diagnosisCidCode: normalizedCidCode,
            diagnosisOmimCode: normalizedOmimCode,
          }));
        }
      } catch (_) {
        // Sem bloquear o fluxo clínico caso não haja relação completa no backend.
      }
    }

    const suggestionArgs = {
      orphaNumeric,
      normalizedOrphaCode,
      displayLabel: normalizedDefinition || displayValue,
    };
    lastSuggestionArgsRef.current = suggestionArgs;
    await loadDiseaseSuggestions(suggestionArgs);
  };

  const handleDiseasePhenotypeToggle = (phenotype) => {
    setTouched(true);
    setFormData((previous) => ({
      ...previous,
      diseasePhenotypes: previous.diseasePhenotypes.map(normalizeDiseasePhenotype).filter((item) => item.hpoId !== phenotype.hpoId),
    }));
  };

  const handleDiseaseBiomarkerValueChange = (biomarker, rawValue) => {
    const key = getDiseaseBiomarkerKey(biomarker);

    const nextValue = String(rawValue || '').trim();
    setTouched(true);
    setFormData((previous) => {
      const nextBiomarkerValues = { ...previous.biomarkers_values };
      if (nextValue) {
        nextBiomarkerValues[key] = nextValue;
      } else {
        delete nextBiomarkerValues[key];
      }

      const nextDiseaseBiomarkers = previous.diseaseBiomarkers.map((item) => {
        const normalized = normalizeDiseaseBiomarker(item);
        if (getDiseaseBiomarkerKey(normalized) !== key) {
          return normalized;
        }
        return {
          ...normalized,
          value: nextValue,
        };
      });

      return {
        ...previous,
        biomarkers_values: nextBiomarkerValues,
        diseaseBiomarkers: nextDiseaseBiomarkers,
      };
    });
  };

  const handleMedicationSelect = (medication) => {
    setTouched(true);
    const atcCode = String(medication?.atc_code || medication?.code || '').replace(/^ATC:/i, '').trim().toUpperCase();
    setFormData((previous) => ({
      ...previous,
      medicationName: String(medication?.name || '').trim(),
      medicationCode: atcCode,
      medicationDrugClass: String(medication?.atc_level_1 || '').trim().toUpperCase(),
      medicationSearchQuery: String(medication?.name || '').trim(),
    }));
    setMedicationResults([]);
  };

  useEffect(() => {
    if (!['TREATED', 'ON_TREATMENT'].includes(String(formData.treatmentStatus || '').trim().toUpperCase())) {
      setMedicationResults([]);
      setMedicationError('');
      setMedicationLoading(false);
      return;
    }

    const query = String(formData.medicationSearchQuery || '').trim();
    if (query.length < 2) {
      setMedicationResults([]);
      setMedicationError('');
      setMedicationLoading(false);
      return;
    }

    let active = true;

    const loadMedications = async () => {
      try {
        setMedicationLoading(true);
        setMedicationError('');

        const response = await apiClient.get('/dictionary/atc/search', {
          params: {
            query,
            limit: 20,
          },
          suppressErrorToast: true,
        });

        if (!active) {
          return;
        }

        const payload = extractResponseItems(response, ['medications']);
        setMedicationResults(payload);
      } catch (_) {
        if (active) {
          setMedicationResults([]);
          setMedicationError(t('wizard.errors.medicationSearch', 'Não foi possível consultar medicamentos neste momento.'));
        }
      } finally {
        if (active) {
          setMedicationLoading(false);
        }
      }
    };

    void loadMedications();

    return () => {
      active = false;
    };
  }, [formData.treatmentStatus, formData.medicationSearchQuery, diseaseProfile]);

  const handleNext = () => {
    setTouched(true);
    if (activeStep === 0 && !isStep1Valid) return;
    if (activeStep === 1 && !isStep2Valid) {
      setStep2Attempted(true);
      return;
    }
    setActiveStep((current) => Math.min(current + 1, stepMeta.length - 1));
    if (typeof onStepChange === 'function') {
      onStepChange(Math.min(activeStep + 1, stepMeta.length - 1));
    }
  };

  const handleBack = () => {
    setActiveStep((current) => Math.max(current - 1, 0));
    if (typeof onStepChange === 'function') {
      onStepChange(Math.max(activeStep - 1, 0));
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    console.log('[DEBUG] Botão clicado');
    setTouched(true);
    setStep1Attempted(true);
    setSubmitError('');
    setFailedClinicalEntities([]);

    if (!isStep1Valid || !isStep2Valid || !isStep3Valid) {
      const errors = {
        step1Valid: isStep1Valid,
        step2Valid: isStep2Valid,
        step3Valid: isStep3Valid,
        patientValidationIssues: patientValidation?.error?.issues || [],
        sampleValidationIssues: sampleValidation?.error?.issues || [],
        clinicalValidationIssues: clinicalValidation?.error?.issues || [],
        biomarkerValidationIssues: biomarkerValidation?.error?.issues || [],
        consentValidationIssues: consentValidation?.error?.issues || [],
        dictionariesReady,
        consentTemplatesCount: consentTemplates.length,
      };
      console.log(errors);
      setActiveStep(!isStep1Valid ? 0 : !isStep2Valid ? 1 : 2);
      return;
    }

    if (organizationChoice.required && !intakeOrganizationId) {
      setSubmitError(t('wizard.validation.organization', 'Selecione a organização da coleta: sua conta pertence a mais de uma.'));
      setActiveStep(1);
      return;
    }

    if (!intakeCollectionId) {
      setSubmitError(t('wizard.validation.collection', 'Selecione a coleção da amostra (RF004).'));
      setActiveStep(1);
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = buildSubmissionPayload(formData, clinicalComorbidityDefinitions, biomarkerDefinitions, sampleMerkleRoot || null);
      if (patientMatchInfo?.patient?.patientID) {
        payload.participant.participantId = String(patientMatchInfo.patient.patientID).trim();
      }
      applyIntakeOrganization(payload, intakeOrganizationId);
      applyIntakeCollection(payload, intakeCollectionId);
      console.log('[DEBUG] Payload pronto:', payload);

      let response;
      try {
        response = await apiClient.post('/intake-wizard', payload);
      } catch (apiError) {
        console.error('[DEBUG] Falha imediata na chamada POST /intake-wizard:', apiError);
        throw apiError;
      }

      const message = response?.data?.message || t('wizard.success.completed', 'Cadastro integrado concluído com sucesso.');
      const createdSample = response?.data?.sample || {};
      setSampleLabel({
        ...buildSampleLabelData(createdSample, payload, formData, new Date()),
        ...(response?.data?.label || {}),
        // dict-02 StorageAssignment (#495) — POST /intake-wizard already
        // resolves this additively (see intakeWizard.js), prefer it over the
        // legacy embedded storageLocation shape.
        storageAssignment: response?.data?.storageAssignment || createdSample?.storageAssignment || null,
        storageLocation: response?.data?.storageLocation || createdSample?.storageLocation || null,
      });

      const clinicalEntitiesFailedRaw = response?.data?.clinicalEntities?.failed;
      const clinicalEntitiesFailed = Array.isArray(clinicalEntitiesFailedRaw) ? clinicalEntitiesFailedRaw : [];
      setFailedClinicalEntities(clinicalEntitiesFailed);

      if (clinicalEntitiesFailed.length > 0) {
        notifyApiToast({
          message: t('wizard.clinicalEntitiesWarning.toastMessage', 'Amostra salva com sucesso, mas alguns registros clínicos não foram salvos.'),
          type: 'warning',
          duration: 4500,
        });
      } else {
        notifyApiToast({
          message,
          type: 'success',
          duration: 4500,
        });
      }

      setFormData({
        ...initialState,
        selectedConsentTemplateId: String(selectedConsentTemplate._id).trim(),
      });
      setPatientMatchInfo(null);
      setActiveStep(0);
      setTouched(false);
      setStep1Attempted(false);
      setStep2Attempted(false);
    } catch (error) {
      const message = error?.response?.data?.message || error?.response?.data?.error || error?.message || t('wizard.errors.submit', 'Erro ao finalizar o cadastro integrado.');
      setSubmitError(message);
      notifyApiToast({
        message,
        type: 'error',
        duration: 5500,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrintSampleLabel = () => {
    const sampleId = String(sampleLabel?.specimenId || sampleLabel?.code || '').trim();
    if (typeof window !== 'undefined' && sampleId) {
      window.open(`/samples/${encodeURIComponent(sampleId)}/label`, '_blank', 'noopener,noreferrer');
    }
  };

  const renderStepContent = () => {
    if (activeStep === 0) {
      return (
        <Card className="bg-white rounded-2xl shadow-lg border border-gray-100">
          <div className="border-b border-gray-200 pb-3 mb-5">
            <h3 className="text-xl font-bold text-gray-800">{t('wizard.sections.demographic', 'Dados Demográficos')}</h3>
          </div>
          <div className="wizard-grid grid grid-cols-1 md:grid-cols-2 gap-6">
            <Input id="fullName" name="fullName" data-testid="wizard-full-name" className="w-full rounded-lg px-3 py-2" label={t('wizard.fields.fullName', 'Nome completo')} value={formData.patientName} onChange={handleFieldChange('patientName')} required />
            <Input
              id="birthDate"
              name="birthDate"
              data-testid="wizard-birth-date"
              className="w-full rounded-lg px-3 py-2"
              label={t('wizard.fields.birthDate', 'Data de nascimento')}
              helperText={t('wizard.helpers.birthDateFormat', 'Formato esperado: DD/MM/AAAA')}
              value={formatBirthDateInput(formData.birthDate)}
              onChange={handleFieldChange('birthDate')}
              required
            />
            {patientMatchLoading && (
              <div className="wizard-span-2 md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                {t('wizard.status.checkingPatient', 'Verificando identificação positiva do paciente...')}
              </div>
            )}
            {!patientMatchLoading && patientMatchInfo?.matched && (
              <div className="wizard-span-2 md:col-span-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" data-testid="wizard-patient-match-alert">
                {t('wizard.status.patientMatched', 'Paciente identificado. Novos dados serão vinculados ao perfil histórico.')}
              </div>
            )}
            <Select
              id="gender"
              name="gender"
              data-testid="wizard-gender"
              className="w-full rounded-lg px-3 py-2"
              label={t('wizard.fields.gender', 'Sexo')}
              value={formData.gender}
              onChange={handleFieldChange('gender')}
              required
              options={[
                { value: '', label: t('common.select', 'Selecione') },
                { value: 'M', label: t('patients.sexMale', 'Masculino') },
                { value: 'F', label: t('patients.sexFemale', 'Feminino') },
                { value: 'O', label: t('patients.sexOther', 'Outro') },
              ]}
            />
            <Input
              id="email"
              name="email"
              data-testid="wizard-email"
              className="w-full rounded-lg px-3 py-2"
              label={t('wizard.fields.email', 'Email')}
              helperText={t('wizard.helpers.emailFormat', 'Formato esperado: nome@dominio.com')}
              type="email"
              value={formData.email}
              onChange={handleFieldChange('email')}
              required={!formData.isDeceased}
            />
            <Input
              id="document"
              name="document"
              data-testid="wizard-document"
              className="w-full rounded-lg px-3 py-2"
              label={t('wizard.fields.document', 'Documento')}
              helperText={t('wizard.helpers.documentCpfPassport', 'Aceita CPF ou passaporte válido (somente números).')}
              error={showPatientErrors ? getFieldError(patientValidation, 'documento') : ''}
              value={formData.documento}
              onChange={handleFieldChange('documento')}
              inputMode="numeric"
              pattern="[0-9]*"
              required
            />
            <Input id="recordNumber" name="recordNumber" data-testid="wizard-record-number" className="w-full rounded-lg px-3 py-2" label={t('wizard.fields.recordNumber', 'Prontuário')} helperText={t('wizard.helpers.recordNumberOptional', 'Campo opcional de texto livre.')} value={formData.prontuario} onChange={handleFieldChange('prontuario')} required={false} />
            <label className="wizard-span-2 md:col-span-2 flex items-center gap-2 text-sm font-semibold text-gray-700 mb-1.5">
              <input type="checkbox" checked={formData.isDeceased} onChange={handleFieldChange('isDeceased')} />
              {t('wizard.fields.deceasedPatient', 'Paciente falecido')}
            </label>
            {formData.isDeceased && (
              <div className="wizard-grid wizard-span-2 md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="wizard-span-2 md:col-span-2 border-b border-gray-200 pb-3 mb-1">
                  <h4 className="text-xl font-bold text-gray-800">{t('wizard.sections.legalRepresentative', 'Dados do Representante Legal')}</h4>
                </div>
                <Input className="w-full rounded-lg px-3 py-2" label={t('wizard.fields.legalName', 'Nome do representante legal')} value={formData.representativeName} onChange={handleFieldChange('representativeName')} required />
                <Input className="w-full rounded-lg px-3 py-2" label={t('wizard.fields.legalEmail', 'Email do representante legal')} type="email" value={formData.representativeEmail} onChange={handleFieldChange('representativeEmail')} required />
                <Input
                  className="w-full rounded-lg px-3 py-2"
                  label={t('wizard.fields.legalDocument', 'Documento do representante legal')}
                  helperText={t('wizard.helpers.documentCpfPassport', 'Aceita CPF ou passaporte válido (somente números).')}
                  value={formData.representativeCpf}
                  onChange={handleFieldChange('representativeCpf')}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  required
                />
              </div>
            )}
          </div>
        </Card>
      );
    }

    if (activeStep === 1) {
      return (
        <Card className="bg-white rounded-2xl shadow-lg border border-gray-100">
          <div className="border-b border-gray-200 pb-3 mb-5">
            <h3 className="text-xl font-bold text-gray-800">{t('wizard.sections.preAnalyticalSample', 'Amostra Pré-analítica')}</h3>
          </div>
          <div className="wizard-grid grid grid-cols-1 md:grid-cols-2 gap-6">
            <Select
              id="sprecMatrix"
              name="sprecMatrix"
              data-testid="wizard-sprec-matrix"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
              label={t('wizard.fields.sprecMatrix', 'Matriz SPREC')}
              value={formData.sprecMatrixType}
              onChange={handleFieldChange('sprecMatrixType')}
              required
              options={[
                { value: 'fluid', label: t('wizard.matrix.fluid', 'Fluidos (SPREC 2.0)') },
                { value: 'solid', label: t('wizard.matrix.solid', 'Sólidos (SPREC 2.0)') },
              ]}
            />
            <div className="wizard-span-2 md:col-span-2 text-sm font-semibold text-gray-700 -mb-2">
              {t('wizard.sections.miabisClassification', 'Classificação MIABIS')}
            </div>
            <Select
              id="sampleType"
              name="sampleType"
              data-testid="wizard-sample-type"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
              label={t('wizard.fields.sampleType', 'Tipo de Amostra (MIABIS)')}
              value={formData.sampleType}
              onChange={handleFieldChange('sampleType')}
              required
              options={[{ value: '', label: t('wizard.placeholders.selectSampleType', 'Selecione o tipo de amostra') }, ...sampleTypeOptions]}
            />
            <Select
              id="sampleOrigin"
              name="sampleOrigin"
              data-testid="wizard-sample-origin"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
              label={t('wizard.fields.sampleOrigin', 'Origem da Amostra (MIABIS)')}
              value={formData.sampleOrigin}
              onChange={handleFieldChange('sampleOrigin')}
              required
              options={[{ value: '', label: t('wizard.placeholders.selectSampleOrigin', 'Selecione a origem da amostra') }, ...sampleOriginOptions]}
            />
            <Select
              id="extractionProtocol"
              name="extractionProtocol"
              data-testid="wizard-extraction-protocol"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
              label={t('wizard.fields.extractionProtocol', 'Protocolo de Extração (MIABIS)')}
              value={formData.extractionProtocol}
              onChange={handleFieldChange('extractionProtocol')}
              required
              options={[{ value: '', label: t('wizard.placeholders.selectExtractionProtocol', 'Selecione o protocolo de extração') }, ...extractionProtocolOptions]}
            />
            <Select
              id="sprecAxis1"
              name="sprecAxis1"
              data-testid="wizard-sprec-axis-1"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
              label={sprecAxis1Label}
              value={formData.sprecSampleType}
              onChange={handleFieldChange('sprecSampleType')}
              required
              options={[{ value: '', label: t('wizard.placeholders.selectSprecSampleType', 'Select SPREC sample type') }, ...sprecSampleTypeOptions]}
            />
            <Select
              id="sprecAxis2"
              name="sprecAxis2"
              data-testid="wizard-sprec-axis-2"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
              label={sprecAxis2Label}
              value={formData.sprecPrimaryContainer}
              onChange={handleFieldChange('sprecPrimaryContainer')}
              required
              options={[{ value: '', label: t('wizard.placeholders.selectSprecPrimaryContainer', 'Select SPREC primary container') }, ...sprecPrimaryContainerOptions]}
            />
            <Select
              id="sprecAxis3"
              name="sprecAxis3"
              data-testid="wizard-sprec-axis-3"
              className={`w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500 ${formData.preAnalyticalUnknown ? 'bg-gray-100' : ''}`}
              label={sprecAxis3Label}
              value={formData.sprecPreCentrifugation}
              onChange={handleFieldChange('sprecPreCentrifugation')}
              disabled={formData.preAnalyticalUnknown}
              required
              options={[{ value: '', label: t('wizard.placeholders.selectSprecPreCentrifugation', 'Select pre-centrifugation') }, ...sprecPreCentrifugationOptions]}
            />
            <div className="w-full">
              <div className="mb-1.5 flex items-center gap-2">
                <label className="block text-sm font-semibold text-gray-700">{sprecAxis4Label}</label>
                {shouldShowProtocolAlert && (
                  <span
                    title={t('wizard.alert.protocolRisk', 'Atenção: Forças acima de 10.000g podem causar lise celular e impactar a qualidade de analitos sensíveis')}
                    aria-label={t('wizard.alert.protocolRisk', 'Atenção: Forças acima de 10.000g podem causar lise celular e impactar a qualidade de analitos sensíveis')}
                    className="inline-flex items-center text-amber-600"
                  >
                    <AlertTriangle size={16} />
                  </span>
                )}
              </div>
              <Select
                id="sprecAxis4"
                name="sprecAxis4"
                data-testid="wizard-sprec-axis-4"
                className={`w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500 ${formData.preAnalyticalUnknown ? 'bg-gray-100' : ''}`}
                label=""
                value={formData.sprecCentrifugation}
                onChange={handleFieldChange('sprecCentrifugation')}
                disabled={formData.preAnalyticalUnknown}
                required
                options={[{ value: '', label: t('wizard.placeholders.selectSprecCentrifugation', 'Select centrifugation') }, ...sprecCentrifugationOptions]}
              />
            </div>
            <Select
              id="sprecAxis5"
              name="sprecAxis5"
              data-testid="wizard-sprec-axis-5"
              className={`w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500 ${formData.preAnalyticalUnknown ? 'bg-gray-100' : ''}`}
              label={sprecAxis5Label}
              value={formData.sprecSecondCentrifugation}
              onChange={handleFieldChange('sprecSecondCentrifugation')}
              disabled={formData.preAnalyticalUnknown}
              required
              options={[{ value: '', label: t('wizard.placeholders.selectSprecSecondCentrifugation', 'Select second centrifugation') }, ...sprecSecondCentrifugationOptions]}
            />
            <Select
              id="sprecAxis6"
              name="sprecAxis6"
              data-testid="wizard-sprec-axis-6"
              className={`w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500 ${formData.preAnalyticalUnknown ? 'bg-gray-100' : ''}`}
              label={sprecAxis6Label}
              value={formData.sprecPostCentrifugationDelay}
              onChange={handleFieldChange('sprecPostCentrifugationDelay')}
              disabled={formData.preAnalyticalUnknown}
              required
              options={[{ value: '', label: t('wizard.placeholders.selectSprecPostCentrifugationDelay', 'Select post-centrifugation delay') }, ...sprecPostCentrifugationDelayOptions]}
            />
            <Select
              id="sprecAxis7"
              name="sprecAxis7"
              data-testid="wizard-sprec-axis-7"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
              label={sprecAxis7Label}
              value={formData.sprecLongTermStorage}
              onChange={handleFieldChange('sprecLongTermStorage')}
              required
              options={[{ value: '', label: t('wizard.placeholders.selectSprecLongTermStorage', 'Select long-term storage') }, ...sprecLongTermStorageOptions]}
            />
            <div className="wizard-span-2 md:col-span-2 flex items-center gap-2 text-sm font-semibold text-gray-700 mb-1.5">
              <input data-testid="wizard-processing-unknown" type="checkbox" checked={Boolean(formData.preAnalyticalUnknown)} onChange={handleFieldChange('preAnalyticalUnknown')} />
              {t('wizard.labels.processingUnknown', 'Processing information unknown')}
            </div>
            {formData.preAnalyticalUnknown && (
              <div className="wizard-span-2 md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                {t('wizard.labels.processingUnknownHelp', 'In unknown-processing safety mode, SPREC axes 3, 4, 5 and 6 are automatically forced to code X.')}
              </div>
            )}
            <div className="wizard-span-2 md:col-span-2 governance-grid" data-testid="wizard-governance-grid-step2">
              <div className="governance-card">
                <p className="governance-label">{t('wizard.labels.sprec', 'SPREC 2.0')}</p>
                <p className="governance-sprec-code">{sprecCode || 'PENDENTE'}</p>
                <p className="governance-subtext">{sprecMatrixType === 'solid' ? t('wizard.matrix.solidShort', 'Matriz sólida') : t('wizard.matrix.fluidShort', 'Matriz fluida')}</p>
              </div>
              <div className="governance-card">
                <p className="governance-label">{t('wizard.labels.backendGovernance', 'Governança do backend')}</p>
                <p className="governance-subtext">{t('wizard.labels.afterSubmit', 'Após envio')}</p>
                <p className="governance-subtext">{t('wizard.labels.noPreviewBeforeSubmit', 'Decisão final calculada somente depois da persistência')}</p>
              </div>
            </div>
            <div className="w-full">
              <label htmlFor="wizard-quantity" className="mb-1.5 block text-sm font-semibold text-gray-700">{t('common.quantity', 'Quantidade')}</label>
              <div className="flex items-center gap-2">
                <Input id="wizard-quantity" data-testid="wizard-quantity" className="w-full rounded-lg px-3 py-2" type="number" value={formData.quantity} onChange={handleFieldChange('quantity')} error={step2Attempted ? getFieldError(sampleValidation, 'quantity') : ''} required />
                <span className="inline-flex h-10 items-center rounded-lg border border-gray-300 bg-gray-100 px-3 text-sm font-semibold text-gray-700">{quantityUnit}</span>
              </div>
            </div>
            {organizationChoice.show && (
              <Select
                id="wizard-organization"
                data-testid="wizard-organization"
                label={organizationChoice.required ? t('wizard.fields.organization', 'Organização da coleta') : t('wizard.fields.organizationOptional', 'Organização da coleta (opcional)')}
                value={intakeOrganizationId}
                onChange={(event) => setIntakeOrganizationId(event.target.value)}
              >
                <option value="">{organizationChoice.required ? t('wizard.fields.organizationPlaceholder', 'Selecione…') : t('wizard.fields.organizationNone', 'Nenhuma')}</option>
                {organizationChoice.options.map((option) => (
                  <option key={option.organizationId} value={option.organizationId}>{option.officialName || option.organizationId}</option>
                ))}
              </Select>
            )}
            <Select
              id="wizard-collection"
              data-testid="wizard-collection"
              label={t('wizard.fields.collection', 'Coleção')}
              value={intakeCollectionId}
              onChange={(event) => setIntakeCollectionId(event.target.value)}
              required
            >
              <option value="">{t('wizard.fields.collectionPlaceholder', 'Selecione…')}</option>
              {collectionOptions.map((option) => (
                <option key={option.collectionId} value={option.collectionId}>{option.collectionName || option.collectionId}</option>
              ))}
            </Select>
            <Input id="linkedProject" name="linkedProject" data-testid="wizard-linked-project" className="w-full rounded-lg px-3 py-2" label={t('wizard.fields.linkedProject', 'Projeto vinculado')} value={formData.linkedProject} onChange={handleFieldChange('linkedProject')} required />
            <Input id="parentSpecimenIds" name="parentSpecimenIds" data-testid="wizard-parent-specimen-ids" className="w-full rounded-lg px-3 py-2" label={t('wizard.fields.parentSpecimenIds', 'Amostras de origem (specimenIds)')} value={formData.parentSpecimenIds} onChange={handleFieldChange('parentSpecimenIds')} />
            <Input id="institutionName" name="institutionName" data-testid="wizard-institution-name" className="w-full rounded-lg px-3 py-2" label={t('wizard.fields.institutionName', 'Nome da Instituição')} value={formData.collectionInstitution} onChange={handleFieldChange('collectionInstitution')} required />
            <Input className="w-full rounded-lg px-3 py-2 uppercase bg-gray-100" label={t('wizard.fields.institutionAcronym', 'Sigla da Instituição')} value={String(formData.collectionInstitutionAcronym || '').toUpperCase()} readOnly />
          </div>
        </Card>
      );
    }

    return (
      <div className="grid gap-4 step3-layout">
        <div className="governance-grid governance-grid--three" data-testid="wizard-governance-grid-step3">
          <div className="governance-card">
            <p className="governance-label">{t('wizard.labels.sprec', 'SPREC 2.0')}</p>
            <p className="governance-sprec-code">{sprecCode}</p>
            <p className="governance-subtext">{t('wizard.labels.auditableCode', 'Código auditável pré-analítico')}</p>
          </div>
          <div className="governance-card">
            <p className="governance-label">{t('wizard.labels.backendGovernance', 'Governança do backend')}</p>
            <p className="governance-subtext">{t('wizard.labels.afterSubmit', 'Após envio')}</p>
            <p className="governance-subtext">{t('wizard.labels.noPreviewBeforeSubmit', 'Decisão final calculada somente depois da persistência')}</p>
          </div>
          <div className="governance-card">
            <p className="governance-label">{t('wizard.labels.clinicalIdentifiers', 'Identificadores Clínicos')}</p>
            <div className="identifier-list">
              <div><span>ORPHA</span><strong>{formData.diagnosisOrphaCode || '-'}</strong></div>
              <div><span>OMIM</span><strong>{formData.diagnosisOmimCode || '-'}</strong></div>
              <div><span>CID-10</span><strong>{formData.diagnosisCidCode || '-'}</strong></div>
            </div>
          </div>
        </div>

        <Card className="bg-white rounded-2xl shadow-lg border border-gray-100">
          <div className="grid gap-4">
            <div className="border-b border-gray-200 pb-3 mb-1 section-title-block">
              <h3 className="text-xl font-bold text-gray-800">{t('wizard.sections.consentGovernance', 'TCLE e governança clínica')}</h3>
            </div>
            <Select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
              label={t('wizard.fields.linkedConsent', 'TCLE vinculado')}
              value={formData.selectedConsentTemplateId}
              onChange={handleFieldChange('selectedConsentTemplateId')}
              required
              options={[
                { value: '', label: t('wizard.placeholders.selectTcle', 'Select an informed consent form') },
                ...consentTemplates.map((template) => ({
                  value: String(template._id || '').trim(),
                  label: `${template.active ? `[${t('wizard.status.active', 'Ativo')}] ` : ''}${template.version || 'v?'} - ${template.title || 'TCLE'}`,
                })),
              ]}
            />
            {!consentTemplatesLoading && consentTemplates.length === 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-semibold">{t('wizard.status.noActiveTcle', 'Nenhum TCLE cadastrado.')}</p>
                <a className="mt-2 inline-flex font-semibold text-emerald-700 underline" href="/admin/tcle/new?returnTo=/next/intake">
                  {t('wizard.actions.createTcle', 'Cadastrar novo TCLE')}
                </a>
              </div>
            )}
            {selectedConsentTemplate && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 panel-soft">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-lg font-bold text-slate-800">{selectedConsentTemplate.title}</h4>
                  {selectedConsentTemplate.active && (
                    <span className="inline-flex rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">{t('wizard.status.active', 'Ativo')}</span>
                  )}
                </div>
                <p className="mt-2 text-sm text-slate-600">{buildConsentPreview(selectedConsentTemplate, formData, t).slice(0, 420)}</p>
              </div>
            )}
          </div>
        </Card>

        <Card className="bg-white rounded-2xl shadow-lg border border-gray-100">
          <div className="border-b border-gray-200 pb-3 mb-5 section-title-block">
            <h3 className="text-xl font-bold text-gray-800">{t('wizard.sections.clinicalOrpha', 'Informações Clínicas e ORPHA')}</h3>
          </div>
          <div className="grid grid-cols-1 gap-8 clinical-section-stack">
            <div className="wizard-grid grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5 step3-diagnosis-grid">
              <div className="wizard-span-2 md:col-span-2 relative diagnosis-search-block">
                <label className="mb-1.5 block text-sm font-semibold text-gray-700 diagnosis-search-label">{t('wizard.labels.searchDiseaseOrpha', 'Buscar doença em Orphadata')}</label>
                <input
                  data-testid="wizard-diagnosis-search"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:outline-none diagnosis-search-input"
                  value={diagnosisQuery}
                  onChange={handleDiagnosisChange}
                  onFocus={() => setDiagnosisOpen(String(diagnosisQuery || '').trim().length >= 2)}
                  onBlur={() => setTimeout(() => setDiagnosisOpen(false), 120)}
                      placeholder={t('wizard.placeholders.searchDisease', 'Digite ORPHA, CID-10, código ou descrição da doença')}
                  disabled={formData.isHealthyControl}
                />
                {!formData.isHealthyControl && String(diagnosisQuery || '').trim() && !String(formData.diagnosisCidId || '').trim() && (
                  <p className="diagnosis-selection-hint">{t('wizard.labels.selectDiseaseResult', 'Selecione um resultado da lista para preencher ORPHA, OMIM e CID-10 automaticamente.')}</p>
                )}
                {diagnosisLoading && <p className="mt-2 text-sm text-slate-500">{t('wizard.status.loadingDiseases', 'Buscando doenças ORPHA...')}</p>}
                {diagnosisError && <p className="mt-2 text-sm text-red-600">{diagnosisError}</p>}
                {diagnosisOpen && !formData.isHealthyControl && !diagnosisLoading && diagnosisResults.length > 0 && (
                  <div className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg diagnosis-search-results" data-testid="wizard-diagnosis-results">
                    {diagnosisResults.map((item, index) => (
                      <button
                        key={`${item.id || item.code}-${item.displayName}`}
                        type="button"
                        data-testid={`wizard-diagnosis-option-${index}`}
                        className="mb-1 block w-full rounded-md px-3 py-2 text-left diagnosis-search-result-item"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          handleDiagnosisSelect(item);
                        }}
                      >
                        <span className="block text-sm font-semibold text-slate-800 diagnosis-result-title">{item.displayName}</span>
                        <span className="block diagnosis-result-meta-text">
                          CID-10: {item.cidCode || '-'} | ORPHA: {item.orphaCode || '-'} | OMIM: {item.omimCode || '-'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Input className="w-full rounded-lg px-3 py-2" label={t('wizard.fields.icd10Editable', 'CID-10')} value={formData.diagnosisCidCode} onChange={handleFieldChange('diagnosisCidCode')} placeholder="CID-10" readOnly />
              <Input className="w-full rounded-lg px-3 py-2 bg-gray-100" label={t('wizard.fields.orpha', 'ORPHA')} value={formData.diagnosisOrphaCode} readOnly placeholder="ORPHA" />
              <Input className="w-full rounded-lg px-3 py-2 bg-gray-100" label={t('wizard.fields.omim', 'OMIM')} value={formData.diagnosisOmimCode} readOnly placeholder="OMIM" />
              <div className="wizard-span-2 md:col-span-2">
                <Textarea className="w-full rounded-lg px-3 py-2 bg-gray-100" label={t('wizard.fields.diagnosisDescription', 'Definição / descrição diagnóstica')} value={formData.diagnosisDefinition || formData.diagnosisCidDescription} onChange={handleFieldChange('diagnosisDefinition')} rows={3} readOnly placeholder={t('wizard.placeholders.selectDiseaseFill', 'Selecionar doença em Orphadata para preencher.')} />
              </div>
              <div className="wizard-span-2 md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-5 panel-soft">
                <div className="flex flex-wrap items-center gap-2 clinical-badges">
                  {formData.isHealthyControl && (
                    <span className="inline-flex rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 badge-pill badge-pill--success">{t('wizard.labels.healthyControl', 'Controle saudável')}</span>
                  )}
                </div>
              </div>
            </div>

            <div className="clinical-subsection space-y-5">
              <div className="border-b border-gray-200 pb-3 mb-1 section-title-block">
                <h4 className="text-xl font-bold text-gray-800">{t('wizard.sections.treatmentPharmacology', 'Status de Tratamento e Farmacologia')}</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Select
                  id="treatmentStatus"
                  name="treatmentStatus"
                  data-testid="wizard-treatment-status"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  label={t('wizard.fields.treatmentStatus', 'Status de Tratamento (MIABIS)')}
                  value={formData.treatmentStatus}
                  onChange={handleFieldChange('treatmentStatus')}
                  required
                  options={[
                    { value: '', label: t('wizard.fields.selectStatus', 'Selecione o status') },
                    { value: 'NAIVE', label: t('wizard.fields.naiveStatus', 'Virgem de Tratamento (Naive)') },
                    { value: 'TREATED', label: t('wizard.fields.treatedStatus', 'Em Tratamento') },
                    { value: 'WASHOUT', label: t('wizard.fields.washoutStatus', 'Janela de Lavagem (Washout)') },
                  ]}
                />
                <Input
                  className="w-full rounded-lg px-3 py-2 bg-gray-100"
                  label={t('wizard.fields.diseaseCategory', 'Categoria da Doença')}
                  value={String(diseaseProfile?.disease_category || '').trim() || 'Categoria não mapeada'}
                  readOnly
                />
              </div>

              {['TREATED', 'ON_TREATMENT'].includes(String(formData.treatmentStatus || '').trim().toUpperCase()) && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2 relative">
                    <Input
                      id="medicationSearch"
                      name="medicationSearch"
                      data-testid="wizard-medication-search"
                      className="w-full rounded-lg px-3 py-2"
                      label={t('wizard.fields.medication', 'Medicamento')}
                      value={formData.medicationSearchQuery}
                      onChange={handleFieldChange('medicationSearchQuery')}
                      placeholder={t('wizard.placeholders.medicationSearch', 'Busca semântica por nome, código ou sinônimo')}
                      required
                    />
                    {medicationLoading && <p className="mt-1 text-sm text-slate-500">{t('wizard.status.loadingMedications', 'Buscando medicamentos...')}</p>}
                    {medicationError && <p className="mt-1 text-sm text-red-600">{medicationError}</p>}
                    {!medicationLoading && medicationResults.length > 0 && (
                      <div className="absolute z-20 mt-2 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg" data-testid="wizard-medication-results">
                        {medicationResults.map((item, index) => (
                          <button
                            key={`${item.code}-${item.name}`}
                            type="button"
                            data-testid={`wizard-medication-option-${index}`}
                            className="mb-1 block w-full rounded-md px-3 py-2 text-left hover:bg-slate-100"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              handleMedicationSelect(item);
                            }}
                          >
                            <span className="block text-sm font-semibold text-slate-800">{item.name}</span>
                            <span className="block text-xs text-slate-500">ATC: {item.atc_code || '-'} • Nível 1: {item.atc_level_1 || '-'}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <Input
                    id="atcClass"
                    name="atcClass"
                    data-testid="wizard-atc-level1"
                    className="w-full rounded-lg px-3 py-2 bg-gray-100"
                    label={t('wizard.fields.atcClass', 'Classe Terapêutica (ATC Nível 1)')}
                    value={formData.medicationDrugClass}
                    readOnly
                  />
                  <Input
                    id="atcCode"
                    name="atcCode"
                    data-testid="wizard-atc-code"
                    className="w-full rounded-lg px-3 py-2 bg-gray-100"
                    label={t('wizard.fields.atcCode', 'Código ATC')}
                    value={formData.medicationCode}
                    readOnly
                  />
                  <Input
                    className="w-full rounded-lg px-3 py-2"
                    type="date"
                    label={t('wizard.fields.lastDoseDate', 'Data da Última Dose')}
                    value={formData.lastDoseDate}
                    onChange={handleFieldChange('lastDoseDate')}
                    required
                  />
                </div>
              )}

              {String(formData.treatmentStatus || '').trim().toUpperCase() === 'WASHOUT' && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    className="w-full rounded-lg px-3 py-2"
                    type="date"
                    label={t('wizard.fields.washoutStartDate', 'Início da Janela de Lavagem')}
                    value={formData.washoutStartDate}
                    onChange={handleFieldChange('washoutStartDate')}
                  />
                  <Input
                    className="w-full rounded-lg px-3 py-2"
                    type="date"
                    label={t('wizard.fields.washoutEndDate', 'Fim da Janela de Lavagem')}
                    value={formData.washoutEndDate}
                    onChange={handleFieldChange('washoutEndDate')}
                  />
                </div>
              )}
            </div>

            <div className="clinical-subsection space-y-4" data-testid="wizard-allergies-section">
              <div className="border-b border-gray-200 pb-3 section-title-block">
                <h4 className="text-xl font-bold text-gray-800">{t('wizard.sections.allergiesIntolerances', 'Alergias e Intolerâncias')}</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Input
                  id="allergyName"
                  name="allergyName"
                  data-testid="wizard-allergy-name"
                  className="w-full rounded-lg px-3 py-2"
                  label={t('wizard.fields.allergyName', 'Substância/Agente causador')}
                  value={allergyDraft.allergenName}
                  onChange={handleAllergyDraftChange('allergenName')}
                  placeholder={t('wizard.placeholders.allergyName', 'Ex.: Dipirona')}
                />
                <Input
                  id="allergyCode"
                  name="allergyCode"
                  data-testid="wizard-allergy-code"
                  className="w-full rounded-lg px-3 py-2"
                  label={t('wizard.fields.allergyCode', 'Código DCB')}
                  value={allergyDraft.allergenCode}
                  onChange={handleAllergyDraftChange('allergenCode')}
                  placeholder={t('wizard.placeholders.allergyCode', 'Ex.: 03730')}
                />
                <Input
                  id="allergyReaction"
                  name="allergyReaction"
                  data-testid="wizard-allergy-reaction"
                  className="w-full rounded-lg px-3 py-2"
                  label={t('wizard.fields.allergyReaction', 'Reação/manifestação')}
                  value={allergyDraft.reaction}
                  onChange={handleAllergyDraftChange('reaction')}
                  placeholder={t('wizard.placeholders.allergyReaction', 'Ex.: Urticária')}
                />
              </div>
              <Button
                type="button"
                data-testid="wizard-add-allergy"
                variant="secondary"
                onClick={handleAddAllergy}
                disabled={!String(allergyDraft.allergenName || '').trim() || !String(allergyDraft.allergenCode || '').trim()}
              >
                {t('wizard.actions.addAllergy', 'Adicionar alergia')}
              </Button>
              {Array.isArray(formData.allergies) && formData.allergies.length > 0 && (
                <ul className="allergy-list space-y-2" data-testid="wizard-allergy-list">
                  {formData.allergies.map((allergy, index) => (
                    <li
                      key={`${allergy.allergenCode}-${index}`}
                      data-testid={`wizard-allergy-item-${index}`}
                      className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2"
                    >
                      <span>
                        <span className="font-semibold text-gray-800">{allergy.allergenName}</span>
                        <span className="ml-2 text-sm text-gray-500">DCB: {allergy.allergenCode}</span>
                        {allergy.reaction && <span className="ml-2 text-sm text-gray-500">— {allergy.reaction}</span>}
                      </span>
                      <button
                        type="button"
                        data-testid={`wizard-remove-allergy-${index}`}
                        className="text-red-600 hover:text-red-800 text-sm"
                        onClick={() => handleRemoveAllergy(index)}
                      >
                        {t('wizard.actions.removeAllergy', 'Remover')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="clinical-subsection space-y-4" data-testid="wizard-family-history-section">
              <div className="border-b border-gray-200 pb-3 section-title-block">
                <h4 className="text-xl font-bold text-gray-800">{t('wizard.sections.familyHistory', 'Histórico Familiar')}</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Select
                  id="familyHistoryRelationship"
                  name="familyHistoryRelationship"
                  data-testid="wizard-family-relationship"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  label={t('wizard.fields.familyRelationship', 'Grau de parentesco')}
                  value={familyHistoryDraft.relationship}
                  onChange={handleFamilyHistoryDraftChange('relationship')}
                  options={[
                    { value: '', label: t('wizard.fields.selectRelationship', 'Selecione o parentesco') },
                    { value: 'mother', label: t('wizard.fields.relationshipMother', 'Mãe') },
                    { value: 'father', label: t('wizard.fields.relationshipFather', 'Pai') },
                    { value: 'sibling', label: t('wizard.fields.relationshipSibling', 'Irmão/Irmã') },
                    { value: 'child', label: t('wizard.fields.relationshipChild', 'Filho/Filha') },
                    { value: 'grandparent', label: t('wizard.fields.relationshipGrandparent', 'Avô/Avó') },
                    { value: 'other', label: t('wizard.fields.relationshipOther', 'Outro') },
                  ]}
                />
                <Input
                  id="familyConditionName"
                  name="familyConditionName"
                  data-testid="wizard-family-condition-name"
                  className="w-full rounded-lg px-3 py-2"
                  label={t('wizard.fields.familyConditionName', 'Condição/doença')}
                  value={familyHistoryDraft.conditionName}
                  onChange={handleFamilyHistoryDraftChange('conditionName')}
                  placeholder={t('wizard.placeholders.familyConditionName', 'Ex.: Síndrome de Marfan')}
                />
                <Input
                  id="familyConditionOrpha"
                  name="familyConditionOrpha"
                  data-testid="wizard-family-condition-orpha"
                  className="w-full rounded-lg px-3 py-2"
                  label={t('wizard.fields.familyConditionOrpha', 'Código ORPHA')}
                  value={familyHistoryDraft.orphaCode}
                  onChange={handleFamilyHistoryDraftChange('orphaCode')}
                  placeholder={t('wizard.placeholders.familyConditionOrpha', 'Ex.: ORPHA:558')}
                />
                <Input
                  id="familyConditionOnset"
                  name="familyConditionOnset"
                  data-testid="wizard-family-condition-onset"
                  className="w-full rounded-lg px-3 py-2"
                  label={t('wizard.fields.familyConditionOnset', 'Idade/período de início')}
                  value={familyHistoryDraft.onset}
                  onChange={handleFamilyHistoryDraftChange('onset')}
                  placeholder={t('wizard.placeholders.familyConditionOnset', 'Ex.: 30 anos')}
                />
              </div>
              <Button
                type="button"
                data-testid="wizard-add-family-history"
                variant="secondary"
                onClick={handleAddFamilyHistory}
                disabled={!String(familyHistoryDraft.relationship || '').trim()}
              >
                {t('wizard.actions.addFamilyHistory', 'Adicionar histórico familiar')}
              </Button>
              {Array.isArray(formData.familyHistories) && formData.familyHistories.length > 0 && (
                <ul className="family-history-list space-y-2" data-testid="wizard-family-history-list">
                  {formData.familyHistories.map((entry, index) => (
                    <li
                      key={`${entry.relationship}-${index}`}
                      data-testid={`wizard-family-history-item-${index}`}
                      className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2"
                    >
                      <span>
                        <span className="font-semibold text-gray-800">{entry.relationship}</span>
                        {entry.conditionName && <span className="ml-2 text-sm text-gray-500">— {entry.conditionName}</span>}
                        {entry.orphaCode && <span className="ml-2 text-sm text-gray-500">({entry.orphaCode})</span>}
                        {entry.onset && <span className="ml-2 text-sm text-gray-500">· {entry.onset}</span>}
                      </span>
                      <button
                        type="button"
                        data-testid={`wizard-remove-family-history-${index}`}
                        className="text-red-600 hover:text-red-800 text-sm"
                        onClick={() => handleRemoveFamilyHistory(index)}
                      >
                        {t('wizard.actions.removeFamilyHistory', 'Remover')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="clinical-subsection space-y-4" data-testid="wizard-procedures-section">
              <div className="border-b border-gray-200 pb-3 section-title-block">
                <h4 className="text-xl font-bold text-gray-800">{t('wizard.sections.procedures', 'Procedimentos')}</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Input
                  id="procedureName"
                  name="procedureName"
                  data-testid="wizard-procedure-name"
                  className="w-full rounded-lg px-3 py-2"
                  label={t('wizard.fields.procedureName', 'Procedimento')}
                  value={procedureDraft.procedureName}
                  onChange={handleProcedureDraftChange('procedureName')}
                  placeholder={t('wizard.placeholders.procedureName', 'Ex.: Biópsia hepática')}
                />
                <Input
                  id="procedureCode"
                  name="procedureCode"
                  data-testid="wizard-procedure-code"
                  className="w-full rounded-lg px-3 py-2"
                  label={t('wizard.fields.procedureCode', 'Código')}
                  value={procedureDraft.procedureCode}
                  onChange={handleProcedureDraftChange('procedureCode')}
                  placeholder={t('wizard.placeholders.procedureCode', 'Código institucional')}
                />
                <Input
                  id="procedurePerformed"
                  name="procedurePerformed"
                  data-testid="wizard-procedure-performed"
                  type="date"
                  className="w-full rounded-lg px-3 py-2"
                  label={t('wizard.fields.procedurePerformed', 'Data de realização')}
                  value={procedureDraft.performed}
                  onChange={handleProcedureDraftChange('performed')}
                />
                <Input
                  id="procedureBodySite"
                  name="procedureBodySite"
                  data-testid="wizard-procedure-body-site"
                  className="w-full rounded-lg px-3 py-2"
                  label={t('wizard.fields.procedureBodySite', 'Sítio anatômico')}
                  value={procedureDraft.bodySite}
                  onChange={handleProcedureDraftChange('bodySite')}
                  placeholder={t('wizard.placeholders.procedureBodySite', 'Ex.: Fígado')}
                />
              </div>
              <Button
                type="button"
                data-testid="wizard-add-procedure"
                variant="secondary"
                onClick={handleAddProcedure}
                disabled={!String(procedureDraft.procedureCode || '').trim() || !String(procedureDraft.performed || '').trim()}
              >
                {t('wizard.actions.addProcedure', 'Adicionar procedimento')}
              </Button>
              {Array.isArray(formData.procedures) && formData.procedures.length > 0 && (
                <ul className="procedure-list space-y-2" data-testid="wizard-procedure-list">
                  {formData.procedures.map((entry, index) => (
                    <li
                      key={`${entry.procedureCode}-${index}`}
                      data-testid={`wizard-procedure-item-${index}`}
                      className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2"
                    >
                      <span>
                        <span className="font-semibold text-gray-800">{entry.procedureName || entry.procedureCode}</span>
                        <span className="ml-2 text-sm text-gray-500">{entry.procedureCode}</span>
                        {entry.performed && <span className="ml-2 text-sm text-gray-500">· {entry.performed}</span>}
                        {entry.bodySite && <span className="ml-2 text-sm text-gray-500">({entry.bodySite})</span>}
                      </span>
                      <button
                        type="button"
                        data-testid={`wizard-remove-procedure-${index}`}
                        className="text-red-600 hover:text-red-800 text-sm"
                        onClick={() => handleRemoveProcedure(index)}
                      >
                        {t('wizard.actions.removeProcedure', 'Remover')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="clinical-subsection space-y-4" data-testid="wizard-observations-section">
              <div className="border-b border-gray-200 pb-3 section-title-block">
                <h4 className="text-xl font-bold text-gray-800">{t('wizard.sections.labObservations', 'Resultados Laboratoriais')}</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <Input
                  id="observationTestName"
                  name="observationTestName"
                  data-testid="wizard-observation-test-name"
                  className="w-full rounded-lg px-3 py-2"
                  label={t('wizard.fields.observationTestName', 'Exame')}
                  value={observationDraft.testName}
                  onChange={handleObservationDraftChange('testName')}
                  placeholder={t('wizard.placeholders.observationTestName', 'Ex.: Hemoglobina')}
                />
                <Input
                  id="observationLoinc"
                  name="observationLoinc"
                  data-testid="wizard-observation-loinc"
                  className="w-full rounded-lg px-3 py-2"
                  label={t('wizard.fields.observationLoinc', 'Código LOINC')}
                  value={observationDraft.loincCode}
                  onChange={handleObservationDraftChange('loincCode')}
                  placeholder={t('wizard.placeholders.observationLoinc', 'Ex.: 718-7')}
                />
                <Input
                  id="observationValue"
                  name="observationValue"
                  data-testid="wizard-observation-value"
                  className="w-full rounded-lg px-3 py-2"
                  label={t('wizard.fields.observationValue', 'Valor')}
                  value={observationDraft.value}
                  onChange={handleObservationDraftChange('value')}
                  placeholder={t('wizard.placeholders.observationValue', 'Ex.: 13.2')}
                />
                <Input
                  id="observationUnit"
                  name="observationUnit"
                  data-testid="wizard-observation-unit"
                  className="w-full rounded-lg px-3 py-2"
                  label={t('wizard.fields.observationUnit', 'Unidade')}
                  value={observationDraft.unit}
                  onChange={handleObservationDraftChange('unit')}
                  placeholder={t('wizard.placeholders.observationUnit', 'Ex.: g/dL')}
                />
                <Input
                  id="observationEffectiveDate"
                  name="observationEffectiveDate"
                  data-testid="wizard-observation-effective-date"
                  type="date"
                  className="w-full rounded-lg px-3 py-2"
                  label={t('wizard.fields.observationEffectiveDate', 'Data do resultado')}
                  value={observationDraft.effectiveDate}
                  onChange={handleObservationDraftChange('effectiveDate')}
                />
              </div>
              <Button
                type="button"
                data-testid="wizard-add-observation"
                variant="secondary"
                onClick={handleAddObservation}
                disabled={!String(observationDraft.loincCode || '').trim() || !String(observationDraft.effectiveDate || '').trim()}
              >
                {t('wizard.actions.addObservation', 'Adicionar resultado')}
              </Button>
              {Array.isArray(formData.observationRecords) && formData.observationRecords.length > 0 && (
                <ul className="observation-list space-y-2" data-testid="wizard-observation-list">
                  {formData.observationRecords.map((entry, index) => (
                    <li
                      key={`${entry.loincCode}-${index}`}
                      data-testid={`wizard-observation-item-${index}`}
                      className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2"
                    >
                      <span>
                        <span className="font-semibold text-gray-800">{entry.testName || entry.loincCode}</span>
                        <span className="ml-2 text-sm text-gray-500">{entry.loincCode}</span>
                        {entry.value && <span className="ml-2 text-sm text-gray-500">= {entry.value} {entry.unit}</span>}
                        {entry.effectiveDate && <span className="ml-2 text-sm text-gray-500">· {entry.effectiveDate}</span>}
                      </span>
                      <button
                        type="button"
                        data-testid={`wizard-remove-observation-${index}`}
                        className="text-red-600 hover:text-red-800 text-sm"
                        onClick={() => handleRemoveObservation(index)}
                      >
                        {t('wizard.actions.removeObservation', 'Remover')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="clinical-subsection space-y-4" data-testid="wizard-outcomes-section">
              <div className="border-b border-gray-200 pb-3 section-title-block">
                <h4 className="text-xl font-bold text-gray-800">{t('wizard.sections.clinicalOutcomes', 'Desfechos Longitudinais')}</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Select
                  id="outcomeType"
                  name="outcomeType"
                  data-testid="wizard-outcome-type"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  label={t('wizard.fields.outcomeType', 'Tipo de desfecho')}
                  value={outcomeDraft.outcomeType}
                  onChange={handleOutcomeDraftChange('outcomeType')}
                  options={[
                    { value: '', label: t('wizard.fields.selectOutcomeType', 'Selecione o tipo de desfecho') },
                    { value: 'progression', label: t('wizard.fields.outcomeProgression', 'Progressão') },
                    { value: 'remission', label: t('wizard.fields.outcomeRemission', 'Remissão') },
                    { value: 'relapse', label: t('wizard.fields.outcomeRelapse', 'Recidiva') },
                    { value: 'response', label: t('wizard.fields.outcomeResponse', 'Resposta') },
                    { value: 'toxicity', label: t('wizard.fields.outcomeToxicity', 'Toxicidade') },
                    { value: 'hospitalization', label: t('wizard.fields.outcomeHospitalization', 'Hospitalização') },
                    { value: 'death', label: t('wizard.fields.outcomeDeath', 'Óbito') },
                  ]}
                />
                <Input
                  id="outcomeDate"
                  name="outcomeDate"
                  data-testid="wizard-outcome-date"
                  type="date"
                  className="w-full rounded-lg px-3 py-2"
                  label={t('wizard.fields.outcomeDate', 'Data do desfecho')}
                  value={outcomeDraft.outcomeDate}
                  onChange={handleOutcomeDraftChange('outcomeDate')}
                />
              </div>
              <Button
                type="button"
                data-testid="wizard-add-outcome"
                variant="secondary"
                onClick={handleAddOutcome}
                disabled={!String(outcomeDraft.outcomeType || '').trim() || !String(outcomeDraft.outcomeDate || '').trim()}
              >
                {t('wizard.actions.addOutcome', 'Adicionar desfecho')}
              </Button>
              {Array.isArray(formData.clinicalOutcomes) && formData.clinicalOutcomes.length > 0 && (
                <ul className="outcome-list space-y-2" data-testid="wizard-outcome-list">
                  {formData.clinicalOutcomes.map((entry, index) => (
                    <li
                      key={`${entry.outcomeType}-${index}`}
                      data-testid={`wizard-outcome-item-${index}`}
                      className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2"
                    >
                      <span>
                        <span className="font-semibold text-gray-800">{entry.outcomeType}</span>
                        {entry.outcomeDate && <span className="ml-2 text-sm text-gray-500">· {entry.outcomeDate}</span>}
                      </span>
                      <button
                        type="button"
                        data-testid={`wizard-remove-outcome-${index}`}
                        className="text-red-600 hover:text-red-800 text-sm"
                        onClick={() => handleRemoveOutcome(index)}
                      >
                        {t('wizard.actions.removeOutcome', 'Remover')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="wizard-grid grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
              <Input className="w-full rounded-lg px-3 py-2" label={t('wizard.fields.bloodPressure', 'Pressão arterial')} helperText={t('wizard.helpers.bloodPressureNumbersOnly', 'Aceita somente números; o campo formata como 120/80.')} value={formData.bloodPressure} onChange={handleFieldChange('bloodPressure')} placeholder={t('wizard.placeholders.bloodPressure', 'Digite apenas números, ex.: 12080')} inputMode="numeric" pattern="[0-9/]*" maxLength={7} />
              <div className="wizard-span-2 md:col-span-2">
                <Textarea className="w-full rounded-lg border border-slate-400 bg-white px-3 py-2 shadow-sm" label={t('wizard.fields.clinicalNotes', 'Observações clínicas')} value={formData.clinicalObservations} onChange={handleFieldChange('clinicalObservations')} rows={4} placeholder={t('wizard.placeholders.clinicalNotes', 'Registre observações clínicas relevantes para a amostra.')} />
              </div>
            </div>

            {/* #713: comorbidity/risk-factor checklist -- formData already had
                a boolean field per item (and buildCharlsonConditions/
                buildSubmissionPayload's charlsonConditions mapping already
                had its own unit test, #522) but no checkbox ever rendered
                to let a user actually check one; charlsonConditions was
                therefore always empty from a real submission. This closes
                that gap so the real CCI algorithm (#713) has real input to
                score from a live submission, not just from a hand-built
                unit-test payload. */}
            <div className="clinical-subsection space-y-4" data-testid="wizard-comorbidities-section">
              <div className="border-b border-gray-200 pb-3 section-title-block">
                <h4 className="text-xl font-bold text-gray-800">{t('wizard.sections.comorbidities', 'Comorbidades e fatores de risco')}</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {clinicalComorbidityDefinitions.map((item) => {
                  const slug = getDictionarySlug(item);
                  if (!slug) return null;
                  return (
                    <label key={slug} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        data-testid={`wizard-comorbidity-${slug}`}
                        checked={Boolean(formData[slug])}
                        onChange={handleFieldChange(slug)}
                      />
                      {getDictionaryLabel(item)}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="clinical-subsection space-y-4" data-testid="wizard-dictionary-biomarkers-section">
              <div className="border-b border-gray-200 pb-3 section-title-block">
                <h4 className="text-xl font-bold text-gray-800">{t('wizard.sections.dictionaryBiomarkers', 'Biomarcadores do dicionário clínico')}</h4>
                <p className="mt-1 text-sm text-slate-500">{t('wizard.labels.dictionaryBiomarkersHelp', 'Painel clínico fixo do biobanco (sempre disponível). Informe valores numéricos quando houver resultado laboratorial.')}</p>
              </div>
              {biomarkerDefinitions.length === 0 ? (
                <div className="text-sm text-slate-500 suggestion-empty">{t('wizard.labels.noDictionaryBiomarkers', 'Nenhum biomarcador configurado no dicionário clínico.')}</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {biomarkerDefinitions.map((item) => {
                    const slug = getDictionarySlug(item);
                    if (!slug) return null;
                    return (
                      <Input
                        key={slug}
                        data-testid={`wizard-dictionary-biomarker-${slug}`}
                        className="w-full rounded-lg px-3 py-2"
                        type="text"
                        inputMode="decimal"
                        label={getDictionaryLabel(item)}
                        value={formData[slug] ?? ''}
                        onChange={handleFieldChange(slug)}
                        placeholder={t('wizard.placeholders.informValue', 'Informe o valor')}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            <div className="clinical-subsection space-y-4" data-testid="wizard-suggested-biomarkers-section">
              <div className="border-b border-gray-200 pb-3 section-title-block">
                <h4 className="text-xl font-bold text-gray-800">{t('wizard.sections.hpoPhenotypes', 'Fenótipos HPO sugeridos pela doença')}</h4>
                <p className="mt-1 text-sm text-slate-500">{t('wizard.labels.hpoPhenotypesHelp', 'Carregados de Neo4j ou terminologias locais após a seleção da doença ORPHA.')}</p>
              </div>
              {!hasSelectedDisease ? (
                <div className="text-sm text-slate-500 suggestion-empty">{t('wizard.labels.selectDiseaseForPhenotypes', 'Selecione uma doença para carregar fenótipos HPO sugeridos.')}</div>
              ) : loadingSuggest ? (
                <div className="text-sm text-slate-500 suggestion-empty">{t('wizard.status.loadingPhenotypes', 'Buscando fenótipos...')}</div>
              ) : suggestError ? (
                <div className="text-sm text-rose-600 suggestion-empty" data-testid="wizard-suggest-error-phenotypes">
                  <p>{t('wizard.labels.suggestError', 'Falha ao carregar sugestões semânticas. Você pode tentar novamente.')}</p>
                  <button
                    type="button"
                    className="mt-2 font-semibold text-cyan-700 underline"
                    data-testid="wizard-suggest-retry-phenotypes"
                    onClick={handleRetrySuggest}
                  >
                    {t('wizard.labels.retrySuggest', 'Tentar novamente')}
                  </button>
                </div>
              ) : diseasePhenotypeSuggestions.length === 0 ? (
                <div className="text-sm text-slate-500 suggestion-empty">{t('wizard.labels.noPhenotypes', 'Nenhum fenótipo HPO encontrado no grafo ou nas terminologias para esta doença.')}</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {diseasePhenotypeSuggestions.map((item) => (
                    <label
                      key={item.hpoId}
                      className="phenotype-card"
                    >
                      <input
                        type="checkbox"
                        checked
                        onChange={() => handleDiseasePhenotypeToggle(item)}
                      />
                      <span className="phenotype-card__content">
                        <span className="phenotype-card__label">{item.label}</span>
                        {item.hpoId && (
                          <span className="phenotype-card__code">
                            {item.version ? `HPO ${item.version} · ${item.hpoId}` : item.hpoId}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="clinical-subsection space-y-4" data-testid="wizard-disease-biomarkers-section">
              <div className="border-b border-gray-200 pb-3 section-title-block">
                <h4 className="text-xl font-bold text-gray-800">{t('wizard.sections.suggestedBiomarkers', 'Biomarcadores sugeridos pela doença')}</h4>
                <p className="mt-1 text-sm text-slate-500">{t('wizard.labels.suggestedBiomarkersHelp', 'Vêm do grafo Neo4j ou do catálogo Associações de Biomarcadores para a doença ORPHA selecionada.')}</p>
              </div>
              {!hasSelectedDisease ? (
                <div className="text-sm text-slate-500 suggestion-empty">{t('wizard.labels.selectDiseaseForBiomarkers', 'Selecione uma doença para carregar biomarcadores sugeridos.')}</div>
              ) : loadingSuggest ? (
                <div className="text-sm text-slate-500 suggestion-empty">{t('wizard.status.loadingBiomarkers', 'Buscando biomarcadores...')}</div>
              ) : suggestError ? (
                <div className="text-sm text-rose-600 suggestion-empty" data-testid="wizard-suggest-error-biomarkers">
                  <p>{t('wizard.labels.suggestError', 'Falha ao carregar sugestões semânticas. Você pode tentar novamente.')}</p>
                  <button
                    type="button"
                    className="mt-2 font-semibold text-cyan-700 underline"
                    data-testid="wizard-suggest-retry-biomarkers"
                    onClick={handleRetrySuggest}
                  >
                    {t('wizard.labels.retrySuggest', 'Tentar novamente')}
                  </button>
                </div>
              ) : diseaseBiomarkerSuggestions.length === 0 ? (
                <div className="text-sm text-slate-500 suggestion-empty">{t('wizard.labels.noBiomarkers', 'Nenhuma associação de biomarcador no grafo ou no catálogo para esta doença. Use os biomarcadores do dicionário clínico acima ou cadastre associações.')}</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 biomarker-card-grid">
                  {diseaseBiomarkerSuggestions.map((item, index) => {
                    const biomarkerKey = getDiseaseBiomarkerKey(item);
                    const highlightFabry = isFabryCase && /alpha|alfa|galactosidase|lyso|gb3/i.test(`${item.code} ${item.label}`);
                    const biomarkerValue = String(formData.biomarkers_values[biomarkerKey] ?? item.value).trim();
                    return (
                    <div key={item.code} className={`rounded-xl border p-4 biomarker-card ${highlightFabry ? 'border-cyan-300 bg-cyan-50 biomarker-card--fabry' : 'border-slate-200 bg-slate-50'}`}>
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-slate-800">{item.label}</div>
                          <div className="text-xs text-slate-500">{item.code || t('wizard.labels.noCode', 'sem código')} {item.unit ? `• ${item.unit}` : ''}</div>
                        </div>
                        {highlightFabry && <Microscope size={16} className="text-cyan-700" />}
                      </div>
                      <div className="space-y-2">
                        <Input
                          data-testid={`wizard-biomarker-value-${index}`}
                          className="w-full rounded-lg px-3 py-2"
                          type="number"
                          step="any"
                          label={t('wizard.fields.value', 'Valor')}
                          value={biomarkerValue}
                          onChange={(event) => handleDiseaseBiomarkerValueChange(item, event.target.value)}
                          placeholder={t('wizard.placeholders.informValue', 'Informe o valor')}
                        />
                        <p className="text-xs text-slate-600">{t('wizard.labels.autoDerivedFromDisease', 'Derivado automaticamente da doença selecionada em Orphadata.')}</p>
                      </div>
                    </div>
                  );})}
                </div>
              )}
            </div>

            <input type="hidden" value={formData.selectedConsentTemplateId} readOnly />
          </div>
        </Card>
      </div>
    );
  };

  return (
    <div className={`clinical-intake-wizard bg-gray-50 rounded-2xl p-4 md:p-6 ${className}`.trim()} data-testid="intake-wizard-root">
      <form onSubmit={handleSubmit}>
        <Card className="bg-white rounded-2xl shadow-lg border border-gray-100">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <h2 className="text-2xl font-bold text-gray-800" style={{ margin: 0 }} data-testid="wizard-title">{t('wizard.title', 'Cadastro Integrado')}</h2>
              <p className="text-sm font-semibold text-gray-700" style={{ margin: '0.35rem 0 0' }}>{stepMeta[activeStep].title}</p>
            </div>
            <div className="text-sm font-semibold text-gray-700">{t('wizard.stepProgress', 'Passo')} {activeStep + 1} {t('wizard.stepOf', 'de')} {stepMeta.length}</div>
          </div>
        </Card>

        {dictionariesLoading && (
          <Card className="bg-white rounded-2xl shadow-lg border border-gray-100" data-testid="wizard-loading-terminologies">
            <div className="text-sm font-semibold text-gray-700">{t('wizard.status.loadingTerminologies', 'Carregando terminologias internas...')}</div>
          </Card>
        )}
        {consentTemplatesLoading && (
          <Card className="bg-white rounded-2xl shadow-lg border border-gray-100" data-testid="wizard-loading-consent">
            <div className="text-sm font-semibold text-gray-700">{t('wizard.status.loadingConsent', 'Carregando TCLE ativo...')}</div>
          </Card>
        )}
        {/* #1222: demographic fill is safe only after both mount-time fetches settle;
            Chromium under Playwright can stall when fill races the in-flight bodies. */}
        {!dictionariesLoading && !consentTemplatesLoading && (
          <span data-testid="wizard-step1-ready" hidden aria-hidden="true" />
        )}
        {consentTemplatesError && !/Nenhum TCLE ativo/i.test(String(consentTemplatesError || '')) && <Card className="bg-white rounded-2xl shadow-lg border border-red-100"><div className="text-sm font-semibold text-red-600">{consentTemplatesError}</div></Card>}
        {collectionOptionsError && <Card className="bg-white rounded-2xl shadow-lg border border-red-100"><div className="text-sm font-semibold text-red-600">{collectionOptionsError}</div></Card>}
        {submitError && <Card className="bg-white rounded-2xl shadow-lg border border-red-100"><div className="text-sm font-semibold text-red-600">{submitError}</div></Card>}
        {sampleLabel && (
          <Card className="sample-label-card bg-white rounded-2xl shadow-lg border border-emerald-200">
            <div data-testid="sample-label">
              <div className="sample-label-header">
                <h3 className="sample-label-title">{t('wizard.sampleLabel.title', 'Etiqueta de Amostra')}</h3>
                <span className="sample-label-chip">SPREC {sampleLabel.sprecCode || 'N/A'}</span>
              </div>
              <div className="sample-label-body">
                <div className="sample-label-code" data-testid="sample-label-code">{sampleLabel.code}</div>
                <div className="sample-label-meta">
                  <span data-testid="sample-label-sample-id">{t('wizard.sampleLabel.sampleId', 'Amostra')}: {sampleLabel.specimenId || 'N/A'}</span>
                  <span data-testid="sample-label-type">{t('wizard.sampleLabel.type', 'Tipo')}: {sampleLabel.sampleType || 'N/A'}</span>
                  <span data-testid="sample-label-date">{t('wizard.sampleLabel.date', 'Data')}: {sampleLabel.collectionDate || 'N/A'}</span>
                  <span>{t('wizard.sampleLabel.location', 'Localização')}: {sampleLabel.storageAssignment?.positionCode || sampleLabel.storageLocation?.readable || sampleLabel.storageLocation?.position || 'N/A'}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" className="sample-label-print-button" data-testid="sample-label-print-button" onClick={handlePrintSampleLabel}>
                    {t('wizard.sampleLabel.openApiLabel', 'Abrir página de etiqueta')}
                  </Button>
                  <a className="inline-flex items-center rounded-lg border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-700" href={sampleLabel.specimenId ? `/samples/${encodeURIComponent(String(sampleLabel.specimenId))}/label` : '#'} target="_blank" rel="noreferrer">
                    {t('wizard.sampleLabel.viewLabelPage', 'Abrir etiqueta autenticada')}
                  </a>
                </div>
              </div>
            </div>
          </Card>
        )}
        {failedClinicalEntities.length > 0 && (
          <Card className="rounded-2xl border border-amber-200 bg-amber-50">
            <div data-testid="clinical-entities-warning">
              <div className="text-sm font-semibold text-amber-900">
                {t('wizard.clinicalEntitiesWarning.title', 'Alguns registros clínicos não foram salvos')}
                {(sampleLabel?.specimenId || sampleLabel?.code) ? ` — ${t('wizard.clinicalEntitiesWarning.specimen', 'Amostra')}: ${sampleLabel.specimenId || sampleLabel.code}` : ''}
              </div>
              <ul className="mt-2 text-sm text-amber-800 list-disc list-inside">
                {failedClinicalEntities.map((failure, index) => (
                  <li key={`${failure?.entity || 'entity'}-${index}`} data-testid="clinical-entities-warning-item">
                    {failure?.entity}{failure?.reference ? ` (${failure.reference})` : ''} {t('wizard.clinicalEntitiesWarning.notRecorded', 'não registrado')}
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        )}
        {formData.preAnalyticalUnknown && (
          <Card className="rounded-2xl border border-amber-200 bg-amber-50">
            <div className="text-sm font-semibold text-amber-900">
              Segurança de governança ativa: com processamento desconhecido, os eixos SPREC 3, 4, 5 e 6 permanecem em código X para manter rastreabilidade e auditoria.
            </div>
          </Card>
        )}

        {renderStepContent()}

        <Card className="bg-white rounded-2xl shadow-lg border border-gray-100">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
            <Button data-testid="wizard-back-button" className="rounded-lg px-6 py-2.5 font-medium transition-transform duration-200 active:scale-95 hover:shadow-md" type="button" variant="secondary" onClick={handleBack} disabled={activeStep === 0 || isSubmitting}>{t('common.back', 'Voltar')}</Button>
            {activeStep < stepMeta.length - 1 ? (
              <Button data-testid="wizard-next-button" className="rounded-lg px-6 py-2.5 font-medium transition-transform duration-200 active:scale-95 hover:shadow-md" type="button" onClick={handleNext} disabled={isSubmitting}>{t('common.next', 'Próximo')}</Button>
            ) : (
              <Button
                data-testid="wizard-submit-button"
                className="rounded-lg px-6 py-2.5 font-medium transition-transform duration-200 active:scale-95 hover:shadow-md"
                type="submit"
                onClick={() => console.log('[DEBUG] Botão clicado')}
                disabled={isSubmitting || consentTemplatesLoading || !selectedConsentTemplate}
              >
                {isSubmitting ? t('wizard.status.sending', 'Enviando...') : submitLabel}
              </Button>
            )}
          </div>
        </Card>
      </form>
    </div>
  );
}
