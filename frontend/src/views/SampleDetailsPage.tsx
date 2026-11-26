import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, CheckCircle2, XCircle } from 'lucide-react';
import Button from '../components/UI/Button';
import Card from '../components/UI/Card';
import Input from '../components/UI/Input';
import Table from '../components/UI/Table';
import { useSamples } from '../hooks/useSamples';
import { useResults } from '../hooks/useResults';
import { useEquipment } from '../hooks/useEquipment';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import AnalysisUploadModal from '../components/AnalysisUploadModal';
import SampleFilesSection from '../components/SampleFilesSection';
import InlineStorageMovementPanel from '../components/samples/InlineStorageMovementPanel';
import CloseSpecimenAction from '../components/samples/CloseSpecimenAction';
import SampleCompromiseCard from '../components/samples/SampleCompromiseCard';
import SampleLineageCard from '../components/samples/SampleLineageCard';
import { buildSprecAxisSummary, buildSprecSummary } from '../components/samples/sampleListFormatters';
import { Sample, SampleStorageLocationDTO } from '../types/models';
import { resultService, sampleService } from '../services/api';
import { storageApi } from '../services/storageApi';
import { resolveLegacySampleStatus } from '../foundation/contracts';
import { readSampleQuantities, resolveQuantityStatus } from '../utils/sampleHelpers';

type SampleEditForm = {
  linkedProject: string;
  currentQuantity: string;
  sampleOrigin: string;
  extractionProtocol: string;
  participantId: string;
};

// #545: currentStatus/status are retired legacy fields — sample.service.js
// strips them from every write since #540 (specimenStatus is the sole
// source of truth) — so the update payload must never include them.
export function buildSampleUpdatePayload(form: SampleEditForm, parsedAvailable: number | null): Partial<Sample> {
  const payload: Partial<Sample> = {
    linkedProject: form.linkedProject?.trim() || undefined,
    sampleOrigin: form.sampleOrigin?.trim() || undefined,
    extractionProtocol: form.extractionProtocol?.trim() || undefined,
    participantId: form.participantId?.trim() || undefined,
  };

  if (parsedAvailable !== null) {
    payload.currentQuantity = parsedAvailable;
  }

  return payload;
}

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
  const { samples, loading, error, updateSample, loadSamples } = useSamples();
  const { results, loadResults } = useResults();
  const { equipment } = useEquipment();
  const [sample, setSample] = useState<Sample | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [complianceReport, setComplianceReport] = useState<ComplianceReport | null>(null);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [complianceError, setComplianceError] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showStoragePanel, setShowStoragePanel] = useState(false);
  const [storageLocation, setStorageLocation] = useState<SampleStorageLocationDTO | null>(null);
  const [form, setForm] = useState({
    linkedProject: '',
    currentQuantity: '',
    sampleOrigin: '',
    extractionProtocol: '',
    participantId: '',
  });

  const canEdit = hasRole(['Administrador', 'Coordenador']) || user?.roleName === 'Administrador' || user?.roleName === 'Coordenador';

  const computeAvailability = (s: Sample | null | undefined) => {
    const { initial, current } = readSampleQuantities(s);
    const quantityStatus = resolveQuantityStatus(s);

    // #1436: missing quantities are unknown, not "0,0 µL / Indisponível".
    if (quantityStatus === 'unknown' || current == null) {
      return {
        label: t('samples.detail.availability.unknown', 'Não registrada'),
        className: 'availability-unknown',
        current: null as number | null,
        initial,
        displayAmount: '—',
      };
    }

    if (quantityStatus === 'depleted' || current <= 0) {
      return {
        label: t('samples.detail.availability.unavailable', 'Indisponível'),
        className: 'availability-indisponível',
        current,
        initial: initial ?? 0,
        displayAmount: `${Number(current).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} µL`,
      };
    }

    if (quantityStatus === 'partial' || (initial != null && current < initial)) {
      return {
        label: t('samples.detail.availability.partial', 'Parcialmente Disponível'),
        className: 'availability-parcialmente-disponível',
        current,
        initial: initial ?? current,
        displayAmount: `${Number(current).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} µL`,
      };
    }

    return {
      label: t('samples.detail.availability.available', 'Disponível'),
      className: 'availability-disponível',
      current,
      initial: initial ?? current,
      displayAmount: `${Number(current).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} µL`,
    };
  };

  // Resolve sample from in-memory list, then fall back to GET /samples/:id
  // (inventory is capped; deep-links and seed churn can miss the local window).
  useEffect(() => {
    let cancelled = false;

    const applySample = (foundSample: Sample) => {
      setSample(foundSample);
      setForm({
        linkedProject: foundSample.linkedProject || '',
        currentQuantity: (foundSample.volumeCurrent ?? foundSample.currentQuantity ?? foundSample.quantity ?? '').toString(),
        sampleOrigin: foundSample.sampleOrigin || '',
        extractionProtocol: foundSample.extractionProtocol || '',
        participantId: (foundSample as any).participantId ? String((foundSample as any).participantId) : String((foundSample as any).patientID || ''),
      });
    };

    const resolveSample = async () => {
      if (!id || loading || samples === undefined) return;

      const searchId = String(id || '').trim();
      const foundSample = (samples || []).find(s => {
        const sampleId = String(s._id || (s as any).id || '').trim();
        const specimenIdStr = String(s.specimenId || '').trim();
        return sampleId === searchId ||
               specimenIdStr === searchId ||
               sampleId.toLowerCase() === searchId.toLowerCase() ||
               specimenIdStr.toLowerCase() === searchId.toLowerCase();
      });

      if (foundSample) {
        if (!cancelled) applySample(foundSample);
        return;
      }

      if (!samples || samples.length === 0) {
        // still try direct fetch below
      }

      try {
        const response = await sampleService.getById(searchId);
        const payload = (response as any)?.data ?? response;
        const remote = (payload?.data ?? payload?.sample ?? payload) as Sample | null;
        if (!cancelled && remote && (remote._id || (remote as any).specimenId)) {
          applySample(remote);
          return;
        }
      } catch (err) {
        console.warn('Amostra não encontrada via API:', { searchId, err });
      }

      if (!cancelled) {
        console.warn('Amostra não encontrada:', {
          searchId: id,
          availableIds: (samples || []).map(s => ({ _id: s._id, specimenId: s.specimenId })),
        });
        setSample(null);
      }
    };

    void resolveSample();
    return () => { cancelled = true; };
  }, [samples, id, loading]);

  useEffect(() => {
    const targetId = sample?._id || (sample as any)?.specimenId || id;
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
  }, [sample?._id, sample?.specimenId, id]);

  const getStorageInfo = (location: SampleStorageLocationDTO | null): { summary: string; details: string } => {
    const boxName = location?.box?.boxName ? String(location.box.boxName) : '';
    const position = location?.box?.position ? String(location.box.position) : '';
    const path = location?.path ? String(location.path) : '';

    if (!boxName && !path && !position) {
      return {
        summary: t('samples.detail.storage.awaiting', 'Aguardando Armazenagem'),
        details: t('samples.detail.storage.awaitingDescription', 'A amostra já foi recebida e aguarda atribuição de localização física.'),
      };
    }

    const readable = path || boxName;
    const summary = position ? `${readable} / ${t('samples.detail.storage.well', 'Poço')} ${position}` : readable;
    return { summary, details: summary };
  };

  // The resolved storage location (box, position and path): GET /samples/:id
  // doesn't resolve it, so it's fetched separately via GET /storage/sample/:sampleId.
  const loadStorageLocation = async (sampleId: string) => {
    const response = await storageApi.getSampleLocation(sampleId);
    setStorageLocation(response.success && response.data ? (response.data as SampleStorageLocationDTO) : null);
  };

  useEffect(() => {
    const targetId = sample?._id || (sample as any)?.specimenId || id;
    if (!targetId) {
      setStorageLocation(null);
      return;
    }
    void loadStorageLocation(String(targetId));
  }, [sample?._id, sample?.specimenId, id]);

  const effectiveSample = useMemo(() => {
    if (!isEditing) return sample;
    const parsedAvailable = Number(form.currentQuantity);
    return {
      ...sample,
      currentQuantity: Number.isFinite(parsedAvailable) ? parsedAvailable : sample?.currentQuantity,
      linkedProject: form.linkedProject || sample?.linkedProject,
    } as Sample;
  }, [isEditing, sample, form.currentQuantity, form.linkedProject]);

  const availabilityPreview = computeAvailability(effectiveSample);
  // #518: reads currentSpecimenPreanalytics (resolved server-side by GET
  // /samples, sealed-pinned if set else newest — see #517) instead of the
  // legacy embedded effectiveSample.sprec object. Shared with
  // SamplesPageView's list-row summary via sampleListFormatters.ts.
  const sprecSummary = useMemo(
    () => buildSprecSummary(effectiveSample || {} as Sample, t),
    [effectiveSample, t],
  );
  const sprecAxisSummary = useMemo(
    () => buildSprecAxisSummary(effectiveSample || {} as Sample, t),
    [effectiveSample, t],
  );

  const statusOptions = useMemo(() => ([
    { value: 'Available', label: t('samples.status.available', 'Disponível') },
    { value: 'PartiallyWithdrawn', label: t('samples.status.partiallyWithdrawn', 'Parcialmente Retirada') },
    { value: 'TotallyWithdrawn', label: t('samples.status.totallyWithdrawn', 'Totalmente Retirada') },
    { value: 'Withdrawn', label: t('samples.status.withdrawn', 'Retirada') },
    { value: 'Destroyed', label: t('samples.status.destroyed', 'Destruída') },
    { value: 'Unusable', label: t('samples.status.unusable', 'Inutilizada') },
    { value: 'Closed', label: t('samples.status.closed', 'Encerrada') },
    { value: 'Unknown', label: t('samples.detail.availability.unknown', 'Não registrada') },
  ]), [t]);

  // #545: specimenStatus is the sole persisted source of truth (sample.service.js
  // strips currentStatus/status from every write since #540) — "Status Atual"
  // is a read-only derived display, not an editable field. RF006 AC3: the
  // partial/total withdrawal part reads quantityStatus.
  // #1436: prefer availabilityPreview so unknown quantity shows "Não registrada"
  // together with "—" instead of legacy AVAILABLE / "Disponível".
  const derivedStatusLabel = useMemo(() => {
    if (availabilityPreview.className === 'availability-unknown') {
      return availabilityPreview.label;
    }
    const derived = resolveLegacySampleStatus(sample);
    return statusOptions.find((option) => option.value === derived)?.label || derived;
  }, [sample, statusOptions, availabilityPreview]);

  // #628: Result.specimenId is now the sole canonical shape (every write
  // path writes it, existing documents backfilled) — a direct match, not
  // the multi-key Set this used while the field was still stale.
  const sampleResults = useMemo(() => {
    if (!sample) return [];
    const specimenId = String((sample as any).specimenId || '');
    if (!specimenId) return [];
    return results.filter(result => String((result as any).specimenId) === specimenId);
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
      <div className="page-shell">
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
      <div className="page-shell">
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
      <div className="page-shell">
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
      <div className="page-shell">
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
        linkedProject: sample.linkedProject || '',
        currentQuantity: (sample.currentQuantity ?? sample.quantity ?? '').toString(),
        sampleOrigin: sample.sampleOrigin || '',
        extractionProtocol: sample.extractionProtocol || '',
        participantId: sample.participantId ? String(sample.participantId) : '',
      });
    }
    setSaveError(null);
    setIsEditing(false);
  };

  const handleUpdate = async () => {
    if (!sample) return;
    setSaving(true);
    setSaveError(null);

    const parsedAvailable = form.currentQuantity === '' ? null : Number(form.currentQuantity);
    if (parsedAvailable !== null && (!Number.isFinite(parsedAvailable) || parsedAvailable < 0)) {
      setSaveError('Quantidade disponível inválida');
      setSaving(false);
      return;
    }

    const payload = buildSampleUpdatePayload(form, parsedAvailable);

    try {
      const targetId = sample._id || (sample as any).specimenId || id || '';
      const updated = await updateSample(targetId, payload);
      // Atualiza estado local para refletir a edição imediatamente
      setSample(prev => ({
        ...prev!,
        ...payload,
        currentQuantity: payload.currentQuantity ?? prev?.currentQuantity,
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
    <div className="page-shell" data-testid="sample-detail-root">
      <div className="page-header">
        <div>
            <h1 className="page-title" data-testid="sample-detail-page-title">
            {t('samples.detail.title', 'Detalhes da Amostra')} - {(sample as any).specimenId || sample._id || (sample as any).id || t('common.notAvailable', 'N/A')}
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
                <CloseSpecimenAction
                  sample={sample}
                  canEdit={canEdit}
                  t={t}
                  onClosed={(result) => setSample((prev) => (prev ? {
                    ...prev,
                    specimenStatus: result.specimenStatus,
                    quantityStatus: result.quantityStatus,
                  } : prev))}
                />
                <Button variant="secondary" onClick={() => navigate(`/samples/${id}/chain`)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }} data-testid="sample-detail-chain-button">
                  {t('samples.chain') || 'Cadeia de Custódia'}
                </Button>
                <Button variant="secondary" onClick={() => navigate(`/samples/${id}/label`)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }} data-testid="sample-detail-label-button">
                  {t('samples.printLabels') || 'Imprimir Etiquetas'}
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

        <SampleCompromiseCard sampleId={String(sample._id || sample.specimenId || id)} t={t} locale={locale} />
        <SampleLineageCard parentSpecimenIds={sample.parentSpecimenIds} t={t} />

        {/* Informações Básicas */}
        <Card>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text)' }}>
            {t('samples.detail.basicInfoTitle', 'Informações Básicas')}
          </h3>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>{t('samples.detail.sampleId', 'ID da Amostra')}:</span>
              <span style={{ color: 'var(--text)' }}>{(sample as any).specimenId || sample._id || t('common.notAvailable', 'N/A')}</span>
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
                {(sample as any).registeredAt ? new Date((sample as any).registeredAt).toLocaleDateString(locale) : sample.registrationDate ? new Date(sample.registrationDate).toLocaleDateString(locale) : t('common.notAvailable', 'N/A')}
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
                {availabilityPreview.initial == null
                  ? '—'
                  : `${availabilityPreview.initial.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} µL`}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>{t('samples.detail.currentQuantity', 'Quantidade Disponível')}:</span>
              {isEditing ? (
                <div style={{ width: '180px' }}>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    value={form.currentQuantity}
                    onChange={(e) => handleChange('currentQuantity', e.target.value)}
                    placeholder={t('samples.quantity', 'Quantidade') || 'Quantidade'}
                  />
                </div>
              ) : (
                <span style={{ color: 'var(--text)' }}>
                  {availabilityPreview.displayAmount}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>{t('samples.detail.currentStatus', 'Status Atual')}:</span>
              <span style={{ color: 'var(--text)' }}>{derivedStatusLabel}</span>
            </div>
          </div>
        </Card>

        {/* Armazenagem e Projeto */}
        <Card>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text)' }}>
            {t('samples.detail.storage.storageProjectTitle', 'Armazenagem e Projeto')}
          </h3>
          {!storageLocation?.box?.boxId && (
            <div style={{ marginBottom: '0.75rem', padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: 'rgba(37, 99, 235, 0.08)', color: 'var(--text)' }}>
              <strong>{t('samples.detail.storage.awaiting', 'Aguardando Armazenagem')}.</strong> {t('samples.detail.storage.storageAwaitingMessage', 'A amostra está registrada, mas ainda não foi atribuída a uma posição física.')}
            </div>
          )}
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={{ padding: '0.75rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>{t('samples.detail.storage.storageLabel', 'Armazenagem')}:</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '999px',
                    backgroundColor: !storageLocation?.box?.boxId ? 'rgba(37, 99, 235, 0.10)' : 'rgba(16, 185, 129, 0.10)',
                    color: !storageLocation?.box?.boxId ? 'var(--primary)' : 'var(--text)',
                    fontWeight: 600,
                    fontSize: '0.875rem'
                  }}>
                    {getStorageInfo(storageLocation).summary}
                  </span>
                  {canEdit && (
                    <Button
                      variant="secondary"
                      onClick={() => setShowStoragePanel((prev) => !prev)}
                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                    >
                      {t('samples.detail.storage.manage', 'Gerenciar Armazenagem')}
                    </Button>
                  )}
                </div>
              </div>
            </div>
            {showStoragePanel && sample && (
              <InlineStorageMovementPanel
                sample={{ ...sample, id: String(sample._id || (sample as any).specimenId || id || '') }}
                t={(key: string) => t(key) || key}
                onCancel={() => setShowStoragePanel(false)}
                onCompleted={() => {
                  setShowStoragePanel(false);
                  loadSamples();
                  const targetId = sample?._id || (sample as any)?.specimenId || id;
                  if (targetId) void loadStorageLocation(String(targetId));
                }}
              />
            )}
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
              <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>{t('samples.detail.participantId', 'ID do Paciente')}:</span>
              {isEditing ? (
                <div style={{ width: '220px' }}>
                  <Input
                    value={form.participantId}
                    onChange={(e) => handleChange('participantId', e.target.value)}
                    placeholder={t('samples.patient', 'Paciente') || 'Paciente'}
                  />
                </div>
              ) : (
                <span style={{ fontFamily: 'monospace', color: 'var(--text)', fontWeight: 500 }}>
                  {sample.participantId || t('common.notAvailable', 'N/A')}
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

        {/* #647: RF007 scientific-file upload/checksum/encryption/audit --
            a distinct capability and backend collection (sample_files) from
            the "Resultados"/AnalysisUploadModal card above (/api/results) --
            previously unreachable, this component existed but was never
            mounted anywhere. */}
        {sample && (
          <Card>
            <SampleFilesSection sampleID={String(sample._id || (sample as any).specimenId || id || '')} />
          </Card>
        )}
      </div>

      {sample && (
        <AnalysisUploadModal
          isOpen={showUploadModal}
          onClose={() => setShowUploadModal(false)}
          onSuccess={handleUploadSuccess}
          sampleId={String(sample._id || (sample as any).specimenId || '')}
        />
      )}
    </div>
  );
}

