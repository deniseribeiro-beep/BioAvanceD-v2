import { useState } from 'react';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import Input from '../components/UI/Input';
import { Plus, Edit, Trash2, FileText, Lock } from 'lucide-react';
import { useReportTemplates } from '../hooks/useReportTemplates';
import { useLanguage } from '../contexts/LanguageContext';
import { ReportTemplate, REPORT_TEMPLATE_HANDLER_KEYS } from '../types/models';

// #726 (RF008 AC#6): free-form config per handler (e.g. temperature's
// `{ mode: 'control' | 'report' }` — see report-template-seed.service.js),
// edited as raw JSON text in the form. Exported for
// ReportTemplatesPage.test.tsx.
export function parseHandlerOptionsInput(text: string): { value: Record<string, unknown>; error?: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { value: {} };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { value: {}, error: 'handlerOptions deve ser um objeto JSON (ex.: {})' };
    }
    return { value: parsed };
  } catch {
    return { value: {}, error: 'handlerOptions deve ser um JSON válido' };
  }
}

// `code` is immutable once a template exists (reportTemplates.routes.js's
// PUT handler forces `code: existing.code` server-side regardless of what's
// sent) -- omitted from the payload on edit so the disabled form field can
// never accidentally resubmit a stale/placeholder value.
export function buildReportTemplateSubmissionPayload(
  formData: Partial<ReportTemplate> & { handlerOptionsText?: string },
  editingTemplate: ReportTemplate | null
): Partial<ReportTemplate> {
  const { value: handlerOptions } = parseHandlerOptionsInput(formData.handlerOptionsText ?? '{}');

  const payload: Partial<ReportTemplate> = {
    name: formData.name,
    description: formData.description || null,
    // #1450: the form's select shows the first key when the template has
    // none, so the payload sends that same key.
    handlerKey: formData.handlerKey || REPORT_TEMPLATE_HANDLER_KEYS[0],
    handlerOptions,
    templateStatus: formData.templateStatus || 'active',
  };

  if (!editingTemplate) {
    payload.code = formData.code;
  }

  return payload;
}

export default function ReportTemplatesPage() {
  const { t } = useLanguage();
  const { reportTemplates, loading, error, createReportTemplate, updateReportTemplate, deleteReportTemplate } = useReportTemplates();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ReportTemplate | null>(null);

  const handlerKeyLabel = (key: string) => t(`reportTemplates.handlerKeys.${key}`, key);

  return (
    <div className="page-shell" data-testid="report-templates-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <FileText size={28} /> {t('reportTemplates.title')}
          </h1>
          <p className="page-subtitle">{t('reportTemplates.subtitle')}</p>
        </div>
        <Button
          data-testid="new-report-template-button"
          onClick={() => {
            setEditingTemplate(null);
            setIsModalOpen(true);
          }}
        >
          <Plus size={18} /> {t('reportTemplates.new')}
        </Button>
      </div>

      {loading && <p>{t('common.loading')}</p>}
      {error && <p className="report-templates-error">{t('common.error')}: {error}</p>}

      <Card>
        <Table
          data-testid="report-templates-table"
          headers={[
            t('reportTemplates.code'),
            t('reportTemplates.name'),
            t('reportTemplates.handlerKey'),
            t('reportTemplates.templateStatus'),
            t('reportTemplates.origin'),
            t('common.actions'),
          ]}
        >
          {Array.isArray(reportTemplates) && reportTemplates.length > 0 ? (
            reportTemplates.map((template) => (
              <tr key={template._id || template.code}>
                <td><code>{template.code}</code></td>
                <td>{template.name}</td>
                <td>{handlerKeyLabel(template.handlerKey)}</td>
                <td>
                  <span className={`template-status-badge ${template.templateStatus}`}>
                    {template.templateStatus === 'active' ? t('reportTemplates.statusActive') : t('reportTemplates.statusRetired')}
                  </span>
                </td>
                <td>
                  {template.isSystemDefined ? (
                    <span className="template-origin-badge system">
                      <Lock size={12} /> {t('reportTemplates.systemDefined')}
                    </span>
                  ) : (
                    <span className="template-origin-badge custom">{t('reportTemplates.custom')}</span>
                  )}
                </td>
                <td>
                  <div className="table-actions">
                    <button
                      data-testid={`edit-report-template-button-${template.code}`}
                      className="action-button"
                      onClick={() => {
                        setEditingTemplate(template);
                        setIsModalOpen(true);
                      }}
                      title={t('common.edit')}
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      data-testid={`delete-report-template-button-${template.code}`}
                      className="action-button danger"
                      disabled={template.isSystemDefined}
                      title={template.isSystemDefined ? t('reportTemplates.deleteSystemBlocked') : t('common.delete')}
                      onClick={async () => {
                        if (template.isSystemDefined) return;
                        if (confirm(t('reportTemplates.deleteConfirm'))) {
                          try {
                            await deleteReportTemplate(template._id || template.code);
                          } catch (err: any) {
                            alert(err.message);
                          }
                        }
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6} className="report-templates-empty">
                {loading ? t('common.loading') : t('reportTemplates.empty')}
              </td>
            </tr>
          )}
        </Table>
      </Card>

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingTemplate(null);
        }}
        title={editingTemplate ? t('reportTemplates.editTitle') : t('reportTemplates.newTitle')}
      >
        <ReportTemplateForm
          template={editingTemplate}
          onSave={async (data) => {
            try {
              const payload = buildReportTemplateSubmissionPayload(data, editingTemplate);
              if (editingTemplate) {
                await updateReportTemplate(editingTemplate._id || editingTemplate.code, payload);
              } else {
                await createReportTemplate(payload);
              }
              setIsModalOpen(false);
              setEditingTemplate(null);
            } catch (err: any) {
              alert(err.message);
            }
          }}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingTemplate(null);
          }}
        />
      </Modal>
    </div>
  );
}

function ReportTemplateForm({
  template,
  onSave,
  onCancel,
}: {
  template: ReportTemplate | null;
  onSave: (data: Partial<ReportTemplate> & { handlerOptionsText?: string }) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [formData, setFormData] = useState<Partial<ReportTemplate>>(
    template || {
      code: '',
      name: '',
      description: '',
      handlerKey: REPORT_TEMPLATE_HANDLER_KEYS[0],
      templateStatus: 'active',
    }
  );
  const [handlerOptionsText, setHandlerOptionsText] = useState(
    JSON.stringify(template?.handlerOptions || {}, null, 2)
  );
  const [handlerOptionsError, setHandlerOptionsError] = useState<string | undefined>(undefined);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = parseHandlerOptionsInput(handlerOptionsText);
    if (error) {
      setHandlerOptionsError(error);
      return;
    }
    onSave({ ...formData, handlerOptionsText });
  };

  return (
    <form onSubmit={handleSubmit} className="report-template-form" data-testid="report-template-form">
      <div className="report-template-form-grid">
        <Input
          label={t('reportTemplates.code')}
          data-testid="report-template-code-input"
          value={formData.code || ''}
          onChange={(e) => setFormData({ ...formData, code: e.target.value.toLowerCase() })}
          disabled={!!template}
          helperText={t('reportTemplates.codeHelp')}
          required
        />
        <Input
          label={t('reportTemplates.name')}
          data-testid="report-template-name-input"
          value={formData.name || ''}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
        />
        <Input
          label={t('reportTemplates.description')}
          data-testid="report-template-description-input"
          value={formData.description || ''}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
        />
        <div className="report-template-field">
          <label htmlFor="report-template-handler-key">{t('reportTemplates.handlerKey')}</label>
          <select
            id="report-template-handler-key"
            data-testid="report-template-handler-key-select"
            className="form-select"
            value={formData.handlerKey || REPORT_TEMPLATE_HANDLER_KEYS[0]}
            onChange={(e) => setFormData({ ...formData, handlerKey: e.target.value })}
          >
            {REPORT_TEMPLATE_HANDLER_KEYS.map((key) => (
              <option key={key} value={key}>
                {t(`reportTemplates.handlerKeys.${key}`, key)}
              </option>
            ))}
          </select>
        </div>
        <div className="report-template-field">
          <label htmlFor="report-template-status">{t('reportTemplates.templateStatus')}</label>
          <select
            id="report-template-status"
            data-testid="report-template-status-select"
            className="form-select"
            value={formData.templateStatus || 'active'}
            onChange={(e) => setFormData({ ...formData, templateStatus: e.target.value as 'active' | 'retired' })}
          >
            <option value="active">{t('reportTemplates.statusActive')}</option>
            <option value="retired">{t('reportTemplates.statusRetired')}</option>
          </select>
        </div>
        <div className="report-template-field">
          <label htmlFor="report-template-handler-options">{t('reportTemplates.handlerOptions')}</label>
          <textarea
            id="report-template-handler-options"
            data-testid="report-template-handler-options-input"
            className="report-template-json-input"
            rows={4}
            value={handlerOptionsText}
            onChange={(e) => {
              setHandlerOptionsText(e.target.value);
              setHandlerOptionsError(undefined);
            }}
          />
          <span className="report-template-field-help">{t('reportTemplates.handlerOptionsHelp')}</span>
          {handlerOptionsError && <span className="report-templates-error">{handlerOptionsError}</span>}
        </div>
      </div>
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" data-testid="report-template-form-submit">
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}
