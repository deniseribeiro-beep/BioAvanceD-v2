import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download } from 'lucide-react';
import Button from '../components/UI/Button';
import Card from '../components/UI/Card';
import Input from '../components/UI/Input';
import Select from '../components/UI/Select';
import Table from '../components/UI/Table';
import { useSamples } from '../hooks/useSamples';
import { useLocations } from '../hooks/useLocations';
import { useResults } from '../hooks/useResults';
import { useEquipment } from '../hooks/useEquipment';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import AnalysisUploadModal from '../components/AnalysisUploadModal';
import { Sample } from '../types/models';
import { resultService } from '../services/api';
import './SamplesPage.css';

export default function SampleDetailsPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { t } = useLanguage();
  const { user, hasRole } = useAuth();
  const { samples, loading, error, updateSample } = useSamples();
  const { results, loadResults } = useResults();
  const { equipment } = useEquipment();
  const { locations = [], loadLocations } = useLocations();
  const [sample, setSample] = useState<Sample | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [form, setForm] = useState({
    locationID: '',
    linkedProject: '',
    availableQuantity: '',
    currentStatus: '',
    sampleOrigin: '',
    extractionProtocol: '',
    patientID: '',
  });

  const canEdit = hasRole(['Administrador', 'Coordenador']) || user?.roleName === 'Administrador' || user?.roleName === 'Coordenador';

  const computeAvailability = (s: Sample | null | undefined) => {
    const initial = s?.volumeInitial ?? s?.originalQuantity ?? s?.quantity ?? 0;
    const current = s?.volumeCurrent ?? s?.availableQuantity ?? s?.quantity ?? 0;

    if (current <= 0) {
      return {
        label: 'Indisponível',
        className: 'availability-indisponível',
        current,
        initial,
      };
    }

    if (current < initial) {
      return {
        label: 'Parcialmente Disponível',
        className: 'availability-parcialmente-disponível',
        current,
        initial,
      };
    }

    return {
      label: 'Disponível',
      className: 'availability-disponível',
      current,
      initial,
    };
  };

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
        setForm({
          locationID: foundSample.locationID ? String(foundSample.locationID) : '',
          linkedProject: foundSample.linkedProject || '',
          availableQuantity: (foundSample.volumeCurrent ?? foundSample.availableQuantity ?? foundSample.quantity ?? '').toString(),
          currentStatus: foundSample.currentStatus || 'Available',
          sampleOrigin: foundSample.sampleOrigin || '',
          extractionProtocol: foundSample.extractionProtocol || '',
          patientID: foundSample.patientID ? String(foundSample.patientID) : '',
        });
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
      return {
        summary: 'Aguardando Armazenagem',
        details: 'A amostra já foi recebida e aguarda atribuição de localização física.',
      };
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

  const effectiveSample = useMemo(() => {
    if (!isEditing) return sample;
    const parsedAvailable = Number(form.availableQuantity);
    const parsedLocation = form.locationID ? Number(form.locationID) : undefined;
    return {
      ...sample,
      availableQuantity: Number.isFinite(parsedAvailable) ? parsedAvailable : sample?.availableQuantity,
      volumeCurrent: Number.isFinite(parsedAvailable) ? parsedAvailable : sample?.volumeCurrent,
      locationID: parsedLocation ?? sample?.locationID,
      linkedProject: form.linkedProject || sample?.linkedProject,
      currentStatus: (form.currentStatus as Sample['currentStatus']) || sample?.currentStatus,
    } as Sample;
  }, [isEditing, sample, form.availableQuantity, form.locationID, form.linkedProject, form.currentStatus]);

  const availabilityPreview = computeAvailability(effectiveSample);

  const locationOptions = useMemo(() => {
    if (!locations || locations.length === 0) {
      return [{ value: '', label: 'Aguardando Armazenagem' }];
    }
    return [
      { value: '', label: 'Sem armazenagem atribuída' },
      ...locations.map(loc => ({
        value: loc.locationID,
        label: `${loc.locationID} - Bloco ${loc.block} / Prat. ${loc.rack} / Gav. ${loc.drawer} / Caixa ${loc.box}`,
      })),
    ];
  }, [locations, t]);

  const statusOptions = useMemo(() => ([
    { value: 'Available', label: t('samples.status.available', 'Disponível') },
    { value: 'PartiallyWithdrawn', label: t('samples.status.partiallyWithdrawn', 'Parcialmente Retirada') },
    { value: 'TotallyWithdrawn', label: t('samples.status.totallyWithdrawn', 'Totalmente Retirada') },
    { value: 'Withdrawn', label: t('samples.status.withdrawn', 'Retirada') },
    { value: 'Expired', label: t('samples.status.expired', 'Expirada') },
    { value: 'Destroyed', label: t('samples.status.destroyed', 'Destruída') },
    { value: 'Unusable', label: t('samples.status.unusable', 'Inutilizada') },
  ]), [t]);

  const sampleResults = useMemo(() => {
    if (!sample) return [];
    const sampleKeys = new Set([
      String(sample._id || ''),
      String(sample.sampleID || '')
    ]);
    return results.filter(result => sampleKeys.has(String(result.sampleID)));
  }, [results, sample]);

  const getResultEquipmentLabel = (equipmentID?: number, equipmentName?: string) => {
    if (equipmentID) {
      const match = equipment.find((item) => item.equipmentID === equipmentID);
      return match?.equipmentDescription || `Equipamento #${equipmentID}`;
    }
    return equipmentName || 'Não informado';
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

  const handleChange = (field: keyof typeof form, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleCancel = () => {
    if (sample) {
      setForm({
        locationID: sample.locationID ? String(sample.locationID) : '',
        linkedProject: sample.linkedProject || '',
        availableQuantity: (sample.volumeCurrent ?? sample.availableQuantity ?? sample.quantity ?? '').toString(),
        currentStatus: sample.currentStatus || 'Available',
        sampleOrigin: sample.sampleOrigin || '',
        extractionProtocol: sample.extractionProtocol || '',
        patientID: sample.patientID ? String(sample.patientID) : '',
      });
    }
    setSaveError(null);
    setIsEditing(false);
  };

  const handleUpdate = async () => {
    if (!sample) return;
    setSaving(true);
    setSaveError(null);

    const parsedAvailable = form.availableQuantity === '' ? null : Number(form.availableQuantity);
    if (parsedAvailable !== null && (!Number.isFinite(parsedAvailable) || parsedAvailable < 0)) {
      setSaveError('Quantidade disponível inválida');
      setSaving(false);
      return;
    }

    const payload: Partial<Sample> = {
      linkedProject: form.linkedProject?.trim() || undefined,
      locationID: form.locationID ? Number(form.locationID) : undefined,
      currentStatus: (form.currentStatus as Sample['currentStatus']) || undefined,
      sampleOrigin: form.sampleOrigin?.trim() || undefined,
      extractionProtocol: form.extractionProtocol?.trim() || undefined,
      patientID: form.patientID?.trim() || undefined,
    };

    if (parsedAvailable !== null) {
      payload.availableQuantity = parsedAvailable;
      payload.volumeCurrent = parsedAvailable;
    }

    try {
      const targetId = sample._id || sample.sampleID || id || '';
      const updated = await updateSample(targetId, payload);
      // Atualiza estado local para refletir a edição imediatamente
      setSample(prev => ({
        ...prev!,
        ...payload,
        availableQuantity: payload.availableQuantity ?? prev?.availableQuantity,
        volumeCurrent: payload.volumeCurrent ?? prev?.volumeCurrent,
      }));
      // Se backend retornou amostra, sincroniza
      if (updated) {
        setSample(updated as Sample);
      }
      setIsEditing(false);
    } catch (err: any) {
      setSaveError(err?.message || 'Erro ao salvar alterações');
    } finally {
      setSaving(false);
    }
  };

  const handleUploadSuccess = () => {
    loadResults();
    setShowUploadModal(false);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            Detalhes da Amostra - {sample.barcode || sample.sampleID || 'N/A'}
          </h1>

          <div style={{ marginBottom: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {!isEditing ? (
              <>
                {canEdit && (
                  <Button
                    variant="primary"
                    onClick={() => setIsEditing(true)}
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
                  >
                    {t('common.edit') || 'Editar'}
                  </Button>
                )}
                <Button variant="secondary" onClick={() => navigate(`/samples/${id}/chain`)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}>
                  {t('samples.chain') || 'Cadeia de Custódia'}
                </Button>
                <Button variant="secondary" onClick={() => navigate('/samples')} style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}>
                  <ArrowLeft size={18} style={{ marginRight: '0.5rem' }} />
                  {t('common.back') || 'Voltar'}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="primary"
                  onClick={handleUpdate}
                  disabled={saving}
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
                >
                  {saving ? (t('common.loading') || 'Salvando...') : (t('common.save') || 'Salvar')}
                </Button>
              <Button
                  variant="secondary"
                  onClick={handleCancel}
                  disabled={saving}
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
                >
                  {t('common.cancel') || 'Cancelar'}
                </Button>
              </>
            )}
            {saveError && (
              <span style={{ color: 'var(--danger)', alignSelf: 'center', fontSize: '0.9rem' }}>
                {saveError}
              </span>
            )}
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
              {isEditing ? (
                <div style={{ width: '280px' }}>
                  <Input
                    value={form.sampleOrigin}
                    onChange={(e) => handleChange('sampleOrigin', e.target.value)}
                    placeholder={t('samples.origin', 'Origem') || 'Origem'}
                  />
                </div>
              ) : (
                <span style={{ color: 'var(--text)' }}>{sample.sampleOrigin || 'N/A'}</span>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>Protocolo de Extração:</span>
              {isEditing ? (
                <div style={{ width: '280px' }}>
                  <Input
                    value={form.extractionProtocol}
                    onChange={(e) => handleChange('extractionProtocol', e.target.value)}
                    placeholder={t('samples.protocol', 'Protocolo') || 'Protocolo'}
                  />
                </div>
              ) : (
                <span style={{ color: 'var(--text)' }}>{sample.extractionProtocol || 'N/A'}</span>
              )}
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
                {availabilityPreview.initial.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} µL
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>Quantidade Disponível:</span>
              {isEditing ? (
                <div style={{ width: '180px' }}>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    value={form.availableQuantity}
                    onChange={(e) => handleChange('availableQuantity', e.target.value)}
                    placeholder={t('samples.quantity', 'Quantidade') || 'Quantidade'}
                  />
                </div>
              ) : (
                <span style={{ color: 'var(--text)' }}>
                  {availabilityPreview.current.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} µL
                </span>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>Status Atual:</span>
              {isEditing ? (
                <div style={{ minWidth: '220px' }}>
                  <Select
                    value={form.currentStatus}
                    onChange={(e) => handleChange('currentStatus', e.target.value)}
                    options={statusOptions}
                  />
                </div>
              ) : (
                <span className={`availability-badge ${availabilityPreview.className}`}>
                  {availabilityPreview.label}
                </span>
              )}
            </div>
          </div>
        </Card>

        {/* Armazenagem e Projeto */}
        <Card>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text)' }}>
            Armazenagem e Projeto
          </h3>
          {sample?.locationID == null && (
            <div style={{ marginBottom: '0.75rem', padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: 'rgba(37, 99, 235, 0.08)', color: 'var(--text)' }}>
              <strong>Aguardando Armazenagem.</strong> A amostra está registrada, mas ainda não foi atribuída a uma posição física.
            </div>
          )}
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={{ padding: '0.75rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>Armazenagem:</span>
                {isEditing ? (
                  <div style={{ minWidth: '260px' }}>
                    <Select
                      value={form.locationID}
                      onChange={(e) => handleChange('locationID', e.target.value)}
                      options={locationOptions}
                    />
                    <div style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: 'var(--text-light)' }}>
                      Opcional. A amostra pode permanecer sem localização até ser armazenada.
                    </div>
                  </div>
                ) : (
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '999px',
                    backgroundColor: effectiveSample?.locationID == null ? 'rgba(37, 99, 235, 0.10)' : 'rgba(16, 185, 129, 0.10)',
                    color: effectiveSample?.locationID == null ? 'var(--primary)' : 'var(--text)',
                    fontWeight: 600,
                    fontSize: '0.875rem'
                  }}>
                    {getLocationInfo(effectiveSample?.locationID).summary}
                  </span>
                )}
              </div>
              <div style={{ 
                fontSize: '0.8125rem', 
                color: 'var(--text)', 
                lineHeight: '1.6',
                paddingTop: '0.5rem',
                borderTop: '1px solid var(--border)'
              }}>
                {getLocationInfo(effectiveSample?.locationID).details}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>Projeto Vinculado:</span>
              {isEditing ? (
                <div style={{ flex: 1, maxWidth: '420px', marginLeft: '1rem' }}>
                  <Input
                    value={form.linkedProject}
                    onChange={(e) => handleChange('linkedProject', e.target.value)}
                    placeholder={t('samples.linkedProject', 'Projeto vinculado') || 'Projeto vinculado'}
                  />
                </div>
              ) : (
                <span style={{ color: 'var(--text)' }}>{effectiveSample?.linkedProject || 'N/A'}</span>
              )}
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
              {isEditing ? (
                <div style={{ width: '220px' }}>
                  <Input
                    value={form.patientID}
                    onChange={(e) => handleChange('patientID', e.target.value)}
                    placeholder={t('samples.patient', 'Paciente') || 'Paciente'}
                  />
                </div>
              ) : (
                <span style={{ fontFamily: 'monospace', color: 'var(--text)', fontWeight: 500 }}>
                  {sample.patientID || 'N/A'}
                </span>
              )}
            </div>
          </div>
        </Card>

        {/* Arquivos de Análise */}
        {sample && (
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: 'var(--text)' }}>
                Arquivos de Análise
              </h3>
              {canEdit && (
                <Button variant="primary" onClick={() => setShowUploadModal(true)}>
                  Enviar Arquivo
                </Button>
              )}
            </div>

            {sampleResults.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '2rem',
                backgroundColor: 'var(--surface)',
                borderRadius: '6px',
                color: 'var(--text-light)'
              }}>
                <p>Nenhum arquivo associado a esta amostra</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <Table
                  headers={[
                    'ID',
                    'Tipo',
                    'Método',
                    'Pesquisador',
                    'Equipamento',
                    'Descrição',
                    'Ações',
                  ]}
                >
                  {sampleResults.map((result) => (
                    <tr key={result._id || result.resultID}>
                      <td>{result.resultID || result._id}</td>
                      <td><span className="file-type-badge">{result.fileType}</span></td>
                      <td>{result.method || 'N/A'}</td>
                      <td>{result.responsibleResearcher || 'N/A'}</td>
                      <td>{getResultEquipmentLabel(result.equipmentID, result.equipmentName)}</td>
                      <td>{result.description || 'N/A'}</td>
                      <td>
                        <div className="table-actions">
                          <Button
                            variant="secondary"
                            onClick={async () => {
                              try {
                                await resultService.download(result._id || result.resultID);
                              } catch (err: any) {
                                alert(`Erro ao fazer download: ${err.message || 'Erro desconhecido'}`);
                              }
                            }}
                          >
                            <Download size={16} />
                            Download
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}
          </Card>
        )}
      </div>

      {sample && (
        <AnalysisUploadModal
          isOpen={showUploadModal}
          onClose={() => setShowUploadModal(false)}
          onSuccess={handleUploadSuccess}
          sampleId={String(sample._id || sample.sampleID || '')}
        />
      )}
    </div>
  );
}
