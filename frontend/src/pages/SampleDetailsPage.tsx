import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import Button from '../components/UI/Button';
import Card from '../components/UI/Card';
import { useSamples } from '../hooks/useSamples';
import { useLocations } from '../hooks/useLocations';
import { useLanguage } from '../contexts/LanguageContext';
import SampleFilesSection from '../components/SampleFilesSection';
import { Sample } from '../types/models';
import './SamplesPage.css';

export default function SampleDetailsPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { t } = useLanguage();
  const { samples, loading, error } = useSamples();
  const { locations = [], loadLocations } = useLocations();
  const [sample, setSample] = useState<Sample | null>(null);

  // Carrega localizações ao montar
  useEffect(() => {
    if (loadLocations) {
      loadLocations().catch(err => {
        console.error('Erro ao carregar localizações:', err);
      });
    }
  }, [loadLocations]);

  // Busca a amostra quando os dados são carregados
  useEffect(() => {
    if (!loading && id && samples !== undefined) {
      // Se não há amostras carregadas (array vazio após carregar)
      if (!samples || samples.length === 0) {
        setSample(null);
        return;
      }

      // Tenta encontrar a amostra por _id ou sampleID
      const searchId = String(id || '').trim();
      const foundSample = samples.find(s => {
        const sampleId = String(s._id || '').trim();
        const sampleIDStr = String(s.sampleID || '').trim();
        
        return sampleId === searchId || 
               sampleIDStr === searchId ||
               sampleId.toLowerCase() === searchId.toLowerCase() ||
               sampleIDStr.toLowerCase() === searchId.toLowerCase();
      });
      
      if (foundSample) {
        setSample(foundSample);
      } else {
        // Se carregou mas não encontrou, define como null
        console.warn('Amostra não encontrada:', { 
          searchId: id, 
          availableIds: samples.map(s => ({ _id: s._id, sampleID: s.sampleID }))
        });
        setSample(null);
      }
    }
  }, [samples, id, loading]);

  const getLocationInfo = (locationID?: number): { summary: string; details: string } => {
    if (locationID === undefined || locationID === null) {
      return { summary: 'N/A', details: 'Localização não definida' };
    }
    
    if (!locations || !Array.isArray(locations) || locations.length === 0) {
      return { summary: `ID: ${locationID}`, details: 'Informações de localização não disponíveis' };
    }

    const location = locations.find(loc => loc.locationID === locationID);
    if (!location) {
      return { summary: `ID: ${locationID}`, details: 'Localização não encontrada' };
    }

    const parts: string[] = [];
    if (location.block) parts.push(`Bloco: ${location.block}`);
    if (location.rack) parts.push(`Prateleira: ${location.rack}`);
    if (location.drawer) parts.push(`Gaveta: ${location.drawer}`);
    if (location.box) parts.push(`Caixa: ${location.box}`);
    if (location.wellPosition || location.eppendorfWell) {
      parts.push(`Poço: ${location.wellPosition || location.eppendorfWell}`);
    }

    const summary = parts.length > 0 
      ? parts.slice(0, 2).join(' | ') 
      : `ID: ${locationID}`;
    
    const details = parts.length > 0 
      ? parts.join(' • ') 
      : `Localização ID: ${locationID}`;

    return { summary, details };
  };

  if (loading) {
    return (
      <div className="page">
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          minHeight: '400px',
          flexDirection: 'column',
          gap: '1rem'
        }}>
          <p>{t('common.loading') || 'Carregando...'}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div style={{ marginBottom: '1rem' }}>
          <Button variant="secondary" onClick={() => navigate('/samples')}>
            <ArrowLeft size={18} style={{ marginRight: '0.5rem' }} />
            {t('common.back') || 'Voltar'}
          </Button>
        </div>
        <Card>
          <p style={{ color: 'var(--danger)' }}>
            {t('common.error') || 'Erro'}: {error}
          </p>
        </Card>
      </div>
    );
  }

  // Se terminou de carregar mas não encontrou a amostra
  if (!loading && samples !== undefined && !sample && id) {
    return (
      <div className="page">
        <div style={{ marginBottom: '1rem' }}>
          <Button variant="secondary" onClick={() => navigate('/samples')}>
            <ArrowLeft size={18} style={{ marginRight: '0.5rem' }} />
            {t('common.back') || 'Voltar'}
          </Button>
        </div>
        <Card>
          <p>{t('samples.notFound') || 'Amostra não encontrada'}</p>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-light)', marginTop: '0.5rem' }}>
            ID buscado: {id}
          </p>
          {samples && samples.length > 0 && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: '0.5rem' }}>
              Total de amostras carregadas: {samples.length}
            </p>
          )}
        </Card>
      </div>
    );
  }

  // Se ainda não tem sample (ainda carregando ou aguardando)
  if (!sample) {
    return (
      <div className="page">
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          minHeight: '400px',
          flexDirection: 'column',
          gap: '1rem'
        }}>
          <p>{t('common.loading') || 'Carregando...'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <Button 
            variant="secondary" 
            onClick={() => navigate('/samples')}
            style={{ marginBottom: '1rem' }}
          >
            <ArrowLeft size={18} style={{ marginRight: '0.5rem' }} />
            {t('common.back') || 'Voltar'}
          </Button>
          <h1 className="page-title">
            Detalhes da Amostra - {sample.barcode || sample.sampleID || 'N/A'}
          </h1>

          <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
            <Button variant="secondary" onClick={() => navigate(`/samples/${id}/label`)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}>
              {t('samples.label') || 'Etiqueta'}
            </Button>
            <Button variant="secondary" onClick={() => navigate(`/samples/${id}/chain`)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}>
              {t('samples.chain') || 'Fluxo'}
            </Button>
            <Button variant="secondary" onClick={() => navigate(`/samples/${id}/movements`)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}>
              {t('samples.movements') || 'Movimentações'}
            </Button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: '1.5rem' }}>
        {/* Informações Básicas */}
        <Card>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text)' }}>
            Informações Básicas
          </h3>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>ID da Amostra:</span>
              <span style={{ color: 'var(--text)' }}>{sample.sampleID || sample._id || 'N/A'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>Código de Barras:</span>
              <span style={{ fontFamily: 'monospace', color: 'var(--primary)', fontWeight: 600 }}>{sample.barcode || 'N/A'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>Tipo:</span>
              <span style={{ color: 'var(--text)' }}>{sample.sampleType || 'N/A'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>Origem:</span>
              <span style={{ color: 'var(--text)' }}>{sample.sampleOrigin || 'N/A'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>Protocolo de Extração:</span>
              <span style={{ color: 'var(--text)' }}>{sample.extractionProtocol || 'N/A'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>Data de Registro:</span>
              <span style={{ color: 'var(--text)' }}>
                {sample.registrationDate ? new Date(sample.registrationDate).toLocaleDateString('pt-BR') : 'N/A'}
              </span>
            </div>
          </div>
        </Card>

        {/* Quantidade e Qualidade */}
        <Card>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text)' }}>
            Quantidade e Qualidade
          </h3>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>Quantidade Total:</span>
              <span style={{ color: 'var(--text)' }}>
                {sample.quantity?.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) || 'N/A'} µL
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>Quantidade Disponível:</span>
              <span style={{ color: 'var(--text)' }}>
                {sample.availableQuantity?.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) || sample.quantity?.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) || 'N/A'} µL
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>Status de Disponibilidade:</span>
              <span className={`availability-badge availability-${(sample.availabilityStatus || 'Disponível').toLowerCase().replace(' ', '-')}`}>
                {sample.availabilityStatus || 'Disponível'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>Status Atual:</span>
              <span className={`status-badge status-${(sample.currentStatus || 'Available').toLowerCase()}`}>
                {sample.currentStatus === 'Available' ? 'Disponível' : 
                 sample.currentStatus === 'Withdrawn' ? 'Retirada' : 
                 sample.currentStatus || 'Disponível'}
              </span>
            </div>
          </div>
        </Card>

        {/* Localização e Projeto */}
        <Card>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text)' }}>
            Localização e Projeto
          </h3>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={{ padding: '0.75rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>Localização:</span>
                <span style={{ 
                  fontFamily: 'monospace', 
                  color: 'var(--primary)', 
                  fontWeight: 600,
                  fontSize: '0.875rem'
                }}>
                  {getLocationInfo(sample.locationID).summary}
                </span>
              </div>
              <div style={{ 
                fontSize: '0.8125rem', 
                color: 'var(--text)', 
                lineHeight: '1.6',
                paddingTop: '0.5rem',
                borderTop: '1px solid var(--border)'
              }}>
                {getLocationInfo(sample.locationID).details}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>Projeto Vinculado:</span>
              <span style={{ color: 'var(--text)' }}>{sample.linkedProject || 'N/A'}</span>
            </div>
          </div>
        </Card>

        {/* Paciente */}
        <Card>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text)' }}>
            Paciente
          </h3>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>ID do Paciente:</span>
              <span style={{ fontFamily: 'monospace', color: 'var(--text)', fontWeight: 500 }}>
                {sample.patientID || 'N/A'}
              </span>
            </div>
          </div>
        </Card>

        {/* Arquivos de Análise */}
        {sample._id && (
          <Card>
            <SampleFilesSection sampleID={sample._id} />
          </Card>
        )}
      </div>
    </div>
  );
}
