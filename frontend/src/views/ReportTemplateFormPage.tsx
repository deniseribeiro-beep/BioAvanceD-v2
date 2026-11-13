import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import EntityFormPageShell from '../components/UI/EntityFormPageShell';
import { useReportTemplates } from '../hooks/useReportTemplates';
import { useLanguage } from '../contexts/LanguageContext';
import { ReportTemplate, REPORT_TEMPLATE_HANDLER_KEYS } from '../types/models';
import { buildReportTemplateSubmissionPayload, parseHandlerOptionsInput } from './reportTemplateForm';

const LIST_PATH = '/reports/templates';

export default function ReportTemplateFormPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const { reportTemplates, createReportTemplate, updateReportTemplate } = useReportTemplates();
  const isNew = !id;

  const editingTemplate = useMemo(() => {
    const fromState = (location.state as { template?: ReportTemplate } | null)?.template;
    if (fromState) return fromState;
    if (!id) return null;
    return (
      reportTemplates.find(
        (tpl) => tpl._id === id || tpl.code === id || String(tpl._id) === id
      ) ?? null
    );
  }, [location.state, reportTemplates, id]);

  const title = editingTemplate ? t('reportTemplates.editTitle') : t('reportTemplates.newTitle');

  return (
    <EntityFormPageShell title={title} backTo={LIST_PATH} testId="report-template-form-page">
      {id && !editingTemplate ? (
        <p>{t('common.loading')}</p>
      ) : (
        <ReportTemplateFormFields
          template={isNew ? null : editingTemplate}
          onSave={async (data) => {
            try {
              const payload = buildReportTemplateSubmissionPayload(data, editingTemplate);
              if (editingTemplate && !isNew) {
                await updateReportTemplate(editingTemplate._id || editingTemplate.code, payload);
              } else {
                await createReportTemplate(payload);
              }
              navigate(LIST_PATH);
            } catch (err: any) {
              alert(err.message);
            }
          }}
          onCancel={() => navigate(LIST_PATH)}
        />
      )}
    </EntityFormPageShell>
  );
}

export function ReportTemplateFormFields({
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
