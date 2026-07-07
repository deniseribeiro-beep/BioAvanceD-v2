import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, CheckCircle2, XCircle } from 'lucide-react';
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
import { resultService, sampleService } from '../services/api';
import './SamplesPage.css';

type ComplianceNode = {
  valid: boolean;
  reason?: string;
};

type ComplianceReport = {
  sampleId: string;
  isReleasable: boolean;
  graphPath: {
    ethics: ComplianceNode;
    quality: ComplianceNode;
    clinical: ComplianceNode;
    integrity: ComplianceNode;
  };
  suggestedStatus: 'AVAILABLE' | 'BLOCKED' | 'QUARANTINE';
};

export default function SampleDetailsPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { t, language } = useLanguage();
  const locale = language;
  const { user, hasRole } = useAuth();
  const { samples, loading, error, updateSample } = useSamples();
  const { results, loadResults } = useResults();
  const { equipment } = useEquipment();
  const { locations = [], loadLocations } = useLocations();
  const [sample, setSample] = useState<Sample | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [complianceReport, setComplianceReport] = useState<ComplianceReport | null>(null);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [complianceError, setComplianceError] = useState<string | null>(null);
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
        label: t('samples.detail.availability.unavailable', 'Indisponível'),
        className: 'availability-indisponível',
        current,
        initial,
      };
    }

    if (current < initial) {
      return {
        label: t('samples.detail.availability.partial', 'Parcialmente Disponível'),
        className: 'availability-parcialmente-disponível',
        current,
        initial,
      };
    }

    return {
      label: t('samples.detail.availability.available', 'Disponível'),
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

  useEffect(() => {
    const targetId = sample?._id || sample?.sampleID || id;
    if (!targetId) {
      setComplianceReport(null);
      return;
    }

    let active = true;
    const loadComplianceGraph = async () => {
      setComplianceLoading(true);
      setComplianceError(null);
      try {
        const response = await sampleService.getComplianceGraph(String(targetId));
        const nextData = response?.data?.data || response?.data || null;
        if (active) {
          setComplianceReport(nextData);
        }
      } catch (error: any) {
        if (active) {
          setComplianceReport(null);
          setComplianceError(error?.response?.data?.message || error?.message || 'Erro ao carregar grafo de conformidade');
        }
      } finally {
        if (active) {
          setComplianceLoading(false);
        }
      }
    };

    void loadComplianceGraph();

    return () => {
      active = false;
    };
  }, [sample?._id, sample?.sampleID, id]);

  const getLocationInfo = (locationID?: number): { summary: string; details: string } => {
    if (locationID === undefined || locationID === null) {
      return {
        summary: t('samples.detail.storage.awaiting', 'Aguardando Armazenagem'),
        details: t('samples.detail.storage.awaitingDescription', 'A amostra já foi recebida e aguarda atribuição de localização física.'),
      };
    }

    if (!locations || !Array.isArray(locations) || locations.length === 0) {
      return { summary: t('samples.detail.storage.idLabel', 'ID: {id}').replace('{id}', String(locationID)), details: t('samples.detail.storage.unavailable', 'Informações de localização não disponíveis') };
    }

    const location = locations.find(loc => loc.locationID === locationID);
    if (!location) {
      return { summary: t('samples.detail.storage.idLabel', 'ID: {id}').replace('{id}', String(locationID)), details: t('samples.detail.storage.notFound', 'Localização não encontrada') };
    }

    const parts: string[] = [];
    if (location.block) parts.push(`${t('samples.detail.storage.block', 'Bloco')}: ${location.block}`);
    if (location.rack) parts.push(`${t('samples.detail.storage.rack', 'Prateleira')}: ${location.rack}`);
    if (location.drawer) parts.push(`${t('samples.detail.storage.drawer', 'Gaveta')}: ${location.drawer}`);
    if (location.box) parts.push(`${t('samples.detail.storage.box', 'Caixa')}: ${location.box}`);
    if (location.wellPosition || location.eppendorfWell) {
      parts.push(`${t('samples.detail.storage.well', 'Poço')}: ${location.wellPosition || location.eppendorfWell}`);
    }

    const summary = parts.length > 0 
      ? parts.slice(0, 2).join(' | ') 
      : t('samples.detail.storage.idLabel', 'ID: {id}').replace('{id}', String(locationID));

    const details = parts.length > 0 
      ? parts.join(' • ') 
      : t('samples.detail.storage.locationId', 'Localização ID: {id}').replace('{id}', String(locationID));

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
  const sprecSummary = useMemo(() => {
    const sprec = (effectiveSample as any)?.sprec || {};
    const matrixType = String((effectiveSample as any)?.matrix_type || sprec.matrixType || '').trim().toLowerCase();
    const parts = matrixType === 'solid'
      ? [sprec.sampleType, sprec.primaryContainer, sprec.warmIschemia, sprec.coldIschemia, sprec.fixationType, sprec.fixationTime, sprec.longTermStorage]
      : [sprec.sampleType, sprec.primaryContainer, sprec.preCentrifugation, sprec.centrifugation, sprec.secondCentrifugation, sprec.postCentrifugationDelay, sprec.longTermStorage];
    const code = String((effectiveSample as any)?.sprec_code || (effectiveSample as any)?.sprecCode || parts.map((part) => String(part || '').trim()).filter(Boolean).join('-')).trim();
    return code ? `${t('samples.detail.sprec.prefix', 'SPREC')} ${code}` : t('samples.detail.sprec.na', 'SPREC: N/A');
  }, [effectiveSample]);
  const sprecAxisSummary = useMemo(() => {
    const sprec = (effectiveSample as any)?.sprec || {};
    const matrixType = String((effectiveSample as any)?.matrix_type || sprec.matrixType || '').trim().toLowerCase();
    const axes = matrixType === 'solid'
      ? [
        [t('samples.detail.sprec.axes.Pwarm', 'Pwarm'), sprec.warmIschemia],
        [t('samples.detail.sprec.axes.Pcold', 'Pcold'), sprec.coldIschemia],
        [t('samples.detail.sprec.axes.Pfix', 'Pfix'), sprec.fixationType],
        [t('samples.detail.sprec.axes.PfixTime', 'PfixTime'), sprec.fixationTime],
        [t('samples.detail.sprec.axes.Pstore', 'Pstore'), sprec.longTermStorage],
      ]
      : [
        [t('samples.detail.sprec.axes.Ppre', 'Ppre'), sprec.preCentrifugation],
        [t('samples.detail.sprec.axes.Pcent1', 'Pcent1'), sprec.centrifugation],
        [t('samples.detail.sprec.axes.Pcent2', 'Pcent2'), sprec.secondCentrifugation],
        [t('samples.detail.sprec.axes.Ppost', 'Ppost'), sprec.postCentrifugationDelay],
        [t('samples.detail.sprec.axes.Pstore', 'Pstore'), sprec.longTermStorage],
      ];

    return axes
      .map(([label, value]) => `${label}:${String(value || '').trim() || t('common.notAvailable', 'N/A')}`)
      .join(' | ');
  }, [effectiveSample]);

  const locationOptions = useMemo(() => {
    if (!locations || locations.length === 0) {
      return [{ value: '', label: t('samples.detail.storage.awaiting', 'Aguardando Armazenagem') }];
    }
    return [
      { value: '', label: t('samples.detail.storage.unassigned', 'Sem armazenagem atribuída') },
      ...locations
        .filter(loc => loc.locationID != null)
        .map(loc => ({
          value: String(loc.locationID),
          label: `${loc.locationID} - ${t('samples.detail.storage.block', 'Bloco')} ${loc.block} / ${t('samples.detail.storage.shelfAbbr', 'Prat.')} ${loc.rack} / ${t('samples.detail.storage.drawerAbbr', 'Gav.')} ${loc.drawer} / ${t('samples.detail.storage.box', 'Caixa')} ${loc.box}`,
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
      return match?.equipmentDescription || t('samples.detail.equipmentFallback', 'Equipamento #{id}').replace('{id}', String(equipmentID));
    }
    return equipmentName || t('common.notAvailable', 'Não informado');
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
            {t('samples.detail.searchedId', 'ID buscado')}: {id}
          </p>
          {samples && samples.length > 0 && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: '0.5rem' }}>
              {t('samples.detail.loadedSamples', 'Total de amostras carregadas')}: {samples.length}
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

    const locationIdNum = form.locationID && form.locationID !== '' ? Number(form.locationID) : undefined;
    const payload: Partial<Sample> = {
      linkedProject: form.linkedProject?.trim() || undefined,
      locationID: Number.isFinite(locationIdNum) ? locationIdNum : undefined,
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
    <div className="page" data-testid="sample-detail-root">
      <div className="page-header">
        <div>
            <h1 className="page-title" data-testid="sample-detail-page-title">
            {t('samples.detail.title', 'Detalhes da Amostra')} - {sample.barcode || sample.sampleID || t('common.notAvailable', 'N/A')}
          </h1>

          <div style={{ marginBottom: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {!isEditing ? (
              <>
                {canEdit && (
                  <Button
                    variant="primary"
                    onClick={() => setIsEditing(true)}
                    data-testid="sample-detail-edit-button"
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
                  >
                    {t('common.edit') || 'Editar'}
                  </Button>
                )}
                <Button variant="secondary" onClick={() => navigate(`/samples/${id}/chain`)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }} data-testid="sample-detail-chain-button">
                  {t('samples.chain') || 'Cadeia de Custódia'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => navigate('/samples')}
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
                  data-testid="sample-detail-back-button"
                  data-legacy-testid="sample-detail-back-button-2"
                >
                  <ArrowLeft size={18} style={{ marginRight: '0.5rem' }} />
                  {t('common.back') || 'Voltar'}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="primary"
                  onClick={handleUpdate}
                  data-testid="sample-detail-save-button"
                  disabled={saving}
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
                >
                  {saving ? (t('common.loading') || 'Salvando...') : (t('common.save') || 'Salvar')}
                </Button>
              <Button
                  variant="secondary"
                  onClick={handleCancel}
                  data-testid="sample-detail-cancel-button"
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
        <Card>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text)' }}>
            {t('samples.detail.governanceTitle', 'Grafo de Governança')}
          </h3>

          {complianceLoading ? (
            <p style={{ color: 'var(--text-light)' }}>{t('samples.detail.validatingCompliance', 'Validando conformidade da amostra...')}</p>
          ) : complianceError ? (
            <p style={{ color: 'var(--danger)' }}>{complianceError}</p>
          ) : complianceReport ? (
            <>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginBottom: '0.75rem',
                padding: '0.4rem 0.75rem',
                borderRadius: '999px',
                backgroundColor: complianceReport.isReleasable ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.12)',
                color: complianceReport.isReleasable ? '#047857' : '#b91c1c',
                fontWeight: 700,
                fontSize: '0.85rem'
              }}>
                {complianceReport.isReleasable ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                {complianceReport.isReleasable ? t('samples.detail.releasable', 'Amostra liberável') : t('samples.detail.blockedForRelease', 'Amostra bloqueada para liberação')}
              </div>

              <div style={{ display: 'grid', gap: '0.6rem' }}>
                {[
                  { key: 'ethics', label: 'Ética', data: complianceReport.graphPath.ethics },
                  { key: 'quality', label: 'Qualidade', data: complianceReport.graphPath.quality },
                  { key: 'clinical', label: 'Clínica', data: complianceReport.graphPath.clinical },
                  { key: 'integrity', label: 'Integridade', data: complianceReport.graphPath.integrity },
                ].map((node) => (
                  <div
                    key={node.key}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                      padding: '0.65rem 0.75rem',
                      borderRadius: '8px',
                      backgroundColor: node.data?.valid ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--text)' }}>{node.label}</div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>
                        {node.data?.reason || t('samples.detail.noDetails', 'Sem detalhes')}
                      </div>
                    </div>
                    <div style={{ color: node.data?.valid ? '#16a34a' : '#dc2626', marginTop: '0.1rem' }}>
                      {node.data?.valid ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--text-light)' }}>
                {t('samples.detail.suggestedReleaseStatus', 'release_status sugerido')}: <strong style={{ color: 'var(--text)' }}>{complianceReport.suggestedStatus}</strong>
              </div>
            </>
          ) : (
            <p style={{ color: 'var(--text-light)' }}>{t('samples.detail.noComplianceReport', 'Sem relatório de conformidade disponível.')}</p>
          )}
        </Card>

        {/* Informações Básicas */}
        <Card>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text)' }}>
            {t('samples.detail.basicInfoTitle', 'Informações Básicas')}
          </h3>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>{t('samples.detail.sampleId', 'ID da Amostra')}:</span>
              <span style={{ color: 'var(--text)' }}>{sample.sampleID || sample._id || t('common.notAvailable', 'N/A')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>{t('samples.detail.barcode', 'Código de Barras')}:</span>
              <span style={{ fontFamily: 'monospace', color: 'var(--primary)', fontWeight: 600 }}>{sample.barcode || t('common.notAvailable', 'N/A')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>{t('samples.detail.type', 'Tipo')}:</span>
              <span style={{ color: 'var(--text)' }}>{sample.sampleType || t('common.notAvailable', 'N/A')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>{t('samples.detail.origin', 'Origem')}:</span>
              {isEditing ? (
                <div style={{ width: '280px' }}>
                  <Input
                    value={form.sampleOrigin}
                    onChange={(e) => handleChange('sampleOrigin', e.target.value)}
                    placeholder={t('samples.origin', 'Origem') || 'Origem'}
                  />
                </div>
              ) : (
                <span style={{ color: 'var(--text)' }}>{sample.sampleOrigin || t('common.notAvailable', 'N/A')}</span>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>{t('samples.detail.extractionProtocol', 'Protocolo de Extração')}:</span>
              {isEditing ? (
                <div style={{ width: '280px' }}>
                  <Input
                    value={form.extractionProtocol}
                    onChange={(e) => handleChange('extractionProtocol', e.target.value)}
                    placeholder={t('samples.protocol', 'Protocolo') || 'Protocolo'}
                  />
                </div>
              ) : (
                <span style={{ color: 'var(--text)' }}>{sample.extractionProtocol || t('common.notAvailable', 'N/A')}</span>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>{t('samples.detail.registrationDate', 'Data de Registro')}:</span>
              <span style={{ color: 'var(--text)' }}>
                {sample.registrationDate ? new Date(sample.registrationDate).toLocaleDateString(locale) : t('common.notAvailable', 'N/A')}
              </span>
            </div>
          </div>
        </Card>

        <Card>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text)' }}>
            {t('samples.detail.sprecTitle', 'SPREC')}
          </h3>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>{t('samples.detail.sprecCode', 'Código')}:</span>
              <span style={{ color: 'var(--text)', fontFamily: 'monospace' }}>{sprecSummary}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>{t('samples.detail.sprecAxes', 'Eixos')}:</span>
              <span style={{ color: 'var(--text)' }}>{sprecAxisSummary}</span>
            </div>
          </div>
        </Card>

        {/* Quantidade e Qualidade */}
        <Card>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text)' }}>
            {t('samples.detail.quantityQualityTitle', 'Quantidade e Qualidade')}
          </h3>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>{t('samples.detail.totalQuantity', 'Quantidade Total')}:</span>
              <span style={{ color: 'var(--text)' }}>
                {availabilityPreview.initial.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} µL
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>{t('samples.detail.availableQuantity', 'Quantidade Disponível')}:</span>
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
                  {availabilityPreview.current.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} µL
                </span>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>{t('samples.detail.currentStatus', 'Status Atual')}:</span>
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
            {t('samples.detail.storage.storageProjectTitle', 'Armazenagem e Projeto')}
          </h3>
          {sample?.locationID == null && (
            <div style={{ marginBottom: '0.75rem', padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: 'rgba(37, 99, 235, 0.08)', color: 'var(--text)' }}>
              <strong>{t('samples.detail.storage.awaiting', 'Aguardando Armazenagem')}.</strong> {t('samples.detail.storage.storageAwaitingMessage', 'A amostra está registrada, mas ainda não foi atribuída a uma posição física.')}
            </div>
          )}
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={{ padding: '0.75rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>{t('samples.detail.storage.storageLabel', 'Armazenagem')}:</span>
                {isEditing ? (
                  <div style={{ minWidth: '260px' }}>
                    <Select
                      value={form.locationID}
                      onChange={(e) => handleChange('locationID', e.target.value)}
                      options={locationOptions}
                    />
                    <div style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: 'var(--text-light)' }}>
                      {t('samples.detail.storage.storageOptional', 'Opcional. A amostra pode permanecer sem localização até ser armazenada.')}
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
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>{t('samples.detail.linkedProject', 'Projeto Vinculado')}:</span>
              {isEditing ? (
                <div style={{ flex: 1, maxWidth: '420px', marginLeft: '1rem' }}>
                  <Input
                    value={form.linkedProject}
                    onChange={(e) => handleChange('linkedProject', e.target.value)}
                    placeholder={t('samples.linkedProject', 'Projeto vinculado') || 'Projeto vinculado'}
                  />
                </div>
              ) : (
                <span style={{ color: 'var(--text)' }}>{effectiveSample?.linkedProject || t('common.notAvailable', 'N/A')}</span>
              )}
            </div>
          </div>
        </Card>

        {/* Paciente */}
        <Card>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text)' }}>
            {t('samples.detail.patientTitle', 'Paciente')}
          </h3>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>{t('samples.detail.patientId', 'ID do Paciente')}:</span>
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
                  {sample.patientID || t('common.notAvailable', 'N/A')}
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
                {t('samples.detail.analysisFilesTitle', 'Arquivos de Análise')}
              </h3>
              {canEdit && (
                <Button variant="primary" onClick={() => setShowUploadModal(true)}>
                  {t('samples.detail.sendFile', 'Enviar Arquivo')}
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
                <p>{t('samples.detail.noAnalysisFiles', 'Nenhum arquivo associado a esta amostra')}</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <Table
                  headers={[
                    'ID',
                    'Tipo',
                    t('samples.detail.tableHeaders.method', 'Método'),
                    t('samples.detail.tableHeaders.researcher', 'Pesquisador'),
                    t('samples.detail.tableHeaders.equipment', 'Equipamento'),
                    t('samples.detail.tableHeaders.description', 'Descrição'),
                    t('samples.detail.tableHeaders.actions', 'Ações'),
                  ]}
                >
                  {sampleResults.map((result) => (
                    <tr key={result._id || result.resultID}>
                      <td>{result.resultID || result._id}</td>
                      <td><span className="file-type-badge">{result.fileType}</span></td>
                      <td>{result.method || t('common.notAvailable', 'N/A')}</td>
                      <td>{result.responsibleResearcher || t('common.notAvailable', 'N/A')}</td>
                      <td>{getResultEquipmentLabel(result.equipmentID, result.equipmentName)}</td>
                      <td>{result.description || t('common.notAvailable', 'N/A')}</td>
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
                            {t('samples.detail.download', 'Download')}
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
