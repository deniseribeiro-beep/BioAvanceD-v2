import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import { apiClient } from '../api/client';
import { reportsService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { getReportTypeDefinition } from '../config/constants/report.constants';
import { MIABIS_QUALITY } from '../config/constants/specimen.constants.js';
import { SPREC_FLUID_DICTIONARY, SPREC_SOLID_DICTIONARY } from '../constants/sprecDictionary';
import { ArrowLeft, Download, Filter, Search, X } from 'lucide-react';
import './ReportQueryPage.css';

type LookupOption = {
  system?: string;
  code: string;
  display: string;
};

type FilterValue = string | boolean | LookupOption | null;

type FilterKind = 'autocomplete' | 'select' | 'date' | 'checkbox';

type FilterFieldBase = {
  name: string;
  label: string;
  kind: FilterKind;
  helperText?: string;
};

type AutocompleteField = FilterFieldBase & {
  kind: 'autocomplete';
  placeholder: string;
  searchType: 'orpha' | 'drug';
};

type SelectField = FilterFieldBase & {
  kind: 'select';
  options: Array<{ label: string; value: string }>;
};

type DateField = FilterFieldBase & {
  kind: 'date';
};

type CheckboxField = FilterFieldBase & {
  kind: 'checkbox';
};

type ReportFilterField = AutocompleteField | SelectField | DateField | CheckboxField;

type ReportFilterSection = {
  id: string;
  title: string;
  description: string;
  fields: ReportFilterField[];
};

const CLINICAL_KEYS = new Set(['patients', 'samplesByPatient', 'results', 'sampleAnalysis']);
const QUALITY_KEYS = new Set(['samples', 'sampleAnalysis', 'withdrawalHistory', 'tissueOriginHistory']);
const MONITORING_KEYS = new Set(['temperature', 'temperatureControl', 'sensors', 'equipment', 'accessLogs']);

const TREATMENT_STATUS_OPTIONS = [
  { label: 'Naive', value: 'NAIVE' },
  { label: 'On Treatment', value: 'ON_TREATMENT' },
  { label: 'Washout', value: 'WASHOUT' },
];

const RELEASE_STATUS_OPTIONS = [
  { label: 'Ativa', value: 'AVAILABLE' },
  { label: 'Em Quarentena', value: 'QUARANTINE' },
  { label: 'Esgotada', value: 'BLOCKED' },
];

const QUALITY_CATEGORY_OPTIONS = MIABIS_QUALITY.map((item) => ({
  label: item.label,
  value: item.id,
}));

const SPREC_MATRIX_OPTIONS = [
  { label: 'Fluidos (SPREC 2.0)', value: 'fluid' },
  { label: 'Sólidos (SPREC 2.0)', value: 'solid' },
];

const SPREC_AXIS_FILTER_KEYS = [
  'sprecSampleType',
  'sprecPrimaryContainer',
  'sprecPreCentrifugation',
  'sprecCentrifugation',
  'sprecSecondCentrifugation',
  'sprecPostCentrifugationDelay',
  'sprecLongTermStorage',
] as const;

const REPORT_SECTION_LIBRARY = {
  clinical: {
    id: 'clinical',
    title: 'Relatório de Pacientes / Clínico',
    description: 'Busca rastreável usando ORPHA, ATC/ChEMBL e status terapêutico MIABIS.',
    fields: [
      {
        name: 'orphaCode',
        label: 'Filtro de Doença',
        kind: 'autocomplete',
        placeholder: 'Buscar ORPHA code ou nome da doença',
        searchType: 'orpha',
        helperText: 'Consulta o cache Orphadata e retorna código ORPHA + nome.',
      },
      {
        name: 'atcCode',
        label: 'Filtro de Fármaco',
        kind: 'autocomplete',
        placeholder: 'Buscar generic_name ou ATC code',
        searchType: 'drug',
        helperText: 'Consulta ATC/ChEMBL e retorna nome genérico + código ATC.',
      },
      {
        name: 'treatmentStatus',
        label: 'Filtro de Status de Tratamento',
        kind: 'select',
        options: TREATMENT_STATUS_OPTIONS,
        helperText: 'Padrão MIABIS para rastreio clínico.',
      },
    ],
  },
  quality: {
    id: 'quality',
    title: 'Relatório de Amostras / Qualidade',
    description: 'Filtros SPREC completos (matriz + 7 eixos) e status operacional da amostra.',
    fields: [],
  },
  monitoring: {
    id: 'monitoring',
    title: 'Relatório de Monitoramento (IoT/Equipamentos)',
    description: 'Faixa temporal e eventos críticos de temperatura.',
    fields: [
      {
        name: 'startDate',
        label: 'Data inicial',
        kind: 'date',
        helperText: 'Início do período do relatório.',
      },
      {
        name: 'endDate',
        label: 'Data final',
        kind: 'date',
        helperText: 'Fim do período do relatório.',
      },
      {
        name: 'criticalAlertsOnly',
        label: 'Mostrar apenas eventos de quebra de temperatura (Alertas Críticos)',
        kind: 'checkbox',
        helperText: 'Mostra somente leituras com indício de alerta crítico.',
      },
    ],
  },
} as const;

function normalizeText(value: unknown) {
  return String(value || '').trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function flattenFilters(values: Record<string, FilterValue>) {
  const payload: Record<string, string | boolean> = {};

  Object.entries(values).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') {
      return;
    }

    if (typeof value === 'boolean') {
      if (value) {
        payload[key] = true;
      }
      return;
    }

    if (typeof value === 'object' && 'code' in value) {
      payload[key] = value.code;
      if (key === 'orphaCode') {
        payload.orphaName = value.display;
      }
      if (key === 'atcCode') {
        payload.genericName = value.display;
      }
      return;
    }

    payload[key] = String(value);
  });

  return payload;
}

function formatFilename(reportLabel: string) {
  return reportLabel
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function buildSections(reportKey: string, qualityFields: ReportFilterField[]): ReportFilterSection[] {
  const sections: ReportFilterSection[] = [];

  if (CLINICAL_KEYS.has(reportKey)) {
    sections.push(REPORT_SECTION_LIBRARY.clinical);
  }

  if (QUALITY_KEYS.has(reportKey)) {
    sections.push({
      ...REPORT_SECTION_LIBRARY.quality,
      fields: qualityFields,
    });
  }

  if (MONITORING_KEYS.has(reportKey)) {
    sections.push(REPORT_SECTION_LIBRARY.monitoring);
  }

  return sections;
}

function DictionaryAutocompleteField({
  label,
  placeholder,
  helperText,
  value,
  onChange,
  onSearch,
}: {
  label: string;
  placeholder: string;
  helperText?: string;
  value: LookupOption | null;
  onChange: (value: LookupOption | null) => void;
  onSearch: (query: string) => Promise<LookupOption[]>;
}) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<LookupOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedLabel = value ? `${value.display} (${value.code})` : '';

  useEffect(() => {
    setQuery(selectedLabel);
    setOptions([]);
    setError('');
  }, [selectedLabel]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || trimmed === selectedLabel) {
      setOptions([]);
      setLoading(false);
      return;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');

      try {
        const nextOptions = await onSearch(trimmed);
        if (active) {
          setOptions(nextOptions);
        }
      } catch {
        if (active) {
          setOptions([]);
          setError('Não foi possível carregar as opções agora.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [onSearch, query, selectedLabel]);

  return (
    <div className="report-autocomplete-field">
      <label className="report-field-label">{label}</label>
      <div className="report-autocomplete-box">
        <Search size={16} className="report-autocomplete-icon" />
        <Input
          type="text"
          value={query}
          onChange={(event) => {
            const nextValue = event.target.value;
            setQuery(nextValue);
            if (value) {
              onChange(null);
            }
          }}
          placeholder={placeholder}
          className="report-autocomplete-input"
          autoComplete="off"
        />
        {value && (
          <button
            type="button"
            className="report-autocomplete-clear"
            onClick={() => {
              onChange(null);
              setQuery('');
              setOptions([]);
            }}
            aria-label={`Limpar ${label}`}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {helperText && <p className="report-field-help">{helperText}</p>}
      {loading && <p className="report-field-status">Buscando opções...</p>}
      {!loading && error && <p className="report-field-status report-field-status--error">{error}</p>}

      {options.length > 0 && (
        <div className="report-autocomplete-results">
          {options.map((option) => (
            <button
              key={`${option.system || 'local'}:${option.code}`}
              type="button"
              className="report-autocomplete-option"
              onClick={() => {
                onChange(option);
                setQuery(`${option.display} (${option.code})`);
                setOptions([]);
              }}
            >
              <strong>{option.display}</strong>
              <span>{option.code}</span>
            </button>
          ))}
        </div>
      )}

      {value && <p className="report-filter-selected">Selecionado: {value.display} ({value.code})</p>}
    </div>
  );
}

function ReportSelectField({
  label,
  helperText,
  value,
  options,
  onChange,
}: {
  label: string;
  helperText?: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="report-field-stack">
      <label className="report-field-label">{label}</label>
      <select
        className="report-select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
      >
        <option value="">Todos</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {helperText && <p className="report-field-help">{helperText}</p>}
    </div>
  );
}

function ReportDateField({
  label,
  helperText,
  value,
  onChange,
}: {
  label: string;
  helperText?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="report-field-stack">
      <label className="report-field-label">{label}</label>
      <Input type="date" value={value} onChange={(event) => onChange(event.target.value)} />
      {helperText && <p className="report-field-help">{helperText}</p>}
    </div>
  );
}

function ReportCheckboxField({
  label,
  helperText,
  value,
  onChange,
}: {
  label: string;
  helperText?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="report-checkbox-field">
      <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <strong>{label}</strong>
        {helperText && <em>{helperText}</em>}
      </span>
    </label>
  );
}

function ReportField({
  field,
  values,
  onChange,
  searchOrpha,
  searchDrugs,
}: {
  field: ReportFilterField;
  values: Record<string, FilterValue>;
  onChange: (name: string, value: FilterValue) => void;
  searchOrpha: (query: string) => Promise<LookupOption[]>;
  searchDrugs: (query: string) => Promise<LookupOption[]>;
}) {
  switch (field.kind) {
    case 'autocomplete':
      return (
        <DictionaryAutocompleteField
          label={field.label}
          placeholder={field.placeholder}
          helperText={field.helperText}
          value={(values[field.name] as LookupOption | null) || null}
          onChange={(nextValue) => onChange(field.name, nextValue)}
          onSearch={field.searchType === 'orpha' ? searchOrpha : searchDrugs}
        />
      );
    case 'select':
      return (
        <ReportSelectField
          label={field.label}
          helperText={field.helperText}
          value={String(values[field.name] || '')}
          options={field.options}
          onChange={(nextValue) => onChange(field.name, nextValue)}
        />
      );
    case 'date':
      return (
        <ReportDateField
          label={field.label}
          helperText={field.helperText}
          value={String(values[field.name] || '')}
          onChange={(nextValue) => onChange(field.name, nextValue)}
        />
      );
    case 'checkbox':
      return (
        <ReportCheckboxField
          label={field.label}
          helperText={field.helperText}
          value={Boolean(values[field.name])}
          onChange={(nextValue) => onChange(field.name, nextValue)}
        />
      );
    default:
      return null;
  }
}

export default function ReportQueryPage() {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const { hasReportAccess } = useAuth();
  const { t } = useLanguage();

  const reportDefinition = getReportTypeDefinition(type);
  const reportKey = reportDefinition?.key || String(type || '');
  const reportLabel = reportDefinition ? t(reportDefinition.type, reportDefinition.fallbackType) : 'Relatório';
  const reportDescription = reportDefinition
    ? t(reportDefinition.description, reportDefinition.fallbackDescription)
    : 'Configure os filtros e exporte o relatório';

  const [values, setValues] = useState<Record<string, FilterValue>>({});
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const sprecMatrixType = String(values.sprecMatrixType || 'fluid').trim().toLowerCase() === 'solid' ? 'solid' : 'fluid';
  const activeSprecDictionary = sprecMatrixType === 'solid' ? SPREC_SOLID_DICTIONARY : SPREC_FLUID_DICTIONARY;

  const qualityFields = useMemo<ReportFilterField[]>(() => {
    const axisFields: ReportFilterField[] = [
      {
        name: 'sprecSampleType',
        label: `Axis 1 - ${activeSprecDictionary.sampleType.label}`,
        kind: 'select',
        options: activeSprecDictionary.sampleType.options,
        helperText: 'Código SPREC do tipo da amostra.',
      },
      {
        name: 'sprecPrimaryContainer',
        label: `Axis 2 - ${activeSprecDictionary.primaryContainer.label}`,
        kind: 'select',
        options: activeSprecDictionary.primaryContainer.options,
        helperText: 'Código SPREC do recipiente/tipo de coleta.',
      },
      {
        name: 'sprecPreCentrifugation',
        label: `Axis 3 - ${activeSprecDictionary.preCentrifugation.label}`,
        kind: 'select',
        options: activeSprecDictionary.preCentrifugation.options,
      },
      {
        name: 'sprecCentrifugation',
        label: `Axis 4 - ${activeSprecDictionary.centrifugation.label}`,
        kind: 'select',
        options: activeSprecDictionary.centrifugation.options,
      },
      {
        name: 'sprecSecondCentrifugation',
        label: `Axis 5 - ${activeSprecDictionary.secondCentrifugation.label}`,
        kind: 'select',
        options: activeSprecDictionary.secondCentrifugation.options,
      },
      {
        name: 'sprecPostCentrifugationDelay',
        label: `Axis 6 - ${activeSprecDictionary.postCentrifugationDelay.label}`,
        kind: 'select',
        options: activeSprecDictionary.postCentrifugationDelay.options,
      },
      {
        name: 'sprecLongTermStorage',
        label: `Axis 7 - ${activeSprecDictionary.longTermStorage.label}`,
        kind: 'select',
        options: activeSprecDictionary.longTermStorage.options,
      },
    ];

    return [
      {
        name: 'sprecMatrixType',
        label: 'Filtro SPREC - Matriz',
        kind: 'select',
        options: SPREC_MATRIX_OPTIONS,
        helperText: 'Mesmo padrão da fase pré-analítica (Step 2).',
      },
      ...axisFields,
      {
        name: 'sprecCategory',
        label: 'Filtro SPREC - Categoria de Qualidade',
        kind: 'select',
        options: QUALITY_CATEGORY_OPTIONS,
        helperText: 'Categorias MIABIS/SPREC padronizadas.',
      },
      {
        name: 'status',
        label: 'Filtro de Status',
        kind: 'select',
        options: RELEASE_STATUS_OPTIONS,
        helperText: 'Status do grafo e da amostra: ativa, quarentena ou esgotada.',
      },
    ];
  }, [activeSprecDictionary]);

  useEffect(() => {
    setValues({});
    setError('');
  }, [reportKey]);

  const sections = useMemo(() => buildSections(reportKey, qualityFields), [qualityFields, reportKey]);

  const searchOrpha = useCallback(async (query: string): Promise<LookupOption[]> => {
    const trimmed = normalizeText(query);
    if (!trimmed) {
      return [];
    }

    const response = await apiClient.get('/dictionary/search', {
      params: { query: trimmed },
      suppressErrorToast: true,
    } as any);

    return Array.isArray(response?.data?.results)
      ? response.data.results
        .map((item: any) => ({
          system: String(item?.system || 'http://www.orpha.net'),
          code: String(item?.code || item?.codigo || '').trim(),
          display: String(item?.display || item?.descricao || item?.label || '').trim(),
        }))
        .filter((item: LookupOption) => item.code && item.display)
      : [];
  }, []);

  const searchDrugs = useCallback(async (query: string): Promise<LookupOption[]> => {
    const trimmed = normalizeText(query);
    if (!trimmed) {
      return [];
    }

    const response = await apiClient.get('/dictionary/medications/search', {
      params: { q: trimmed, limit: 20 },
      suppressErrorToast: true,
    } as any);

    return Array.isArray(response?.data?.medications)
      ? response.data.medications
        .map((item: any) => ({
          system: String(item?.system || 'ATC/ChEMBL'),
          code: String(item?.atc_code || item?.code || '').trim(),
          display: String(item?.generic_name || item?.name || item?.display || '').trim(),
        }))
        .filter((item: LookupOption) => item.code && item.display)
      : [];
  }, []);

  const handleFieldChange = (name: string, value: FilterValue) => {
    if (name === 'sprecMatrixType') {
      setValues((currentValues) => ({
        ...currentValues,
        sprecMatrixType: value,
        ...Object.fromEntries(SPREC_AXIS_FILTER_KEYS.map((axisKey) => [axisKey, ''])),
      }));
      return;
    }

    setValues((currentValues) => ({
      ...currentValues,
      [name]: value,
    }));
  };

  const handleCancel = () => {
    navigate('/reports');
  };

  const handleExport = async () => {
    if (!reportKey) {
      setError('Não foi possível identificar o relatório selecionado.');
      return;
    }

    if (!hasReportAccess(reportDefinition?.type || reportKey) && !hasReportAccess(reportKey)) {
      setError(t('reports.noPermission', 'Você não tem permissão para exportar este relatório.'));
      return;
    }

    setExporting(true);
    setError('');

    try {
      const payload = flattenFilters(values);
      const response = await reportsService.exportReport(reportKey, 'csv', payload);
      const filename = `relatorio_${formatFilename(reportLabel)}_${Date.now()}.csv`;
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(`Erro ao exportar relatório: ${err?.response?.data?.error || err?.message || 'falha inesperada'}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page report-query-page">
      <div className="page-header report-query-header">
        <div>
          <Button variant="secondary" onClick={handleCancel} className="report-query-back-button">
            <ArrowLeft size={18} />
            Voltar
          </Button>
          <div className="report-query-hero-copy">
            <p className="report-query-eyebrow">Consulta guiada</p>
            <h1 className="page-title">{reportLabel}</h1>
            <p className="page-subtitle">{reportDescription}</p>
          </div>
        </div>
      </div>

      {error && (
        <Card className="report-query-state report-query-state--error">
          <p>{error}</p>
        </Card>
      )}

      <Card className="report-query-intro-card">
        <div className="report-query-intro">
          <div className="report-query-intro-icon">
            <Filter size={20} />
          </div>
          <div>
            <h2>Filtros rastreáveis</h2>
            <p>
              Os filtros abaixo são derivados do tipo de relatório selecionado e consultam o dicionário de dados
              integrado antes da exportação.
            </p>
          </div>
        </div>
      </Card>

      {sections.length > 0 ? (
        <div className="report-query-section-list">
          {sections.map((section) => (
            <Card key={section.id} className="report-query-section-card">
              <div className="report-query-section-head">
                <div>
                  <h2>{section.title}</h2>
                  <p>{section.description}</p>
                </div>
              </div>

              <div className="report-query-fields-grid">
                {section.fields.map((field) => (
                  <ReportField
                    key={field.name}
                    field={field}
                    values={values}
                    onChange={handleFieldChange}
                    searchOrpha={searchOrpha}
                    searchDrugs={searchDrugs}
                  />
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="report-query-section-card">
          <p className="report-query-empty">Nenhum filtro específico foi definido para este relatório. Você ainda pode exportar sem filtros.</p>
        </Card>
      )}

      <Card className="report-query-footer-card">
        <div className="report-query-footer-copy">
          <strong>{reportLabel}</strong>
          <span>Os parâmetros preenchidos serão enviados para o backend como querystring para geração rastreável.</span>
        </div>
        <div className="report-query-footer-actions">
          <Button variant="secondary" onClick={handleCancel} disabled={exporting}>
            Cancelar
          </Button>
          <Button onClick={() => void handleExport()} disabled={exporting}>
            <Download size={18} />
            {exporting ? 'Exportando...' : 'Exportar'}
          </Button>
        </div>
      </Card>
    </div>
  );
}