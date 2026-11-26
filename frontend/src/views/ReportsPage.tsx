import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import { FileText, Filter, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { REPORT_TYPE_DEFINITIONS, mergeCustomTemplates } from '../config/constants/report.constants';
import { useReportTemplates } from '../hooks/useReportTemplates';

// REPORT_TYPES será definido dentro do componente para ter acesso ao t()

export default function ReportsPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { hasReportAccess } = useAuth();
  // #735 (RF008 AC#6): templates created on ReportTemplatesPage join the menu.
  const { reportTemplates } = useReportTemplates();

  const reportCatalog = useMemo(() => {
    return mergeCustomTemplates(REPORT_TYPE_DEFINITIONS, reportTemplates)
      .filter((reportType) => hasReportAccess(reportType.type) || hasReportAccess(reportType.key))
      .map((reportType) => ({
      ...reportType,
      typeLabel: t(reportType.type, reportType.fallbackType),
      descriptionLabel: reportType.description ? t(reportType.description, reportType.fallbackDescription) : reportType.fallbackDescription,
    }));
  }, [hasReportAccess, reportTemplates, t]);
  // Filtra tipos de relatórios baseado nas permissões do usuário
  const allowedReportTypes = reportCatalog;

  const handleGenerateReport = async (reportType: { key: string; type: string }) => {
    // Verifica permissão antes de gerar
    if (!hasReportAccess(reportType.type) && !hasReportAccess(reportType.key)) {
      alert(t('reports.noPermission'));
      return;
    }
    
    // Navega para página de consulta com filtros
    navigate(`/reports/query/${encodeURIComponent(reportType.key)}`);
  };

  return (
    <div className="page-shell reports-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Central de Relatórios</h1>
          <p className="page-subtitle">
            Selecione o relatório, configure filtros normativos (Orpha, ATC/ChEMBL, SPREC, MIABIS)
            e exporte dados rastreáveis na próxima etapa.
          </p>
        </div>
        <div className="reports-header-badge">
          <Filter size={16} />
          Fluxo com filtros dinâmicos
        </div>
      </div>

      {allowedReportTypes.length > 0 ? (
        <div className="reports-grid">
          {allowedReportTypes.map((reportType) => (
            <Card key={reportType.type} className="report-card">
              <div className="report-card-content">
                <div className="report-icon-large">{reportType.icon}</div>
                <h3 className="report-title">{reportType.typeLabel}</h3>
                <p className="report-description">{reportType.descriptionLabel}</p>
                <Button
                  onClick={() => handleGenerateReport(reportType)}
                  className="report-button"
                >
                  <ArrowRight size={18} />
                  {t('reports.generate')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="no-reports-card">
          <div className="empty-state">
            <FileText size={48} className="empty-state-icon" />
            <h3 className="empty-state-title">{t('reports.noTypesAvailable')}</h3>
            <p className="empty-state-text">
              {t('reports.noPermissionContact')}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

