import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import { FileText, Download, Eye, X, ExternalLink, Trash2 } from 'lucide-react';
import { Reports } from '../types/models';
import { useReports } from '../hooks/useReports';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { getAllowedReportDefinitions, getReportTypeDefinition } from '../config/constants/report.constants';
import './ReportsPage.css';

// REPORT_TYPES será definido dentro do componente para ter acesso ao t()

export default function ReportsPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { reports, loading, error, deleteReport } = useReports();
  const { hasReportAccess } = useAuth();

  const reportCatalog = useMemo(() => {
    return getAllowedReportDefinitions(hasReportAccess).map((reportType) => ({
      ...reportType,
      typeLabel: t(reportType.type, reportType.fallbackType),
      descriptionLabel: t(reportType.description, reportType.fallbackDescription),
    }));
  }, [hasReportAccess, t]);
  const [deletingReportId, setDeletingReportId] = useState<number | null>(null);
  const [viewingReport, setViewingReport] = useState<Reports | null>(null);
  const [reportData, setReportData] = useState<any>(null);
  
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

  const handleViewReport = (report: Reports, inPage: boolean = false) => {
    if (inPage) {
      // Navega para a página de visualização
      navigate(`/reports/${report.reportID}`);
    } else {
      // Abre no modal (comportamento antigo)
      try {
        if (report.reportData) {
          const data = JSON.parse(report.reportData);
          setReportData(data);
          setViewingReport(report);
        } else {
          alert(t('reports.noData'));
        }
      } catch (err) {
        alert(t('reports.loadError'));
      }
    }
  };

  const handleDeleteReport = async (report: Reports) => {
    const confirmMessage = t('reports.deleteConfirm').replace('{type}', report.reportType);
    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      setDeletingReportId(report.reportID);
      await deleteReport(report.reportID);
      // Se o relatório estava sendo visualizado no modal, fecha o modal
      if (viewingReport && viewingReport.reportID === report.reportID) {
        setViewingReport(null);
        setReportData(null);
      }
    } catch (err: any) {
      const errorMessage = t('reports.deleteError').replace('{error}', err.message);
      alert(errorMessage);
    } finally {
      setDeletingReportId(null);
    }
  };

  const formatReportData = (data: any) => {
    if (!data) return null;
    
    return (
      <div className="report-data">
        {data.total !== undefined && (
          <div className="report-stat">
            <strong>Total:</strong> {data.total}
          </div>
        )}
        
        {data.average !== undefined && (
          <div className="report-stat">
            <strong>Média:</strong> {data.average.toFixed(2)}
          </div>
        )}
        
        {data.min !== undefined && (
          <div className="report-stat">
            <strong>Mínimo:</strong> {data.min}
          </div>
        )}
        
        {data.max !== undefined && (
          <div className="report-stat">
            <strong>Máximo:</strong> {data.max}
          </div>
        )}
        
        {data.byUnit && (
          <div className="report-section">
            <h4>Por Unidade Clínica:</h4>
            <ul>
              {Object.entries(data.byUnit).map(([unit, count]) => (
                <li key={unit}>{unit}: {count as number}</li>
              ))}
            </ul>
          </div>
        )}
        
        {data.byType && (
          <div className="report-section">
            <h4>Por Tipo:</h4>
            <ul>
              {Object.entries(data.byType).map(([type, count]) => (
                <li key={type}>{type}: {count as number}</li>
              ))}
            </ul>
          </div>
        )}
        
        {data.byStatus && (
          <div className="report-section">
            <h4>Por Status:</h4>
            <ul>
              {Object.entries(data.byStatus).map(([status, count]) => (
                <li key={status}>{status}: {count as number}</li>
              ))}
            </ul>
          </div>
        )}
        
        {data.statistics && (
          <div className="report-section">
            <h4>Estatísticas:</h4>
            <ul>
              <li>Total de leituras: {data.statistics.total}</li>
              <li>Temperatura média: {data.statistics.average.toFixed(2)}°C</li>
              <li>Temperatura mínima: {data.statistics.min}°C</li>
              <li>Temperatura máxima: {data.statistics.max}°C</li>
              <li>Alertas: {data.statistics.alerts}</li>
            </ul>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="page reports-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('reports.title')}</h1>
          <p className="page-subtitle">{t('reports.subtitle')}</p>
        </div>
      </div>

      {loading && (
        <Card className="report-state-card">
          <p className="report-state-message">{t('common.loading')}</p>
        </Card>
      )}

      {error && (
        <Card className="report-state-card report-state-card--error">
          <p className="report-state-message">{t('common.error')}: {error}</p>
        </Card>
      )}

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
                  <Download size={18} />
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

      {reports.length > 0 ? (
        <div className="reports-history">
          <h2>{t('reports.generatedReports')} ({reports.length})</h2>
          <div className="reports-list">
            {reports.map((report) => (
              <Card key={report.reportID} className="report-item">
                <div className="report-item-content">
                  <FileText size={24} />
                  <div className="report-item-info">
                    <h4>{report.reportType}</h4>
                    <p>
                      {t('reports.generatedAt')}: {report.generatedAt 
                        ? new Date(report.generatedAt).toLocaleString('pt-BR')
                        : new Date(report.createdAt || Date.now()).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  <div className="report-item-actions">
                    <Button
                      onClick={() => handleViewReport(report, true)}
                      className="report-view-button"
                    >
                      <ExternalLink size={18} />
                      {t('reports.viewInPage')}
                    </Button>
                    <Button
                      onClick={() => handleViewReport(report, false)}
                      variant="secondary"
                      className="report-view-button"
                    >
                      <Eye size={18} />
                      {t('reports.view')}
                    </Button>
                    <Button
                      onClick={() => handleDeleteReport(report)}
                      variant="danger"
                      className="report-view-button"
                      disabled={deletingReportId === report.reportID}
                    >
                      <Trash2 size={18} />
                      {deletingReportId === report.reportID ? t('common.deleting') : t('reports.delete')}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <Card className="no-reports-card">
          <div className="empty-state">
            <FileText size={48} className="empty-state-icon" />
            <h3 className="empty-state-title">{t('reports.noReportsGenerated')}</h3>
            <p className="empty-state-text">
              {t('reports.generateHint')}
            </p>
          </div>
        </Card>
      )}

      {viewingReport && (
        <Modal
          isOpen={!!viewingReport}
          onClose={() => {
            setViewingReport(null);
            setReportData(null);
          }}
          title={viewingReport.reportType}
        >
          <div className="report-viewer">
            {reportData ? (
              formatReportData(reportData)
            ) : (
              <p>{t('common.loading')}</p>
            )}
            <div className="report-actions">
              <Button
                onClick={() => {
                  const dataStr = JSON.stringify(reportData, null, 2);
                  const dataBlob = new Blob([dataStr], { type: 'application/json' });
                  const url = URL.createObjectURL(dataBlob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `${viewingReport.reportType.replace(/\s+/g, '_')}_${Date.now()}.json`;
                  link.click();
                }}
              >
                <Download size={18} />
                {t('reports.downloadJSON')}
              </Button>
              <Button
                onClick={() => {
                  setViewingReport(null);
                  setReportData(null);
                }}
                variant="secondary"
              >
                <X size={18} />
                {t('common.close')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

