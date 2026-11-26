import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Bold,
  FileDown,
  FileText,
  History,
  Italic,
  List,
  ListOrdered,
  Plus,
  Save,
  Sparkles,
  Type,
  Underline,
  X,
} from 'lucide-react';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import Spinner from '../components/UI/Spinner';
import { useToast } from '../components/UI/ToastContainer';
import { consentService } from '../services/api';
import type { ConsentTemplate, ConsentPolicy, PurposeCode } from '../types/models';
import { describeConsentPublication, type ConsentNotificationCounts } from './tclePublication';

type PreviewValueMap = Record<string, string>;

type ConsentItemDraft = {
  id: string;
  label: string;
  required: boolean;
  // RF010 AC3 (#1349): the governed purpose (a GA4GH DUO code) the
  // permission covers, which an access decision is judged against.
  purposeCode?: string;
};

const PREVIEW_VALUES: PreviewValueMap = {
  titulo_projeto: '______________________',
  nome_pesquisador: '______________________',
  numero_caae: '______________________',
  nome_participante: '______________________',
  id_paciente_sistema: '______________________',
  id_amostra: '______________________',
};

const FIXED_HEADER_TEMPLATE = `PROJETO: {{titulo_projeto}}
PESQUISADOR: {{nome_pesquisador}} | CAAE: {{numero_caae}}
PARTICIPANTE: {{nome_participante}} | ID PACIENTE: {{id_paciente_sistema}} | ID AMOSTRA: {{id_amostra}}`;

const FIXED_CONSENT_DECLARATION = 'Eu, {{nome_participante}}, declaro que fui devidamente esclarecido(a) e concordo voluntariamente em participar deste estudo, nos termos apresentados neste documento.';

const FIXED_SIGNATURE_PARTICIPANT = 'Assinatura do participante';
const FIXED_SIGNATURE_RESEARCHER = 'Assinatura do pesquisador/responsável';
const TEST_PDF_GENERIC_FIELDS = [
  'Nome do participante: ______________________',
  'CPF/Documento: ______________________',
  'Data: ____/____/______',
];
const TEST_PDF_SIGNATURE_FIELDS = [
  'Assinatura do participante: ______________________',
  'Assinatura do pesquisador/responsável: ______________________',
];

const DEFAULT_BODY_HTML = '';

function createId() {
  return globalThis.crypto?.randomUUID?.() || `tcle-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function replaceProtectedTags(html: string, values: PreviewValueMap) {
  return String(html || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_match, rawKey) => {
    const key = String(rawKey).toLowerCase();
    const replacement = values[key];
    if (!replacement) {
      return `{{${key}}}`;
    }
    return escapeHtml(replacement);
  });
}

function stripHtml(html: string) {
  return String(html || '')
    .replace(/<br\s*\/?\>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitle(value: string) {
  return String(value || '').trim().toLowerCase();
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function toDateInputValue(value?: Date | string | null) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toIsoDateString(value: string, endOfDay = false) {
  const suffix = endOfDay ? '23:59:59.999' : '12:00:00.000';
  return new Date(`${value}T${suffix}`).toISOString();
}

function unwrapSingleResponse(response: any) {
  return response?.data?.data ?? response?.data ?? null;
}

function unwrapListResponse(response: any) {
  const payload = response?.data?.data ?? response?.data;
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.items)) {
    return payload.items;
  }

  return [];
}

function createDraftItem(label = '', required = false): ConsentItemDraft {
  return {
    id: createId(),
    label,
    required,
  };
}

function normalizeDraftItems(items: Array<Partial<ConsentItemDraft> | null | undefined> | undefined) {
  const normalized = (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: createId(),
      label: String(item?.label || '').trim(),
      required: Boolean(item?.required),
      ...(item?.purposeCode ? { purposeCode: String(item.purposeCode) } : {}),
    }))
    .filter((item) => item.label.length > 0);

  return normalized.length > 0 ? normalized : [createDraftItem()];
}

function normalizeGranularPermissions(items: ConsentItemDraft[]) {
  const usedKeys = new Set<string>();

  function hashKey(str: string) {
    // Simple hash: djb2
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return Math.abs(hash).toString(36).slice(0, 8); // 8 chars max
  }

  return items
    .map((item, index) => {
      const label = String(item.label || '').trim();
      if (!label) {
        return null;
      }

      const hash = hashKey(label);
      let key = `consent_${hash}`;
      let suffix = 2;

      while (usedKeys.has(key)) {
        key = `consent_${hash}_${suffix}`;
        suffix += 1;
      }

      usedKeys.add(key);

      return {
        key,
        label,
        required: Boolean(item.required),
        ...(item.purposeCode ? { purposeCode: item.purposeCode } : {}),
      };
    })
    .filter(Boolean) as Array<{ key: string; label: string; required: boolean; purposeCode?: string }>;
}

function formatDate(value?: Date | string | null) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return 'Sem validade definida';
  }

  return date.toLocaleDateString('pt-BR');
}

function getConsentValidityValue(item: Partial<ConsentPolicy & ConsentTemplate>) {
  const aliases = [
    item.validTo,
    item.validUntil,
    item.validityDate,
    item.expirationDate,
    item.expiresAt,
    item.validade,
  ];
  const directValue = aliases.find((value) => String(value || '').trim());
  if (directValue) {
    return directValue;
  }

  const vigencia = item.vigencia;
  if (vigencia && typeof vigencia === 'object') {
    return vigencia.validTo || vigencia.validUntil || vigencia.endDate || vigencia.fim || null;
  }

  return null;
}

function getErrorMessage(error: any, fallback: string) {
  return error?.response?.data?.message || error?.response?.data?.error || error?.message || fallback;
}

function buildPrintablePolicyHtml(policy: ConsentPolicy) {
  const headerHtml = replaceProtectedTags(FIXED_HEADER_TEMPLATE, PREVIEW_VALUES);
  const acceptanceHtml = replaceProtectedTags(FIXED_CONSENT_DECLARATION, PREVIEW_VALUES);
  const bodyHtml = replaceProtectedTags(String(policy.htmlContent || '').trim() || DEFAULT_BODY_HTML.trim(), PREVIEW_VALUES);
  const granularPermissions = Array.isArray(policy.granularPermissions) ? policy.granularPermissions : [];
  const printableTitle = escapeHtml(`${policy.version || 'v?'} - ${policy.title || 'TCLE'}`);

  return `<!doctype html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${printableTitle}</title>
      <style>
        * { box-sizing: border-box; }
        body {
          margin: 0;
          padding: 24px;
          font-family: Arial, Helvetica, sans-serif;
          color: #0f172a;
          background: #f8fafc;
        }
        .sheet {
          max-width: 820px;
          margin: 0 auto;
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
        }
        .block { padding: 24px; }
        .fixed {
          background: #f1f5f9;
          border-top: 1px solid #e2e8f0;
          border-bottom: 1px solid #e2e8f0;
        }
        .eyebrow {
          display: inline-block;
          margin-bottom: 14px;
          padding: 4px 10px;
          border-radius: 999px;
          background: #e2e8f0;
          color: #334155;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .static-text {
          margin: 0;
          white-space: pre-line;
          line-height: 1.75;
          font-size: 14px;
          color: #0f172a;
        }
        .title {
          margin: 0 0 10px 0;
          font-size: 24px;
        }
        .body { line-height: 1.75; font-size: 15px; }
        .body p { margin: 0 0 12px 0; }
        .body h2, .body h3 { margin: 20px 0 10px 0; }
        .consent-list {
          margin-top: 20px;
          padding: 18px 20px;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          background: #f8fafc;
          page-break-inside: avoid;
        }
        .consent-list h4 {
          margin: 0 0 12px 0;
          font-size: 15px;
          font-weight: 700;
        }
        .consent-list ul {
          margin: 0;
          padding-left: 22px;
        }
        .consent-list li {
          margin-bottom: 10px;
          font-size: 14px;
          line-height: 1.7;
          word-break: break-word;
        }
        .acceptance-note {
          margin: 0;
          line-height: 1.75;
          font-size: 15px;
        }
        .generic-fields {
          display: grid;
          gap: 12px;
          margin: 18px 0 0 0;
          padding: 0;
          list-style: none;
          font-size: 14px;
          color: #0f172a;
        }
        .signature-grid {
          display: grid;
          gap: 18px;
          margin-top: 20px;
        }
        .signature-line {
          min-height: 76px;
          display: grid;
          align-content: end;
          gap: 10px;
          color: #475569;
          font-size: 14px;
        }
        .signature-line::before {
          content: '';
          display: block;
          border-top: 1px solid #94a3b8;
        }
        .signature-line span {
          display: block;
          padding-top: 8px;
          color: #475569;
        }
        @page { size: A4; margin: 18mm; }
      </style>
    </head>
    <body>
      <article class="sheet">
        <section class="block fixed">
          <div class="eyebrow">Cabeçalho fixo</div>
          <pre class="static-text">${headerHtml}</pre>
        </section>
        <section class="block">
          <div class="eyebrow">Bloco editável</div>
          <div class="body">${bodyHtml}</div>
          ${granularPermissions.length > 0 ? `
            <div class="consent-list">
              <h4>Consentimentos granulares</h4>
              <ul>
                ${granularPermissions.map((permission) => `<li>${permission.required ? '[x]' : '[ ]'} ${escapeHtml(permission.label)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
        </section>
        <section class="block fixed">
          <div class="eyebrow">Aceite e assinaturas</div>
          <p class="acceptance-note">${acceptanceHtml}</p>
          <ul class="generic-fields">
            ${TEST_PDF_GENERIC_FIELDS.map((field) => `<li>${escapeHtml(field)}</li>`).join('')}
          </ul>
          <div class="signature-grid">
            ${TEST_PDF_SIGNATURE_FIELDS.map((field) => `<div class="signature-line"><span>${escapeHtml(field)}</span></div>`).join('')}
          </div>
        </section>
      </article>
      <script>
        window.addEventListener('load', () => {
          window.setTimeout(() => {
            window.print();
          }, 150);
        });

        window.addEventListener('afterprint', () => {
          window.close();
        });
      </script>
    </body>
  </html>`;
}

function openPrintablePolicy(policy: ConsentPolicy) {
  const html = buildPrintablePolicyHtml(policy);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const printFrame = document.createElement('iframe');

  printFrame.style.position = 'fixed';
  printFrame.style.right = '0';
  printFrame.style.bottom = '0';
  printFrame.style.width = '0';
  printFrame.style.height = '0';
  printFrame.style.border = '0';
  printFrame.style.opacity = '0';
  printFrame.setAttribute('aria-hidden', 'true');
  printFrame.src = blobUrl;

  const cleanup = () => {
    try {
      URL.revokeObjectURL(blobUrl);
    } catch {
      // Ignora falhas de limpeza.
    }

    printFrame.remove();
  };

  printFrame.onload = () => {
    const frameWindow = printFrame.contentWindow;
    if (!frameWindow) {
      cleanup();
      return;
    }

    const triggerPrint = () => {
      try {
        frameWindow.focus();
        frameWindow.print();
      } catch {
        cleanup();
      }
    };

    frameWindow.addEventListener('afterprint', cleanup, { once: true });
    window.setTimeout(triggerPrint, 300);
  };

  document.body.appendChild(printFrame);
}

function defaultConsentItems() {
  return [createDraftItem()];
}

export default function TcleBuilderPage() {
  const { templateId } = useParams<{ templateId?: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const editorRef = useRef<HTMLDivElement | null>(null);
  const isEditing = Boolean(templateId);

  const [activeTab, setActiveTab] = useState<'editor' | 'history'>('editor');
  const [title, setTitle] = useState('');
  const [caae, setCaae] = useState('');
  // RF010 AC1 (ENUM-0043..0046): the modality the term offers, which each
  // Consent signed on it records (ELM-0095).
  const [consentModel, setConsentModel] = useState<NonNullable<ConsentTemplate['consentModel']> | ''>('');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [bodyHtml, setBodyHtml] = useState(DEFAULT_BODY_HTML.trim());
  const [consentItems, setConsentItems] = useState<ConsentItemDraft[]>(() => defaultConsentItems());
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadedTemplate, setLoadedTemplate] = useState<ConsentTemplate | null>(null);
  const [historyAnchorTitle, setHistoryAnchorTitle] = useState('');
  const [historyGroupId, setHistoryGroupId] = useState('');
  const [historyItems, setHistoryItems] = useState<ConsentPolicy[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [editorReady, setEditorReady] = useState(false);
  const [purposeCodes, setPurposeCodes] = useState<PurposeCode[]>([]);

  const normalizedBody = useMemo(() => stripHtml(bodyHtml), [bodyHtml]);
  const currentModelTitle = useMemo(() => normalizeTitle(historyAnchorTitle || title), [historyAnchorTitle, title]);
  const hasHistoryAnchor = useMemo(() => Boolean(historyGroupId.trim() || currentModelTitle), [historyGroupId, currentModelTitle]);
  const granularPermissionsPreview = useMemo(() => normalizeGranularPermissions(consentItems), [consentItems]);
  const activeHistoryEntry = useMemo(() => historyItems.find((item) => item.active) || historyItems[0] || null, [historyItems]);
  const versionSummary = useMemo(() => ({
    total: historyItems.length,
    active: historyItems.filter((item) => item.active).length,
    obsolete: historyItems.filter((item) => !item.active).length,
  }), [historyItems]);

  // #1349: the active DUO purposes a permission may name. A failed load
  // leaves the select with "no purpose" only; publishing still works.
  useEffect(() => {
    let active = true;
    consentService.getPurposeCodes()
      .then((response) => {
        if (active) setPurposeCodes(Array.isArray(response.data?.data) ? response.data.data : []);
      })
      .catch(() => {
        if (active) setPurposeCodes([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const nextHtml = bodyHtml || DEFAULT_BODY_HTML.trim();
    if (editor.innerHTML !== nextHtml) {
      editor.innerHTML = nextHtml;
    }
    // Set default text alignment to justified
    editor.style.textAlign = 'justify';
  }, [bodyHtml, editorReady, activeTab]);

  useEffect(() => {
    let active = true;

    const loadTemplate = async () => {
      if (!templateId) {
        setLoadedTemplate(null);
        setTitle('');
          setCaae('');
          setValidFrom('');
          setValidTo('');
        setBodyHtml(DEFAULT_BODY_HTML.trim());
        setConsentItems(defaultConsentItems());
        setHistoryAnchorTitle('');
        setHistoryGroupId('');
        setLoadingTemplate(false);
        return;
      }

      setLoadingTemplate(true);
      try {
        const response = await consentService.getTemplateById(templateId);
        const template = unwrapSingleResponse(response) as ConsentTemplate | null;

        if (!active) {
          return;
        }

        if (!template) {
          throw new Error('TCLE não encontrado para edição.');
        }

        setLoadedTemplate(template);
        setTitle(String(template.title || ''));
        setCaae(String(template.caae || ''));
        setConsentModel(template.consentModel || '');
        setValidFrom(toDateInputValue(template.validFrom || null));
        setValidTo(toDateInputValue(template.validTo || null));
        setBodyHtml(String(template.htmlContent || template.content || DEFAULT_BODY_HTML.trim()));
        setConsentItems(normalizeDraftItems(template.granularPermissions || template.permissions));
        setHistoryAnchorTitle(String(template.title || ''));
        setHistoryGroupId(String(template.versionGroupId || '').trim());
      } catch (error: any) {
        if (!active) {
          return;
        }

        showToast(getErrorMessage(error, 'Não foi possível carregar o TCLE selecionado.'), 'error');
        navigate('/admin/tcle/new', { replace: true });
      } finally {
        if (active) {
          setLoadingTemplate(false);
        }
      }
    };

    void loadTemplate();

    return () => {
      active = false;
    };
  }, [navigate, showToast, templateId]);

  useEffect(() => {
    let active = true;
    const query = currentModelTitle;
    const groupId = historyGroupId.trim();

    const timer = window.setTimeout(() => {
      void (async () => {
        setHistoryLoading(true);
        setHistoryError('');
        try {
          const response = await consentService.getTemplates();
          const templates = unwrapListResponse(response) as ConsentTemplate[];
          const normalizedQuery = normalizeTitle(query);
          const filtered = templates
            .filter((template) => {
              if (groupId) {
                return String(template?.versionGroupId || '').trim() === groupId;
              }

              if (normalizedQuery) {
                return normalizeTitle(template?.title || '') === normalizedQuery;
              }

              // Without an anchor model, show the full persisted history list.
              return true;
            })
            .sort((a, b) => new Date(String(b?.createdAt || 0)).getTime() - new Date(String(a?.createdAt || 0)).getTime());

          if (active) {
            setHistoryItems(filtered as any);
          }
        } catch (error: any) {
          if (active) {
            setHistoryItems([]);
            setHistoryError(error?.message || 'Não foi possível carregar o histórico de versões.');
          }
        } finally {
          if (active) {
            setHistoryLoading(false);
          }
        }
      })();
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [currentModelTitle, historyGroupId]);

  const updateEditorState = (editor: HTMLDivElement) => {
    setBodyHtml(editor.innerHTML);
  };

  // The toolbar renders only beside the editor, so the ref is set on every click.
  const applyFormat = (command: string, value?: string) => {
    const editor = editorRef.current as HTMLDivElement;
    editor.focus();
    document.execCommand(command, false, value);
    updateEditorState(editor);
  };

  const addConsentItem = () => {
    setConsentItems((current) => [...current, createDraftItem()]);
  };

  const updateConsentItem = (id: string, patch: Partial<ConsentItemDraft>) => {
    setConsentItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const removeConsentItem = (id: string) => {
    setConsentItems((current) => {
      const nextItems = current.filter((item) => item.id !== id);
      return nextItems.length > 0 ? nextItems : [createDraftItem()];
    });
  };


  const openPrintableView = (policy: ConsentPolicy) => {
    if (!policy?._id) {
      showToast('Não foi possível abrir a visualização em PDF.', 'warning');
      return;
    }

    openPrintablePolicy(policy);
  };

  const handleSave = async () => {
    const trimmedTitle = title.trim();
    const normalizedBodyText = stripHtml(bodyHtml);

    if (!trimmedTitle || !validFrom || !validTo || !normalizedBodyText) {
      showToast('Preencha o nome do modelo, as datas de vigência e o corpo do termo antes de salvar.', 'warning');
      return;
    }

    if (new Date(`${validTo}T12:00:00.000`).getTime() < new Date(`${validFrom}T12:00:00.000`).getTime()) {
      showToast('A data final de vigência deve ser maior ou igual à data inicial.', 'warning');
      return;
    }

    const normalizedPermissions = normalizeGranularPermissions(consentItems);
    if (normalizedPermissions.length === 0) {
      showToast('Adicione ao menos um consentimento granular antes de salvar.', 'warning');
      return;
    }

    const payload = {
      title: trimmedTitle,
      ...(caae.trim() ? { caae: caae.trim() } : {}),
      ...(consentModel ? { consentModel } : {}),
      htmlContent: bodyHtml.trim(),
      content: bodyHtml.trim(), // Ensure 'content' is sent for backend validation
      ...(activeHistoryEntry?.version ? { version: String(activeHistoryEntry.version).trim() } : {}),
      validFrom: toIsoDateString(validFrom),
      validTo: toIsoDateString(validTo, true),
      active: true,
      permissions: normalizedPermissions,
    };

    setSaving(true);
    try {
      const response = isEditing && templateId
        ? await consentService.updateTemplate(templateId, payload)
        : await consentService.createTemplate(payload);

      const savedTemplate = unwrapSingleResponse(response) as ConsentTemplate | null;
      if (!savedTemplate || !savedTemplate._id) {
        throw new Error('O servidor não retornou a nova versão do TCLE.');
      }

      setLoadedTemplate(savedTemplate);
      setTitle(String(savedTemplate.title || trimmedTitle));
      setCaae(String(savedTemplate.caae || caae));
      setConsentModel(savedTemplate.consentModel || consentModel);
      setValidFrom(toDateInputValue(savedTemplate.validFrom || null));
      setValidTo(toDateInputValue(savedTemplate.validTo || null));
      setBodyHtml(String(savedTemplate.htmlContent || savedTemplate.content || DEFAULT_BODY_HTML.trim()));
      setConsentItems(normalizeDraftItems(savedTemplate.granularPermissions || savedTemplate.permissions));
      setHistoryAnchorTitle(String(savedTemplate.title || trimmedTitle));
      setHistoryGroupId(String(savedTemplate.versionGroupId || '').trim());

      if (editorRef.current) {
        editorRef.current.innerHTML = String(savedTemplate.htmlContent || savedTemplate.content || DEFAULT_BODY_HTML.trim());
      }

      // #824: publishing now runs the consent-invitation sweep; say what it did.
      const publication = describeConsentPublication(
        Boolean(isEditing),
        (savedTemplate as ConsentTemplate & { consentNotifications?: ConsentNotificationCounts }).consentNotifications
      );
      showToast(publication.message, publication.level);

      navigate(`/admin/tcle/edit/${savedTemplate._id}`, { replace: true });
    } catch (error: any) {
      showToast(getErrorMessage(error, 'Não foi possível salvar o TCLE.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell tcle-builder-page">
      <div className="card-surface">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-primary">
          <Sparkles size={15} />
          <span>Gestão de Consentimento</span>
        </div>
        <h1 className="page-title">Construtor de TCLE</h1>
        <p className="page-subtitle">
          Estruture o TCLE no padrão do wizard: cabeçalho e aceite fixos, corpo e itens granulares editáveis e vigência preenchida manualmente.
        </p>
      </div>

      <Card className="card-surface border-primary/20 bg-primary-soft/30 p-4 text-sm" data-testid="tcle-builder-instructions">
        <h2 className="mb-2 text-base font-semibold">Como usar este construtor (G7)</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
          <li>
            <strong className="text-foreground">Rascunho vs publicado:</strong> antes de salvar, o conteúdo é apenas local. Ao clicar em criar/salvar versão, a revisão é <strong>publicada</strong> e passa a vigorar para novos consentimentos; versões anteriores da mesma família são desativadas no histórico.
          </li>
          <li>
            <strong className="text-foreground">Placeholders:</strong> use <code>{'{{titulo_projeto}}'}</code>, <code>{'{{nome_participante}}'}</code>, <code>{'{{id_amostra}}'}</code> (e demais chaves do cabeçalho) — substituídos na pré-visualização e no PDF de teste.
          </li>
          <li>
            <strong className="text-foreground">DUO (GA4GH):</strong> em cada consentimento granular, informe o código de finalidade (DUO) que fundamenta o uso dos dados na decisão de acesso.
          </li>
          <li>
            <strong className="text-foreground">PDF de teste:</strong> no histórico ou após salvar, use o botão PDF para validar layout, cabeçalho fixo e linhas de assinatura antes de convidar participantes.
          </li>
          <li>
            <strong className="text-foreground">Não confundir:</strong> este TCLE é consentimento de <em>pesquisa</em> com participantes (e-mail, link, gov.br/ICP no fluxo e-consent). Termos de uso e Política do produto (tenant) ficam em <code>/legal/*</code> e no Runbook.
          </li>
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Smoke sugerido: criar modelo → salvar/publicar → abrir PDF → conferir histórico de versões.
        </p>
      </Card>

      <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1" role="tablist" aria-label="Navegação do construtor de TCLE">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'editor'}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${
            activeTab === 'editor' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-primary-soft'
          }`}
          onClick={() => setActiveTab('editor')}
        >
          <FileText size={16} />
          Edição do TCLE
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'history'}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${
            activeTab === 'history' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-primary-soft'
          }`}
          onClick={() => setActiveTab('history')}
        >
          <History size={16} />
          Histórico de Versões
        </button>
      </div>

      {activeTab === 'editor' ? (
        <form id="tcle-builder-form" className="space-y-4" onSubmit={(event) => { event.preventDefault(); void handleSave(); }}>
          <Card className="card-surface space-y-4 border-border p-4 shadow-sm">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Nome do Modelo"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Ex.: TCLE Biobanco Genômico"
                helperText="Identifica a família documental que será versionada."
              />
              <Input
                label="CAAE"
                value={caae}
                onChange={(event) => setCaae(event.target.value)}
                placeholder="Ex.: 12345678.9.0000.0000"
                helperText="Informe o número CAAE associado a esta versão do TCLE."
              />
              <div className="input-group">
                <label className="input-label mb-1.5 text-sm font-semibold text-gray-700" htmlFor="tcleConsentModel">Modalidade de Consentimento</label>
                <select
                  id="tcleConsentModel"
                  className="input w-full rounded-lg border border-gray-300 px-3 py-2"
                  data-testid="tcle-consent-model-select"
                  value={consentModel}
                  onChange={(event) => setConsentModel(event.target.value as typeof consentModel)}
                >
                  <option value="">Não informada</option>
                  <option value="specific">Específico</option>
                  <option value="broad">Amplo</option>
                  <option value="tiered">Escalonado</option>
                  <option value="dynamic">Dinâmico</option>
                </select>
              </div>
              <Input
                label="Data de Início da Vigência"
                type="date"
                value={validFrom}
                onChange={(event) => setValidFrom(event.target.value)}
                helperText="Preenchimento manual. Não existe cálculo automático."
              />
              <Input
                label="Data Final de Vigência"
                type="date"
                value={validTo}
                onChange={(event) => setValidTo(event.target.value)}
                helperText="Defina manualmente a data final do documento."
              />
            </div>

            <div className="tcle-builder-page__meta-strip tcle-builder-page__meta-strip--single-row">
              <div>
                <span>Versão ativa</span>
                <strong>{activeHistoryEntry?.version || 'v1'}</strong>
              </div>
              <div>
                <span>CAAE</span>
                <strong>{caae.trim() || activeHistoryEntry?.caae || '--'}</strong>
              </div>
              <div>
                <span>Itens granulares</span>
                <strong>{granularPermissionsPreview.length}</strong>
              </div>
              <div>
                <span>Corpo</span>
                <strong>{normalizedBody ? `${normalizedBody.length} caracteres` : 'Vazio'}</strong>
              </div>
              <div>
                <span>Modo</span>
                <strong>{isEditing ? 'Edição versionada' : 'Criação da 1ª versão'}</strong>
              </div>
            </div>

            <p className="tcle-builder-document-note">
              O sistema renderiza o cabeçalho e o termo de aceite como blocos fixos. Apenas o corpo explicativo e os consentimentos granulares ficam editáveis.
            </p>

            <div className="tcle-builder-document-shell">
              <section className="tcle-builder-document-block tcle-builder-document-block--fixed">
                <div className="tcle-builder-document-block__eyebrow">Bloco 1 - Cabeçalho fixo</div>
                <div className="tcle-builder-document-block__static tcle-builder-document-block__static--locked">
                  <pre className="tcle-builder-document-block__pre">{FIXED_HEADER_TEMPLATE}</pre>
                </div>
              </section>

              <section className="tcle-builder-document-block">
                <div className="tcle-builder-document-block__header">
                  <div>
                    <div className="tcle-builder-document-block__eyebrow">Bloco 2 - Corpo explicativo</div>
                    <h2>Corpo do Termo</h2>
                  </div>
                  <span className="tcle-builder-status-badge tcle-builder-status-badge--interactive">Editor rico</span>
                </div>

                <div className="tcle-builder-toolbar" role="toolbar" aria-label="Ferramentas do editor de TCLE">
                  <Button type="button" variant="secondary" className="btn-small btn-ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat('bold')}>
                    <Bold size={14} />
                    Negrito
                  </Button>
                  <Button type="button" variant="secondary" className="btn-small btn-ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat('italic')}>
                    <Italic size={14} />
                    Itálico
                  </Button>
                  <Button type="button" variant="secondary" className="btn-small btn-ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat('underline')}>
                    <Underline size={14} />
                    Sublinhado
                  </Button>
                  <Button type="button" variant="secondary" className="btn-small btn-ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat('insertUnorderedList')}>
                    <List size={14} />
                    Lista
                  </Button>
                  <Button type="button" variant="secondary" className="btn-small btn-ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat('insertOrderedList')}>
                    <ListOrdered size={14} />
                    Lista numerada
                  </Button>
                  <Button type="button" variant="secondary" className="btn-small btn-ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat('formatBlock', 'h2')}>
                    <Type size={14} />
                    Título
                  </Button>
                </div>

                <div
                  ref={editorRef}
                  className="tcle-builder-editor"
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  aria-multiline="true"
                  aria-label="Editor do corpo do TCLE"
                  onInput={(event) => updateEditorState(event.currentTarget)}
                  onBlur={(event) => updateEditorState(event.currentTarget)}
                  onFocus={() => setEditorReady(true)}
                  style={{ textAlign: 'justify' }}
                />
              </section>

              <section className="tcle-builder-document-block">
                <div className="tcle-builder-document-block__header">
                  <div>
                    <div className="tcle-builder-document-block__eyebrow">Bloco 3 - Consentimentos granulares</div>
                    <h2>Itens de Aceite</h2>
                  </div>
                  <Button type="button" variant="secondary" className="btn-small" onClick={addConsentItem}>
                    <Plus size={14} />
                    Adicionar consentimento
                  </Button>
                </div>

                <div className="tcle-builder-consent-list">
                  {consentItems.map((item, index) => {
                    const hashKey = (str: string) => {
                      let hash = 5381;
                      for (let i = 0; i < str.length; i++) {
                        hash = ((hash << 5) + hash) + str.charCodeAt(i);
                      }
                      return Math.abs(hash).toString(36).slice(0, 8);
                    };
                    const generatedKey = item.label ? `consent_${hashKey(item.label)}` : `consent_item_${index + 1}`;

                    return (
                      <div key={item.id} className="tcle-builder-consent-item">
                        <div className="tcle-builder-consent-item__main">
                          <div className="tcle-builder-consent-item__field">
                            <label htmlFor={`consent-label-${item.id}`}>Texto do consentimento</label>
                            <input
                              id={`consent-label-${item.id}`}
                              value={item.label}
                              onChange={(event) => updateConsentItem(item.id, { label: event.target.value })}
                              placeholder="Ex.: Aceito ceder minhas amostras para estudos genéticos"
                            />
                            <span className="tcle-builder-consent-item__meta">Chave automática: {generatedKey}</span>
                          </div>
                          <label className="tcle-builder-consent-item__toggle">
                            <input
                              type="checkbox"
                              checked={item.required}
                              onChange={(event) => updateConsentItem(item.id, { required: event.target.checked })}
                            />
                            Checkbox obrigatório
                          </label>
                          <div className="tcle-builder-consent-item__field">
                            <label htmlFor={`consent-purpose-${item.id}`}>Finalidade (DUO)</label>
                            <select
                              id={`consent-purpose-${item.id}`}
                              data-testid={`consent-purpose-${index + 1}`}
                              value={item.purposeCode || ''}
                              onChange={(event) => updateConsentItem(item.id, { purposeCode: event.target.value || undefined })}
                            >
                              <option value="">Sem finalidade codificada</option>
                              {purposeCodes.map((purpose) => (
                                <option key={purpose.code} value={purpose.code}>
                                  {purpose.display} ({purpose.code})
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <Button type="button" variant="secondary" className="btn-small btn-ghost tcle-builder-consent-item__remove" onClick={() => removeConsentItem(item.id)}>
                          <X size={14} />
                          Remover item
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="tcle-builder-document-block tcle-builder-document-block--fixed">
                <div className="tcle-builder-document-block__eyebrow">Bloco 4 - Aceite e assinaturas</div>
                <div className="tcle-builder-document-block__static tcle-builder-document-block__static--locked">
                  <p className="tcle-builder-document-block__static-text">{FIXED_CONSENT_DECLARATION}</p>
                  <div className="tcle-builder-signature-block">
                    <div className="tcle-builder-signature-line">
                      <span>___________________________________________________</span>
                      <strong>{FIXED_SIGNATURE_PARTICIPANT}</strong>
                    </div>
                    <div className="tcle-builder-signature-line">
                      <span>___________________________________________________</span>
                      <strong>{FIXED_SIGNATURE_RESEARCHER}</strong>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            {loadingTemplate ? (
              <div className="tcle-builder-loading tcle-builder-loading--single">
                <Spinner size="sm" />
                <span>Carregando TCLE...</span>
              </div>
            ) : null}

            <div className="tcle-builder-document-actions">
              <Button
                variant="primary"
                type="submit"
                disabled={saving || loadingTemplate || !title.trim() || !validFrom || !validTo || !normalizedBody || granularPermissionsPreview.length === 0}
              >
                {saving ? <Spinner size="sm" /> : <Save size={16} />}
                {saving ? 'Salvando versão...' : isEditing ? 'Salvar nova versão do TCLE' : 'Criar versão do TCLE'}
              </Button>
            </div>
          </Card>
        </form>
      ) : (
        <div className="tcle-builder-history-layout">
          <Card className="tcle-builder-card tcle-builder-card--history">
            <div className="tcle-builder-section-header tcle-builder-section-header--stacked">
              <div>
                <h2>Histórico de versões</h2>
                <p>
                  {hasHistoryAnchor
                    ? 'Versões do mesmo modelo são exibidas. Cada nova edição cria um novo registro e desativa a versão anterior.'
                    : 'Exibindo todas as versões persistidas. Selecione um TCLE para visualizar somente a família versionada.'}
                </p>
              </div>
              <div className="tcle-builder-history-summary">
                <span>
                  <strong>{versionSummary.total}</strong>
                  total
                </span>
                <span>
                  <strong>{versionSummary.active}</strong>
                  ativas
                </span>
                <span>
                  <strong>{versionSummary.obsolete}</strong>
                  obsoletas
                </span>
              </div>
            </div>

            {historyLoading ? (
              <div className="tcle-builder-loading tcle-builder-loading--table">
                <Spinner size="sm" />
                <span>Carregando histórico...</span>
              </div>
            ) : null}

            {historyError ? <div className="tcle-builder-history-error">{historyError}</div> : null}

            {!historyLoading && !historyError && historyItems.length === 0 ? (
              <div className="tcle-builder-history-empty">
                <History size={22} />
                <strong>{hasHistoryAnchor ? 'Nenhuma versão encontrada para este modelo.' : 'Nenhuma versão de TCLE encontrada.'}</strong>
                <span>
                  {hasHistoryAnchor
                    ? 'Salve a primeira versão ou selecione um TCLE já versionado para ver o histórico.'
                    : 'Crie a primeira versão do TCLE para iniciar o histórico.'}
                </span>
              </div>
            ) : null}

            {historyItems.length > 0 ? (
              <div className="tcle-builder-table-wrap">
                <table className="tcle-builder-table">
                  <thead>
                    <tr>
                      <th>Version</th>
                      <th>CAAE</th>
                      <th>Validity Date</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyItems.map((item) => (
                      <tr key={item._id}>
                        <td>
                          <strong>{item.version || '--'}</strong>
                        </td>
                        <td>{String(item.caae || '--').trim() || '--'}</td>
                        <td>{formatDate(getConsentValidityValue(item))}</td>
                        <td>
                          <span className={`tcle-builder-status-badge tcle-builder-status-badge--${item.active ? 'active' : 'obsolete'}`}>
                            {item.active ? 'Ativo' : 'Obsoleto'}
                          </span>
                        </td>
                        <td>
                          <div className="tcle-builder-table-actions">
                            <Button type="button" variant="secondary" className="btn-small" onClick={() => openPrintableView(item)}>
                              <FileDown size={14} />
                              PDF
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Card>

        </div>
      )}

    </div>
  );
}
