import { useEffect, useMemo, useState } from 'react';
import { Ban, Database, Edit2, Plus, FlaskConical, Dna, FileText, Layers3, CheckCircle2 } from 'lucide-react';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import Input from '../components/UI/Input';
import Textarea from '../components/UI/Textarea';
import { apiClient, notifyApiToast } from '../api/client';
import { cidService } from '../services/api';
import CascadingSuggestion from '../components/CascadingSuggestion';
import {
  CLINICAL_COMORBIDITIES,
  createIntakeDictionaryItem,
  BIOMARKER_DICTIONARY,
} from '../config/constants/intake-dictionaries.constants';
import { EXTRACTION_PROTOCOLS, SAMPLE_ORIGINS, SPECIMEN_TYPES } from '../config/constants/specimen.constants';
import './DataDictionaryPage.css';

type BiomarkerRequest = {
  _id?: string;
  biomarkerName: string;
  measurementUnit: string;
  justification: string;
  source?: string;
  requestedAt?: string;
  status?: string;
};

async function fetchPendingBiomarkerRequests(): Promise<BiomarkerRequest[]> {
  try {
    const response = await apiClient.get('/biomarker-requests/pending', { suppressErrorToast: true } as any);
    const payload = response?.data?.requests ?? [];
    return Array.isArray(payload) ? payload : [];
  } catch {
    return [];
  }
}

type DictionaryCategoryKey =
  | 'sample-types'
  | 'anatomical-origins'
  | 'extraction-protocols'
  | 'clinical-comorbidities'
  | 'cids'
  | 'biomarkers';

type DictionaryItem = {
  _id?: string;
  id?: string | number;
  name?: string;
  label?: string;
  slug?: string;
  value?: string;
  active?: boolean;
  is_active?: boolean;
  unit?: string;
  measurementUnit?: string;
  Capitulo?: string;
  Codigo_Tabulacao?: string;
  Descricao?: string;
  Codigos_CID10?: string;
  ORPHA?: string;
  OMIM?: string;
  category?: string;
  createdAt?: string;
  updatedAt?: string;
  version?: string;
  title?: string;
  caae?: string;
};

type DictionaryFormState = {
  name: string;
  slug: string;
  active: boolean;
  unit: string;
  capitulo: string;
  codigoTabulacao: string;
  descricao: string;
  codigosCid10: string;
  orpha: string;
  omim: string;
};

type DictionaryCategoryKind = 'generic' | 'cid';

type DictionaryCategorySource = 'backend' | 'static';

type DictionaryCategory = {
  key: DictionaryCategoryKey;
  label: string;
  description: string;
  icon: typeof Database;
  endpoint: string;
  kind: DictionaryCategoryKind;
  source: DictionaryCategorySource;
  editable: boolean;
  includeUnit?: boolean;
};

type PaginationState = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  query?: string;
};

const CID_PAGE_SIZE = 50;
const EMPTY_CID_PAGINATION: PaginationState = {
  page: 1,
  limit: CID_PAGE_SIZE,
  total: 0,
  totalPages: 0,
  hasNext: false,
  hasPrev: false,
  query: '',
};

const categories: DictionaryCategory[] = [
  {
    key: 'sample-types',
    label: 'Tipos de Amostra',
    description: 'Tipos canônicos usados no cadastro de amostras e integrações laboratoriais.',
    icon: Layers3,
    endpoint: '',
    kind: 'generic',
    source: 'static',
    editable: false,
  },
  {
    key: 'anatomical-origins',
    label: 'Origem Anatômica',
    description: 'Origem anatômica ou biológica associada à amostra.',
    icon: Database,
    endpoint: '',
    kind: 'generic',
    source: 'static',
    editable: false,
  },
  {
    key: 'extraction-protocols',
    label: 'Protocolos de Extração',
    description: 'Protocolos aplicados na fase pré-analítica.',
    icon: FlaskConical,
    endpoint: '',
    kind: 'generic',
    source: 'static',
    editable: false,
  },
  {
    key: 'clinical-comorbidities',
    label: 'Comorbidades Clínicas',
    description: 'Comorbidades disponíveis para o wizard clínico e relatórios.',
    icon: CheckCircle2,
    endpoint: '',
    kind: 'generic',
    source: 'static',
    editable: false,
  },
  {
    key: 'cids',
    label: 'CID / Doenças',
    description: 'Catálogo de CID utilizado no wizard clínico e agora administrado na tela unificada.',
    icon: FileText,
    endpoint: '/cids',
    kind: 'cid',
    source: 'backend',
    editable: true,
  },
  {
    key: 'biomarkers',
    label: 'Biomarcadores',
    description: 'Biomarcadores laboratoriais usados no wizard e nos painéis analíticos.',
    icon: Dna,
    endpoint: '',
    kind: 'generic',
    source: 'static',
    editable: false,
    includeUnit: true,
  },
];

const initialFormState: DictionaryFormState = {
  name: '',
  slug: '',
  active: true,
  unit: '',
  capitulo: '',
  codigoTabulacao: '',
  descricao: '',
  codigosCid10: '',
  orpha: '',
  omim: '',
};

function slugify(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value.toLowerCase() === 'active' || value.toLowerCase() === 'ativo';
  }

  if (typeof value === 'number') {
    return value === 1;
  }

  return true;
}

function normalizeItem(rawItem: DictionaryItem): DictionaryItem {
  const name = String(rawItem?.name || rawItem?.label || '').trim();
  const slug = String(rawItem?.slug || rawItem?.value || '').trim();
  const unit = String(rawItem?.unit || rawItem?.measurementUnit || '').trim();
  const active = normalizeBoolean(rawItem?.active ?? rawItem?.is_active);
  const capitulo = String(rawItem?.Capitulo || '').trim();
  const codigoTabulacao = String(rawItem?.Codigo_Tabulacao || '').trim();
  const descricao = String(rawItem?.Descricao || '').trim();
  const codigosCid10 = String(rawItem?.Codigos_CID10 || '').trim();
  const orpha = String(rawItem?.ORPHA || '').trim();
  const omim = String(rawItem?.OMIM || '').trim();

  return {
    ...rawItem,
    name,
    label: rawItem?.label || name,
    slug: slug || slugify(name),
    value: rawItem?.value || slug || slugify(name),
    active,
    is_active: active,
    unit,
    measurementUnit: unit,
    Capitulo: capitulo,
    Codigo_Tabulacao: codigoTabulacao,
    Descricao: descricao,
    Codigos_CID10: codigosCid10,
    ORPHA: orpha,
    OMIM: omim,
  };
}

async function fetchDictionaryItems(endpoint: string): Promise<DictionaryItem[]> {
  const response = await apiClient.get(endpoint, { suppressErrorToast: true } as any);
  const payload = response?.data?.data ?? response?.data ?? [];
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((item) => normalizeItem(item));
}

async function loadCidItems(term: string, page: number, limit = CID_PAGE_SIZE): Promise<{
  items: DictionaryItem[];
  pagination: PaginationState;
}> {
  const normalizedTerm = String(term || '').trim();

  if (normalizedTerm.length < 2) {
    return {
      items: [],
      pagination: {
        page: 1,
        limit,
        total: 0,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
        query: '',
      } as PaginationState,
    };
  }

  const response = await cidService.search(normalizedTerm, limit, page);
  // Corrigir: o retorno correto é response?.data?.data (array de CidEntry)
  const payload = response?.data?.data ?? [];
  const pagination = (response?.data?.pagination || {}) as Partial<PaginationState>;

  return {
    items: Array.isArray(payload) ? payload.map((item) => normalizeItem(item)) : [],
    pagination: {
      page: Number(pagination.page || page),
      limit: Number(pagination.limit || limit),
      total: Number(pagination.total || 0),
      totalPages: Number(pagination.totalPages || 0),
      hasNext: Boolean(pagination.hasNext),
      hasPrev: Boolean(pagination.hasPrev),
      query: String(pagination.query || normalizedTerm || '').trim(),
    },
  };
}

async function loadCategoryItems(category: DictionaryCategory, query = ''): Promise<DictionaryItem[]> {
  if (category.key === 'cids') {
    const nextResult = await loadCidItems(query, 1, CID_PAGE_SIZE);
    return nextResult.items;
  }

  if (category.source === 'backend') {
    return fetchDictionaryItems(category.endpoint);
  }

  if (category.key === 'sample-types') {
    return SPECIMEN_TYPES.map(createIntakeDictionaryItem);
  }

  if (category.key === 'anatomical-origins') {
    return SAMPLE_ORIGINS.map(createIntakeDictionaryItem);
  }

  if (category.key === 'extraction-protocols') {
    return EXTRACTION_PROTOCOLS.map(createIntakeDictionaryItem);
  }

  if (category.key === 'clinical-comorbidities') {
    return CLINICAL_COMORBIDITIES.map(createIntakeDictionaryItem);
  }

  if (category.key === 'biomarkers') {
    return BIOMARKER_DICTIONARY.map(createIntakeDictionaryItem);
  }

  return [];
}

async function createDictionaryItem(endpoint: string, payload: Record<string, unknown>) {
  return apiClient.post(endpoint, payload, { suppressErrorToast: true } as any);
}

async function updateDictionaryItem(endpoint: string, payload: Record<string, unknown>) {
  return apiClient.put(endpoint, payload, { suppressErrorToast: true } as any);
}

async function deactivateDictionaryItem(endpoint: string) {
  return apiClient.patch(endpoint, { active: false, is_active: false }, { suppressErrorToast: true } as any);
}

export default function DataDictionaryPage() {
  const [activeCategoryKey, setActiveCategoryKey] = useState<DictionaryCategoryKey>('sample-types');
  const [items, setItems] = useState<DictionaryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState('');
  const [cidSearchTerm, setCidSearchTerm] = useState('');
  const [cidPagination, setCidPagination] = useState<PaginationState>(EMPTY_CID_PAGINATION);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<DictionaryItem | null>(null);
  const [formState, setFormState] = useState<DictionaryFormState>(initialFormState);
  const [formError, setFormError] = useState('');

  // Novos estados para solicitações pendentes de biomarcadores
  const [pendingBiomarkerRequests, setPendingBiomarkerRequests] = useState<BiomarkerRequest[]>([]);
  const [loadingBiomarkerRequests, setLoadingBiomarkerRequests] = useState(false);
  // Carregar solicitações pendentes de biomarcadores quando categoria for 'biomarkers'
  useEffect(() => {
    if (activeCategoryKey !== 'biomarkers') {
      setPendingBiomarkerRequests([]);
      return;
    }
    let mounted = true;
    setLoadingBiomarkerRequests(true);
    fetchPendingBiomarkerRequests().then((requests) => {
      if (mounted) setPendingBiomarkerRequests(requests);
    }).finally(() => {
      if (mounted) setLoadingBiomarkerRequests(false);
    });
    return () => { mounted = false; };
  }, [activeCategoryKey]);

  const activeCategory = useMemo(
    () => categories.find((category) => category.key === activeCategoryKey) || categories[0],
    [activeCategoryKey]
  );

  const isCidCategory = activeCategory.kind === 'cid';

  const tableHeaders = useMemo(() => {
    if (isCidCategory) {
      return ['Código Tabulação', 'CID10', 'Descrição', 'Capítulo', 'Status', 'Ações'];
    }

    const headers = ['Nome / Label', 'Valor Interno', 'Status'];

    if (activeCategory.includeUnit) {
      headers.push('Unidade');
    }

    headers.push('Ações');
    return headers;
  }, [activeCategory.includeUnit, isCidCategory]);

  const activeCount = useMemo(
    () => items.filter((item) => normalizeBoolean(item.active ?? item.is_active)).length,
    [items]
  );

  const generatedSlug = useMemo(() => slugify(formState.name), [formState.name]);

  useEffect(() => {
    if (activeCategoryKey === 'cids') {
      return;
    }

    let mounted = true;

    const loadItems = async () => {
      setLoading(true);
      setPageError('');

      try {
        const nextItems = await loadCategoryItems(activeCategory);
        if (!mounted) {
          return;
        }

        setItems(nextItems);
      } catch (error: any) {
        if (!mounted) {
          return;
        }

        const message = error?.response?.data?.message || error?.response?.data?.error || error?.message || 'Não foi possível carregar os itens da categoria.';
        setItems([]);
        setPageError(message);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadItems();

    return () => {
      mounted = false;
    };
  }, [activeCategory]);

  useEffect(() => {
    if (activeCategoryKey !== 'cids') {
      return;
    }

    let mounted = true;
    const term = cidSearchTerm.trim();
    const page = cidPagination.page;
    const timer = window.setTimeout(() => {
      const loadCidRecords = async () => {

        if (term.length < 2) {
          setItems([]);
          setLoading(false);
          setPageError('Digite pelo menos 2 caracteres para buscar CIDs.');
          setCidPagination(EMPTY_CID_PAGINATION);
          return;
        }

        setLoading(true);
        setPageError('');

        try {
          const nextItems = await loadCidItems(term, page, CID_PAGE_SIZE);
          if (!mounted) {
            return;
          }

          setItems(nextItems.items);
          setCidPagination(nextItems.pagination);
        } catch (error: any) {
          if (!mounted) {
            return;
          }

          const message = error?.response?.data?.message || error?.response?.data?.error || error?.message || 'Não foi possível carregar os CIDs.';
          setItems([]);
          setPageError(message);
          setCidPagination(EMPTY_CID_PAGINATION);
        } finally {
          if (mounted) {
            setLoading(false);
          }
        }
      };

      void loadCidRecords();
    }, 250);

    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, [activeCategoryKey, cidPagination.page, cidSearchTerm]);

  const openCreateModal = () => {
    if (!activeCategory.editable) {
      notifyApiToast({
        message: 'Esta categoria é somente leitura no momento.',
        type: 'info',
        duration: 3500,
      });
      return;
    }

    setEditingItem(null);
    setFormState({ ...initialFormState, slug: '' });
    setFormError('');
    setModalOpen(true);
  };

  const openEditModal = (item: DictionaryItem) => {
    if (!activeCategory.editable) {
      notifyApiToast({
        message: 'Esta categoria é somente leitura no momento.',
        type: 'info',
        duration: 3500,
      });
      return;
    }

    const normalized = normalizeItem(item);
    setEditingItem(normalized);
    setFormState(
      isCidCategory
        ? {
            name: '',
            slug: '',
            active: normalizeBoolean(normalized.active ?? normalized.is_active),
            unit: '',
            capitulo: normalized.Capitulo || '',
            codigoTabulacao: normalized.Codigo_Tabulacao || '',
            descricao: normalized.Descricao || '',
            codigosCid10: normalized.Codigos_CID10 || '',
            orpha: normalized.ORPHA || '',
            omim: normalized.OMIM || '',
          }
        : {
            name: normalized.name || '',
            slug: normalized.slug || '',
            active: normalizeBoolean(normalized.active ?? normalized.is_active),
            unit: normalized.unit || '',
            capitulo: '',
            codigoTabulacao: '',
            descricao: '',
            codigosCid10: '',
            orpha: '',
            omim: '',
          }
    );
    setFormError('');
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) {
      return;
    }

    setModalOpen(false);
    setEditingItem(null);
    setFormError('');
  };

  const handleFieldChange = (field: keyof DictionaryFormState) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    const value = field === 'active' ? (target as HTMLInputElement).checked : target.value;

    setFormError('');
    setFormState((previous) => ({
      ...previous,
      [field]: value,
      ...(field === 'name' ? { slug: slugify(event.target.value) } : null),
    }));
  };

  const validateForm = () => {
    if (isCidCategory) {
      if (!formState.codigoTabulacao.trim()) {
        return 'Informe o código de tabulação do CID.';
      }

      if (!formState.codigosCid10.trim()) {
        return 'Informe o código CID10.';
      }

      if (!formState.descricao.trim()) {
        return 'Informe a descrição do CID.';
      }

      return '';
    }

    if (!formState.name.trim()) {
      return 'Informe o nome do item.';
    }

    if (activeCategory.includeUnit && !formState.unit.trim()) {
      return 'Informe a unidade de medida para biomarcadores.';
    }

    return '';
  };

  const refreshItems = async () => {
    if (isCidCategory) {
      const nextItems = await loadCidItems(cidSearchTerm, cidPagination.page, CID_PAGE_SIZE);
      setItems(nextItems.items);
      setCidPagination(nextItems.pagination);
      return;
    }

    const nextItems = await loadCategoryItems(activeCategory);
    setItems(nextItems);
  };

  const handleSaveItem = async () => {
    if (!activeCategory.editable) {
      setFormError('Esta categoria é somente leitura.');
      return;
    }

    const validationError = validateForm();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    try {
      setSaving(true);
      setFormError('');

      const payload = isCidCategory
        ? {
            Capitulo: formState.capitulo.trim(),
            Codigo_Tabulacao: formState.codigoTabulacao.trim(),
            Descricao: formState.descricao.trim(),
            Codigos_CID10: formState.codigosCid10.trim(),
            ORPHA: formState.orpha.trim(),
            OMIM: formState.omim.trim(),
            active: formState.active,
            is_active: formState.active,
          }
        : {
            name: formState.name.trim(),
            label: formState.name.trim(),
            slug: formState.slug.trim() || generatedSlug,
            value: formState.slug.trim() || generatedSlug,
            active: formState.active,
            is_active: formState.active,
            unit: activeCategory.includeUnit ? formState.unit.trim() : undefined,
            measurementUnit: activeCategory.includeUnit ? formState.unit.trim() : undefined,
          };

      if (editingItem?._id) {
        await updateDictionaryItem(`${activeCategory.endpoint}/${encodeURIComponent(String(editingItem._id))}`, payload);
      } else if (editingItem?.id !== undefined) {
        await updateDictionaryItem(`${activeCategory.endpoint}/${encodeURIComponent(String(editingItem.id))}`, payload);
      } else {
        await createDictionaryItem(activeCategory.endpoint, payload);
      }

      await refreshItems();
      setModalOpen(false);
      setEditingItem(null);
      setFormState(initialFormState);
      notifyApiToast({
        message: editingItem ? 'Item atualizado com sucesso.' : 'Item criado com sucesso.',
        type: 'success',
        duration: 3500,
      });
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.response?.data?.error || error?.message || 'Não foi possível salvar o item.';
      setFormError(message);
      notifyApiToast({
        message,
        type: 'error',
        duration: 4500,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivateItem = async (item: DictionaryItem) => {
    if (!activeCategory.editable) {
      notifyApiToast({
        message: 'Esta categoria é somente leitura no momento.',
        type: 'info',
        duration: 3500,
      });
      return;
    }

    const itemName = String(item.name || item.label || 'item').trim();
    if (!window.confirm(`Desativar "${itemName}"? O registro permanecerá no banco e deixará de aparecer nas opções do sistema.`)) {
      return;
    }

    const itemId = item._id ?? item.id;
    if (itemId === undefined || itemId === null) {
      notifyApiToast({
        message: 'Não foi possível identificar o item selecionado.',
        type: 'error',
        duration: 4000,
      });
      return;
    }

    try {
      setSaving(true);
      await deactivateDictionaryItem(`${activeCategory.endpoint}/${encodeURIComponent(String(itemId))}`);
      await refreshItems();
      notifyApiToast({
        message: 'Item desativado com sucesso.',
        type: 'success',
        duration: 3500,
      });
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.response?.data?.error || error?.message || 'Não foi possível desativar o item.';
      notifyApiToast({
        message,
        type: 'error',
        duration: 4500,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page data-dictionary-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dicionário de Dados</h1>
          <p className="page-subtitle">CRUD unificado das opções usadas pelo sistema, com desativação segura e rastreável.</p>
        </div>
      </div>

      <div className="data-dictionary-layout">
        <aside className="data-dictionary-sidebar">
          <Card className="data-dictionary-sidebar-card">
            <div className="data-dictionary-sidebar__header">
              <span className="data-dictionary-sidebar__eyebrow">Categoria de Dados</span>
              <p>Selecione a tabela de domínio que deseja administrar.</p>
            </div>

            <div className="data-dictionary-sidebar__list">
              {categories.map((category) => {
                const Icon = category.icon;
                const isActive = category.key === activeCategoryKey;

                return (
                  <button
                    key={category.key}
                    type="button"
                    className={`data-dictionary-category ${isActive ? 'is-active' : ''}`}
                    onClick={() => {
                      setActiveCategoryKey(category.key);
                      setPageError('');
                      setFormError('');
                      setCidSearchTerm('');
                      setCidPagination(EMPTY_CID_PAGINATION);
                    }}
                  >
                    <span className="data-dictionary-category__icon">
                      <Icon size={16} />
                    </span>
                    <span className="data-dictionary-category__content">
                      <strong>{category.label}</strong>
                      <small>{category.description}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>
        </aside>

        <main className="data-dictionary-main">
          <Card className="data-dictionary-panel">
            {activeCategoryKey === 'cids' && (
              <div className="data-dictionary-biomarker-requests" style={{ marginBottom: 16 }}>
                <h3>Busca Semantica ORPHA/HPO</h3>
                <CascadingSuggestion />
              </div>
            )}
            {/* Exibir solicitações pendentes de biomarcadores */}
            {activeCategoryKey === 'biomarkers' && (
              <div className="data-dictionary-biomarker-requests">
                <h3>Solicitações de Biomarcadores Pendentes</h3>
                {loadingBiomarkerRequests ? (
                  <div>Carregando solicitações...</div>
                ) : pendingBiomarkerRequests.length === 0 ? (
                  <div>Nenhuma solicitação pendente.</div>
                ) : (
                  <table className="biomarker-requests-table">
                    <thead>
                      <tr>
                        <th>Nome</th>
                        <th>Unidade</th>
                        <th>Justificativa</th>
                        <th>Data</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingBiomarkerRequests.map((req) => (
                        <tr key={req._id || req.biomarkerName + req.requestedAt}>
                          <td>{req.biomarkerName}</td>
                          <td>{req.measurementUnit}</td>
                          <td>{req.justification}</td>
                          <td>{req.requestedAt ? new Date(req.requestedAt).toLocaleString() : '-'}</td>
                          <td>{req.status || 'Pendente'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
            <div className="data-dictionary-toolbar">
              <div>
                <p className="data-dictionary-toolbar__eyebrow">Tabela Dinâmica</p>
                <h2>{activeCategory.label}</h2>
                <p>{activeCategory.description}</p>
              </div>

              <div className="data-dictionary-toolbar__actions">
                <div className="data-dictionary-metrics">
                  <span><strong>{isCidCategory ? cidPagination.total : items.length}</strong> registros</span>
                  <span><strong>{activeCount}</strong> ativos</span>
                </div>
                <Button type="button" onClick={openCreateModal} disabled={saving || !activeCategory.editable}>
                  <Plus size={16} />
                  {activeCategory.editable ? (isCidCategory ? 'Adicionar CID' : 'Adicionar Novo Item') : 'Catálogo somente leitura'}
                </Button>
              </div>
            </div>

            {isCidCategory && (
              <div className="data-dictionary-search-area">
                <div className="data-dictionary-search">
                  <Input
                    label="Buscar CID"
                    value={cidSearchTerm}
                    onChange={(event) => {
                      setCidSearchTerm(event.target.value);
                      setCidPagination((current) => ({ ...current, page: 1 }));
                    }}
                    placeholder="Digite código, descrição, ORPHA ou OMIM"
                    helperText={
                      loading
                        ? 'Buscando CIDs...'
                        : cidSearchTerm.trim().length === 1
                          ? 'Digite ao menos 2 caracteres para buscar.'
                          : 'Sem termo, a tela carrega o catálogo completo de CID.'
                    }
                  />
                </div>

                <div className="data-dictionary-pagination data-dictionary-pagination--top">
                  <div className="data-dictionary-pagination__summary">
                    <strong>
                      {cidPagination.total > 0
                        ? `${((cidPagination.page - 1) * cidPagination.limit) + 1}-${Math.min(cidPagination.page * cidPagination.limit, cidPagination.total)} de ${cidPagination.total}`
                        : 'Nenhum registro encontrado'}
                    </strong>
                    <span>
                      Página {cidPagination.page} de {Math.max(cidPagination.totalPages, 1)}
                    </span>
                  </div>

                  <div className="data-dictionary-pagination__actions">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setCidPagination((current) => ({ ...current, page: 1 }))}
                      disabled={loading || cidPagination.page <= 1}
                    >
                      Primeira
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setCidPagination((current) => ({ ...current, page: Math.max(1, current.page - 1) }))}
                      disabled={loading || cidPagination.page <= 1}
                    >
                      Anterior
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setCidPagination((current) => ({ ...current, page: current.page + 1 }))}
                      disabled={loading || !cidPagination.hasNext}
                    >
                      Próxima
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setCidPagination((current) => ({ ...current, page: Math.max(1, current.totalPages || current.page) }))}
                      disabled={loading || !cidPagination.hasNext}
                    >
                      Última
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {pageError && (
              <div className="data-dictionary-alert" role="alert">
                {pageError}
              </div>
            )}

            {loading ? (
              <div className="data-dictionary-empty">Carregando itens da categoria...</div>
            ) : items.length === 0 ? (
              <div className="data-dictionary-empty">
                {isCidCategory ? (
                  <>
                    <strong>Nenhum CID encontrado.</strong>
                    <p>
                      {cidSearchTerm.trim().length < 2
                        ? 'Digite ao menos 2 caracteres para iniciar a busca.'
                        : 'Refine o termo ou tente outro código/descrição.'}
                    </p>
                  </>
                ) : (
                  <>
                    <strong>Nenhum item cadastrado.</strong>
                    <p>Use o botão Adicionar Novo Item para criar o primeiro registro desta categoria.</p>
                  </>
                )}
              </div>
            ) : (
              <Table headers={tableHeaders}>
                {items.map((item) => {
                  const itemId = item._id ?? item.id;
                  const isActive = normalizeBoolean(item.active ?? item.is_active);
                  const itemName = isCidCategory
                    ? String(item.Descricao || '-').trim()
                    : String(item.name || item.label || '-').trim();
                  const itemSlug = isCidCategory
                    ? String(item.Codigo_Tabulacao || '-').trim()
                    : String(item.slug || item.value || '-').trim();
                  const itemUnit = String(item.unit || item.measurementUnit || '-').trim();
                  const itemCid10 = String(item.Codigos_CID10 || '-').trim();
                  const itemChapter = String(item.Capitulo || '-').trim();

                  // Garantir unicidade
                  return (
                    <tr key={`row-${itemId || itemSlug || itemName}`}>
                      {isCidCategory ? (
                        <>
                          <td>{itemSlug || '-'}</td>
                          <td>{itemCid10 || '-'}</td>
                          <td>{itemName || '-'}</td>
                          <td>{itemChapter || '-'}</td>
                          <td>
                            <span className={`data-dictionary-status ${isActive ? 'is-active' : 'is-inactive'}`}>
                              {isActive ? 'Ativo' : 'Inativo'}
                            </span>
                          </td>
                        </>
                      ) : (
                        <>
                          <td>{itemName}</td>
                          <td>{itemSlug}</td>
                          <td>
                            <span className={`data-dictionary-status ${isActive ? 'is-active' : 'is-inactive'}`}>
                              {isActive ? 'Ativo' : 'Inativo'}
                            </span>
                          </td>
                          {activeCategory.includeUnit && <td>{itemUnit || '-'}</td>}
                        </>
                      )}
                      <td>
                        <div className="data-dictionary-actions">
                          {activeCategory.editable ? (
                            <>
                              <button
                                type="button"
                                className="data-dictionary-action-button"
                                onClick={() => openEditModal(item)}
                                title="Editar"
                              >
                                <Edit2 size={16} />
                                <span>Editar</span>
                              </button>
                              <button
                                type="button"
                                className="data-dictionary-action-button data-dictionary-action-button--danger"
                                onClick={() => handleDeactivateItem(item)}
                                title="Desativar"
                                disabled={!isActive || saving}
                              >
                                <Ban size={16} />
                                <span>Desativar</span>
                              </button>
                            </>
                          ) : (
                            <span className="data-dictionary-readonly-note">Somente leitura</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </Table>
            )}

            {isCidCategory && cidPagination.totalPages > 1 && (
              <div className="data-dictionary-pagination data-dictionary-pagination--bottom">
                <div className="data-dictionary-pagination__summary">
                  <strong>
                    {cidPagination.total > 0
                      ? `${((cidPagination.page - 1) * cidPagination.limit) + 1}-${Math.min(cidPagination.page * cidPagination.limit, cidPagination.total)} de ${cidPagination.total}`
                      : 'Nenhum registro encontrado'}
                  </strong>
                  <span>
                    Página {cidPagination.page} de {Math.max(cidPagination.totalPages, 1)}
                  </span>
                </div>

                <div className="data-dictionary-pagination__actions">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setCidPagination((current) => ({ ...current, page: 1 }))}
                    disabled={loading || cidPagination.page <= 1}
                  >
                    Primeira
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setCidPagination((current) => ({ ...current, page: Math.max(1, current.page - 1) }))}
                    disabled={loading || cidPagination.page <= 1}
                  >
                    Anterior
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setCidPagination((current) => ({ ...current, page: current.page + 1 }))}
                    disabled={loading || !cidPagination.hasNext}
                  >
                    Próxima
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setCidPagination((current) => ({ ...current, page: Math.max(1, current.totalPages || current.page) }))}
                    disabled={loading || !cidPagination.hasNext}
                  >
                    Última
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </main>
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editingItem ? (isCidCategory ? 'Editar CID' : 'Editar Item do Dicionário') : (isCidCategory ? 'Adicionar CID' : 'Adicionar Novo Item')}
      >
        <div className="data-dictionary-modal">
          <div className="data-dictionary-modal__meta">
            <strong>{activeCategory.label}</strong>
            <p>{activeCategory.description}</p>
          </div>

          <div className="data-dictionary-modal__grid">
            {isCidCategory ? (
              <>
                <Input
                  label="Código de Tabulação"
                  value={formState.codigoTabulacao}
                  onChange={handleFieldChange('codigoTabulacao')}
                  placeholder="Ex.: E11"
                  required
                />

                <Input
                  label="Código CID10"
                  value={formState.codigosCid10}
                  onChange={handleFieldChange('codigosCid10')}
                  placeholder="Ex.: E11.9"
                  required
                />

                <Input
                  label="Código ORPHA"
                  value={formState.orpha}
                  onChange={handleFieldChange('orpha')}
                  placeholder="Ex.: ORPHA:123"
                />

                <Input
                  label="Código OMIM"
                  value={formState.omim}
                  onChange={handleFieldChange('omim')}
                  placeholder="Ex.: 123456"
                />

                <Input
                  label="Capítulo"
                  value={formState.capitulo}
                  onChange={handleFieldChange('capitulo')}
                  placeholder="Ex.: Capítulo IV - Endócrinas"
                />

                <div className="data-dictionary-modal__textarea-field">
                  <Textarea
                    label="Descrição"
                    value={formState.descricao}
                    onChange={handleFieldChange('descricao')}
                    placeholder="Ex.: Diabetes mellitus tipo 2 sem complicações"
                    rows={4}
                    required
                  />
                </div>
              </>
            ) : (
              <>
                <Input
                  label="Nome do item"
                  value={formState.name}
                  onChange={handleFieldChange('name')}
                  placeholder="Ex.: Plasma"
                  required
                />

                <Input
                  label="Valor interno (slug)"
                  value={formState.slug || generatedSlug}
                  readOnly
                  disabled
                  helperText="Gerado automaticamente a partir do nome do item."
                />

                {activeCategory.includeUnit && (
                  <Input
                    label="Unidade de Medida"
                    value={formState.unit}
                    onChange={handleFieldChange('unit')}
                    placeholder="Ex.: U/mL"
                    required
                  />
                )}
              </>
            )}

            <label className="data-dictionary-modal__switch">
              <input
                type="checkbox"
                checked={formState.active}
                onChange={handleFieldChange('active')}
              />
              <span>
                <strong>Item ativo</strong>
                <small>Itens inativos continuam no banco, mas saem das opções do sistema.</small>
              </span>
            </label>
          </div>

          {formError && (
            <div className="data-dictionary-modal__error" role="alert">
              {formError}
            </div>
          )}

          <div className="data-dictionary-modal__actions">
            <Button type="button" variant="secondary" onClick={closeModal} disabled={saving}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleSaveItem} disabled={saving || !activeCategory.editable}>
              {saving ? 'Salvando...' : editingItem ? 'Salvar Alterações' : isCidCategory ? 'Criar CID' : 'Criar Item'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
