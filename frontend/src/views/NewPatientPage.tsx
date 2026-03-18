import { useState, useEffect, useMemo, useRef, CSSProperties } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import { ArrowLeft, HelpCircle } from 'lucide-react';
import { Patient, ConsentPermission, ConsentTemplate, ConsentPolicy, CidEntry, ClinicalUnit, PhoneCodeEntry } from '../types/models';
import { usePatients } from '../hooks/usePatients';
import { useClinicalUnits } from '../hooks/useClinicalUnits';
import { consentService, cidService, phoneCodeService } from '../services/api';
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
  },
  consentSelectionItemActive: {
    backgroundColor: 'var(--background)',
    borderRadius: '6px'
  },
  consentSelectionLabelText: {
    display: 'inline-block',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  consentSelectionFooter: {
    display: 'flex',
    justifyContent: 'flex-end'
  },
  consentSelectionToggleButton: {
    border: '1px solid var(--border)',
    borderRadius: '6px',
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    fontSize: '0.8rem',
    padding: '0.35rem 0.6rem',
    cursor: 'pointer'
  },
  consentAccordionToggle: {
    border: '1px solid var(--border)',
    borderRadius: '6px',
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    fontSize: '0.9rem',
    fontWeight: 600,
    padding: '0.6rem 0.75rem',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left'
  },
  inlineLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    marginBottom: '0.5rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: 'var(--text)'
  },
  tooltipButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: 'var(--text-light)',
    padding: 0
  },
  tooltipQuestionButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text-light)',
    cursor: 'pointer',
    fontSize: '0.75rem',
    fontWeight: 700,
    lineHeight: 1,
    padding: 0
  },
  tooltipBox: {
    marginTop: '0.4rem',
    padding: '0.6rem',
    borderRadius: '6px',
    backgroundColor: 'var(--background)',
    border: '1px solid var(--border)',
    color: 'var(--text-light)',
    fontSize: '0.8rem',
    lineHeight: 1.5
  },
  comboboxContainer: {
    position: 'relative'
  },
  comboboxList: {
    position: 'absolute',
    zIndex: 120,
    left: 0,
    right: 0,
    marginTop: '0.25rem',
    maxHeight: '220px',
    overflowY: 'auto',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    backgroundColor: 'var(--surface)',
    boxShadow: '0 8px 16px rgba(0,0,0,0.08)'
  },
  comboboxUl: {
    listStyle: 'none',
    margin: 0,
    padding: 0
  },
  comboboxItem: {
    width: '100%',
    border: 'none',
    background: 'transparent',
    textAlign: 'left',
    padding: '0.6rem 0.75rem',
    cursor: 'pointer',
    color: 'var(--text)',
    fontSize: '0.875rem'
  },
  comboboxInfoItem: {
    padding: '0.6rem 0.75rem',
    color: 'var(--text-light)',
    fontSize: '0.875rem'
  },
  comboboxHint: {
    marginTop: '0.4rem',
    color: 'var(--text-light)',
    fontSize: '0.78rem'
  },
  comboboxActionRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.5rem',
    marginTop: '0.4rem'
  },
  comboboxActionButton: {
    border: '1px solid var(--border)',
    borderRadius: '6px',
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    fontSize: '0.78rem',
    padding: '0.35rem 0.6rem',
    cursor: 'pointer'
  },
  clinicalFieldWithHelp: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem'
  }
};

const DEFAULT_PHONE_DIAL_CODE = '+55';
const DEFAULT_PHONE_CODE_ENTRY: PhoneCodeEntry = {
  countryName: 'Brasil',
  iso2: 'BR',
  dialCode: DEFAULT_PHONE_DIAL_CODE,
  searchLabel: `Brasil (${DEFAULT_PHONE_DIAL_CODE})`
};

const MAX_VISIBLE_TCLE_OPTIONS = 6;

export default function NewPatientPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language } = useLanguage();
  const { createPatient, updatePatient, loadPatients } = usePatients();
  const {
    clinicalUnits,
    loading: clinicalUnitsLoading,
    creating: creatingClinicalUnit,
    searchClinicalUnits,
    createClinicalUnit,
  } = useClinicalUnits();
  
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

  const normalizePhoneDigits = (value: string): string => {
    return value.replace(/\D/g, '').slice(0, 15);
  };

  const getInitialPhoneParts = (rawPhone?: string) => {
    const digits = normalizePhoneDigits(String(rawPhone || ''));

    if (digits.length >= 12 && digits.startsWith('55')) {
      return {
        countryCode: '+55',
        localPhone: digits.slice(2)
      };
    }

    return {
      countryCode: DEFAULT_PHONE_DIAL_CODE,
      localPhone: digits,
    };
  };

  const initialPhoneParts = getInitialPhoneParts(editingPatient?.phone);

  const applyBirthDateMask = (value: string): string => {
    const digits = value.replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  };

  const applyIsoBirthDateMask = (value: string): string => {
    const digits = value.replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 4) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
  };

  const normalizeBirthDateInput = (value: string): string => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    // Keep frontend behavior for DD/MM and allow backend ISO format as well.
    if (raw.includes('-')) {
      return applyIsoBirthDateMask(raw);
    }

    if (raw.includes('/')) {
      return applyBirthDateMask(raw);
    }

    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 4) {
      const yearCandidate = Number(digits.slice(0, 4));
      if (yearCandidate >= 1900 && yearCandidate <= 2100) {
        return applyIsoBirthDateMask(digits);
      }
    }

    return applyBirthDateMask(digits);
  };

  const isValidBirthDate = (value: string): boolean => {
    const normalized = String(value || '').trim();
    if (!normalized) return false;

    if (/^\d{2}\/\d{2}\/\d{4}$/.test(normalized)) {
      const [dayStr, monthStr, yearStr] = normalized.split('/');
      const day = Number(dayStr);
      const month = Number(monthStr);
      const year = Number(yearStr);
      const date = new Date(year, month - 1, day);
      return (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
      );
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      const [yearStr, monthStr, dayStr] = normalized.split('-');
      const day = Number(dayStr);
      const month = Number(monthStr);
      const year = Number(yearStr);
      const date = new Date(year, month - 1, day);
      return (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
      );
    }

    return false;
  };

  const normalizeAcronym = (value: string): string => {
    return value.replace(/\s+/g, '').slice(0, 6).toUpperCase();
  };

  const normalizeClinicalUnitInput = (value: string): string => {
    const normalized = String(value || '')
      .toUpperCase()
      .replace(/[^A-ZÀ-ÖØ-Ý0-9\s-]/g, '')
      .replace(/\s+/g, ' ')
      .trimStart();
    return normalized;
  };

  const normalizeClinicalUnitKey = (value: string): string => {
    return String(value || '')
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
  };

  const generateUnitAcronym = (clinicalUnitValue: string): string => {
    const normalized = String(clinicalUnitValue || '')
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
    if (!normalized) return '';

    const stopWords = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'OF', 'THE', 'DEL', 'LA', 'EL', 'Y']);
    const words = normalized.split(/\s+/).filter(Boolean);
    const relevantWords = words.filter((word) => !stopWords.has(word));
    const source = relevantWords.length > 0 ? relevantWords : words;
    return normalizeAcronym(source.map((word) => word[0]).join(''));
  };

  const getPhoneMaxDigitsByCountry = (countryCode: string): number => {
    const normalizedCode = String(countryCode || '').trim();
    if (normalizedCode === '+55') return 11;
    if (normalizedCode === '+1') return 10;
    if (normalizedCode === '+54') return 10;
    if (normalizedCode === '+56') return 9;
    if (normalizedCode === '+52') return 10;
    return 12;
  };

  const maskLocalPhoneByCountry = (countryCode: string, value: string): string => {
    const digits = normalizePhoneDigits(value).slice(0, getPhoneMaxDigitsByCountry(countryCode));

    if (countryCode === '+55') {
      if (digits.length <= 2) return digits;
      if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
      if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    }

    if (countryCode === '+1') {
      if (digits.length <= 3) return digits;
      if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }

    if (countryCode === '+54') {
      if (digits.length <= 2) return digits;
      if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    }

    if (digits.length <= 4) return digits;
    if (digits.length <= 8) return `${digits.slice(0, 4)} ${digits.slice(4)}`;
    return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`;
  };

  const getPhonePlaceholderByCountry = (countryCode: string): string => {
    if (countryCode === '+55') return '(11) 99999-9999';
    if (countryCode === '+1') return '(555) 123-4567';
    if (countryCode === '+54') return '(11) 1234-5678';
    if (countryCode === '+56') return '91234 5678';
    if (countryCode === '+52') return '5512345678';
    return '1234 5678 9012';
  };

  const getPreferredCidCode = (cid?: Partial<CidEntry> | null): string => {
    if (!cid) return '';
    return String(cid.Codigos_CID10 || cid.Codigo_Tabulacao || '').trim();
  };

  const initialCidReference: any = (() => {
    const reference = editingPatient?.icdReference;
    if (!reference) return null;

    const code = String(reference.Codigo_Tabulacao || '').trim();
    const cid10 = String(reference.Codigos_CID10 || '').trim();
    const description = String(reference.Descricao || '').trim();

    if (!code && !cid10 && !description) {
      return null;
    }

    return {
      _id: reference.cidId,
      Codigo_Tabulacao: code,
      Codigos_CID10: cid10 || code,
      Descricao: description || String(editingPatient?.icdCode || ''),
      Capitulo: null
    };
  })();

  const [formData, setFormData] = useState<Partial<Patient>>({
    patientName: editingPatient?.patientName || '',
    email: editingPatient?.email || '',
    phone: initialPhoneParts.localPhone || '',
    birthDate: editingPatient?.birthDate ? formatDate(editingPatient.birthDate) : '',
    sex: editingPatient?.sex ? convertSexFromBackend(editingPatient.sex) : t('patients.sexMale'),
    weight: editingPatient?.weight || undefined,
    heightCm: editingPatient?.heightCm || undefined,
    recordNumber: editingPatient?.recordNumber || undefined,
    clinicalUnitId: editingPatient?.clinicalUnitId ? String(editingPatient.clinicalUnitId) : undefined,
    clinicalUnit: editingPatient?.clinicalUnit || '',
    unitAcronym: editingPatient?.unitAcronym || generateUnitAcronym(String(editingPatient?.clinicalUnit || '')),
    isDeceased: Boolean(editingPatient?.isDeceased),
    representativeName: editingPatient?.representativeName || '',
    representativeCpf: editingPatient?.representativeCpf || '',
    representativePhone: editingPatient?.representativePhone || '',
    diagnosticHypothesis: editingPatient?.diagnosticHypothesis || '',
    icdCode: getPreferredCidCode(initialCidReference) || editingPatient?.icdCode || '',
    icdReference: editingPatient?.icdReference || null,
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
  const [consentTemplate, setConsentTemplate] = useState<ConsentTemplate | null>(null);
  const [consentPolicies, setConsentPolicies] = useState<ConsentPolicy[]>([]);
  const [selectedConsentTemplateId, setSelectedConsentTemplateId] = useState<string>(editingPatient?.consentTemplateId || '');
  const [consentTemplateSearch, setConsentTemplateSearch] = useState('');
  const [isConsentSelectionOpen, setIsConsentSelectionOpen] = useState(false);
  const [showAllConsentTemplates, setShowAllConsentTemplates] = useState(false);
  const [consentLoading, setConsentLoading] = useState(false);
  const [selectedPhoneCountryCode, setSelectedPhoneCountryCode] = useState<string>(initialPhoneParts.countryCode);
  const [phoneCodeSearchTerm, setPhoneCodeSearchTerm] = useState<string>(initialPhoneParts.countryCode || DEFAULT_PHONE_DIAL_CODE);
  const [phoneCodeResults, setPhoneCodeResults] = useState<PhoneCodeEntry[]>([DEFAULT_PHONE_CODE_ENTRY]);
  const [phoneCodeLoading, setPhoneCodeLoading] = useState(false);
  const [phoneCodeDropdownOpen, setPhoneCodeDropdownOpen] = useState(false);
  const [selectedPhoneCodeEntry, setSelectedPhoneCodeEntry] = useState<PhoneCodeEntry | null>(null);
  const [showVariantTooltip, setShowVariantTooltip] = useState(false);
  const [showAlphaGalTooltip, setShowAlphaGalTooltip] = useState(false);
  const [showLysoGb3Tooltip, setShowLysoGb3Tooltip] = useState(false);
  const [showBirthDateTooltip, setShowBirthDateTooltip] = useState(false);
  const [isSavingPatient, setIsSavingPatient] = useState(false);
  const [clinicalUnitSearchTerm, setClinicalUnitSearchTerm] = useState<string>(String(editingPatient?.clinicalUnit || ''));
  const [clinicalUnitDropdownOpen, setClinicalUnitDropdownOpen] = useState(false);
  const [selectedClinicalUnit, setSelectedClinicalUnit] = useState<ClinicalUnit | null>(() => {
    const clinicalUnitName = String(editingPatient?.clinicalUnit || '').trim();
    const clinicalUnitId = String((editingPatient as any)?.clinicalUnitId || '').trim();
    if (!clinicalUnitName) return null;
    return {
      _id: clinicalUnitId || undefined,
      name: clinicalUnitName,
      acronym: String(editingPatient?.unitAcronym || '').trim() || undefined
    };
  });
  const [cidSearchTerm, setCidSearchTerm] = useState<string>(() => {
    if (initialCidReference) {
      const code = getPreferredCidCode(initialCidReference);
      const description = String(initialCidReference.Descricao || '').trim();
      return description ? `${code} - ${description}` : code;
    }
    return String(editingPatient?.icdCode || '');
  });
  const [cidResults, setCidResults] = useState<CidEntry[]>([]);
  const [cidLoading, setCidLoading] = useState(false);
  const [cidDropdownOpen, setCidDropdownOpen] = useState(false);
  const [selectedCid, setSelectedCid] = useState<CidEntry | null>(initialCidReference);
  const clinicalUnitComboboxRef = useRef<HTMLDivElement | null>(null);
  const cidComboboxRef = useRef<HTMLDivElement | null>(null);
  const phoneCodeComboboxRef = useRef<HTMLDivElement | null>(null);
  const [selectedConsentTemplateIds, setSelectedConsentTemplateIds] = useState<string[]>(
    editingPatient?.consentTemplateId ? [String(editingPatient.consentTemplateId)] : []
  );

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

  const parseBirthDateToDate = (dateStr: string): Date | null => {
    if (!dateStr) return null;

    const normalized = String(dateStr).trim();
    const brMatch = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brMatch) {
      const day = parseInt(brMatch[1], 10);
      const month = parseInt(brMatch[2], 10) - 1;
      const year = parseInt(brMatch[3], 10);
      const parsed = new Date(year, month, day);
      if (
        parsed.getFullYear() === year &&
        parsed.getMonth() === month &&
        parsed.getDate() === day
      ) {
        return parsed;
      }
      return null;
    }

    const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const year = parseInt(isoMatch[1], 10);
      const month = parseInt(isoMatch[2], 10) - 1;
      const day = parseInt(isoMatch[3], 10);
      const parsed = new Date(year, month, day);
      if (
        parsed.getFullYear() === year &&
        parsed.getMonth() === month &&
        parsed.getDate() === day
      ) {
        return parsed;
      }
      return null;
    }

    return null;
  };

  const normalizePhone = (value: string): string => {
    return normalizePhoneDigits(value);
  };

  const normalizePhoneCodeEntry = (entry: Partial<PhoneCodeEntry>): PhoneCodeEntry => {
    const dialDigits = normalizePhone(String(entry.dialCode || ''));
    const dialCode = dialDigits ? `+${dialDigits}` : '';
    const countryName = String(entry.countryName || '').trim() || 'País';
    const iso2 = String(entry.iso2 || '').trim().toUpperCase() || null;

    return {
      _id: entry._id,
      countryName,
      iso2,
      dialCode,
      searchLabel: `${countryName}${dialCode ? ` (${dialCode})` : ''}`.trim()
    };
  };

  const handleSelectPhoneCode = (entry: PhoneCodeEntry) => {
    const normalizedEntry = normalizePhoneCodeEntry(entry);
    if (!normalizedEntry.dialCode) return;

    setSelectedPhoneCodeEntry(normalizedEntry);
    setSelectedPhoneCountryCode(normalizedEntry.dialCode);
    setPhoneCodeSearchTerm(normalizedEntry.searchLabel || normalizedEntry.dialCode);
    setPhoneCodeDropdownOpen(false);
    setFormData((prev) => ({
      ...prev,
      phone: normalizePhoneDigits(String(prev.phone || '')).slice(0, getPhoneMaxDigitsByCountry(normalizedEntry.dialCode))
    }));
  };

  const getCidDisplayLabel = (cid: Partial<CidEntry>): string => {
    const code = getPreferredCidCode(cid);
    const description = String(cid.Descricao || '').trim();
    return description ? `${code} - ${description}` : code;
  };

  const handleSelectCid = (cid: CidEntry) => {
    const selectedCode = getPreferredCidCode(cid);
    setSelectedCid(cid);
    setCidSearchTerm(getCidDisplayLabel(cid));
    setCidDropdownOpen(false);
    setFormData((prev) => ({
      ...prev,
      icdCode: selectedCode,
      icdReference: {
        cidId: String(cid._id || ''),
        Codigo_Tabulacao: String(cid.Codigo_Tabulacao || ''),
        Codigos_CID10: String(cid.Codigos_CID10 || cid.Codigo_Tabulacao || ''),
        Descricao: String(cid.Descricao || '')
      }
    }));
  };

  const handleSelectClinicalUnit = (unit: ClinicalUnit) => {
    const unitName = String(unit.name || '').trim();
    const unitId = String(unit._id || '').trim();
    const unitAcronym = String(unit.acronym || '').trim() || generateUnitAcronym(unitName);

    setSelectedClinicalUnit(unit);
    setClinicalUnitSearchTerm(unitName);
    setClinicalUnitDropdownOpen(false);
    setFormData((prev) => ({
      ...prev,
      clinicalUnitId: unitId || undefined,
      clinicalUnit: unitName,
      unitAcronym: unitAcronym || undefined
    }));
  };

  const handleCreateClinicalUnit = async () => {
    const typedName = normalizeClinicalUnitInput(clinicalUnitSearchTerm).trim();
    if (typedName.length < 3) {
      alert(t('patients.clinicalUnitMinLength'));
      return;
    }

    const existingMatch = clinicalUnits.find((unit) =>
      normalizeClinicalUnitKey(unit.name) === normalizeClinicalUnitKey(typedName)
    );

    if (existingMatch) {
      handleSelectClinicalUnit(existingMatch);
      return;
    }

    try {
      const created = await createClinicalUnit(typedName);
      if (!created) {
        alert(t('patients.clinicalUnitCreateError'));
        return;
      }

      handleSelectClinicalUnit(created);
    } catch (error: any) {
      alert(error?.message || t('patients.clinicalUnitCreateError'));
    }
  };

  const handleToggleConsentTemplate = (policyId: string) => {
    setSelectedConsentTemplateId(policyId);
    setSelectedConsentTemplateIds([policyId]);
  };

  const normalizeCpf = (value: string): string => {
    return value.replace(/\D/g, '').slice(0, 11);
  };

  const isValidEmail = (email?: string): boolean => {
    if (!email) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  };

  const isValidPhone = (phone?: string, countryCode?: string): boolean => {
    if (!phone) return true;
    const localDigits = normalizePhone(phone);
    const dialDigits = normalizePhone(String(countryCode || ''));
    const fullDigits = `${dialDigits}${localDigits}`;
    return fullDigits.length >= 10 && fullDigits.length <= 15;
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

  const loadConsentTemplate = async () => {
    setConsentLoading(true);
    try {
      const response = await consentService.getAllPolicies();
      const policies = response.data?.data || [];
      const normalizedPolicies = (Array.isArray(policies) ? policies : [])
        .sort((a: ConsentPolicy, b: ConsentPolicy) => {
          const dateA = new Date(String(a.createdAt || a.validFrom || 0)).getTime();
          const dateB = new Date(String(b.createdAt || b.validFrom || 0)).getTime();
          return dateB - dateA;
        });
      setConsentPolicies(normalizedPolicies);

      const selectedPolicy = normalizedPolicies.find((policy: ConsentPolicy) => String(policy._id) === String(selectedConsentTemplateId));
      const template = selectedPolicy ? normalizePolicyToTemplate(selectedPolicy) : null;
      setConsentTemplate(template);
    } catch (err: any) {
      // Keep consent selection available even if template list fails to load.
    } finally {
      setConsentLoading(false);
    }
  };

  useEffect(() => {
    loadConsentTemplate();
  }, [selectedConsentTemplateId]);

  useEffect(() => {
    if (!selectedConsentTemplateId) {
      setFormData((prev) => ({ ...prev, linkedProject: '' }));
      return;
    }

    const selectedPolicy = consentPolicies.find((policy) => String(policy._id) === String(selectedConsentTemplateId));
    if (!selectedPolicy) return;

    const linkedProjectLabel = `${selectedPolicy.title} (CAAE: ${selectedPolicy.caae || '--'})`;
    setFormData((prev) => ({ ...prev, linkedProject: linkedProjectLabel }));
  }, [selectedConsentTemplateId, consentPolicies]);

  useEffect(() => {
    if (!selectedConsentTemplateId) {
      setSelectedConsentTemplateIds([]);
      return;
    }
    setSelectedConsentTemplateIds([selectedConsentTemplateId]);
  }, [selectedConsentTemplateId]);

  useEffect(() => {
    if (!clinicalUnitDropdownOpen) {
      return;
    }

    const rawTerm = String(clinicalUnitSearchTerm || '').trim();

    const debounce = setTimeout(async () => {
      await searchClinicalUnits(rawTerm, 10);
    }, 300);

    return () => clearTimeout(debounce);
  }, [clinicalUnitSearchTerm, clinicalUnitDropdownOpen, searchClinicalUnits]);

  useEffect(() => {
    if (!cidDropdownOpen) {
      setCidLoading(false);
      return;
    }

    const rawTerm = String(cidSearchTerm || '').trim();
    if (rawTerm.length > 0 && rawTerm.length < 2) {
      setCidResults([]);
      setCidLoading(false);
      return;
    }

    const debounce = setTimeout(async () => {
      setCidLoading(true);
      try {
        const response = await cidService.search(rawTerm, 10);
        const items = Array.isArray(response.data?.data) ? response.data.data : [];
        setCidResults(items);
      } catch {
        setCidResults([]);
      } finally {
        setCidLoading(false);
      }
    }, 300);

    return () => clearTimeout(debounce);
  }, [cidSearchTerm, cidDropdownOpen]);

  useEffect(() => {
    if (!phoneCodeDropdownOpen) {
      setPhoneCodeLoading(false);
      return;
    }

    const rawTerm = String(phoneCodeSearchTerm || '').trim();
    const debounce = setTimeout(async () => {
      setPhoneCodeLoading(true);
      try {
        const response = await phoneCodeService.search(rawTerm, 20);
        const items = Array.isArray(response.data?.data)
          ? response.data.data.map((item) => normalizePhoneCodeEntry(item)).filter((item) => item.dialCode)
          : [];

        setPhoneCodeResults(items.length > 0 ? items : [DEFAULT_PHONE_CODE_ENTRY]);

        if (!selectedPhoneCodeEntry) {
          const matched = items.find((item) => item.dialCode === selectedPhoneCountryCode);
          if (matched) {
            setSelectedPhoneCodeEntry(matched);
            setPhoneCodeSearchTerm(matched.searchLabel || matched.dialCode);
          }
        }
      } catch {
        setPhoneCodeResults([DEFAULT_PHONE_CODE_ENTRY]);
      } finally {
        setPhoneCodeLoading(false);
      }
    }, 250);

    return () => clearTimeout(debounce);
  }, [phoneCodeSearchTerm, phoneCodeDropdownOpen, selectedPhoneCountryCode, selectedPhoneCodeEntry]);

  useEffect(() => {
    const preload = async () => {
      const storedPhoneDigits = normalizePhone(String(editingPatient?.phone || ''));
      try {
        const response = await phoneCodeService.search('', 50);
        const items = Array.isArray(response.data?.data)
          ? response.data.data.map((item) => normalizePhoneCodeEntry(item)).filter((item) => item.dialCode)
          : [];

        if (items.length > 0) {
          const matchedByStoredPhone = storedPhoneDigits
            ? [...items]
              .sort((a, b) => normalizePhone(b.dialCode).length - normalizePhone(a.dialCode).length)
              .find((item) => {
                const dialDigits = normalizePhone(item.dialCode);
                return dialDigits.length > 0 && storedPhoneDigits.startsWith(dialDigits) && storedPhoneDigits.length > dialDigits.length;
              })
            : null;

          const matched = matchedByStoredPhone || items.find((item) => item.dialCode === selectedPhoneCountryCode) || items[0];
          setPhoneCodeResults(items);
          setSelectedPhoneCodeEntry(matched);
          setSelectedPhoneCountryCode(matched.dialCode || DEFAULT_PHONE_DIAL_CODE);
          setPhoneCodeSearchTerm(matched.searchLabel || matched.dialCode);
          return;
        }
      } catch {
      }

      setPhoneCodeResults([DEFAULT_PHONE_CODE_ENTRY]);
      setSelectedPhoneCodeEntry(DEFAULT_PHONE_CODE_ENTRY);
      setPhoneCodeSearchTerm(DEFAULT_PHONE_CODE_ENTRY.searchLabel || DEFAULT_PHONE_DIAL_CODE);
    };

    void preload();
  }, [editingPatient?.phone]);

  useEffect(() => {
    const handleDocumentMouseDown = (event: MouseEvent) => {
      if (clinicalUnitComboboxRef.current && !clinicalUnitComboboxRef.current.contains(event.target as Node)) {
        setClinicalUnitDropdownOpen(false);
      }
      if (cidComboboxRef.current && !cidComboboxRef.current.contains(event.target as Node)) {
        setCidDropdownOpen(false);
      }
      if (phoneCodeComboboxRef.current && !phoneCodeComboboxRef.current.contains(event.target as Node)) {
        setPhoneCodeDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, []);

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

  const shouldCollapseConsentTemplates =
    consentTemplateSearch.trim().length === 0 &&
    filteredConsentPolicies.length > MAX_VISIBLE_TCLE_OPTIONS;

  const visibleConsentPolicies = useMemo(() => {
    if (shouldCollapseConsentTemplates && !showAllConsentTemplates) {
      return filteredConsentPolicies.slice(0, MAX_VISIBLE_TCLE_OPTIONS);
    }
    return filteredConsentPolicies;
  }, [filteredConsentPolicies, shouldCollapseConsentTemplates, showAllConsentTemplates]);

  useEffect(() => {
    setShowAllConsentTemplates(false);
  }, [consentTemplateSearch]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    // Prevent duplicate submits that can trigger backend conflict (409).
    if (isSavingPatient) {
      return;
    }

    setIsSavingPatient(true);

    try {

    let resolvedClinicalUnitId = String(formData.clinicalUnitId || '').trim();
    let resolvedClinicalUnitName = String(formData.clinicalUnit || '').trim();

    if (resolvedClinicalUnitName && !resolvedClinicalUnitId) {
      try {
        const createdClinicalUnit = await createClinicalUnit(resolvedClinicalUnitName);
        if (createdClinicalUnit?._id) {
          resolvedClinicalUnitId = String(createdClinicalUnit._id);
          resolvedClinicalUnitName = String(createdClinicalUnit.name || '').trim() || resolvedClinicalUnitName;
          setSelectedClinicalUnit(createdClinicalUnit);
          setClinicalUnitSearchTerm(resolvedClinicalUnitName);
          setFormData((prev) => ({
            ...prev,
            clinicalUnitId: resolvedClinicalUnitId,
            clinicalUnit: resolvedClinicalUnitName,
            unitAcronym: String(createdClinicalUnit.acronym || '').trim() || generateUnitAcronym(resolvedClinicalUnitName)
          }));
        }
      } catch (error: any) {
        alert(error?.message || t('patients.clinicalUnitCreateError'));
        return;
      }
    }

    if (resolvedClinicalUnitName && resolvedClinicalUnitName.length < 3) {
      alert(t('patients.clinicalUnitMinLength'));
      return;
    }
    
    if (!formData.email || !isValidEmail(formData.email)) {
      alert(t('patients.invalidEmail'));
      return;
    }

    if (!formData.birthDate || !isValidBirthDate(String(formData.birthDate))) {
      alert(t('patients.invalidBirthDate'));
      return;
    }

    if (!isValidPhone(String(formData.phone || ''), selectedPhoneCountryCode)) {
      alert(t('patients.invalidPhone'));
      return;
    }

    const primaryConsentTemplateId = selectedConsentTemplateId || selectedConsentTemplateIds[0] || '';

    if (!primaryConsentTemplateId) {
      alert(t('patients.consentTemplateRequired'));
      return;
    }

    if (formData.isDeceased) {
      const representativeName = String(formData.representativeName || '').trim();
      const representativeCpf = normalizeCpf(String(formData.representativeCpf || ''));
      const representativePhone = normalizePhone(String(formData.representativePhone || ''));

      if (!representativeName || representativeCpf.length !== 11 || representativePhone.length < 10) {
        alert(t('patients.deceasedRepresentativeRequired'));
        return;
      }
    }

    // Remove patientID se fornecido - será gerado automaticamente pelo backend
    const dataToSave: any = { ...formData };
    delete dataToSave.patientID;
    dataToSave.email = String(formData.email || '').trim().toLowerCase();
    dataToSave.clinicalUnitId = resolvedClinicalUnitId || null;
    dataToSave.clinicalUnit = resolvedClinicalUnitName || null;
    dataToSave.unitAcronym = dataToSave.clinicalUnit
      ? generateUnitAcronym(dataToSave.clinicalUnit)
      : null;
    const localPhoneDigits = normalizePhone(String(formData.phone || ''));
    const dialCodeDigits = normalizePhone(selectedPhoneCountryCode);
    dataToSave.phone = localPhoneDigits ? `${dialCodeDigits}${localPhoneDigits}` : null;
    if (primaryConsentTemplateId) {
      dataToSave.consentTemplateId = primaryConsentTemplateId;
      const selectedPolicy = consentPolicies.find((policy) => String(policy._id) === String(primaryConsentTemplateId));
      dataToSave.linkedProject = selectedPolicy
        ? `${selectedPolicy.title} (CAAE: ${selectedPolicy.caae || '--'})`
        : dataToSave.linkedProject;
    }

    dataToSave.icdCode = String(formData.icdCode || '').trim() || null;
    dataToSave.icdReference = dataToSave.icdCode ? (formData.icdReference || null) : null;

    dataToSave.isDeceased = Boolean(formData.isDeceased);
    dataToSave.representativeName = dataToSave.isDeceased ? String(formData.representativeName || '').trim() : null;
    dataToSave.representativeCpf = dataToSave.isDeceased ? normalizeCpf(String(formData.representativeCpf || '')) : null;
    dataToSave.representativePhone = dataToSave.isDeceased ? normalizePhone(String(formData.representativePhone || '')) : null;
    
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
      const date = parseBirthDateToDate(dataToSave.birthDate);
      if (date) {
        dataToSave.birthDate = date.toISOString();
      }
    }

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

        navigate(`/patients/${createdPatientID}/consent`, {
          state: {
            patientName: String(formData.patientName || ''),
            linkedProject: `${selectedPolicy.title} (CAAE: ${selectedPolicy.caae || '--'})`,
            selectedConsentTemplateId: String(selectedPolicy._id),
            fromPatientCreation: true
          }
        });
        alert(t('patients.createSuccess'));
        return;
      } else {
        alert(t('patients.patientIdResolveError'));
      }
    }
    
    // Recarrega a lista e volta para a página de pacientes
    await loadPatients();
    if (editingPatient) {
      navigate('/patients');
    }
  } catch (err: any) {
    const statusCode = Number(err?.response?.status || 0);
    const backendMessage = err?.response?.data?.error || err?.response?.data?.message || err?.message || '';
    const isConflict = statusCode === 409 || /duplicad|ja cadastrado|já cadastrado|already exists|conflict/i.test(String(backendMessage));

    const friendlyConflictMessage =
      language === 'en-US'
        ? 'Patient already registered. Check if there is an existing patient with the same identifiers (ID, record, CPF) or same name and birth date.'
        : language === 'es-ES'
          ? 'Paciente ya registrado. Verifique si ya existe un paciente con los mismos identificadores (ID, historia clínica, CPF) o el mismo nombre y fecha de nacimiento.'
          : 'Paciente já cadastrado. Verifique se já existe um paciente com os mesmos identificadores (ID, prontuário, CPF) ou com o mesmo nome e data de nascimento.';

    alert(isConflict ? friendlyConflictMessage : (backendMessage || t('patients.saveError')));
  } finally {
    setIsSavingPatient(false);
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
            gap: '1rem',
            alignItems: 'start'
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
            
            <div style={styles.clinicalFieldWithHelp}>
              <label style={styles.inlineLabel}>
                <span>{`${t('patients.birthDate')} *`}</span>
                <button
                  type="button"
                  style={styles.tooltipQuestionButton}
                  aria-label={
                    language === 'en-US'
                      ? 'Show accepted date formats'
                      : language === 'es-ES'
                        ? 'Mostrar formatos de fecha aceptados'
                        : 'Mostrar formatos de data aceitos'
                  }
                  title={
                    language === 'en-US'
                      ? 'Accepted date formats'
                      : language === 'es-ES'
                        ? 'Formatos de fecha aceptados'
                        : 'Formatos de data aceitos'
                  }
                  onClick={() => setShowBirthDateTooltip((prev) => !prev)}
                >
                  ?
                </button>
              </label>
              <Input
                type="text"
                placeholder={
                  language === 'en-US'
                    ? 'DD/MM/YYYY or YYYY-MM-DD'
                    : language === 'es-ES'
                      ? 'DD/MM/AAAA o AAAA-MM-DD'
                      : 'DD/MM/AAAA ou AAAA-MM-DD'
                }
                value={formData.birthDate || ''}
                onChange={(e) => setFormData({ ...formData, birthDate: normalizeBirthDateInput(e.target.value) })}
                inputMode="numeric"
                maxLength={10}
                required
              />
              {showBirthDateTooltip && (
                <div style={styles.tooltipBox}>
                  {language === 'en-US'
                    ? 'Accepted formats: DD/MM/YYYY (e.g., 31/12/1990) or YYYY-MM-DD (e.g., 1990-12-31).'
                    : language === 'es-ES'
                      ? 'Formatos aceptados: DD/MM/AAAA (ej.: 31/12/1990) o AAAA-MM-DD (ej.: 1990-12-31).'
                      : 'Formatos aceitos: DD/MM/AAAA (ex.: 31/12/1990) ou AAAA-MM-DD (ex.: 1990-12-31).'}
                </div>
              )}
            </div>
            
            <div ref={phoneCodeComboboxRef} style={styles.comboboxContainer}>
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

            <div>
              <label style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontSize: '0.875rem',
                fontWeight: 500,
                color: 'var(--text)'
              }}>
                {t('patients.phone')}
              </label>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '150px 1fr',
                gap: '0.5rem'
              }}>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={phoneCodeSearchTerm}
                    onFocus={() => setPhoneCodeDropdownOpen(true)}
                    onChange={(e) => {
                      setPhoneCodeSearchTerm(e.target.value);
                      setPhoneCodeDropdownOpen(true);
                    }}
                    placeholder={t('patients.phoneCodeSearchPlaceholder')}
                    title={t('patients.phoneCountryCode')}
                    aria-label={t('patients.phoneCountryCode')}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      fontSize: '0.875rem',
                      backgroundColor: 'var(--surface)',
                      color: 'var(--text)'
                    }}
                  />
                  {phoneCodeDropdownOpen && (
                    <div style={styles.comboboxList}>
                      <ul style={styles.comboboxUl}>
                        {phoneCodeLoading ? (
                          <li style={styles.comboboxInfoItem}>{t('patients.phoneCodeLoading')}</li>
                        ) : phoneCodeResults.length > 0 ? (
                          phoneCodeResults.map((option) => {
                            const key = String(option._id || `${option.countryName}-${option.dialCode}`);
                            const isActive = option.dialCode === selectedPhoneCountryCode;

                            return (
                              <li key={key}>
                                <button
                                  type="button"
                                  style={{
                                    ...styles.comboboxItem,
                                    backgroundColor: isActive ? 'var(--background)' : 'transparent'
                                  }}
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => handleSelectPhoneCode(option)}
                                >
                                  {option.searchLabel || `${option.countryName} (${option.dialCode})`}
                                </button>
                              </li>
                            );
                          })
                        ) : (
                          <li style={styles.comboboxInfoItem}>{t('patients.phoneCodeNoResults')}</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
                <input
                  type="text"
                  value={maskLocalPhoneByCountry(selectedPhoneCountryCode, String(formData.phone || ''))}
                  onChange={(e) => setFormData({
                    ...formData,
                    phone: normalizePhoneDigits(e.target.value).slice(0, getPhoneMaxDigitsByCountry(selectedPhoneCountryCode))
                  })}
                  placeholder={getPhonePlaceholderByCountry(selectedPhoneCountryCode)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    fontSize: '0.875rem',
                    backgroundColor: 'var(--surface)',
                    color: 'var(--text)'
                  }}
                />
              </div>
              <div style={styles.comboboxHint}>{t('patients.phoneCodeSearchHint')}</div>
            </div>
            
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

            <div>
              <label style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontSize: '0.875rem',
                fontWeight: 500,
                color: 'var(--text)'
              }}>
                {t('patients.isDeceased')}
              </label>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="isDeceased"
                    checked={!formData.isDeceased}
                    onChange={() => setFormData({
                      ...formData,
                      isDeceased: false,
                      representativeName: '',
                      representativeCpf: '',
                      representativePhone: ''
                    })}
                  />
                  <span>{t('common.no')}</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="isDeceased"
                    checked={!!formData.isDeceased}
                    onChange={() => setFormData({ ...formData, isDeceased: true })}
                  />
                  <span>{t('common.yes')}</span>
                </label>
              </div>
            </div>

            {formData.isDeceased && (
              <>
                <Input
                  label={`${t('patients.representativeName')} *`}
                  type="text"
                  value={formData.representativeName || ''}
                  onChange={(e) => setFormData({ ...formData, representativeName: e.target.value })}
                  helperText={t('patients.representativeHelper')}
                  required
                />
                <Input
                  label={`${t('patients.representativeCpf')} *`}
                  type="text"
                  value={formData.representativeCpf || ''}
                  onChange={(e) => setFormData({ ...formData, representativeCpf: normalizeCpf(e.target.value) })}
                  inputMode="numeric"
                  maxLength={11}
                  required
                />
                <Input
                  label={`${t('patients.representativePhone')} *`}
                  type="text"
                  value={formData.representativePhone || ''}
                  onChange={(e) => setFormData({ ...formData, representativePhone: normalizePhone(e.target.value) })}
                  inputMode="numeric"
                  maxLength={15}
                  required
                />
              </>
            )}
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
            <div ref={clinicalUnitComboboxRef} style={styles.comboboxContainer}>
              <Input
                label={t('patients.clinicalUnit')}
                type="text"
                value={clinicalUnitSearchTerm}
                onFocus={() => setClinicalUnitDropdownOpen(true)}
                onChange={(e) => {
                  const typedValue = normalizeClinicalUnitInput(e.target.value || '');
                  setClinicalUnitSearchTerm(typedValue);
                  setSelectedClinicalUnit(null);
                  setClinicalUnitDropdownOpen(true);
                  setFormData({
                    ...formData,
                    clinicalUnitId: undefined,
                    clinicalUnit: typedValue,
                    unitAcronym: generateUnitAcronym(typedValue)
                  });
                }}
                onBlur={(e) => {
                  const normalizedValue = normalizeClinicalUnitInput(e.target.value || '').trim();
                  setClinicalUnitSearchTerm(normalizedValue);
                  setFormData((prev) => ({
                    ...prev,
                    clinicalUnit: normalizedValue,
                    unitAcronym: normalizedValue ? generateUnitAcronym(normalizedValue) : undefined
                  }));
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();

                  const typedValue = normalizeClinicalUnitInput(clinicalUnitSearchTerm).trim();
                  if (typedValue.length < 3) {
                    alert(t('patients.clinicalUnitMinLength'));
                    return;
                  }

                  const exactMatch = clinicalUnits.find((unit) =>
                    normalizeClinicalUnitKey(unit.name) === normalizeClinicalUnitKey(typedValue)
                  );

                  if (exactMatch) {
                    handleSelectClinicalUnit(exactMatch);
                    return;
                  }

                  handleCreateClinicalUnit();
                }}
                placeholder={t('patients.clinicalUnitSearchPlaceholder')}
              />

              {clinicalUnitDropdownOpen && (
                <div style={{ ...styles.comboboxList, position: 'static' }}>
                  <ul style={styles.comboboxUl}>
                    {clinicalUnitsLoading ? (
                      <li style={styles.comboboxInfoItem}>{t('patients.clinicalUnitSearching')}</li>
                    ) : clinicalUnits.length > 0 ? (
                      clinicalUnits.map((unit) => {
                        const unitName = String(unit.name || '').trim();
                        const unitAcronym = String(unit.acronym || '').trim();
                        const isActive = selectedClinicalUnit?._id && String(selectedClinicalUnit._id) === String(unit._id);

                        return (
                          <li key={String(unit._id || unit.normalizedName || unitName)}>
                            <button
                              type="button"
                              style={{
                                ...styles.comboboxItem,
                                backgroundColor: isActive ? 'var(--background)' : 'transparent'
                              }}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => handleSelectClinicalUnit(unit)}
                            >
                              {unitAcronym ? `${unitName} (${unitAcronym})` : unitName}
                            </button>
                          </li>
                        );
                      })
                    ) : (
                      <li style={styles.comboboxInfoItem}>{t('patients.clinicalUnitNoResults')}</li>
                    )}
                  </ul>
                </div>
              )}

              <div style={styles.comboboxActionRow}>
                <span style={styles.comboboxHint}>{t('patients.clinicalUnitSearchHint')}</span>
                <button
                  type="button"
                  style={styles.comboboxActionButton}
                  disabled={creatingClinicalUnit || String(clinicalUnitSearchTerm || '').trim().length < 3}
                  onClick={handleCreateClinicalUnit}
                >
                  {creatingClinicalUnit ? t('patients.clinicalUnitCreating') : t('patients.clinicalUnitAddNew')}
                </button>
              </div>
            </div>
            
            <Input
              label={t('patients.unitAcronym')}
              type="text"
              value={formData.unitAcronym || ''}
              readOnly
              helperText={t('patients.unitAcronymAuto')}
            />
            
            <Input
              label={t('patients.diagnosticHypothesis')}
              type="text"
              value={formData.diagnosticHypothesis || ''}
              onChange={(e) => setFormData({ ...formData, diagnosticHypothesis: e.target.value })}
            />
            
            <div ref={cidComboboxRef} style={styles.comboboxContainer}>
              <Input
                label={t('patients.icdCode')}
                type="text"
                value={cidSearchTerm}
                onFocus={() => setCidDropdownOpen(true)}
                onChange={(e) => {
                  const typedValue = e.target.value;
                  setCidSearchTerm(typedValue);
                  setSelectedCid(null);
                  setCidDropdownOpen(true);
                  setFormData({ ...formData, icdCode: typedValue.trim(), icdReference: null });
                }}
                placeholder={t('patients.icdSearchPlaceholder')}
              />

              {cidDropdownOpen && (
                <div style={styles.comboboxList}>
                  <ul style={styles.comboboxUl}>
                    {cidLoading ? (
                      <li style={styles.comboboxInfoItem}>{t('patients.cidSearching')}</li>
                    ) : cidResults.length > 0 ? (
                      cidResults.map((cid) => {
                        const cidLabel = getCidDisplayLabel(cid);
                        const isActive = selectedCid?._id && String(selectedCid._id) === String(cid._id);
                        return (
                          <li key={String(cid._id || cid.Codigo_Tabulacao || cid.Codigos_CID10)}>
                            <button
                              type="button"
                              style={{
                                ...styles.comboboxItem,
                                backgroundColor: isActive ? 'var(--background)' : 'transparent'
                              }}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => handleSelectCid(cid)}
                            >
                              {cidLabel}
                            </button>
                          </li>
                        );
                      })
                    ) : (
                      <li style={styles.comboboxInfoItem}>{t('patients.cidNoResults')}</li>
                    )}
                  </ul>
                </div>
              )}
              {String(cidSearchTerm || '').trim().length > 0 && (
                <div style={styles.comboboxHint}>{t('patients.cidSearchHint')}</div>
              )}
            </div>

            <div>
              <label style={styles.inlineLabel}>
                <span>{t('patients.geneticVariant')}</span>
                <button
                  type="button"
                  style={styles.tooltipButton}
                  aria-label={t('patients.geneticVariantHelpLabel')}
                  title={t('patients.geneticVariantHelpLabel')}
                  onClick={() => setShowVariantTooltip((prev) => !prev)}
                >
                  <HelpCircle size={16} />
                </button>
              </label>
              <Input
                type="text"
                value={formData.geneticVariant || ''}
                onChange={(e) => setFormData({ ...formData, geneticVariant: e.target.value })}
              />
              {showVariantTooltip && (
                <div style={styles.tooltipBox}>{t('patients.geneticVariantHelpText')}</div>
              )}
            </div>
            
            <div style={styles.clinicalFieldWithHelp}>
              <label style={styles.inlineLabel}>
                <span>{t('patients.alphaGal')}</span>
                <button
                  type="button"
                  style={styles.tooltipButton}
                  aria-label={t('patients.alphaGalHelpLabel')}
                  title={t('patients.alphaGalHelpLabel')}
                  onClick={() => setShowAlphaGalTooltip((prev) => !prev)}
                >
                  <HelpCircle size={16} />
                </button>
              </label>
              <Input
                type="number"
                step="0.01"
                value={formData.alphaGal || ''}
                onChange={(e) => setFormData({ ...formData, alphaGal: parseFloat(e.target.value) || undefined })}
              />
              {showAlphaGalTooltip && (
                <div style={styles.tooltipBox}>{t('patients.alphaGalHelpText')}</div>
              )}
            </div>
            
            <div style={styles.clinicalFieldWithHelp}>
              <label style={styles.inlineLabel}>
                <span>{t('patients.lysoGb3')}</span>
                <button
                  type="button"
                  style={styles.tooltipButton}
                  aria-label={t('patients.lysoGb3HelpLabel')}
                  title={t('patients.lysoGb3HelpLabel')}
                  onClick={() => setShowLysoGb3Tooltip((prev) => !prev)}
                >
                  <HelpCircle size={16} />
                </button>
              </label>
              <Input
                type="number"
                step="0.1"
                value={formData.lysoGb3 || ''}
                onChange={(e) => setFormData({ ...formData, lysoGb3: parseFloat(e.target.value) || undefined })}
              />
              {showLysoGb3Tooltip && (
                <div style={styles.tooltipBox}>{t('patients.lysoGb3HelpText')}</div>
              )}
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ 
            fontSize: '1.125rem', 
            fontWeight: 600, 
            marginBottom: '1rem',
            color: 'var(--text)'
          }}>
            {`${t('patients.linkedProjectConsent')} *`}
          </h2>

          <div style={styles.consentSelectionContainer}>
            <button
              type="button"
              style={styles.consentAccordionToggle}
              onClick={() => setIsConsentSelectionOpen((prev) => !prev)}
            >
              {isConsentSelectionOpen
                ? t('patients.hideConsentTemplateSearch')
                : t('patients.consentTemplateSearch')}
            </button>

            {isConsentSelectionOpen && (
              <>
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
                    visibleConsentPolicies.map((policy) => {
                      const policyId = String(policy._id || `${policy.version}-${policy.title}`);
                      const isPrimary = selectedConsentTemplateId === policyId;
                      const policyLabel = `${policy.version} - ${policy.title} (${t('patients.caaeLabel')}: ${policy.caae || '--'})${isPrimary ? ` • ${t('patients.primaryConsentTemplate')}` : ''}`;
                      return (
                        <label
                          key={policyId}
                          style={{
                            ...styles.consentSelectionItem,
                            ...(isPrimary ? styles.consentSelectionItemActive : {})
                          }}
                        >
                          <input
                            type="radio"
                            name="primary-consent-template"
                            checked={isPrimary}
                            onChange={() => handleToggleConsentTemplate(policyId)}
                          />
                          <span title={policyLabel} style={styles.consentSelectionLabelText}>
                            {policyLabel}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
                {shouldCollapseConsentTemplates && (
                  <div style={styles.consentSelectionFooter}>
                    <button
                      type="button"
                      style={styles.consentSelectionToggleButton}
                      onClick={() => setShowAllConsentTemplates((prev) => !prev)}
                    >
                      {showAllConsentTemplates
                        ? t('patients.showFewerConsentTemplates')
                        : t('patients.showMoreConsentTemplates')}
                    </button>
                  </div>
                )}
              </>
            )}
            <span style={{ color: 'var(--text-light)', fontSize: '0.8rem' }}>{t('patients.consentChecklistHint')}</span>
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
            disabled={isSavingPatient}
          >
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={isSavingPatient || creatingClinicalUnit}>
            {isSavingPatient
              ? (language === 'en-US' ? 'Saving...' : language === 'es-ES' ? 'Guardando...' : 'Salvando...')
              : (editingPatient ? t('patients.saveChanges') : t('patients.registerPatient'))}
          </Button>
        </div>
      </form>

    </div>
  );
}

