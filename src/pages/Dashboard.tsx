import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import { Users, FlaskConical, FileText, Thermometer, Box, Radio, Shield } from 'lucide-react';
import { usePatients } from '../hooks/usePatients';
import { useSamples } from '../hooks/useSamples';
import { useResults } from '../hooks/useResults';
import { useTemperature } from '../hooks/useTemperature';
import { usePolicies } from '../hooks/usePolicies';
import { useEquipment } from '../hooks/useEquipment';
import { useSensors } from '../hooks/useSensors';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import './Dashboard.css';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, hasAccess, hasRole } = useAuth();
  const { t, language } = useLanguage();
  const { patients, loading: loadingPatients } = usePatients();
  const { samples, loading: loadingSamples } = useSamples();
  const { results, loading: loadingResults } = useResults();
  const { temperatures, loading: loadingTemperatures, viewControl } = useTemperature();
  const { policies, loading: loadingPolicies } = usePolicies();
  const { equipment, loading: loadingEquipment } = useEquipment();
  const { sensors, loading: loadingSensors } = useSensors();

  // TEMPORARIAMENTE DESATIVADO: Não há sensores cadastrados ainda
  const TEMPERATURE_READING_DISABLED = true;

  // Carrega controle de temperatura (não bloqueia o carregamento da dashboard)
  useEffect(() => {
    // Apenas tenta carregar se não estiver desativado, não estiver carregando e se a função existir
    if (!TEMPERATURE_READING_DISABLED && viewControl && !loadingTemperatures) {
      viewControl().catch((err) => {
        // Erro não bloqueia o carregamento da dashboard
        console.warn('Erro ao carregar controle de temperatura:', err);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Executa apenas uma vez ao montar

  // Calcula estatísticas reais
  const stats = useMemo(() => {
    // Garante que todos os dados sejam arrays
    const temperaturesArray = Array.isArray(temperatures) ? temperatures : [];
    const policiesArray = Array.isArray(policies) ? policies : [];
    // Para pacientes, se não houver dados e não estiver carregando, usa contagem mínima de 0
    // (os mockados são apenas para exibição na página, não para contagem na dashboard)
    const patientsArray = Array.isArray(patients) ? patients : [];
    const samplesArray = Array.isArray(samples) ? samples : [];
    const resultsArray = Array.isArray(results) ? results : [];
    const equipmentArray = Array.isArray(equipment) ? equipment : [];
    const sensorsArray = Array.isArray(sensors) ? sensors : [];

    // Calcula alertas de temperatura
    let temperatureAlerts = 0;
    temperaturesArray.forEach((temp) => {
      const policy = policiesArray.find((p) => p.policyID?.toString() === temp.policyID?.toString());
      if (policy) {
        if (
          temp.temperatureValue < policy.minThreshold ||
          temp.temperatureValue > policy.maxThreshold ||
          temp.readingStatus !== 'valid'
        ) {
          temperatureAlerts++;
        }
      }
    });

    return {
      patients: patientsArray.length,
      samples: samplesArray.length,
      results: resultsArray.length,
      temperatureAlerts,
      equipment: equipmentArray.length,
      sensors: sensorsArray.length,
      policies: policiesArray.length,
    };
  }, [patients, samples, results, temperatures, policies, equipment, sensors]);

  const loading = loadingPatients || loadingSamples || loadingResults || loadingTemperatures || 
                  loadingPolicies || loadingEquipment || loadingSensors;

  // Define quais cards cada tipo de acesso pode ver
  const statCards = useMemo(() => {
    if (!user) return [];

    const allCards = [
      {
        title: t('dashboard.patients'),
        value: stats.patients,
        icon: Users,
        color: 'var(--primary)',
        link: '/patients',
        allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
        allowedAccessTypes: [1, 2, 3, 4], // Inclui Administrador (4)
      },
      {
        title: t('dashboard.samples'),
        value: stats.samples,
        icon: FlaskConical,
        color: 'var(--success)',
        link: '/samples',
        allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
        allowedAccessTypes: [1, 2, 3],
      },
      {
        title: t('dashboard.results'),
        value: stats.results,
        icon: FileText,
        color: 'var(--warning)',
        link: '/results',
        allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
        allowedAccessTypes: [1, 2, 3],
      },
      {
        title: t('dashboard.temperatureAlerts'),
        value: stats.temperatureAlerts,
        icon: Thermometer,
        color: 'var(--danger)',
        link: '/temperature',
        allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
        allowedAccessTypes: [2, 3, 4], // Administrador (4) também tem acesso
      },
      {
        title: t('dashboard.equipment'),
        value: stats.equipment,
        icon: Box,
        color: 'var(--secondary)',
        link: '/equipment',
        allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
        allowedAccessTypes: [2, 3, 4], // Administrador (4) também tem acesso
      },
      {
        title: t('dashboard.sensors'),
        value: stats.sensors,
        icon: Radio,
        color: '#8b5cf6',
        link: '/sensors',
        allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
        allowedAccessTypes: [2, 3, 4], // Administrador (4) também tem acesso
      },
      {
        title: t('dashboard.policies'),
        value: stats.policies,
        icon: Shield,
        color: '#06b6d4',
        link: '/policies',
        allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
        allowedAccessTypes: [2, 3, 4], // Administrador (4) também tem acesso
      },
    ];

    // Filtra cards baseado no role ou accessType
    return allCards.filter(card => {
      // Se tem roleName, usa ele
      if (user.roleName) {
        return card.allowedRoles.includes(user.roleName);
      }
      
      // Fallback para accessType com lógica hierárquica
      // Administrador (4) tem acesso a tudo
      if (user.accessType === 4) {
        return true;
      }
      // Coordenador (3) tem acesso a tudo exceto itens exclusivos de admin
      if (user.accessType === 3) {
        return card.allowedAccessTypes.includes(3) || card.allowedAccessTypes.includes(2);
      }
      // Técnico (2) tem acesso aos seus itens
      if (user.accessType === 2) {
        return card.allowedAccessTypes.includes(2) || card.allowedAccessTypes.includes(1);
      }
      // Usuário Externo (1) tem acesso apenas aos seus itens
      return card.allowedAccessTypes.includes(user.accessType || 0);
    });
  }, [user, stats, t, language]);

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1 className="page-title">{t('dashboard.title')}</h1>
        <p className="page-subtitle">{t('dashboard.subtitle')}</p>
      </div>

      {loading && (
        <div className="dashboard-loading">
          <p>{t('common.loading')}</p>
        </div>
      )}

      <div className="dashboard-stats">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          const handleClick = () => {
            if (stat.link) {
              navigate(stat.link);
            }
          };
          return (
            <Card 
              key={stat.title} 
              className="stat-card" 
              style={{ cursor: stat.link ? 'pointer' : 'default' }}
              onClick={handleClick}
            >
              <div className="stat-card-content">
                <div className="stat-card-icon" style={{ backgroundColor: `${stat.color}20`, color: stat.color }}>
                  <Icon size={24} />
                </div>
                <div className="stat-card-info">
                  <p className="stat-card-title">{stat.title}</p>
                  <p className="stat-card-value">{loading ? '...' : stat.value}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="dashboard-content">
        {stats.temperatureAlerts > 0 && (
          <Card className="dashboard-card alert-card">
            <h3 className="dashboard-card-title" style={{ color: 'var(--danger)' }}>
              ⚠️ {t('dashboard.temperatureAlertsActive')}
            </h3>
            <p className="alert-message">
              {t('dashboard.temperatureAlertsMessage').replace('{count}', stats.temperatureAlerts.toString())}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}


