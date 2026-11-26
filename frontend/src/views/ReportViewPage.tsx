import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import { ArrowLeft, Download, FileText, Calendar, Printer, Trash2 } from 'lucide-react';
import { Reports } from '../types/models';
import { reportsService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { getPatientDisplayName } from '../utils/patientAnonymization';
import { getReportTypeDefinition } from '../config/constants/report.constants';
import { getMaintenanceStatusLabel } from '../config/constants/sensor.constants';
import { resolveSpecimenStatus, translateSpecimenStatus } from '../utils/sampleHelpers';
import { selectTemperatureRows, selectAccessLogRows, selectAuditEventRows, rowKey } from './ReportViewPage.helpers';

export default function ReportViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [report, setReport] = useState<Reports | null>(null);
  const [reportData, setReportData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reportDefinition = getReportTypeDefinition(report?.reportType || '');
  // #1217: a custom template (#735) has no definition; GET /:type/filters
  // names it, as ReportQueryPage reads it.
  const [templateName, setTemplateName] = useState<string | null>(null);

  useEffect(() => {
    loadReport();
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    setTemplateName(null);
    if (!report?.reportType || reportDefinition) {
      return undefined;
    }
    reportsService
      .getFilters(report.reportType)
      .then((response) => {
        if (!cancelled && typeof response?.data?.name === 'string') {
          setTemplateName(response.data.name);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [report?.reportType, reportDefinition]);

  const loadReport = async () => {
    if (!id) {
      setError('ID do relatório não fornecido');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await reportsService.getById(parseInt(id));
      const reportData = response.data;
      setReport(reportData);

      // Parse dos dados do relatório
      if (reportData.reportData) {
        try {
          const parsed = JSON.parse(reportData.reportData);
          setReportData(parsed);
        } catch (e) {
          console.error('Erro ao parsear dados do relatório:', e);
          setReportData({});
        }
      } else {
        setReportData({});
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar relatório');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!reportData) return;

    const dataStr = JSON.stringify(reportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${report?.reportType?.replace(/\s+/g, '_') || 'relatorio'}_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDelete = async (target: Reports) => {
    if (!window.confirm(`Tem certeza que deseja excluir o relatório "${target.reportType}"?\n\nEsta ação não pode ser desfeita.`)) {
      return;
    }

    try {
      await reportsService.delete(target.reportID);
      // Redireciona para a lista de relatórios após exclusão
      navigate('/reports');
    } catch (err: any) {
      alert(`Erro ao excluir relatório: ${err.message}`);
    }
  };

  const formatDate = (date: Date | string | undefined) => {
    if (!date) return 'Não disponível';
    return new Date(date).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const renderReportContent = () => {
    if (!reportData) return null;

    return (
      <div className="report-content">
        {/* Estatísticas Gerais */}
        {(reportData.total !== undefined || reportData.statistics) && (
          <div className="report-stats-grid">
            {reportData.total !== undefined && (
              <Card className="stat-card">
                <div className="stat-label">Total</div>
                <div className="stat-value">{reportData.total}</div>
              </Card>
            )}
            {reportData.statistics && (
              <>
                {reportData.statistics.average !== undefined && (
                  <Card className="stat-card">
                    <div className="stat-label">Média</div>
                    <div className="stat-value">{reportData.statistics.average.toFixed(2)}</div>
                  </Card>
                )}
                {reportData.statistics.min !== undefined && (
                  <Card className="stat-card">
                    <div className="stat-label">Mínimo</div>
                    <div className="stat-value">{reportData.statistics.min}</div>
                  </Card>
                )}
                {reportData.statistics.max !== undefined && (
                  <Card className="stat-card">
                    <div className="stat-label">Máximo</div>
                    <div className="stat-value">{reportData.statistics.max}</div>
                  </Card>
                )}
                {reportData.statistics.alerts !== undefined && (
                  <Card className="stat-card alert">
                    <div className="stat-label">Alertas</div>
                    <div className="stat-value">{reportData.statistics.alerts}</div>
                  </Card>
                )}
              </>
            )}
          </div>
        )}

        {/* Distribuições */}
        {(reportData.byUnit || reportData.byType || reportData.byStatus || reportData.byAction || reportData.bySeverity) && (
          <div className="report-distributions">
            {reportData.byUnit && (
              <Card className="distribution-card">
                <h3 className="distribution-title">Por Unidade Clínica</h3>
                <div className="distribution-list">
                  {Object.entries(reportData.byUnit).map(([unit, count]) => (
                    <div key={unit} className="distribution-item">
                      <span className="distribution-label">{unit}</span>
                      <span className="distribution-value">{count as number}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {reportData.byType && (
              <Card className="distribution-card">
                <h3 className="distribution-title">Por Tipo</h3>
                <div className="distribution-list">
                  {Object.entries(reportData.byType).map(([type, count]) => (
                    <div key={type} className="distribution-item">
                      <span className="distribution-label">{type}</span>
                      <span className="distribution-value">{count as number}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {reportData.byStatus && (
              <Card className="distribution-card">
                <h3 className="distribution-title">Por Status</h3>
                <div className="distribution-list">
                  {Object.entries(reportData.byStatus).map(([status, count]) => (
                    <div key={status} className="distribution-item">
                      <span className="distribution-label">{status}</span>
                      <span className="distribution-value">{count as number}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {reportData.byAction && (
              <Card className="distribution-card">
                <h3 className="distribution-title">Por Ação</h3>
                <div className="distribution-list">
                  {Object.entries(reportData.byAction).map(([action, count]) => (
                    <div key={action} className="distribution-item">
                      <span className="distribution-label">{action}</span>
                      <span className="distribution-value">{count as number}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {reportData.bySeverity && (
              <Card className="distribution-card">
                <h3 className="distribution-title">Por Severidade</h3>
                <div className="distribution-list">
                  {Object.entries(reportData.bySeverity).map(([severity, count]) => (
                    <div key={severity} className="distribution-item">
                      <span className="distribution-label">{severity}</span>
                      <span className="distribution-value">{count as number}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Listas Detalhadas */}
        {/* #949: `temperatures` and `logs` are the keys handleTemperature and
            handleAccessLogs actually return; this gate read `recentReadings`/
            `recentLogs`, which no handler has ever emitted. */}
        {(reportData.patients || reportData.samples || reportData.equipment || reportData.results || reportData.sensors || selectTemperatureRows(reportData).length > 0 || selectAccessLogRows(reportData).length > 0 || selectAuditEventRows(reportData).length > 0) && (
          <div className="report-details">
            {reportData.patients && reportData.patients.length > 0 && (
              <Card className="details-card">
                <h3 className="details-title">Pacientes ({reportData.patients.length})</h3>
                <div className="details-table">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Nome</th>
                        <th>Unidade Clínica</th>
                        <th>Prontuário</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.patients.slice(0, 50).map((p: any) => (
                        <tr key={p.participantId}>
                          <td>{p.participantId}</td>
                          <td>{getPatientDisplayName(p, user)}</td>
                          <td>N/A</td>
                          <td>N/A</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {reportData.patients.length > 50 && (
                    <p className="details-more">... e mais {reportData.patients.length - 50} pacientes</p>
                  )}
                </div>
              </Card>
            )}

            {reportData.samples && reportData.samples.length > 0 && (
              <Card className="details-card">
                <h3 className="details-title">Amostras ({reportData.samples.length})</h3>
                <div className="details-table">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Tipo</th>
                        <th>Status</th>
                        <th>Data de Registro</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.samples.slice(0, 50).map((s: any) => (
                        <tr key={s.specimenId}>
                          <td>{s.specimenId}</td>
                          <td>{s.sampleType}</td>
                          <td>{translateSpecimenStatus(resolveSpecimenStatus(s))}</td>
                          <td>{formatDate(s.registeredAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {reportData.samples.length > 50 && (
                    <p className="details-more">... e mais {reportData.samples.length - 50} amostras</p>
                  )}
                </div>
              </Card>
            )}

            {reportData.equipment && reportData.equipment.length > 0 && (
              <Card className="details-card">
                <h3 className="details-title">Equipamentos ({reportData.equipment.length})</h3>
                <div className="details-table">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Descrição</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.equipment.map((e: any) => (
                        <tr key={e.equipmentID}>
                          <td>{e.equipmentID}</td>
                          <td>{e.equipmentDescription}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {reportData.results && reportData.results.length > 0 && (
              <Card className="details-card">
                <h3 className="details-title">Resultados ({reportData.results.length})</h3>
                <div className="details-table">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Tipo de Arquivo</th>
                        <th>Descrição</th>
                        <th>Método</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.results.slice(0, 50).map((r: any) => (
                        <tr key={r.resultID}>
                          <td>{r.resultID}</td>
                          <td>{r.fileType}</td>
                          <td>{r.description}</td>
                          <td>{r.method || 'N/A'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {reportData.results.length > 50 && (
                    <p className="details-more">... e mais {reportData.results.length - 50} resultados</p>
                  )}
                </div>
              </Card>
            )}

            {reportData.sensors && reportData.sensors.length > 0 && (
              <Card className="details-card">
                <h3 className="details-title">Sensores ({reportData.sensors.length})</h3>
                <div className="details-table">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Tipo</th>
                        <th>Status</th>
                        <th>Última Calibração</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.sensors.map((s: any) => {
                        const sensorId = s.sensorId || s.sensorID || s._id || 'N/A';
                        return (
                          <tr key={s._id || sensorId}>
                            <td>{sensorId}</td>
                            <td>{s.sensorType}</td>
                            <td>{getMaintenanceStatusLabel(s.maintenanceStatus)}</td>
                            <td>{formatDate(s.lastCalibration)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {selectTemperatureRows(reportData).length > 0 && (
              <Card className="details-card">
                <h3 className="details-title">Leituras Recentes de Temperatura ({selectTemperatureRows(reportData).length})</h3>
                <div className="details-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Data/Hora</th>
                        <th>Temperatura</th>
                        <th>Status</th>
                        <th>Sensor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectTemperatureRows(reportData).map((r, i) => (
                        <tr key={rowKey(r, i)}>
                          <td>{formatDate(r.timestamp)}</td>
                          <td>{r.temperatureValue} {r.temperatureUnit}</td>
                          <td>{r.readingStatus}</td>
                          <td>{r.sensorId || r.sensorID || 'N/A'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {selectAccessLogRows(reportData).length > 0 && (
              <Card className="details-card">
                <h3 className="details-title">Logs Recentes ({selectAccessLogRows(reportData).length})</h3>
                <div className="details-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Data/Hora</th>
                        <th>Usuário</th>
                        <th>Ação</th>
                        <th>Entidade</th>
                        <th>Resultado</th>
                        <th>Severidade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectAccessLogRows(reportData).map((l, i) => (
                        <tr key={rowKey(l, i)}>
                          <td>{formatDate(l.timestamp)}</td>
                          <td>{l.userName}</td>
                          <td>{l.action}</td>
                          <td>{l.entity}</td>
                          <td>{l.result}</td>
                          <td>{l.severity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {selectAuditEventRows(reportData).length > 0 && (
              <Card className="details-card">
                <h3 className="details-title">Eventos de Auditoria ({selectAuditEventRows(reportData).length})</h3>
                <div className="details-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Data/Hora</th>
                        <th>Ator</th>
                        <th>Ação</th>
                        <th>Recurso</th>
                        <th>Resultado</th>
                        <th>Origem</th>
                        <th>Evento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectAuditEventRows(reportData).map((e, i) => (
                        <tr key={e.eventId || String(i)}>
                          <td>{formatDate(e.occurredAt)}</td>
                          <td>{e.actorPseudonym}</td>
                          <td>{e.action}</td>
                          <td>{e.entityType}</td>
                          <td>{e.result}</td>
                          <td>{e.source}</td>
                          <td>{e.eventId}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="page-shell">
        <div className="page-header">
          <h1 className="page-title">Carregando relatório...</h1>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-shell">
        <div className="page-header">
          <h1 className="page-title">Erro</h1>
        </div>
        <Card>
          <p style={{ color: 'var(--danger)' }}>{error}</p>
          <Button onClick={() => navigate('/reports')} style={{ marginTop: '1rem' }}>
            <ArrowLeft size={18} />
            Voltar para Relatórios
          </Button>
        </Card>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="page-shell">
        <div className="page-header">
          <h1 className="page-title">Relatório não encontrado</h1>
        </div>
        <Card>
          <p>O relatório solicitado não foi encontrado.</p>
          <Button onClick={() => navigate('/reports')} style={{ marginTop: '1rem' }}>
            <ArrowLeft size={18} />
            Voltar para Relatórios
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-shell report-view-page">
      <div className="page-header report-view-header">
        <div className="page-header-content">
          <Button onClick={() => navigate('/reports')} variant="secondary" className="back-button">
            <ArrowLeft size={18} />
            Voltar
          </Button>
          <div className="page-title-section">
            <FileText size={32} className="report-icon-header" />
            <div>
              <p className="report-view-eyebrow">{reportDefinition ? reportDefinition.fallbackType : 'Relatório'}</p>
              <h1 className="page-title">{reportDefinition ? reportDefinition.fallbackType : templateName || report.reportType}</h1>
              <p className="page-subtitle">
                <Calendar size={16} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
                Gerado em: {formatDate(report.generatedAt || report.createdAt)}
              </p>
            </div>
          </div>
        </div>
        <div className="page-actions report-view-actions">
          <Button onClick={handlePrint} variant="secondary">
            <Printer size={18} />
            Imprimir
          </Button>
          <Button onClick={handleDownload}>
            <Download size={18} />
            Download JSON
          </Button>
          <Button onClick={() => handleDelete(report)} variant="danger">
            <Trash2 size={18} />
            Excluir
          </Button>
        </div>
      </div>

      {renderReportContent()}
    </div>
  );
}

