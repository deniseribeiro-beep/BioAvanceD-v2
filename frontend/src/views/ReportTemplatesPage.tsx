import { useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import { Plus, Edit, Trash2, FileText, Lock } from 'lucide-react';
import { useReportTemplates } from '../hooks/useReportTemplates';
import { useLanguage } from '../contexts/LanguageContext';
import { ReportTemplate } from '../types/models';

export { parseHandlerOptionsInput, buildReportTemplateSubmissionPayload } from './reportTemplateForm';

export default function ReportTemplatesPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { reportTemplates, loading, error, deleteReportTemplate } = useReportTemplates();

  const handlerKeyLabel = (key: string) => t(`reportTemplates.handlerKeys.${key}`, key);

  const editPath = (template: ReportTemplate) => {
    const routeId = template._id || template.code;
    return `/reports/templates/${encodeURIComponent(String(routeId))}/edit`;
  };

  return (
    <div className="page-shell" data-testid="report-templates-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <FileText size={28} /> {t('reportTemplates.title')}
          </h1>
          <p className="page-subtitle">{t('reportTemplates.subtitle')}</p>
        </div>
        <Button data-testid="new-report-template-button" onClick={() => navigate('/reports/templates/new')}>
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
                      onClick={() => navigate(editPath(template), { state: { template } })}
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
    </div>
  );
}
