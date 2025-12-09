import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import Modal from '../components/UI/Modal';
import Table from '../components/UI/Table';
import { FileText, Download, FileDown, Printer, ArrowLeft, Filter } from 'lucide-react';
import { reportsService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { getPatientDisplayName, formatPatientDisplay } from '../utils/patientAnonymization';
import './ReportQueryPage.css';

interface ReportFilter {
  name: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select';
  options?: string[];
}

export default function ReportQueryPage() {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [filters, setFilters] = useState<ReportFilter[]>([]);
  const [filterValues, setFilterValues] = useState<Record<string, any>>({});
  const [previewData, setPreviewData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (type) {
      loadFilters();
    }
  }, [type]);

  const loadFilters = async () => {
    try {
      setLoadingFilters(true);
      const response = await reportsService.getFilters(type!);
      setFilters(response.data.filters || []);
    } catch (err: any) {
      setError('Erro ao carregar filtros: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoadingFilters(false);
    }
  };

  const handleFilterChange = (name: string, value: any) => {
    setFilterValues({ ...filterValues, [name]: value });
  };

  const handlePreview = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await reportsService.previewReport(type!, { filters: filterValues });
      setPreviewData(response.data);
    } catch (err: any) {
      setError('Erro ao gerar pré-visualização: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (format: 'csv' | 'pdf') => {
    try {
      if (format === 'csv') {
        const response = await reportsService.exportReport(type!, 'csv', filterValues);
        // Cria blob e faz download
        const blob = new Blob([response.data], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `relatorio_${type?.replace(/\s+/g, '_')}_${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } else if (format === 'pdf') {
        const response = await reportsService.exportReport(type!, 'pdf', filterValues);
        // Para PDF, pode retornar JSON ou usar biblioteca de PDF
        const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `relatorio_${type?.replace(/\s+/g, '_')}_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } catch (err: any) {
      alert('Erro ao exportar: ' + (err.response?.data?.error || err.message));
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const renderFilterInput = (filter: ReportFilter) => {
    switch (filter.type) {
      case 'select':
        if (!filter.options || filter.options.length === 0) {
          // Se não há opções, renderiza como input de texto
          return (
            <Input
              type="text"
              value={filterValues[filter.name] || ''}
              onChange={(e) => handleFilterChange(filter.name, e.target.value)}
              placeholder="Digite o valor..."
            />
          );
        }
        return (
          <select
            className="input"
            value={filterValues[filter.name] || ''}
            onChange={(e) => handleFilterChange(filter.name, e.target.value)}
          >
            <option value="">Todos</option>
            {filter.options.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        );
      case 'date':
        return (
          <Input
            type="date"
            value={filterValues[filter.name] || ''}
            onChange={(e) => handleFilterChange(filter.name, e.target.value)}
          />
        );
      case 'number':
        return (
          <Input
            type="number"
            value={filterValues[filter.name] || ''}
            onChange={(e) => handleFilterChange(filter.name, parseFloat(e.target.value))}
          />
        );
      default:
        return (
          <Input
            type="text"
            value={filterValues[filter.name] || ''}
            onChange={(e) => handleFilterChange(filter.name, e.target.value)}
          />
        );
    }
  };

  const renderPreviewTable = () => {
    if (!previewData || !previewData.data) return null;

    const data = previewData.data;
    
    // Mensagem de erro ou dados vazios
    if (data.message) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <p>{data.message}</p>
        </div>
      );
    }

    if (data.total === 0) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <p>Nenhum registro encontrado com os filtros aplicados.</p>
        </div>
      );
    }
    
    // Relatório de Pacientes (simples)
    if (data.patients && Array.isArray(data.patients) && !data.patients[0]?.samples) {
      return (
        <>
          {data.previewLimited && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#fef3c7', color: '#92400e', borderRadius: '6px', fontSize: '0.875rem' }}>
              ⚠️ Mostrando apenas os primeiros 50 registros. Total: {data.total} registros.
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <Table
              headers={['ID', 'Nome', 'Unidade Clínica', 'Registro', 'Data Nascimento', 'Sexo']}
            >
              {data.patients.map((p: any) => (
                <tr key={p.patientID}>
                  <td>{p.patientID}</td>
                  <td>{getPatientDisplayName(p, user)}</td>
                  <td>N/A</td>
                  <td>N/A</td>
                  <td>N/A</td>
                  <td>N/A</td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      );
    }

    // Amostras por Paciente (com relacionamento)
    if (data.patients && Array.isArray(data.patients) && data.patients[0]?.samples !== undefined) {
      return (
        <>
          {data.previewLimited && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#fef3c7', color: '#92400e', borderRadius: '6px', fontSize: '0.875rem' }}>
              ⚠️ Mostrando apenas os primeiros 20 pacientes. Total: {data.total} pacientes.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {data.patients.map((patient: any) => (
              <div key={patient.patientID} style={{ 
                border: '1px solid #e2e8f0', 
                borderRadius: '8px', 
                padding: '1rem',
                backgroundColor: '#f8fafc'
              }}>
                <div style={{ 
                  marginBottom: '1rem', 
                  paddingBottom: '0.75rem', 
                  borderBottom: '2px solid #cbd5e1',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#1e293b' }}>
                      {formatPatientDisplay(patient, user)}
                    </h3>
                  </div>
                  <div style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: '#3b82f6',
                    color: 'white',
                    borderRadius: '6px',
                    fontSize: '0.875rem',
                    fontWeight: 600
                  }}>
                    {patient.sampleCount || 0} {patient.sampleCount === 1 ? 'Amostra' : 'Amostras'}
                  </div>
                </div>
                
                {patient.samples && patient.samples.length > 0 ? (
                  <>
                    {patient.samplesLimited && (
                      <div style={{ marginBottom: '0.5rem', padding: '0.5rem', backgroundColor: '#fef3c7', color: '#92400e', borderRadius: '4px', fontSize: '0.75rem' }}>
                        Mostrando apenas as primeiras 10 amostras
                      </div>
                    )}
                    <div style={{ overflowX: 'auto' }}>
                      <Table
                        headers={['ID Amostra', 'Código Barras', 'Tipo', 'Status', 'Disponibilidade', 'Quantidade', 'Data Registro']}
                      >
                        {patient.samples.map((sample: any) => {
                          // Calcula disponibilidade baseado nas quantidades
                          let availabilityStatus = sample.availabilityStatus;
                          const availableQty = sample.availableQuantity !== undefined ? sample.availableQuantity : sample.quantity;
                          const totalQty = sample.quantity || 0;
                          
                          if (!availabilityStatus || (availableQty <= 0 && totalQty >= 0)) {
                            if (sample.movementType === 'Transferência') {
                              availabilityStatus = 'Indisponível';
                            } else if (availableQty <= 0 || totalQty <= 0) {
                              availabilityStatus = 'Indisponível';
                            } else if (availableQty < totalQty) {
                              availabilityStatus = 'Parcialmente Disponível';
                            } else {
                              availabilityStatus = 'Disponível';
                            }
                          } else if (availabilityStatus === 'Disponível' && availableQty <= 0) {
                            availabilityStatus = 'Indisponível';
                          } else if (availabilityStatus === 'Disponível' && availableQty < totalQty && availableQty > 0) {
                            availabilityStatus = 'Parcialmente Disponível';
                          }
                          
                          const availabilityColor = availabilityStatus === 'Disponível' ? '#065f46' : 
                                                   availabilityStatus === 'Parcialmente Disponível' ? '#92400e' : '#991b1b';
                          const availabilityBg = availabilityStatus === 'Disponível' ? '#d1fae5' : 
                                                 availabilityStatus === 'Parcialmente Disponível' ? '#fef3c7' : '#fee2e2';
                          
                          return (
                            <tr key={sample.sampleID}>
                              <td>{sample.sampleID}</td>
                              <td>{sample.barcode || 'N/A'}</td>
                              <td>{sample.sampleType || 'N/A'}</td>
                              <td>{sample.currentStatus || 'N/A'}</td>
                              <td>
                                <span style={{
                                  padding: '0.25rem 0.5rem',
                                  borderRadius: '4px',
                                  fontSize: '0.75rem',
                                  backgroundColor: availabilityBg,
                                  color: availabilityColor,
                                  fontWeight: 500
                                }}>
                                  {availabilityStatus}
                                  {availableQty !== undefined && availableQty !== totalQty && (
                                    <span style={{ marginLeft: '0.25rem', fontSize: '0.7rem', opacity: 0.8 }}>
                                      ({availableQty}/{totalQty})
                                    </span>
                                  )}
                                </span>
                              </td>
                              <td>{totalQty} {sample.measurementUnit || ''}</td>
                              <td>{sample.registrationDate ? new Date(sample.registrationDate).toLocaleDateString('pt-BR') : 'N/A'}</td>
                            </tr>
                          );
                        })}
                      </Table>
                    </div>
                  </>
                ) : (
                  <p style={{ color: '#64748b', fontStyle: 'italic', margin: 0 }}>
                    Nenhuma amostra encontrada para este paciente.
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      );
    }

    // Relatório de Amostras
    if (data.samples && Array.isArray(data.samples)) {
      return (
        <>
          {data.previewLimited && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#fef3c7', color: '#92400e', borderRadius: '6px', fontSize: '0.875rem' }}>
              ⚠️ Mostrando apenas os primeiros 50 registros. Total: {data.total} registros.
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <Table
              headers={['ID', 'Código Barras', 'Tipo', 'Status', 'Quantidade', 'Disponibilidade', 'Data Registro', 'Paciente']}
            >
              {data.samples.map((s: any) => {
                // Calcula disponibilidade baseado nas quantidades
                let availabilityStatus = s.availabilityStatus;
                const availableQty = s.availableQuantity !== undefined ? s.availableQuantity : s.quantity;
                const totalQty = s.quantity || 0;
                
                // Se não tem status ou se a quantidade disponível é 0, recalcula
                if (!availabilityStatus || (availableQty <= 0 && totalQty >= 0)) {
                  if (s.movementType === 'Transferência') {
                    availabilityStatus = 'Indisponível';
                  } else if (availableQty <= 0 || totalQty <= 0) {
                    availabilityStatus = 'Indisponível';
                  } else if (availableQty < totalQty) {
                    availabilityStatus = 'Parcialmente Disponível';
                  } else {
                    availabilityStatus = 'Disponível';
                  }
                } else if (availabilityStatus === 'Disponível' && availableQty <= 0) {
                  // Corrige se o status diz "Disponível" mas não há quantidade
                  availabilityStatus = 'Indisponível';
                } else if (availabilityStatus === 'Disponível' && availableQty < totalQty && availableQty > 0) {
                  // Corrige se o status diz "Disponível" mas há menos quantidade disponível
                  availabilityStatus = 'Parcialmente Disponível';
                }
                
                const availabilityColor = availabilityStatus === 'Disponível' ? '#065f46' : 
                                         availabilityStatus === 'Parcialmente Disponível' ? '#92400e' : '#991b1b';
                const availabilityBg = availabilityStatus === 'Disponível' ? '#d1fae5' : 
                                       availabilityStatus === 'Parcialmente Disponível' ? '#fef3c7' : '#fee2e2';
                
                return (
                  <tr key={s.sampleID}>
                    <td>{s.sampleID}</td>
                    <td>{s.barcode || 'N/A'}</td>
                    <td>{s.sampleType || 'N/A'}</td>
                    <td>{s.currentStatus || 'N/A'}</td>
                    <td>{totalQty} {s.measurementUnit || ''}</td>
                    <td>
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        backgroundColor: availabilityBg,
                        color: availabilityColor,
                        fontWeight: 500
                      }}>
                        {availabilityStatus}
                        {availableQty !== undefined && availableQty !== totalQty && (
                          <span style={{ marginLeft: '0.25rem', fontSize: '0.7rem', opacity: 0.8 }}>
                            ({availableQty}/{totalQty})
                          </span>
                        )}
                      </span>
                    </td>
                    <td>{s.registrationDate ? new Date(s.registrationDate).toLocaleDateString('pt-BR') : 'N/A'}</td>
                    <td>{s.patientID || 'N/A'}</td>
                  </tr>
                );
              })}
            </Table>
          </div>
        </>
      );
    }

    // Relatório de Resultados
    if (data.results && Array.isArray(data.results)) {
      return (
        <>
          {data.previewLimited && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#fef3c7', color: '#92400e', borderRadius: '6px', fontSize: '0.875rem' }}>
              ⚠️ Mostrando apenas os primeiros 50 registros. Total: {data.total} registros.
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <Table
              headers={['ID', 'Tipo Arquivo', 'Descrição', 'Método', 'Amostra ID', 'Data Criação']}
            >
              {data.results.map((r: any) => (
                <tr key={r.resultID}>
                  <td>{r.resultID}</td>
                  <td>{r.fileType || 'N/A'}</td>
                  <td>{r.description || 'N/A'}</td>
                  <td>{r.method || 'N/A'}</td>
                  <td>{r.sampleID || 'N/A'}</td>
                  <td>{r.createdAt ? new Date(r.createdAt).toLocaleString('pt-BR') : 'N/A'}</td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      );
    }

    // Relatório de Temperatura
    if (data.temperatures && Array.isArray(data.temperatures)) {
      return (
        <>
          {data.previewLimited && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#fef3c7', color: '#92400e', borderRadius: '6px', fontSize: '0.875rem' }}>
              ⚠️ Mostrando apenas os primeiros 50 registros. Total: {data.total} registros.
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <Table
              headers={['ID', 'Data/Hora', 'Sensor', 'Temperatura', 'Unidade', 'Status', 'Qualidade']}
            >
              {data.temperatures.map((t: any) => (
                <tr key={t.logID || t._id}>
                  <td>{t.logID || 'N/A'}</td>
                  <td>{t.timestamp ? new Date(t.timestamp).toLocaleString('pt-BR') : 'N/A'}</td>
                  <td>{t.sensorID || 'N/A'}</td>
                  <td>{t.temperatureValue !== undefined ? t.temperatureValue.toFixed(2) : 'N/A'}</td>
                  <td>{t.temperatureUnit || '°C'}</td>
                  <td>
                    <span style={{
                      padding: '0.25rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      backgroundColor: t.readingStatus === 'valid' ? '#d1fae5' : '#fee2e2',
                      color: t.readingStatus === 'valid' ? '#065f46' : '#991b1b'
                    }}>
                      {t.readingStatus || 'N/A'}
                    </span>
                  </td>
                  <td>{t.dataQualityScore !== undefined ? (t.dataQualityScore * 100).toFixed(1) + '%' : 'N/A'}</td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      );
    }

    // Logs de Acesso
    if (data.logs && Array.isArray(data.logs)) {
      return (
        <>
          {data.previewLimited && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#fef3c7', color: '#92400e', borderRadius: '6px', fontSize: '0.875rem' }}>
              ⚠️ Mostrando apenas os primeiros 50 registros. Total: {data.total} registros.
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <Table
              headers={['ID', 'Data/Hora', 'Usuário', 'Ação', 'Entidade', 'Resultado', 'Severidade', 'IP Origem']}
            >
              {data.logs.map((l: any) => (
                <tr key={l.logID || l._id}>
                  <td>{l.logID || 'N/A'}</td>
                  <td>{l.timestamp ? new Date(l.timestamp).toLocaleString('pt-BR') : 'N/A'}</td>
                  <td>{l.userName || 'N/A'}</td>
                  <td>{l.action || 'N/A'}</td>
                  <td>{l.entity || 'N/A'}</td>
                  <td>
                    <span style={{
                      padding: '0.25rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      backgroundColor: l.result === 'SUCCESS' ? '#d1fae5' : l.result === 'ERROR' ? '#fee2e2' : '#fef3c7',
                      color: l.result === 'SUCCESS' ? '#065f46' : l.result === 'ERROR' ? '#991b1b' : '#92400e'
                    }}>
                      {l.result || 'N/A'}
                    </span>
                  </td>
                  <td>
                    <span style={{
                      padding: '0.25rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      backgroundColor: l.severity === 'ERROR' || l.severity === 'CRITICAL' ? '#fee2e2' : l.severity === 'WARNING' ? '#fef3c7' : '#dbeafe',
                      color: l.severity === 'ERROR' || l.severity === 'CRITICAL' ? '#991b1b' : l.severity === 'WARNING' ? '#92400e' : '#1e40af'
                    }}>
                      {l.severity || 'N/A'}
                    </span>
                  </td>
                  <td>{l.sourceIP || 'N/A'}</td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      );
    }

    // Relatório de Equipamentos
    if (data.equipment && Array.isArray(data.equipment)) {
      return (
        <>
          {data.previewLimited && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#fef3c7', color: '#92400e', borderRadius: '6px', fontSize: '0.875rem' }}>
              ⚠️ Mostrando apenas os primeiros 50 registros. Total: {data.total} registros.
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <Table
              headers={['ID', 'Descrição', 'Data Criação', 'Data Atualização']}
            >
              {data.equipment.map((e: any) => (
                <tr key={e.equipmentID || e._id}>
                  <td>{e.equipmentID || 'N/A'}</td>
                  <td>{e.equipmentDescription || 'Sem descrição'}</td>
                  <td>{e.createdAt ? new Date(e.createdAt).toLocaleDateString('pt-BR') : 'N/A'}</td>
                  <td>{e.updatedAt ? new Date(e.updatedAt).toLocaleDateString('pt-BR') : 'N/A'}</td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      );
    }

    // Relatório de Sensores
    if (data.sensors && Array.isArray(data.sensors)) {
      return (
        <>
          {data.previewLimited && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#fef3c7', color: '#92400e', borderRadius: '6px', fontSize: '0.875rem' }}>
              ⚠️ Mostrando apenas os primeiros 50 registros. Total: {data.total} registros.
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <Table
              headers={['ID', 'Tipo', 'Modelo', 'Status Manutenção', 'Última Calibração', 'Próxima Calibração']}
            >
              {data.sensors.map((s: any) => (
                <tr key={s.sensorID || s._id}>
                  <td>{s.sensorID || 'N/A'}</td>
                  <td>{s.sensorType || 'N/A'}</td>
                  <td>{s.sensorModel || 'N/A'}</td>
                  <td>{s.maintenanceStatus || 'N/A'}</td>
                  <td>{s.lastCalibration ? new Date(s.lastCalibration).toLocaleDateString('pt-BR') : 'N/A'}</td>
                  <td>{s.nextCalibration ? new Date(s.nextCalibration).toLocaleDateString('pt-BR') : 'N/A'}</td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      );
    }

    // Histórico de Retirada
    if (data.withdrawals && Array.isArray(data.withdrawals)) {
      return (
        <>
          {data.previewLimited && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#fef3c7', color: '#92400e', borderRadius: '6px', fontSize: '0.875rem' }}>
              ⚠️ Mostrando apenas os primeiros 50 registros. Total: {data.total} registros.
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <Table
              headers={['ID Retirada', 'ID Amostra', 'Tipo Amostra', 'Paciente', 'Tipo Retirada', 'Quantidade', 'Responsável', 'Destino', 'Data']}
            >
              {data.withdrawals.map((w: any) => (
                <tr key={w.withdrawalID || w._id}>
                  <td>{w.withdrawalID || 'N/A'}</td>
                  <td>{w.sampleID || 'N/A'}</td>
                  <td>{w.sampleType || 'N/A'}</td>
                  <td>{w.patientID || 'N/A'}</td>
                  <td>{w.withdrawalType || 'N/A'}</td>
                  <td>{w.withdrawalQuantity || 'N/A'}</td>
                  <td>{w.withdrawalResponsible || 'N/A'}</td>
                  <td>{w.sampleDestination || 'N/A'}</td>
                  <td>{w.withdrawalDate ? new Date(w.withdrawalDate).toLocaleString('pt-BR') : 'N/A'}</td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      );
    }

    // Histórico de Origem de Tecido / Rede Extracelular
    if (data.samples && Array.isArray(data.samples) && (data.samples[0]?.sampleOrigin || data.samples[0]?.linkedProject)) {
      return (
        <>
          {data.previewLimited && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#fef3c7', color: '#92400e', borderRadius: '6px', fontSize: '0.875rem' }}>
              ⚠️ Mostrando apenas os primeiros 50 registros. Total: {data.total} registros.
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <Table
              headers={['ID Amostra', 'Tipo', 'Origem', 'Projeto', 'Paciente', 'Unidade Clínica', 'Data Registro']}
            >
              {data.samples.map((s: any) => (
                <tr key={s.sampleID || s._id}>
                  <td>{s.sampleID || 'N/A'}</td>
                  <td>{s.sampleType || 'N/A'}</td>
                  <td>{s.sampleOrigin || 'N/A'}</td>
                  <td>{s.linkedProject || 'N/A'}</td>
                  <td>{s.patientName ? getPatientDisplayName(s, user) : (s.patientID || 'N/A')}</td>
                  <td>{s.clinicalUnit || 'N/A'}</td>
                  <td>{s.registrationDate ? new Date(s.registrationDate).toLocaleDateString('pt-BR') : 'N/A'}</td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      );
    }

    // Visualização de Análise das amostras
    if (data.analysis && Array.isArray(data.analysis)) {
      return (
        <>
          {data.previewLimited && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#fef3c7', color: '#92400e', borderRadius: '6px', fontSize: '0.875rem' }}>
              ⚠️ Mostrando apenas os primeiros 20 registros. Total: {data.total} amostras.
            </div>
          )}
          {data.withResults !== undefined && (
            <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: '#eff6ff', borderRadius: '6px' }}>
              <strong>Estatísticas:</strong> {data.withResults} amostras com resultados, {data.withoutResults} sem resultados
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {data.analysis.map((item: any) => (
              <div key={item.sampleID} style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '1rem' }}>
                <div style={{ marginBottom: '0.5rem', fontWeight: 600 }}>
                  Amostra {item.sampleID} - {item.sampleType} | Paciente: {item.patientName ? getPatientDisplayName(item, user) : `Anônimo (ID: ${item.patientID})`}
                </div>
                <div>
                  <strong>Resultados: {item.resultsCount}</strong>
                  {item.results && item.results.length > 0 && (
                    <div style={{ marginTop: '0.5rem', paddingLeft: '1rem' }}>
                      {item.results.map((r: any) => (
                        <div key={r.resultID} style={{ fontSize: '0.875rem', color: '#64748b' }}>
                          • {r.description || 'N/A'} ({r.fileType || 'N/A'}) - {r.method || 'N/A'}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      );
    }

    // Fallback para dados genéricos
    return (
      <div className="preview-data" style={{ padding: '2rem' }}>
        <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
          Dados não formatados disponíveis:
        </p>
        <pre style={{ 
          backgroundColor: '#f8f9fa', 
          padding: '1rem', 
          borderRadius: '6px', 
          overflow: 'auto',
          fontSize: '0.875rem',
          maxHeight: '400px'
        }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    );
  };

  return (
    <div className="page report-query-page">
      <div className="page-header">
        <div>
          <Button
            variant="secondary"
            onClick={() => navigate('/reports')}
            style={{ marginBottom: '1rem' }}
          >
            <ArrowLeft size={18} />
            Voltar
          </Button>
          <h1 className="page-title">{type || 'Relatório'}</h1>
          <p className="page-subtitle">Configure os filtros e visualize o relatório</p>
        </div>
      </div>

      {error && (
        <div className="error-message" style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '6px' }}>
          {error}
        </div>
      )}

      <div className="report-query-content">
        {/* Seção de Filtros */}
        <Card className="filters-card">
          <h2 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Filter size={20} />
            Filtros
          </h2>
          
          {loadingFilters ? (
            <p>Carregando filtros...</p>
          ) : filters.length > 0 ? (
            <div className="filters-grid">
              {filters.map(filter => (
                <div key={filter.name} className="filter-item">
                  <label className="input-label">{filter.label}</label>
                  {renderFilterInput(filter)}
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--text-secondary)' }}>Nenhum filtro disponível para este tipo de relatório</p>
          )}

          <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
            <Button onClick={handlePreview} disabled={loading}>
              <FileText size={18} />
              Pré-visualizar
            </Button>
            <Button
              variant="secondary"
              onClick={() => setFilterValues({})}
            >
              Limpar Filtros
            </Button>
          </div>
        </Card>

        {/* Seção de Pré-visualização */}
        {previewData && (
          <Card className="preview-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2>Pré-visualização</h2>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => handleExport('csv')}
                  disabled={!previewData?.data || previewData.data.total === 0 || previewData.data.message}
                >
                  <FileDown size={16} />
                  CSV
                </Button>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => handleExport('pdf')}
                  disabled={!previewData?.data || previewData.data.total === 0 || previewData.data.message}
                >
                  <Download size={16} />
                  PDF
                </Button>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={handlePrint}
                  disabled={!previewData?.data || previewData.data.total === 0 || previewData.data.message}
                >
                  <Printer size={16} />
                  Imprimir
                </Button>
              </div>
            </div>

            {loading ? (
              <div style={{ padding: '2rem', textAlign: 'center' }}>
                <p>Gerando pré-visualização...</p>
              </div>
            ) : (
              <>
                {previewData.data.total !== undefined && (
                  <div style={{ 
                    marginBottom: '1rem', 
                    padding: '1rem', 
                    backgroundColor: '#eff6ff', 
                    borderRadius: '6px',
                    border: '1px solid #bfdbfe',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <div>
                      <strong style={{ fontSize: '1.1rem', color: '#1e40af' }}>
                        Total de registros: {previewData.data.total}
                      </strong>
                      {previewData.reportType && (
                        <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.875rem', color: '#64748b' }}>
                          Tipo: {previewData.reportType}
                        </p>
                      )}
                    </div>
                    {previewData.generatedAt && (
                      <div style={{ fontSize: '0.875rem', color: '#64748b' }}>
                        Gerado em: {new Date(previewData.generatedAt).toLocaleString('pt-BR')}
                      </div>
                    )}
                  </div>
                )}
                {renderPreviewTable()}
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

