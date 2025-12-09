import { useState, useEffect } from 'react';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import { Temperature, Policy } from '../types/models';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { useTemperature } from '../hooks/useTemperature';
import { usePolicies } from '../hooks/usePolicies';
import { validateReading, validateTemperatureUnit, generateAlert } from '../utils/validations';
import './TemperaturePage.css';

export default function TemperaturePage() {
  const { temperatures, loading, error, viewControl } = useTemperature();
  const { policies } = usePolicies();
  const [alerts, setAlerts] = useState<any[]>([]);

  // TEMPORARIAMENTE DESATIVADO: Não há sensores cadastrados ainda
  const TEMPERATURE_READING_DISABLED = true;

  useEffect(() => {
    if (!TEMPERATURE_READING_DISABLED) {
      // Carrega dados de controle de temperatura
      viewControl().catch(console.error);

      // Valida leituras e gera alertas
      temperatures.forEach((temp) => {
        if (!validateReading(temp)) {
          console.warn(`Leitura inválida: ${temp.logID}`);
        }
        if (!validateTemperatureUnit(temp.temperatureUnit)) {
          console.warn(`Unidade inválida: ${temp.temperatureUnit}`);
        }
        const policy = policies.find((p) => p.policyID.toString() === temp.policyID);
        if (policy) {
          const alert = generateAlert(temp, policy);
          if (alert) {
            setAlerts((prev) => [...prev, alert]);
          }
        }
      });
    }
  }, [temperatures, policies, viewControl]);

  const getStatusIcon = (temp: Temperature) => {
    if (temp.readingStatus === 'valid' && temp.dataQualityScore > 0.9) {
      return <CheckCircle size={18} className="status-icon valid" />;
    }
    return <AlertCircle size={18} className="status-icon alert" />;
  };

  // TEMPORARIAMENTE DESATIVADO: Não há sensores cadastrados ainda
  const TEMPERATURE_READING_DISABLED = true;

  if (TEMPERATURE_READING_DISABLED) {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Monitoramento de Temperatura</h1>
            <p className="page-subtitle">Leituras de temperatura em tempo real</p>
          </div>
        </div>

        <Card>
          <div style={{ 
            padding: '2rem', 
            textAlign: 'center',
            backgroundColor: '#fff3cd',
            border: '1px solid #ffc107',
            borderRadius: '8px',
            margin: '2rem 0'
          }}>
            <AlertCircle size={48} style={{ color: '#856404', marginBottom: '1rem' }} />
            <h2 style={{ color: '#856404', marginBottom: '0.5rem' }}>Funcionalidade Temporariamente Desativada</h2>
            <p style={{ color: '#856404', fontSize: '1rem', marginBottom: '1rem' }}>
              A leitura de temperatura está desativada temporariamente porque não há sensores cadastrados no sistema.
            </p>
            <p style={{ color: '#856404', fontSize: '0.875rem' }}>
              Para ativar esta funcionalidade, cadastre sensores em <strong>"Gerenciamento de Instalações" → "Sensores"</strong>.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Monitoramento de Temperatura</h1>
          <p className="page-subtitle">Leituras de temperatura em tempo real</p>
        </div>
      </div>

      {loading && <p>Carregando...</p>}
      {error && <p style={{ color: 'var(--danger)' }}>Erro: {error}</p>}

      <div className="temperature-grid">
        <Card title="Últimas Leituras">
          <Table
            headers={[
              'Timestamp',
              'Sensor',
              'Temperatura',
              'Status',
              'Qualidade',
            ]}
          >
            {temperatures.map((temp) => {
              // Trata sensorID que pode ser objeto ou string
              const sensorDisplay = typeof temp.sensorID === 'object' && temp.sensorID !== null
                ? temp.sensorID.sensorID || temp.sensorID.sensorType || 'N/A'
                : temp.sensorID || 'N/A';
              
              return (
                <tr key={temp.logID}>
                  <td>{new Date(temp.timestamp || '').toLocaleString('pt-BR')}</td>
                  <td>{sensorDisplay}</td>
                  <td>
                    <span className="temperature-value">
                      {temp.temperatureValue} {temp.temperatureUnit}
                    </span>
                  </td>
                  <td>
                    <div className="status-cell">
                      {getStatusIcon(temp)}
                      <span>{temp.readingStatus}</span>
                    </div>
                  </td>
                  <td>
                    <div className="quality-score">
                      {temp.dataQualityScore ? (temp.dataQualityScore * 100).toFixed(0) : 'N/A'}%
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>

        <Card title="Alertas">
          <div className="alerts-list">
            {temperatures.filter((t) => t.readingStatus !== 'valid').length ===
            0 ? (
              <p className="empty-state">Nenhum alerta no momento</p>
            ) : (
              temperatures
                .filter((t) => t.readingStatus !== 'valid')
                .map((temp) => {
                  // Trata sensorID que pode ser objeto ou string
                  const sensorDisplay = typeof temp.sensorID === 'object' && temp.sensorID !== null
                    ? temp.sensorID.sensorID || temp.sensorID.sensorType || 'N/A'
                    : temp.sensorID || 'N/A';
                  
                  return (
                    <div key={temp.logID} className="alert-item">
                      <AlertCircle size={20} className="alert-icon" />
                      <div>
                        <p className="alert-message">
                          {temp.errorMessage || 'Temperatura fora do limite'}
                        </p>
                        <p className="alert-sensor">Sensor: {sensorDisplay}</p>
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

