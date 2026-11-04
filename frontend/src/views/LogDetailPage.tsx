import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import { Log } from '../types/models';
import { logService } from '../services/api';
import { formatPayload, formatMetadata } from '../utils/logFormatter';
import { formatEntityID } from '../utils/entityIdFormatter';
import { useLanguage } from '../contexts/LanguageContext';
import { 
  ArrowLeft,
  XCircle,
  AlertTriangle,
  Info,
  CheckCircle,
  AlertCircle
} from 'lucide-react';

export default function LogDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [log, setLog] = useState<Log | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const loadLog = async () => {
      if (!id) {
        setError(t('logs.detailPage.errors.missingId'));
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        
        // Limpa o ID para garantir que está em formato string
        const cleanId = typeof id === 'string' ? id : String(id);
        
        const response = await logService.getById(cleanId);
        
        if (response && response.data) {
          const payload = response.data as { success: boolean; data?: Log; error?: string };
          if (payload.success && payload.data) {
            setLog(payload.data);
          } else if (payload.error) {
            setError(payload.error);
          } else {
            setError(t('logs.detailPage.notFound'));
          }
        } else {
          setError(t('logs.detailPage.errors.invalidResponse'));
        }
      } catch (err: any) {
        console.error('Erro ao carregar log:', err);
        const errorMessage = err.response?.data?.error || 
                           err.response?.data?.message || 
                           err.message || 
                           t('logs.detailPage.errors.load');
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    loadLog();
  }, [id]);

  const formatTimestamp = (log: Log) => {
    try {
      if (log.timestampISO) {
        const date = new Date(log.timestampISO);
        if (!isNaN(date.getTime())) {
          return date.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });
        }
      }
      if (log.timestamp) {
        let date: Date;
        if (typeof log.timestamp === 'string') {
          date = new Date(log.timestamp);
        } else if (log.timestamp instanceof Date) {
          date = log.timestamp;
        } else if (typeof log.timestamp === 'object' && (log.timestamp as any)?._type === 'Date') {
          // Se for um objeto Date serializado
          date = new Date((log.timestamp as any)._value || log.timestamp);
        } else {
          date = new Date(log.timestamp);
        }
        if (!isNaN(date.getTime())) {
          return date.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });
        }
      }
      if (log.dateTime) {
        const date = typeof log.dateTime === 'string' ? new Date(log.dateTime) : new Date(log.dateTime);
        if (!isNaN(date.getTime())) {
          return date.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });
        }
      }
      return 'N/A';
    } catch (error) {
      console.error('Erro ao formatar timestamp:', error);
      return 'N/A';
    }
  };

  const getSeverityColor = (severity: string) => {
    if (!severity) return 'var(--text-light)';
    switch (severity.toUpperCase()) {
      case 'CRITICAL':
        return '#dc2626';
      case 'ERROR':
        return 'var(--danger)';
      case 'WARNING':
        return 'var(--warning)';
      case 'INFO':
        return '#3b82f6';
      default:
        return 'var(--text-light)';
    }
  };

  const getSeverityIcon = (severity: string) => {
    if (!severity) return <Info size={16} />;
    switch (severity.toUpperCase()) {
      case 'CRITICAL':
      case 'ERROR':
        return <XCircle size={16} />;
      case 'WARNING':
        return <AlertTriangle size={16} />;
      case 'INFO':
        return <Info size={16} />;
      default:
        return <Info size={16} />;
    }
  };

  const getResultColor = (result: string) => {
    if (!result) return 'var(--text-light)';
    switch (result.toUpperCase()) {
      case 'SUCCESS':
        return 'var(--success)';
      case 'ERROR':
      case 'FAILURE':
        return 'var(--danger)';
      case 'WARNING':
        return 'var(--warning)';
      default:
        return 'var(--text-light)';
    }
  };

  const getModuleColor = (module: string) => {
    if (!module) return 'var(--text-light)';
    const moduleLower = module.toLowerCase();
    if (moduleLower.includes('autenticação') || moduleLower.includes('auth')) return '#3b82f6';
    if (moduleLower.includes('cadastro') || moduleLower.includes('patient')) return '#10b981';
    if (moduleLower.includes('amostra') || moduleLower.includes('sample')) return '#8b5cf6';
    if (moduleLower.includes('importação') || moduleLower.includes('import')) return '#f59e0b';
    if (moduleLower.includes('configuração') || moduleLower.includes('config')) return '#6366f1';
    if (moduleLower.includes('segurança') || moduleLower.includes('security')) return '#ef4444';
    return 'var(--text-light)';
  };

  const handleCopy = async (value: string) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Erro ao copiar hash:', e);
    }
  };

  if (loading) {
    return (
      <div className="page-shell logs-page logs-detail-page">
        <Card>
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <p>{t('logs.detailPage.loading')}</p>
          </div>
        </Card>
      </div>
    );
  }

  if (error || !log) {
    return (
      <div className="page-shell logs-page logs-detail-page">
        <Card>
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--danger)' }}>{error || t('logs.detailPage.notFound')}</p>
            <Button onClick={() => navigate('/logs')} style={{ marginTop: '1rem' }}>
              <ArrowLeft size={18} />
              {t('logs.detailPage.back')}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-shell logs-page logs-detail-page">
      <Card>
        <div className="log-detail-actions">
          <Button 
            onClick={() => navigate('/logs')}
            variant="secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <ArrowLeft size={18} />
            {t('logs.detailPage.back')}
          </Button>
        </div>

        <h1 className="log-detail-title">
          {t('logs.detailPage.title')}
        </h1>

        <div className="log-details">
          <div className="detail-section">
            <h3>{t('logs.detailPage.sections.basic')}</h3>
            <div className="detail-grid">
              <div className="detail-item">
                <label>{t('logs.detailPage.labels.id')}</label>
                <span style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                  {(() => {
                    const id: unknown = log._id || log.logID;
                    if (!id) return 'N/A';
                    // Se for objeto serializado (ObjectId), extrai o valor
                    if (typeof id === 'object' && '_type' in id && id._type === 'ObjectId') {
                      return ('_value' in id && id._value) ? String(id._value) : String(id);
                    }
                    // Se for objeto com toString
                    if (typeof id === 'object' && 'toString' in id && typeof id.toString === 'function') {
                      return id.toString();
                    }
                    return String(id);
                  })()}
                </span>
              </div>
              <div className="detail-item">
                <label>{t('logs.detailPage.labels.dateTime')}</label>
                <span>{formatTimestamp(log)}</span>
              </div>
              <div className="detail-item">
                <label>{t('logs.detailPage.labels.timestampISO')}</label>
                <span style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                  {(() => {
                    try {
                      if (log.timestampISO) return log.timestampISO;
                      if (log.timestamp) {
                        let date: Date;
                        if (typeof log.timestamp === 'string') {
                          date = new Date(log.timestamp);
                        } else if (log.timestamp instanceof Date) {
                          date = log.timestamp;
                        } else if (typeof log.timestamp === 'object' && (log.timestamp as any)?._type === 'Date') {
                          date = new Date((log.timestamp as any)._value);
                        } else {
                          date = new Date(log.timestamp);
                        }
                        if (!isNaN(date.getTime())) {
                          return date.toISOString();
                        }
                      }
                      return 'N/A';
                    } catch (e) {
                      return 'N/A';
                    }
                  })()}
                </span>
              </div>
              {log.auditHash && (
                <div className="detail-item">
                  <label>{t('logs.details.auditHash')}</label>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.8125rem', wordBreak: 'break-all', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                    {log.auditHash}
                    <button
                      type="button"
                      className="view-log-button"
                      onClick={() => handleCopy(log.auditHash as string)}
                      title={t('logs.details.copyHash')}
                    >
                      {t('logs.details.copyHash')}
                    </button>
                    {copied && (
                      <span style={{ color: 'var(--success)', fontSize: '0.75rem' }}>{t('logs.details.copied')}</span>
                    )}
                  </span>
                </div>
              )}
              <div className="detail-item">
                <label>{t('logs.detailPage.labels.message')}</label>
                <span style={{ wordBreak: 'break-word' }}>
                  {log.message || 'N/A'}
                </span>
              </div>
              <div className="detail-item">
                <label>{t('logs.detailPage.labels.user')}</label>
                <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '0.9375rem' }}>
                  {log.userName || log.userID || 'USR-SYSTEM'}
                </span>
                <small style={{ display: 'block', color: 'var(--text-light)', marginTop: '0.25rem', fontSize: '0.75rem', fontStyle: 'italic' }}>
                  {t('logs.details.userHint')}
                </small>
              </div>
              <div className="detail-item">
                <label>{t('logs.detailPage.labels.action')}</label>
                <span 
                  className="action-badge"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '0.25rem 0.5rem',
                    borderRadius: '4px',
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    fontFamily: 'monospace',
                    fontSize: '0.8125rem',
                    fontWeight: 500
                  }}
                >
                  {log.action || 'N/A'}
                </span>
              </div>
              <div className="detail-item">
                <label>{t('logs.detailPage.labels.entity')}</label>
                <span style={{ fontWeight: 500 }}>
                  {log.entity || 'N/A'}
                </span>
              </div>
              <div className="detail-item">
                <label>{t('logs.details.entityID')}</label>
                <span style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                  {formatEntityID(log.entityID)}
                </span>
              </div>
              <div className="detail-item">
                <label>{t('logs.detailPage.labels.severity')}</label>
                <span
                  className="severity-badge"
                  style={{ 
                    color: getSeverityColor(log.severity || 'info'),
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem'
                  }}
                >
                  {getSeverityIcon(log.severity || 'INFO')}
                  <span>{log.severity || 'INFO'}</span>
                </span>
              </div>
              <div className="detail-item">
                <label>{t('logs.detailPage.labels.result')}</label>
                <span
                  className="result-badge"
                  style={{ 
                    color: getResultColor(log.result || ''),
                    borderColor: getResultColor(log.result || ''),
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem'
                  }}
                >
                  {log.result === 'success' ? <CheckCircle size={14} /> : 
                   log.result === 'error' || log.result === 'failure' ? <XCircle size={14} /> :
                   <AlertCircle size={14} />}
                  <span>{log.result || 'N/A'}</span>
                </span>
              </div>
              <div className="detail-item">
                <label>{t('logs.details.module')}</label>
                <span
                  className="module-badge"
                  style={{ 
                    color: getModuleColor(log.module || ''),
                    borderColor: getModuleColor(log.module || ''),
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '0.25rem 0.5rem',
                    borderRadius: '4px',
                    border: '1px solid',
                    fontSize: '0.8125rem',
                    fontWeight: 500
                  }}
                >
                  {log.module || 'N/A'}
                </span>
              </div>
            </div>
          </div>

          <div className="detail-section">
            <h3>{t('logs.detailPage.sections.tracking')}</h3>
            <div className="detail-grid">
              <div className="detail-item">
                <label>{t('logs.detailPage.labels.ipSource')}</label>
                <span style={{ fontFamily: 'monospace' }}>
                  {log.ipSource || log.sourceIP || log.metadata?.tracking?.ip || 'N/A'}
                </span>
              </div>
              {log.metadata && typeof log.metadata === 'object' && log.metadata.tracking && (
                <>
                  <div className="detail-item">
                    <label>{t('logs.detailPage.labels.ipOriginal')}</label>
                    <span style={{ fontFamily: 'monospace' }}>
                      {(log.metadata.tracking as any)?.ipOriginal || 'N/A'}
                    </span>
                  </div>
                  <div className="detail-item">
                    <label>{t('logs.detailPage.labels.forwardedFor')}</label>
                    <span style={{ fontFamily: 'monospace' }}>
                      {(log.metadata.tracking as any)?.forwardedFor || 'N/A'}
                    </span>
                  </div>
                  <div className="detail-item">
                    <label>{t('logs.detailPage.labels.userAgent')}</label>
                    <span style={{ fontSize: '0.875rem', wordBreak: 'break-word' }}>
                      {(log.metadata.tracking as any)?.userAgent || 'N/A'}
                    </span>
                  </div>
                  <div className="detail-item">
                    <label>{t('logs.detailPage.labels.referer')}</label>
                    <span>{(log.metadata.tracking as any)?.referer || 'N/A'}</span>
                  </div>
                  <div className="detail-item">
                    <label>{t('logs.detailPage.labels.host')}</label>
                    <span>{(log.metadata.tracking as any)?.host || 'N/A'}</span>
                  </div>
                  <div className="detail-item">
                    <label>{t('logs.detailPage.labels.protocol')}</label>
                    <span>{(log.metadata.tracking as any)?.protocol || 'N/A'}</span>
                  </div>
                  <div className="detail-item">
                    <label>{t('logs.detailPage.labels.secure')}</label>
                    <span>{(log.metadata.tracking as any)?.secure ? t('logs.detailPage.labels.secureYes') : t('logs.detailPage.labels.secureNo')}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {log.payload && (
            <div className="detail-section">
              <h3>{t('logs.detailPage.sections.payload')}</h3>
              <pre className="payload-content" style={{ 
                whiteSpace: 'pre-wrap', 
                wordBreak: 'break-word',
                overflowWrap: 'anywhere'
              }}>
                {(() => {
                  try {
                    return formatPayload(log.payload);
                  } catch (error) {
                    console.error('Erro ao formatar payload:', error);
                    return JSON.stringify(log.payload, null, 2) || t('logs.detailPage.errors.payloadFormat');
                  }
                })()}
              </pre>
            </div>
          )}

          {log.errorStack && (
            <div className="detail-section">
              <h3>{t('logs.detailPage.sections.stack')}</h3>
              <pre className="error-stack-content" style={{ 
                whiteSpace: 'pre-wrap', 
                wordBreak: 'break-word',
                overflowWrap: 'anywhere'
              }}>
                {log.errorStack}
              </pre>
            </div>
          )}

          {log.metadata && (
            <div className="detail-section">
              <h3>{t('logs.detailPage.sections.metadata')}</h3>
              <pre className="metadata-content" style={{ 
                whiteSpace: 'pre-wrap', 
                wordBreak: 'break-word',
                overflowWrap: 'anywhere'
              }}>
                {(() => {
                  try {
                    return formatMetadata(log.metadata);
                  } catch (error) {
                    console.error('Erro ao formatar metadata:', error);
                    return JSON.stringify(log.metadata, null, 2) || t('logs.detailPage.errors.metadataFormat');
                  }
                })()}
              </pre>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

