import { useState, useEffect, useMemo } from 'react';
import { AlertCircle, CheckCircle, ArrowUp, MessageSquare, Clock, Thermometer } from 'lucide-react';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../api/client';

type TemperatureIncident = {
  _id: string;
  sensorKey: string;
  sensorName: string;
  openedAt: string;
  closedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  currentTemperature: number;
  maxTemperature: number;
  minTemperature: number;
  samplesOutOfRange: number;
  status: 'open' | 'acknowledged' | 'escalated' | 'resolved';
  notes: Array<{
    timestamp: string;
    userId: string;
    action: string;
    message: string;
    escalationLevel?: number;
  }>;
  escalationLevel: number;
  lastEscalatedAt: string | null;
};

export default function IncidentManagement() {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  
  const [incidents, setIncidents] = useState<TemperatureIncident[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'acknowledged' | 'escalated' | 'resolved'>('open');
  const [selectedIncident, setSelectedIncident] = useState<TemperatureIncident | null>(null);
  const [noteText, setNoteText] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const pageSize = 10;

  const fetchIncidents = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') {
        params.append('status', statusFilter);
      }
      params.append('limit', '100');

      const { data } = await apiClient.get('/incidents', {
        params,
        suppressErrorToast: true,
      } as Parameters<typeof apiClient.get>[1]);

      setIncidents(data.incidents || []);
    } catch (err: any) {
      setError(err.response?.data?.message || err.response?.data?.error || err.message || t('incidents.errors.load', 'Erro ao carregar incidentes'));
      console.error('Erro ao buscar incidentes:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIncidents();
  }, [statusFilter]);

  const filteredIncidents = useMemo(() => {
    return incidents.sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());
  }, [incidents]);

  const totalPages = Math.ceil(filteredIncidents.length / pageSize);
  const paginatedIncidents = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredIncidents.slice(start, start + pageSize);
  }, [filteredIncidents, currentPage]);

  const handleAcknowledge = async (incidentId: string) => {
    try {
      await apiClient.put(`/incidents/${incidentId}/acknowledge`, {
        userId: user?._id,
        notes: t('incidents.actions.acknowledgedNote', 'Incidente reconhecido')
      }, {
        suppressErrorToast: true,
      } as Parameters<typeof apiClient.put>[2]);
      
      await fetchIncidents();
      setSelectedIncident(null);
    } catch (err: any) {
      alert(err.response?.data?.message || err.response?.data?.error || err.message || t('incidents.errors.acknowledge', 'Erro ao reconhecer incidente'));
    }
  };

  const handleResolve = async (incidentId: string) => {
    try {
      await apiClient.put(`/incidents/${incidentId}/resolve`, {
        userId: user?._id,
        notes: noteText || t('incidents.actions.resolvedNote', 'Incidente resolvido')
      }, {
        suppressErrorToast: true,
      } as Parameters<typeof apiClient.put>[2]);
      
      await fetchIncidents();
      setSelectedIncident(null);
      setNoteText('');
    } catch (err: any) {
      alert(err.response?.data?.message || err.response?.data?.error || err.message || t('incidents.errors.resolve', 'Erro ao resolver incidente'));
    }
  };

  const handleEscalate = async (incidentId: string) => {
    try {
      await apiClient.put(`/incidents/${incidentId}/escalate`, {
        userId: user?._id,
        notes: t('incidents.actions.escalatedNote', 'Incidente escalado')
      }, {
        suppressErrorToast: true,
      } as Parameters<typeof apiClient.put>[2]);
      
      await fetchIncidents();
      setSelectedIncident(null);
    } catch (err: any) {
      alert(err.response?.data?.message || err.response?.data?.error || err.message || t('incidents.errors.escalate', 'Erro ao escalar incidente'));
    }
  };

  const handleAddNote = async (incidentId: string) => {
    try {
      await apiClient.post(`/incidents/${incidentId}/notes`, {
        userId: user?._id,
        message: noteText
      }, {
        suppressErrorToast: true,
      } as Parameters<typeof apiClient.post>[2]);
      
      await fetchIncidents();
      setNoteText('');
      const updated = incidents.find(i => i._id === incidentId);
      if (updated) setSelectedIncident(updated);
    } catch (err: any) {
      alert(err.response?.data?.message || err.response?.data?.error || err.message || t('incidents.errors.addNote', 'Erro ao adicionar nota'));
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return '#ef4444';
      case 'acknowledged': return '#f59e0b';
      case 'escalated': return '#dc2626';
      case 'resolved': return '#16a34a';
      default: return '#64748b';
    }
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      'open': t('incidents.status.open', 'Aberto'),
      'acknowledged': t('incidents.status.acknowledged', 'Reconhecido'),
      'escalated': t('incidents.status.escalated', 'Escalado'),
      'resolved': t('incidents.status.resolved', 'Resolvido')
    };
    return labels[status] || status;
  };

  return (
    <>
      <div className="facility-incident-management">
        <Card className="incident-filters-card">
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              data-testid="incidents-status-filter"
              value={statusFilter}
              aria-label={t('incidents.filters.statusAriaLabel', 'Filtrar incidentes por status')}
              onChange={(e) => {
                setStatusFilter(e.target.value as any);
                setCurrentPage(1);
              }}
              className="input"
              style={{ maxWidth: '240px' }}
            >
              <option value="all">{t('incidents.filters.allStatuses', 'Todos os status')}</option>
              <option value="open">{t('incidents.filters.open', 'Abertos')}</option>
              <option value="acknowledged">{t('incidents.filters.acknowledged', 'Reconhecidos')}</option>
              <option value="escalated">{t('incidents.filters.escalated', 'Escalados')}</option>
              <option value="resolved">{t('incidents.filters.resolved', 'Resolvidos')}</option>
            </select>

            <Button data-testid="incidents-refresh-button" onClick={fetchIncidents} variant="secondary" disabled={loading}>
              {loading ? t('common.loading', 'Carregando...') : t('common.refresh', 'Atualizar Lista')}
            </Button>
          </div>
        </Card>

        {error && (
          <Card style={{ background: '#fef2f2', borderColor: '#fca5a5', color: '#dc2626' }}>
            {error}
          </Card>
        )}

        <Card>
          <Table headers={[
            t('incidents.table.sensor', 'Sensor'),
            t('common.status', 'Status'),
            t('incidents.table.openedAt', 'Aberto em'),
            t('incidents.table.currentTemp', 'Temp Atual'),
            t('incidents.table.occurrences', 'Ocorrências'),
            t('common.actions', 'Ações')
          ]}>
            {paginatedIncidents.length === 0 ? (
              <tr>
                <td colSpan={6} className="table-empty-state-cell">
                  <div className="table-empty-state">
                    <Thermometer size={34} />
                    <h3 className="table-empty-state__title">
                      {statusFilter === 'all'
                        ? t('incidents.empty.none', 'Nenhum incidente')
                        : t('incidents.empty.noneForStatus', 'Nenhum incidente {{status}}').replace('{{status}}', getStatusLabel(statusFilter).toLowerCase())}
                    </h3>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedIncidents.map((incident) => (
                <tr key={incident._id} data-testid={`incident-row-${incident._id}`}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Thermometer size={16} color={getStatusColor(incident.status)} />
                      <strong>{incident.sensorName}</strong>
                    </div>
                  </td>
                  <td>
                    <span
                      style={{
                        background: getStatusColor(incident.status),
                        color: 'white',
                        padding: '0.25rem 0.75rem',
                        borderRadius: '0.375rem',
                        fontSize: '0.875rem',
                        fontWeight: 500
                      }}
                    >
                      {getStatusLabel(incident.status)}
                    </span>
                  </td>
                  <td>{new Date(incident.openedAt).toLocaleString(language)}</td>
                  <td><strong>{incident.currentTemperature.toFixed(1)}°C</strong></td>
                  <td>{incident.samplesOutOfRange}</td>
                  <td>
                    <Button
                      data-testid={`incident-details-button-${incident._id}`}
                      variant="secondary"
                      onClick={() => setSelectedIncident(incident)}
                      style={{ fontSize: '0.875rem', padding: '0.4rem 0.8rem' }}
                    >
                      {t('common.details', 'Detalhes')}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </Table>

          {filteredIncidents.length > 0 && (
            <div className="history-pagination">
              <div className="history-pagination__summary">
                {t('incidents.pagination.showing', 'Mostrando')} {Math.min((currentPage - 1) * pageSize + 1, filteredIncidents.length)}-
                {Math.min(currentPage * pageSize, filteredIncidents.length)} {t('incidents.pagination.of', 'de')} {filteredIncidents.length}
              </div>

              <div className="history-pagination__controls">
                <Button
                  variant="secondary"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  {t('common.previous', 'Anterior')}
                </Button>
                <span className="history-pagination__page">
                  {t('incidents.pagination.page', 'Página')} {currentPage} {t('incidents.pagination.of', 'de')} {totalPages}
                </span>
                <Button
                  variant="secondary"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  {t('common.next', 'Próximo')}
                </Button>
              </div>
            </div>
          )}
        </Card>

        {selectedIncident && (
          <Card className="incident-detail-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem' }}>
                  {t('incidents.detail.title', 'Detalhes do Incidente')}
                </h3>
                <p style={{ margin: 0, color: '#64748b' }}>{selectedIncident.sensorName}</p>
              </div>
              <Button
                variant="secondary"
                onClick={() => setSelectedIncident(null)}
              >
                {t('common.close', 'Fechar')}
              </Button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
              <div>
                <p style={{ margin: '0 0 0.25rem', fontSize: '0.875rem', color: '#64748b', textTransform: 'uppercase' }}>{t('common.status', 'Status')}</p>
                <p style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
                  {getStatusLabel(selectedIncident.status)}
                </p>
              </div>
              <div>
                <p style={{ margin: '0 0 0.25rem', fontSize: '0.875rem', color: '#64748b', textTransform: 'uppercase' }}>{t('incidents.detail.escalationLevel', 'Nível de Escalação')}</p>
                <p style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
                  {[t('incidents.escalation.normal', 'Normal'), t('incidents.escalation.supervisor', 'Supervisor'), t('incidents.escalation.critical', 'Crítico')][selectedIncident.escalationLevel] || t('incidents.escalation.normal', 'Normal')}
                </p>
              </div>
              <div>
                <p style={{ margin: '0 0 0.25rem', fontSize: '0.875rem', color: '#64748b', textTransform: 'uppercase' }}>{t('incidents.detail.currentTemp', 'Temperatura Atual')}</p>
                <p style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{selectedIncident.currentTemperature.toFixed(1)}°C</p>
              </div>
              <div>
                <p style={{ margin: '0 0 0.25rem', fontSize: '0.875rem', color: '#64748b', textTransform: 'uppercase' }}>{t('incidents.detail.maxMin', 'Máxima/Mínima')}</p>
                <p style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
                  {selectedIncident.maxTemperature.toFixed(1)}°C / {selectedIncident.minTemperature.toFixed(1)}°C
                </p>
              </div>
              <div>
                <p style={{ margin: '0 0 0.25rem', fontSize: '0.875rem', color: '#64748b', textTransform: 'uppercase' }}>{t('incidents.table.openedAt', 'Aberto em')}</p>
                <p style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
                  {new Date(selectedIncident.openedAt).toLocaleString(language)}
                </p>
              </div>
              <div>
                <p style={{ margin: '0 0 0.25rem', fontSize: '0.875rem', color: '#64748b', textTransform: 'uppercase' }}>{t('incidents.table.occurrences', 'Ocorrências')}</p>
                <p style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{selectedIncident.samplesOutOfRange}</p>
              </div>
            </div>

            {selectedIncident.notes && selectedIncident.notes.length > 0 && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ margin: '0 0 1rem', fontSize: '0.875rem', fontWeight: 600, textTransform: 'uppercase', color: '#64748b' }}>
                  {t('incidents.detail.history', 'Histórico')}
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {selectedIncident.notes.map((note, idx) => (
                    <div key={idx} style={{ 
                      padding: '0.75rem',
                      background: '#f8fafc',
                      borderRadius: '0.375rem',
                      borderLeft: `3px solid ${getStatusColor('open')}`
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.25rem' }}>
                        <p style={{ margin: 0, fontWeight: 500, fontSize: '0.875rem' }}>{note.action}</p>
                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          {new Date(note.timestamp).toLocaleString(language)}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: '0.875rem', color: '#475569' }}>{note.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedIncident.status !== 'resolved' && (
              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1.5rem' }}>
                <div style={{ marginBottom: '1rem' }}>
                  <label htmlFor="note-input" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 500 }}>
                    {t('incidents.actions.addNote', 'Adicionar Nota')}
                  </label>
                  <textarea
                    id="note-input"
                    data-testid="incident-note-input"
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder={t('incidents.actions.notePlaceholder', 'Descreva as ações tomadas...')}
                    className="input"
                    style={{ minHeight: '80px', fontFamily: 'inherit' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  {selectedIncident.status === 'open' && (
                    <>
                      <Button
                        data-testid="incident-acknowledge-button"
                        onClick={() => handleAcknowledge(selectedIncident._id)}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                      >
                        <CheckCircle size={16} />
                        {t('incidents.actions.acknowledge', 'Reconhecer')}
                      </Button>
                      {selectedIncident.escalationLevel < 2 && (
                        <Button
                          data-testid="incident-escalate-button"
                          onClick={() => handleEscalate(selectedIncident._id)}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f59e0b' }}
                        >
                          <ArrowUp size={16} />
                          {t('incidents.actions.escalate', 'Escalar')}
                        </Button>
                      )}
                      <Button
                        data-testid="incident-resolve-button"
                        onClick={() => handleResolve(selectedIncident._id)}
                        variant="secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                      >
                        <AlertCircle size={16} />
                        {t('incidents.actions.resolve', 'Resolver')}
                      </Button>
                    </>
                  )}
                  {selectedIncident.status === 'acknowledged' && (
                    <>
                      {selectedIncident.escalationLevel < 2 && (
                        <Button
                          data-testid="incident-escalate-button"
                          onClick={() => handleEscalate(selectedIncident._id)}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f59e0b' }}
                        >
                          <ArrowUp size={16} />
                          {t('incidents.actions.escalate', 'Escalar')}
                        </Button>
                      )}
                      <Button
                        data-testid="incident-resolve-button"
                        onClick={() => handleResolve(selectedIncident._id)}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                      >
                        <CheckCircle size={16} />
                        {t('incidents.actions.resolve', 'Resolver')}
                      </Button>
                      <Button
                        data-testid="incident-add-note-button"
                        onClick={() => handleAddNote(selectedIncident._id)}
                        variant="secondary"
                        disabled={!noteText.trim()}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                      >
                        <MessageSquare size={16} />
                        {t('incidents.actions.addNote', 'Adicionar Nota')}
                      </Button>
                    </>
                  )}
                  {selectedIncident.status === 'escalated' && (
                    <>
                      <Button
                        data-testid="incident-resolve-button"
                        onClick={() => handleResolve(selectedIncident._id)}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                      >
                        <CheckCircle size={16} />
                        {t('incidents.actions.resolve', 'Resolver')}
                      </Button>
                      <Button
                        data-testid="incident-add-note-button"
                        onClick={() => handleAddNote(selectedIncident._id)}
                        variant="secondary"
                        disabled={!noteText.trim()}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                      >
                        <MessageSquare size={16} />
                        {t('incidents.actions.addNote', 'Adicionar Nota')}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
