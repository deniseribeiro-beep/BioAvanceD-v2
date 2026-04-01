import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Input from '../components/UI/Input';
import Button from '../components/UI/Button';
import { Log } from '../types/models';
import { 
  Search, 
  Filter, 
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Eye,
  User,
  AlertCircle,
  CheckCircle,
  XCircle,
  Info,
  AlertTriangle,
  Activity,
  Shield,
  Database
} from 'lucide-react';
import { useLogs } from '../hooks/useLogs';
import { logService, auditService } from '../services/api';
import { extractPayloadSummary } from '../utils/logFormatter';
import { formatEntityID } from '../utils/entityIdFormatter';
import { useLanguage } from '../contexts/LanguageContext';
import './LogsPage.css';

type SortField = 'timestamp' | 'userName' | 'action' | 'entity' | 'severity' | 'result' | 'ipSource' | 'module';
type SortOrder = 'asc' | 'desc';

export default function LogsPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { logs, loading, error, loadLogs } = useLogs();
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredLogs, setFilteredLogs] = useState<Log[]>([]);
  
  // Filtros
  const [filters, setFilters] = useState({
    userName: '',
    action: '',
    entity: '',
    severity: '',
    result: '',
    ip: '',
    module: '',
    startDate: '',
    endDate: ''
  });
  
  const [showFilters, setShowFilters] = useState(false);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  
  // Paginação
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalLogs, setTotalLogs] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  
  // Ordenação
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  
  // Estado para exportação
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Verificação Merkle
  const [verifyDate, setVerifyDate] = useState('');
  const [verifyHash, setVerifyHash] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<null | {
    verified: boolean;
    rootUsed: string | null;
    savedRoot: string | null;
    recalculatedRoot: string | null;
    tampered: boolean | null;
  }>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  // Carrega logs iniciais
  useEffect(() => {
    loadLogs();
  }, []);

  // Reseta paginação quando filtros ou busca mudarem
  useEffect(() => {
    setCurrentPage(1);
  }, [filters, searchTerm]);

  // Aplica filtros e busca quando logs, filtros, paginação ou ordenação mudarem
  useEffect(() => {
    applyFilters();
  }, [filters, searchTerm, logs, sortField, sortOrder, currentPage, pageSize]);


  const applyFilters = () => {
    const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();
    let filtered = [...logs];

    // Filtro de busca por texto (busca por identificador anonimizado, não por nome real)
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(log => 
        (log.userName || '').toLowerCase().includes(searchLower) || // Identificador anonimizado
        (log.action || '').toLowerCase().includes(searchLower) ||
        (log.entity || '').toLowerCase().includes(searchLower) ||
        (log.message || '').toLowerCase().includes(searchLower) ||
        (log.ipSource || log.sourceIP || '').toLowerCase().includes(searchLower)
      );
    }

    // Aplica filtros individuais
    if (filters.userName) {
      filtered = filtered.filter(log => 
        normalize(log.userName).includes(normalize(filters.userName))
      );
    }
    if (filters.action) {
      const actionFilter = normalize(filters.action);
      filtered = filtered.filter(log => normalize(log.action) === actionFilter);
    }
    if (filters.entity) {
      const entityFilter = normalize(filters.entity);
      filtered = filtered.filter(log => normalize(log.entity) === entityFilter);
    }
    if (filters.severity) {
      const severityFilter = normalize(filters.severity);
      filtered = filtered.filter(log => normalize(log.severity) === severityFilter);
    }
    if (filters.result) {
      const resultFilter = normalize(filters.result);
      filtered = filtered.filter(log => normalize(log.result) === resultFilter);
    }
    if (filters.ip) {
      const ip = normalize(filters.ip);
      filtered = filtered.filter(log => 
        normalize(log.ipSource || log.sourceIP).includes(ip)
      );
    }
    if (filters.module) {
      const moduleFilter = normalize(filters.module);
      filtered = filtered.filter(log => normalize(log.module) === moduleFilter);
    }
    if (filters.startDate) {
      try {
        const start = new Date(filters.startDate);
        if (!isNaN(start.getTime())) {
          filtered = filtered.filter(log => {
            try {
              let logDate: Date | null = null;
              if (log.timestampISO) {
                logDate = new Date(log.timestampISO);
              } else if (log.timestamp) {
                if (typeof log.timestamp === 'string') {
                  logDate = new Date(log.timestamp);
                } else if (log.timestamp instanceof Date) {
                  logDate = log.timestamp;
                } else if (typeof log.timestamp === 'object' && (log.timestamp as any)?._type === 'Date') {
                  logDate = new Date((log.timestamp as any)._value);
                } else {
                  logDate = new Date(log.timestamp);
                }
              } else if (log.dateTime) {
                logDate = typeof log.dateTime === 'string' ? new Date(log.dateTime) : new Date(log.dateTime);
              }
              return logDate && !isNaN(logDate.getTime()) && logDate >= start;
            } catch (e) {
              return false;
            }
          });
        }
      } catch (e) {
        console.error('Erro ao filtrar por data inicial:', e);
      }
    }
    if (filters.endDate) {
      try {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        if (!isNaN(end.getTime())) {
          filtered = filtered.filter(log => {
            try {
              let logDate: Date | null = null;
              if (log.timestampISO) {
                logDate = new Date(log.timestampISO);
              } else if (log.timestamp) {
                if (typeof log.timestamp === 'string') {
                  logDate = new Date(log.timestamp);
                } else if (log.timestamp instanceof Date) {
                  logDate = log.timestamp;
                } else if (typeof log.timestamp === 'object' && (log.timestamp as any)?._type === 'Date') {
                  logDate = new Date((log.timestamp as any)._value);
                } else {
                  logDate = new Date(log.timestamp);
                }
              } else if (log.dateTime) {
                logDate = typeof log.dateTime === 'string' ? new Date(log.dateTime) : new Date(log.dateTime);
              }
              return logDate && !isNaN(logDate.getTime()) && logDate <= end;
            } catch (e) {
              return false;
            }
          });
        }
      } catch (e) {
        console.error('Erro ao filtrar por data final:', e);
      }
    }

    // Aplica ordenação
    filtered.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortField) {
        case 'timestamp':
          try {
            const getTime = (log: Log) => {
              if (log.timestampISO) {
                const d = new Date(log.timestampISO);
                return isNaN(d.getTime()) ? 0 : d.getTime();
              }
              if (log.timestamp) {
                let d: Date;
                if (typeof log.timestamp === 'string') {
                  d = new Date(log.timestamp);
                } else if (log.timestamp instanceof Date) {
                  d = log.timestamp;
                } else if (typeof log.timestamp === 'object' && (log.timestamp as any)?._type === 'Date') {
                  d = new Date((log.timestamp as any)._value || log.timestamp);
                } else {
                  d = new Date(log.timestamp);
                }
                return isNaN(d.getTime()) ? 0 : d.getTime();
              }
              if (log.dateTime) {
                const d = typeof log.dateTime === 'string' ? new Date(log.dateTime) : new Date(log.dateTime);
                return isNaN(d.getTime()) ? 0 : d.getTime();
              }
              return 0;
            };
            aValue = getTime(a);
            bValue = getTime(b);
          } catch (e) {
            aValue = 0;
            bValue = 0;
          }
          break;
        case 'userName':
          aValue = (a.userName || '').toLowerCase();
          bValue = (b.userName || '').toLowerCase();
          break;
        case 'action':
          aValue = (a.action || '').toLowerCase();
          bValue = (b.action || '').toLowerCase();
          break;
        case 'entity':
          aValue = (a.entity || '').toLowerCase();
          bValue = (b.entity || '').toLowerCase();
          break;
        case 'severity':
          aValue = (a.severity || '').toLowerCase();
          bValue = (b.severity || '').toLowerCase();
          break;
        case 'result':
          aValue = (a.result || '').toLowerCase();
          bValue = (b.result || '').toLowerCase();
          break;
        case 'ipSource':
          aValue = (a.ipSource || a.sourceIP || '').toLowerCase();
          bValue = (b.ipSource || b.sourceIP || '').toLowerCase();
          break;
        case 'module':
          aValue = (a.module || '').toLowerCase();
          bValue = (b.module || '').toLowerCase();
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    // Aplica paginação
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedLogs = filtered.slice(startIndex, endIndex);

    setFilteredLogs(paginatedLogs);
    setTotalLogs(filtered.length);
    setTotalPages(Math.ceil(filtered.length / pageSize));
  };

  const handleVerifyHash = async () => {
    if (!verifyDate || !verifyHash) {
      setVerifyError(t('logs.verify.errorRequired'));
      setVerifyResult(null);
      return;
    }

    try {
      setVerifyLoading(true);
      setVerifyError(null);
      setVerifyResult(null);

      const reportResponse = await auditService.getReport(verifyDate, verifyHash.trim());
      const reportData = reportResponse?.data?.data;

      const proof = reportData?.proof || null;
      const savedRoot = reportData?.savedRoot || null;
      const recalculatedRoot = reportData?.recalculatedRoot || null;
      const rootUsed = savedRoot || recalculatedRoot || null;

      if (!rootUsed || !proof || !Array.isArray(proof)) {
        setVerifyError(t('logs.verify.errorNoProof'));
        return;
      }

      const verifyResponse = await auditService.verify(verifyHash.trim(), proof, rootUsed);
      setVerifyResult({
        verified: !!verifyResponse?.data?.verified,
        rootUsed,
        savedRoot,
        recalculatedRoot,
        tampered: typeof reportData?.tampered === 'boolean' ? reportData.tampered : null
      });
    } catch (err: any) {
      const message = err.response?.data?.error || err.response?.data?.message || err.message || t('logs.verify.errorGeneric');
      setVerifyError(message);
    } finally {
      setVerifyLoading(false);
    }
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
      setCopiedHash(value);
      setTimeout(() => setCopiedHash((current) => (current === value ? null : current)), 2000);
    } catch (e) {
      console.error('Erro ao copiar hash:', e);
    }
  };

  const handleSort = (field: string) => {
    const sortFieldTyped = field as SortField;
    if (sortField === sortFieldTyped) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(sortFieldTyped);
      setSortOrder('asc');
    }
  };

  const handleExport = async (format: 'csv' | 'xlsx') => {
    setExporting(true);
    setExportError(null);
    
    try {
      const queryFilters: any = { ...filters };
      if (searchTerm) queryFilters.search = searchTerm;

      const response = format === 'xlsx'
        ? await logService.exportExcel(queryFilters)
        : await logService.exportCSV(queryFilters);

      // Verifica se a resposta é realmente um blob ou se é JSON de erro
      const contentType = response.headers['content-type'] || '';
      
      // Se for JSON, pode ser uma resposta de erro
      if (contentType.includes('application/json')) {
        try {
          // Se response.data é um Blob, converte para texto
          const text = response.data instanceof Blob 
            ? await response.data.text()
            : response.data;
          const json = typeof text === 'string' ? JSON.parse(text) : text;
          
          // Se for erro
          throw new Error(json.error || json.message || t('logs.exportError'));
        } catch (parseError: any) {
          // Se não conseguir parsear ou se for erro HTTP
          if (response.status >= 400) {
            throw new Error(parseError.message || t('logs.exportError'));
          }
          throw parseError;
        }
      }

      // Valida se é realmente um blob válido
      if (!(response.data instanceof Blob)) {
        throw new Error('Resposta inválida do servidor');
      }

      const blob = new Blob([response.data], {
        type: format === 'xlsx' 
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
          : 'text/csv;charset=utf-8;'
      });
      
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const dateStr = new Date().toISOString().split('T')[0];
      const fileName = format === 'xlsx' 
        ? `logs_${dateStr}.xlsx` 
        : `logs_${dateStr}.csv`;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      // Feedback de sucesso
      setTimeout(() => {
        setExporting(false);
      }, 1000);
    } catch (err: any) {
      console.error('Erro ao exportar logs:', err);
      
      let errorMessage = t('logs.exportError');
      
      // Se a resposta é um blob (pode ser JSON de erro dentro do blob)
      if (err.response?.data instanceof Blob) {
        try {
          const errorText = await err.response.data.text();
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error || errorJson.message || errorMessage;
        } catch {
          // Se não conseguir parsear, usa status HTTP
          errorMessage = t('logs.exportErrorStatus')
            .replace('{status}', String(err.response?.status || t('logs.exportErrorUnknown')))
            .replace('{statusText}', err.response?.statusText || errorMessage);
        }
      }
      // Se a resposta é um objeto JSON
      else if (err.response?.data && typeof err.response.data === 'object') {
        errorMessage = err.response.data.error || err.response.data.message || errorMessage;
      }
      // Se tem mensagem de erro
      else if (err.message) {
        errorMessage = err.message;
      }
      // Se tem status HTTP
      else if (err.response?.status) {
        errorMessage = `Erro ${err.response.status}: ${err.response.statusText || errorMessage}`;
      }
      
      setExportError(errorMessage);
      setExporting(false);
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


  const getModuleColor = (module: string) => {
    if (!module) return 'var(--text-light)';
    const moduleLower = module.toLowerCase();
    if (moduleLower.includes('autenticação') || moduleLower.includes('auth')) return '#3b82f6';
    if (moduleLower.includes('cadastro') || moduleLower.includes('patient')) return '#10b981';
    if (moduleLower.includes('amostra') || moduleLower.includes('sample')) return '#8b5cf6';
    if (moduleLower.includes('importação') || moduleLower.includes('import')) return '#f59e0b';
    if (moduleLower.includes('configuração') || moduleLower.includes('config')) return '#6366f1';
    if (moduleLower.includes('segurança') || moduleLower.includes('security')) return '#ef4444';
    if (moduleLower.includes('assistente') || moduleLower.includes('ia')) return '#ec4899';
    return 'var(--text-light)';
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

  const formatTimestamp = (log: Log) => {
    try {
      if (log.timestampFormatted) return log.timestampFormatted;
      
      let date: Date | null = null;
      
      // Tenta usar timestampISO primeiro
      if (log.timestampISO) {
        date = new Date(log.timestampISO);
      }
      // Tenta usar timestamp
      else if (log.timestamp) {
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
      }
      // Tenta usar dateTime
      else if (log.dateTime) {
        if (typeof log.dateTime === 'string') {
          date = new Date(log.dateTime);
        } else if (log.dateTime instanceof Date) {
          date = log.dateTime;
        } else if (typeof log.dateTime === 'object' && (log.dateTime as any)?._type === 'Date') {
          date = new Date((log.dateTime as any)._value || log.dateTime);
        } else {
          date = new Date(log.dateTime);
        }
      }
      
      if (!date || isNaN(date.getTime())) return 'N/A';
      
      return date.toLocaleString('pt-BR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch (error) {
      console.error('Erro ao formatar timestamp:', error);
      return 'N/A';
    }
  };

  const truncateMessage = (message: string, maxLength: number = 100) => {
    if (!message) return 'N/A';
    if (message.length <= maxLength) return message;
    return message.substring(0, maxLength) + '...';
  };

  const toggleMessageExpansion = (logId: string) => {
    setExpandedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(logId)) {
        newSet.delete(logId);
      } else {
        newSet.add(logId);
      }
      return newSet;
    });
  };

  const toggleRowExpansion = (logId: string) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(logId)) {
        newSet.delete(logId);
      } else {
        newSet.add(logId);
      }
      return newSet;
    });
  };


  const clearFilters = () => {
    setFilters({
      userName: '',
      action: '',
      entity: '',
      severity: '',
      result: '',
      ip: '',
      module: '',
      startDate: '',
      endDate: ''
    });
    setSearchTerm('');
  };

  const hasActiveFilters = useMemo(() => {
    return Object.values(filters).some(v => v !== '') || searchTerm !== '';
  }, [filters, searchTerm]);

  // Opções para filtros
  // Função para formatar ação para exibição
  const formatAction = (action: string): string => {
    if (!action) return 'N/A';
    
    // Ações semânticas já formatadas
    const actionMap: Record<string, string> = {
      'CREATE': t('logs.actionTypes.create'),
      'READ': t('logs.actionTypes.read'),
      'UPDATE': t('logs.actionTypes.update'),
      'DELETE': t('logs.actionTypes.delete'),
      'QUERY': t('logs.actionTypes.query'),
      'LOGIN': t('logs.actionTypes.login'),
      'LOGOUT': t('logs.actionTypes.logout'),
      'REGISTER': 'Registrar',
      'IMPORT': 'Importar',
      'EXPORT': t('logs.actionTypes.export'),
      'GENERATE': 'Gerar',
      'VALIDATE': 'Validar',
      'MFA': 'MFA',
      'UNAUTHORIZED': 'Não Autorizado',
      'FORBIDDEN': 'Proibido',
      'GET': t('logs.actionTypes.read'),
      'POST': t('logs.actionTypes.create'),
      'PUT': t('logs.actionTypes.update'),
      'PATCH': 'Atualizar Parcialmente'
    };
    
    return actionMap[action.toUpperCase()] || action;
  };

  const actionOptions = useMemo(() => {
    const actions = new Set<string>();
    logs.forEach(log => {
      if (log.action) {
        const action = String(log.action).trim();
        // Filtra apenas ações válidas (não vazias)
        if (action && action !== 'undefined' && action !== 'null') {
          actions.add(action);
        }
      }
    });
    
    // Ordena ações: primeiro ações semânticas (CREATE, UPDATE, etc), depois métodos HTTP
    const semanticActions = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'QUERY', 'LOGIN', 'LOGOUT', 
                            'REGISTER', 'IMPORT', 'EXPORT', 'GENERATE', 'VALIDATE', 'MFA'];
    const sorted = Array.from(actions).sort((a, b) => {
      const aIndex = semanticActions.indexOf(a.toUpperCase());
      const bIndex = semanticActions.indexOf(b.toUpperCase());
      
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.localeCompare(b);
    });
    
    return sorted;
  }, [logs]);

  // Lista de entidades válidas do sistema
  const VALID_ENTITIES = [
    'Access',
    'Authentication',
    'Assistant',
    'Equipment',
    'Export',
    'Import',
    'IntelligentAssistant',
    'Location',
    'Log',
    'Patient',
    'Policy',
    'Report',
    'Result',
    'Sample',
    'Sensor',
    'Sistema',
    'Temperature',
    'User'
  ];

  const entityOptions = useMemo(() => {
    const entities = new Set<string>();
    
    logs.forEach(log => {
      if (log.entity) {
        const entity = String(log.entity).trim();
        
        // Filtra apenas entidades válidas
        // Remove ObjectIds (24 caracteres hexadecimais) e IDs numéricos longos
        const isObjectId = /^[0-9a-fA-F]{24}$/.test(entity);
        const isLongNumericId = /^\d{8,}$/.test(entity);
        const isValidEntity = VALID_ENTITIES.includes(entity);
        
        // Adiciona apenas se for uma entidade válida e não for um ID
        if (!isObjectId && !isLongNumericId && (isValidEntity || entity === 'Sistema')) {
          entities.add(entity);
        }
      }
    });
    
    // Ordena: primeiro as entidades válidas conhecidas, depois outras
    const sorted = Array.from(entities).sort((a, b) => {
      const aIndex = VALID_ENTITIES.indexOf(a);
      const bIndex = VALID_ENTITIES.indexOf(b);
      
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.localeCompare(b);
    });
    
    return sorted;
  }, [logs]);

  const moduleOptions = useMemo(() => {
    const modules = new Set<string>();
    logs.forEach(log => {
      if (log.module) modules.add(log.module);
    });
    return Array.from(modules).sort();
  }, [logs]);

  return (
    <div className="page logs-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('logs.title')}</h1>
          <p className="page-subtitle">{t('logs.subtitle')}</p>
        </div>
        <div className="logs-header-actions">
          <Button
            variant="secondary"
            onClick={() => setShowFilters(!showFilters)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <Filter size={18} />
            {t('common.filter')} {hasActiveFilters && `(${Object.values(filters).filter(v => v !== '').length})`}
          </Button>
          <Button
            variant="secondary"
            onClick={() => handleExport('xlsx')}
            disabled={exporting || loading}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            title={t('logs.exportExcel')}
          >
            <FileSpreadsheet size={18} />
            {exporting ? t('common.exporting') : 'Excel'}
          </Button>
        </div>
      </div>

      {loading && (
        <Card>
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <p>{t('common.loading')}</p>
          </div>
        </Card>
      )}

      {error && (
        <Card>
          <div className="error-message">
            <AlertCircle size={20} />
            <div>
              <strong>{t('common.error')}:</strong> {error}
            </div>
          </div>
        </Card>
      )}

      {exportError && (
        <Card>
          <div className="error-message" style={{ 
            padding: '1rem', 
            backgroundColor: '#fee2e2', 
            border: '1px solid #fecaca', 
            borderRadius: '8px',
            color: '#991b1b',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            marginBottom: '1rem'
          }}>
            <AlertCircle size={20} />
            <div style={{ flex: 1 }}>
              <strong>{t('logs.exportError')}:</strong> {exportError}
            </div>
            <Button
              variant="secondary"
              onClick={() => setExportError(null)}
              style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}
            >
              {t('common.close')}
            </Button>
          </div>
        </Card>
      )}

      {!loading && !error && (
        <>
          {/* Barra de busca e filtros */}
          <Card className="logs-filters-card">
            <div className="logs-search">
              <div className="search-input-wrapper">
                <Search size={20} className="search-icon" />
                <Input
                  placeholder={t('logs.searchPlaceholder')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
                {searchTerm && (
                  <button
                    className="clear-search"
                    onClick={() => setSearchTerm('')}
                    title={t('logs.clearSearch')}
                  >
                    <XCircle size={16} />
                  </button>
                )}
              </div>
            </div>

            {showFilters && (
              <div className="filters-panel">
                <div className="filters-grid">
                  <div className="filter-group">
                    <label>{t('logs.filters.userIdentifier')}</label>
                    <Input
                      value={filters.userName}
                      onChange={(e) => setFilters({ ...filters, userName: e.target.value })}
                      placeholder={t('logs.filters.userIdentifierPlaceholder')}
                    />
                    <small style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: '0.25rem', display: 'block' }}>
                      {t('logs.filters.userIdentifierHint')}
                    </small>
                  </div>

                  <div className="filter-group">
                    <label>{t('logs.filters.action')}</label>
                    <select
                      aria-label={t('logs.filters.action')}
                      value={filters.action}
                      onChange={(e) => setFilters({ ...filters, action: e.target.value })}
                    >
                      <option value="">{t('logs.filters.allActions')}</option>
                      {actionOptions.map(action => (
                        <option key={action} value={action}>
                          {formatAction(action)} ({action})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="filter-group">
                    <label>{t('logs.filters.entity')}</label>
                    <select
                      aria-label={t('logs.filters.entity')}
                      value={filters.entity}
                      onChange={(e) => setFilters({ ...filters, entity: e.target.value })}
                    >
                      <option value="">{t('logs.filters.allEntities')}</option>
                      {entityOptions.map(entity => (
                        <option key={entity} value={entity}>{entity}</option>
                      ))}
                    </select>
                  </div>

                  <div className="filter-group">
                    <label>{t('logs.filters.severity')}</label>
                    <select
                      aria-label={t('logs.filters.severity')}
                      value={filters.severity}
                      onChange={(e) => setFilters({ ...filters, severity: e.target.value })}
                    >
                      <option value="">{t('logs.filters.allSeverities')}</option>
                      <option value="info">{t('logs.severity.info')}</option>
                      <option value="warning">{t('logs.severity.warning')}</option>
                      <option value="error">{t('logs.severity.error')}</option>
                      <option value="critical">{t('logs.severity.critical')}</option>
                    </select>
                  </div>

                  <div className="filter-group">
                    <label>{t('logs.filters.result')}</label>
                    <select
                      aria-label={t('logs.filters.result')}
                      value={filters.result}
                      onChange={(e) => setFilters({ ...filters, result: e.target.value })}
                    >
                      <option value="">{t('logs.filters.allResults')}</option>
                      <option value="success">{t('logs.result.success')}</option>
                      <option value="error">{t('logs.result.error')}</option>
                      <option value="warning">{t('logs.result.warning')}</option>
                    </select>
                  </div>

                  <div className="filter-group">
                    <label>{t('logs.filters.sourceIP')}</label>
                    <Input
                      value={filters.ip}
                      onChange={(e) => setFilters({ ...filters, ip: e.target.value })}
                      placeholder={t('logs.filters.sourceIPPlaceholder')}
                    />
                  </div>

                  <div className="filter-group">
                    <label>{t('logs.filters.module')}</label>
                    <select
                      aria-label={t('logs.filters.module')}
                      value={filters.module}
                      onChange={(e) => setFilters({ ...filters, module: e.target.value })}
                    >
                      <option value="">{t('logs.filters.allModules')}</option>
                      {moduleOptions.map(module => (
                        <option key={module} value={module}>{module}</option>
                      ))}
                    </select>
                  </div>

                  <div className="filter-group">
                    <label>{t('logs.filters.startDate')}</label>
                    <Input
                      type="date"
                      value={filters.startDate}
                      onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                    />
                  </div>

                  <div className="filter-group">
                    <label>{t('logs.filters.endDate')}</label>
                    <Input
                      type="date"
                      value={filters.endDate}
                      onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                    />
                  </div>
                </div>

                {hasActiveFilters && (
                  <div className="filters-actions">
                    <Button variant="secondary" onClick={clearFilters}>
                      {t('logs.filters.clearFilters')}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card className="logs-filters-card logs-verify-card">
            <div className="logs-verify-row">
              <div className="logs-verify-date">
                <label className="logs-inline-label">
                  {t('logs.verify.date')}
                </label>
                <Input
                  type="date"
                  value={verifyDate}
                  onChange={(e) => setVerifyDate(e.target.value)}
                />
              </div>
              <div className="logs-verify-hash">
                <label className="logs-inline-label">
                  {t('logs.verify.hash')}
                </label>
                <Input
                  placeholder={t('logs.verify.hashPlaceholder')}
                  value={verifyHash}
                  onChange={(e) => setVerifyHash(e.target.value)}
                />
              </div>
              <Button
                variant="secondary"
                onClick={handleVerifyHash}
                disabled={verifyLoading}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <Shield size={18} />
                {verifyLoading ? t('common.loading') : t('logs.verify.action')}
              </Button>
            </div>
            {verifyError && (
              <div className="error-message" style={{ marginTop: '0.75rem' }}>
                <AlertCircle size={18} />
                <div>{verifyError}</div>
              </div>
            )}
            {verifyResult && (
              <div className="logs-verify-result">
                <div>
                  <strong>{t('logs.verify.status')}:</strong>{' '}
                  <span style={{ color: verifyResult.verified ? 'var(--success)' : 'var(--danger)' }}>
                    {verifyResult.verified ? t('logs.verify.ok') : t('logs.verify.fail')}
                  </span>
                </div>
                {verifyResult.rootUsed && (
                  <div className="logs-verify-root">
                    {t('logs.verify.root')}: {verifyResult.rootUsed}
                  </div>
                )}
                {verifyResult.tampered !== null && (
                  <div>
                    <strong>{t('logs.verify.tamperedLabel')}:</strong>{' '}
                    {verifyResult.tampered ? t('logs.verify.tamperedYes') : t('logs.verify.tamperedNo')}
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Tabela de logs */}
          <Card>
            <div className="logs-table-container">
              <Table
                headers={[
                  { label: t('logs.tableHeaders.dateTime'), sortable: true, field: 'timestamp' },
                  { label: t('logs.tableHeaders.action'), sortable: true, field: 'action' },
                  { label: t('logs.tableHeaders.message'), sortable: false },
                  { label: t('logs.tableHeaders.severity'), sortable: true, field: 'severity' },
                  { label: t('logs.tableHeaders.result'), sortable: true, field: 'result' },
                  { label: '', sortable: false, className: 'log-expand-col' }
                ]}
                onSort={handleSort}
                sortField={sortField}
                sortOrder={sortOrder}
              >
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="no-logs-message">
                      <div className="no-logs-content">
                        <span>
                          {hasActiveFilters
                            ? (t('logs.noLogsFound') || 'Nenhum resultado encontrado com os filtros atuais.')
                            : 'Nenhum log disponível.'}
                        </span>
                        <div className="no-logs-actions">
                          {hasActiveFilters && (
                            <Button variant="secondary" onClick={clearFilters}>
                              {t('logs.filters.clearFilters')}
                            </Button>
                          )}
                          <Button variant="secondary" onClick={loadLogs}>
                            Recarregar
                          </Button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log, index) => {
                    // Extrai ID de forma segura, tratando ObjectIds serializados
                    const getIdString = (id: any): string => {
                      if (!id) return '';
                      if (typeof id === 'string') return id;
                      if (typeof id === 'object' && id._type === 'ObjectId') {
                        return id._value || String(id);
                      }
                      if (typeof id === 'object' && id.toString) {
                        return id.toString();
                      }
                      return String(id);
                    };
                    
                    const rawId = log._id || log.logID;
                    const logId = getIdString(rawId) || `log-${index}`;
                    const isMessageExpanded = expandedMessages.has(logId);
                    const isRowExpanded = expandedRows.has(logId);
                    const message = log.message || 'N/A';
                    const shouldTruncate = typeof message === 'string' && message.length > 120;
                    const displayMessage = isMessageExpanded || !shouldTruncate ? message : (typeof message === 'string' ? truncateMessage(message, 120) : String(message));
                    const entity = log.entity || 'N/A';
                    
                    // Extrai IP de forma segura
                    let ip = 'N/A';
                    try {
                      if (log.ipSource) ip = String(log.ipSource);
                      else if (log.sourceIP) ip = String(log.sourceIP);
                      else if (log.ip) ip = String(log.ip);
                      else if (log.metadata && typeof log.metadata === 'object' && (log.metadata as any).tracking && (log.metadata as any).tracking.ip) {
                        ip = String((log.metadata as any).tracking.ip);
                      }
                    } catch (e) {
                      ip = 'N/A';
                    }
                    
                    return (
                      <>
                        <tr 
                          key={logId}
                          className={`log-row severity-${(log.severity || 'info').toLowerCase()} ${isRowExpanded ? 'expanded' : ''}`}
                        >
                          <td className="log-timestamp">
                            <span title={log.timestampISO || formatTimestamp(log)}>
                              {formatTimestamp(log)}
                            </span>
                          </td>
                          <td className="log-action">
                            <span 
                              className="action-badge"
                              style={{
                                fontFamily: 'monospace',
                                fontSize: '0.8125rem',
                                fontWeight: 500,
                                padding: '0.25rem 0.5rem',
                                borderRadius: '4px',
                                backgroundColor: 'var(--bg-secondary)',
                                border: '1px solid var(--border-color)'
                              }}
                              title={log.action || 'N/A'}
                            >
                              {formatAction(log.action || 'N/A')}
                            </span>
                          </td>
                          <td className="log-message">
                            <div className="message-container">
                              <span className="message-text" title={message}>
                                {displayMessage}
                              </span>
                              {shouldTruncate && (
                                <button
                                  className="message-expand-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleMessageExpansion(logId);
                                  }}
                                  title={isMessageExpanded ? t('logs.actions.collapseMessage') : t('logs.actions.expandMessage')}
                                >
                                  {isMessageExpanded ? t('logs.actions.viewLess') : t('logs.actions.viewMore')}
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="log-severity">
                            <span
                              className="severity-badge"
                              style={{ color: getSeverityColor(log.severity || 'info') }}
                              title={log.severity || 'INFO'}
                            >
                              {getSeverityIcon(log.severity || 'INFO')}
                              <span>{log.severity || 'INFO'}</span>
                            </span>
                          </td>
                          <td className="log-result">
                            <span
                              className="result-badge"
                              style={{ 
                                color: getResultColor(log.result || ''),
                                borderColor: getResultColor(log.result || '')
                              }}
                            >
                              {log.result === 'success' ? <CheckCircle size={12} /> : 
                               log.result === 'error' || log.result === 'failure' ? <XCircle size={12} /> :
                               <AlertCircle size={12} />}
                              <span>{log.result || 'N/A'}</span>
                            </span>
                          </td>
                          <td className="log-expand-col">
                            <button
                              className="expand-row-button"
                              onClick={() => toggleRowExpansion(logId)}
                              title={isRowExpanded ? t('logs.actions.hideDetails') : t('logs.actions.viewDetails')}
                            >
                              {isRowExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                          </td>
                        </tr>
                        {isRowExpanded && (
                          <tr key={`${logId}-details`} className="log-details-row">
                            <td colSpan={6} className="log-details-content">
                              <div className="log-details-grid">
                                <div className="log-detail-item">
                                  <span className="log-detail-label">
                                    <User size={14} />
                                    {t('logs.details.user')}
                                  </span>
                                  <span className="log-detail-value" title={t('logs.details.userHint')}>
                                    {log.userName || 'USR-SYSTEM'}
                                  </span>
                                </div>
                                <div className="log-detail-item">
                                  <span className="log-detail-label">
                                    <Activity size={14} />
                                    {t('logs.details.module')}
                                  </span>
                                  <span 
                                    className="log-detail-value module-badge"
                                    style={{ 
                                      color: getModuleColor(log.module || ''),
                                      borderColor: getModuleColor(log.module || '')
                                    }}
                                  >
                                    {log.module || 'N/A'}
                                  </span>
                                </div>
                                <div className="log-detail-item">
                                  <span className="log-detail-label">
                                    <Database size={14} />
                                    {t('logs.details.entity')}
                                  </span>
                                  <span className="log-detail-value entity-text" title={`Entidade: ${entity}`}>
                                    {entity}
                                  </span>
                                </div>
                                <div className="log-detail-item">
                                  <span className="log-detail-label">
                                    <Shield size={14} />
                                    {t('logs.details.ip')}
                                  </span>
                                  <span
                                    className="log-detail-value ip-text"
                                    title={
                                      (() => {
                                        try {
                                          if (log.metadata && typeof log.metadata === 'object') {
                                            const tracking = (log.metadata as any).tracking;
                                            if (tracking && typeof tracking === 'object') {
                                              return `IP: ${tracking.ip || 'N/A'}\n` +
                                                `User-Agent: ${tracking.userAgent || 'N/A'}\n` +
                                                `Referer: ${tracking.referer || 'N/A'}\n` +
                                                `Host: ${tracking.host || 'N/A'}`;
                                            }
                                          }
                                        } catch (e) {
                                          // Ignora erros
                                        }
                                        return `IP: ${ip}`;
                                      })()
                                    }
                                  >
                                    {ip}
                                  </span>
                                </div>
                                {log.entityID && (
                                  <div className="log-detail-item">
                                    <span className="log-detail-label">
                                      {t('logs.details.entityID')}
                                    </span>
                                    <span className="log-detail-value" style={{ fontFamily: 'monospace' }}>
                                      {formatEntityID(log.entityID)}
                                    </span>
                                  </div>
                                )}
                                {log.auditHash && (
                                  <div className="log-detail-item" style={{ gridColumn: '1 / -1' }}>
                                    <span className="log-detail-label">
                                      {t('logs.details.auditHash')}
                                    </span>
                                    <span className="log-detail-value" style={{ fontFamily: 'monospace', wordBreak: 'break-all', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                      {log.auditHash}
                                      <button
                                        type="button"
                                        className="view-log-button"
                                        onClick={() => handleCopy(log.auditHash as string)}
                                        title={t('logs.details.copyHash')}
                                      >
                                        {t('logs.details.copyHash')}
                                      </button>
                                      {copiedHash === log.auditHash && (
                                        <span style={{ color: 'var(--success)', fontSize: '0.75rem' }}>
                                          {t('logs.details.copied')}
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                )}
                                {log.payload && (
                                  <div className="log-detail-item" style={{ gridColumn: '1 / -1' }}>
                                    <span className="log-detail-label">
                                      {t('logs.details.payload')}:
                                    </span>
                                    <div className="log-detail-value" style={{ 
                                      fontFamily: 'monospace', 
                                      fontSize: '0.8125rem',
                                      backgroundColor: 'var(--bg-secondary)',
                                      padding: '0.5rem',
                                      borderRadius: '4px',
                                      overflow: 'auto',
                                      maxHeight: '200px',
                                      whiteSpace: 'pre-wrap',
                                      wordBreak: 'break-word'
                                    }}>
                                      {(() => {
                                        try {
                                          return extractPayloadSummary(log.payload);
                                        } catch (e) {
                                          console.error('Erro ao extrair resumo do payload:', e);
                                          return t('logs.details.payloadError');
                                        }
                                      })()}
                                    </div>
                                  </div>
                                )}
                                <div className="log-detail-item log-detail-actions">
                                  <button
                                    className="view-log-button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      try {
                                        // Extrai ID de forma segura para navegação
                                        const getIdForNavigation = (id: any): string | null => {
                                          if (!id) return null;
                                          if (typeof id === 'string') return id;
                                          if (typeof id === 'object' && (id as any)?._type === 'ObjectId') {
                                            return (id as any)._value || null;
                                          }
                                          if (typeof id === 'object' && (id as any)?._value) {
                                            return String((id as any)._value);
                                          }
                                          if (typeof id === 'object' && (id as any).toString) {
                                            return (id as any).toString();
                                          }
                                          return String(id);
                                        };
                                        
                                        const navId = getIdForNavigation(log._id || log.logID);
                                        if (navId) {
                                          navigate(`/logs/${navId}`);
                                        } else {
                                          console.error('Não foi possível extrair ID para navegação');
                                        }
                                      } catch (error) {
                                        console.error('Erro ao navegar para detalhes:', error);
                                      }
                                    }}
                                    title={t('logs.actions.viewFullDetails')}
                                    type="button"
                                  >
                                    <Eye size={14} />
                                    {t('logs.actions.viewFullDetails')}
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })
                )}
              </Table>
            </div>

            {/* Paginação */}
            {totalPages > 1 && (
              <div className="pagination">
                <div className="pagination-info">
                  {t('logs.pagination.showing')
                    .replace('{start}', String(((currentPage - 1) * pageSize) + 1))
                    .replace('{end}', String(Math.min(currentPage * pageSize, totalLogs)))
                    .replace('{total}', String(totalLogs))}
                </div>
                <div className="pagination-controls">
                  <Button
                    variant="secondary"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft size={18} />
                    {t('logs.pagination.previous')}
                  </Button>
                  <span className="page-numbers">
                    {t('logs.pagination.page')
                      .replace('{current}', String(currentPage))
                      .replace('{total}', String(totalPages))}
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    {t('logs.pagination.next')}
                    <ChevronRight size={18} />
                  </Button>
                </div>
                <div className="pagination-size">
                  <label>{t('logs.pagination.itemsPerPage')}</label>
                  <select
                    aria-label={t('logs.pagination.itemsPerPage')}
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                  </select>
                </div>
              </div>
            )}
          </Card>
        </>
      )}

    </div>
  );
}
