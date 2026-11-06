import { useEffect, useMemo, useState } from 'react';
import Modal from './UI/Modal';
import Input from './UI/Input';
import Select from './UI/Select';
import Button from './UI/Button';
import Card from './UI/Card';
import { useSamples } from '../hooks/useSamples';
import { useEquipment } from '../hooks/useEquipment';
import { useAnalysisTypes } from '../hooks/useAnalysisTypes';
import { useAuth } from '../contexts/AuthContext';
import { resultService, equipmentService } from '../services/api';
import { extractResponseItems } from '../api/response.adapters';
import { Sample, Equipment } from '../types/models';
import { ANALYSIS_METHODS } from '../constants/labOptions';

type AnalysisUploadModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  sampleId?: string;
  inline?: boolean;
};

export default function AnalysisUploadModal({
  isOpen,
  onClose,
  onSuccess,
  sampleId,
  inline = false,
}: AnalysisUploadModalProps) {
  const { samples } = useSamples();
  const { equipment } = useEquipment();
  const { types, loading: loadingTypes, error: typesError } = useAnalysisTypes();
  const { user, hasRole } = useAuth();

  // Estado para equipamentos analíticos
  const [analyticalEquipment, setAnalyticalEquipment] = useState<Equipment[]>([]);
  const [loadingAnalyticalEquipment, setLoadingAnalyticalEquipment] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [analysisType, setAnalysisType] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [method, setMethod] = useState('');
  const [researcher, setResearcher] = useState('');
  const [description, setDescription] = useState('');
  const [sampleInput, setSampleInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const resolvedSampleId = sampleId || sampleInput;
  const canEditResearcher = hasRole(['Administrador']) || user?.roleName === 'Administrador';

  // Carrega equipamentos analíticos quando o modal abre
  useEffect(() => {
    if (isOpen) {
      loadAnalyticalEquipment();
    }
  }, [isOpen]);

  const loadAnalyticalEquipment = async () => {
    try {
      setLoadingAnalyticalEquipment(true);
      const response = await equipmentService.getAnalytical();
      // #898: the backend wraps this list in a { success, data } envelope,
      // not a bare array — unwrap it the same way the rest of the app does
      // (see response.adapters.ts) instead of assuming the array shape.
      const payload: any = response?.data;
      const isRecognisedShape = Array.isArray(payload) || Array.isArray(payload?.data);
      if (!isRecognisedShape) {
        console.error('Formato de resposta inesperado para equipamentos analíticos:', payload);
      }
      setAnalyticalEquipment(extractResponseItems<Equipment>(response));
    } catch (err: any) {
      console.error('Erro ao carregar equipamentos analíticos:', err);
      setAnalyticalEquipment([]);
    } finally {
      setLoadingAnalyticalEquipment(false);
    }
  };

  /**
   * Formata label do equipamento como: ${name || equipmentDescription} (${serialNumber})
   * Se status for 'Maintenance', adiciona indicador desabilitado
   */
  const getEquipmentLabel = (eq: Equipment): string => {
    const displayName = eq.name || eq.equipmentDescription || 'Equipamento';
    const serialInfo = eq.serialNumber ? ` (${eq.serialNumber})` : '';
    const maintenanceIndicator = eq.status === 'Maintenance' ? ' [Manutenção]' : '';
    return `${displayName}${serialInfo}${maintenanceIndicator}`;
  };

  const equipmentOptions = useMemo(() => {
    if (loadingAnalyticalEquipment) {
      return [{ value: '', label: 'Carregando equipamentos...' }];
    }

    if (!analyticalEquipment || analyticalEquipment.length === 0) {
      return [{ value: '', label: 'Nenhum equipamento analítico disponível' }];
    }

    return [
      { value: '', label: 'Selecione o equipamento' },
      ...analyticalEquipment
        .filter(eq => eq.status !== 'Maintenance') // Filtra equipamentos em manutenção
        .map((eq) => ({
          value: String(eq.equipmentID),
          label: getEquipmentLabel(eq),
        })),
    ];
  }, [analyticalEquipment, loadingAnalyticalEquipment]);

  const methodOptions = useMemo(() => {
    return [
      { value: '', label: 'Selecione o método' },
      ...ANALYSIS_METHODS.map((analysisMethod) => ({
        value: analysisMethod,
        label: analysisMethod,
      }))
    ];
  }, []);

  const analysisTypeOptions = useMemo(() => {
    if (loadingTypes) {
      return [{ value: '', label: 'Carregando opções...' }];
    }

    if (!types || types.length === 0) {
      return [{ value: '', label: 'Nenhum tipo disponível' }];
    }

    return [
      { value: '', label: 'Selecione o tipo' },
      ...types.map((type) => ({
        value: type.code,
        label: type.name,
      }))
    ];
  }, [types, loadingTypes]);

  const sampleOptions = useMemo(() => {
    if (!samples || samples.length === 0) return [];
    return samples.map((s: Sample) => ({
      value: String(s.specimenId || s._id || ''),
      label: `${s.specimenId || s._id} ${s.barcode ? `• ${s.barcode}` : ''}`,
    }));
  }, [samples]);

  useEffect(() => {
    if (isOpen) {
      setError('');
      setFile(null);
      setAnalysisType('');
      setEquipmentId('');
      setMethod('');
      setDescription('');
      setSubmitting(false);
      setResearcher(
        user?.name || user?.username || user?.email || ''
      );
      if (sampleId) {
        setSampleInput(sampleId);
      } else {
        setSampleInput('');
      }
    }
  }, [isOpen, sampleId, user]);

  const handleSubmit = async () => {
    // Types only: Enviar is disabled until isFormValid, which needs a file.
    if (!file) return;

    setSubmitting(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('analysisType', analysisType);
      // #628: backend's wire contract for this field is now specimenId
      // (result.routes.js resolves it against a real Sample lookup,
      // accepting an _id, a specimenId, or the legacy numeric sampleID).
      formData.append('specimenId', resolvedSampleId);
      formData.append('method', method.trim());
      formData.append('responsibleResearcher', researcher.trim());
      formData.append('description', description.trim());
      formData.append('equipmentID', equipmentId);

      await resultService.upload(formData);
      onSuccess?.();
      onClose();
      setFile(null);
      setAnalysisType('');
      setEquipmentId('');
      setMethod('');
      setDescription('');
      if (!sampleId) setSampleInput('');
    } catch (err: any) {
      setError(err?.message || 'Erro ao enviar arquivo');
    } finally {
      setSubmitting(false);
    }
  };

  const isFormValid = Boolean(
    file &&
    analysisType &&
    resolvedSampleId &&
    method &&
    researcher.trim() &&
    equipmentId
  );

  if (!isOpen) return null;

  const formContent = (
    <div style={{ display: 'grid', gap: '1rem' }}>
        {error && (
          <div style={{ color: 'var(--danger)', fontSize: '0.9rem' }}>
            {error}
          </div>
        )}

        <div>
          <label htmlFor="analysis-upload-file">Arquivo</label>
          <input
            id="analysis-upload-file"
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            disabled={submitting}
          />
        </div>

        <div>
          <label>Tipo de Análise</label>
          <Select
            value={analysisType}
            onChange={(e) => setAnalysisType(e.target.value)}
            options={analysisTypeOptions}
            disabled={loadingTypes}
          />
          {typesError && (
            <span style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>
              {typesError}
            </span>
          )}
        </div>

        <div>
          <label>Equipamento Utilizado (Analítico)</label>
          <Select
            value={equipmentId}
            onChange={(e) => setEquipmentId(e.target.value)}
            options={equipmentOptions}
            disabled={loadingAnalyticalEquipment || analyticalEquipment.length === 0}
          />
          {analyticalEquipment.filter(eq => eq.status === 'Maintenance').length > 0 && (
            <span style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>
              ℹ️ Equipamentos em manutenção não estão disponíveis para seleção
            </span>
          )}
        </div>

        <div>
          <label>Método / Protocolo</label>
          <Select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            options={methodOptions}
          />
        </div>

        <div>
          <label>Pesquisador Responsável</label>
          <Input
            value={researcher}
            onChange={(e) => setResearcher(e.target.value)}
            placeholder="Pesquisador"
            disabled={!canEditResearcher}
          />
        </div>

        {!sampleId && (
          <div>
            <label>ID da Amostra</label>
            <Input
              list="sample-list"
              value={sampleInput}
              onChange={(e) => setSampleInput(e.target.value)}
              placeholder="Digite ou selecione a amostra"
              helperText="Selecione um ID cadastrado ou digite manualmente"
            />
            <datalist id="sample-list">
              {sampleOptions.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </datalist>
          </div>
        )}

        {sampleId && (
          <div>
            <label>ID da Amostra</label>
            <Input value={sampleId} disabled />
          </div>
        )}

        <div>
          <label>Descrição / Observações</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            style={{
              width: '100%',
              padding: '0.5rem',
              borderRadius: '4px',
              border: '1px solid var(--border)',
            }}
            placeholder="Observações"
          />
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submitting || !isFormValid}>
            {submitting ? 'Enviando...' : 'Enviar'}
          </Button>
        </div>
    </div>
  );

  if (inline) {
    return (
      <Card style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Enviar Arquivo de Análise</h2>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Ocultar
          </Button>
        </div>
        {formContent}
      </Card>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Enviar Arquivo de Análise">
      {formContent}
    </Modal>
  );
}
