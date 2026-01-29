import { useEffect, useMemo, useState } from 'react';
import Modal from './UI/Modal';
import Input from './UI/Input';
import Select from './UI/Select';
import Button from './UI/Button';
import { useSamples } from '../hooks/useSamples';
import { useEquipment } from '../hooks/useEquipment';
import { useAnalysisTypes } from '../hooks/useAnalysisTypes';
import { useAuth } from '../contexts/AuthContext';
import { resultService } from '../services/api';
import { Sample } from '../types/models';

type AnalysisUploadModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  sampleId?: string;
};

export default function AnalysisUploadModal({
  isOpen,
  onClose,
  onSuccess,
  sampleId,
}: AnalysisUploadModalProps) {
  const { samples } = useSamples();
  const { equipment } = useEquipment();
  const { types, loading: loadingTypes, error: typesError } = useAnalysisTypes();
  const { user, hasRole } = useAuth();

  const [file, setFile] = useState<File | null>(null);
  const [analysisType, setAnalysisType] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [equipmentName, setEquipmentName] = useState('');
  const [method, setMethod] = useState('');
  const [researcher, setResearcher] = useState('');
  const [description, setDescription] = useState('');
  const [sampleInput, setSampleInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const resolvedSampleId = sampleId || sampleInput;
  const canEditResearcher = hasRole(['Administrador']) || user?.roleName === 'Administrador';

  const equipmentOptions = useMemo(() => {
    if (!equipment || equipment.length === 0) return [];
    return [
      { value: '', label: 'Selecione o equipamento' },
      ...equipment.map((e) => ({
        value: String(e.equipmentID),
        label: `${e.equipmentDescription || 'Equipamento'} (${e.equipmentID})`,
      })),
    ];
  }, [equipment]);

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
      value: String(s.sampleID || s._id || ''),
      label: `${s.sampleID || s._id} ${s.barcode ? `• ${s.barcode}` : ''}`,
    }));
  }, [samples]);

  useEffect(() => {
    if (isOpen) {
      setError('');
      setResearcher(
        user?.name || user?.username || user?.email || ''
      );
      if (sampleId) setSampleInput(sampleId);
    }
  }, [isOpen, sampleId, user]);

  const handleSubmit = async () => {
    if (!file) {
      setError('Selecione um arquivo');
      return;
    }
    if (!analysisType) {
      setError('Selecione o tipo de análise');
      return;
    }
    if (!resolvedSampleId) {
      setError('Selecione a amostra');
      return;
    }
    if (!method.trim()) {
      setError('Informe o método/protocolo');
      return;
    }
    if (!researcher.trim()) {
      setError('Informe o pesquisador responsável');
      return;
    }
    if (!equipmentId && !equipmentName.trim()) {
      setError('Informe o equipamento utilizado');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('analysisType', analysisType);
      formData.append('sampleID', resolvedSampleId);
      formData.append('method', method.trim());
      formData.append('responsibleResearcher', researcher.trim());
      formData.append('description', description.trim());

      if (equipmentId) {
        formData.append('equipmentID', equipmentId);
      } else if (equipmentName.trim()) {
        formData.append('equipmentName', equipmentName.trim());
      }

      await resultService.upload(formData);
      onSuccess?.();
      onClose();
      setFile(null);
      setAnalysisType('');
      setEquipmentId('');
      setEquipmentName('');
      setMethod('');
      setDescription('');
      if (!sampleId) setSampleInput('');
    } catch (err: any) {
      setError(err?.message || 'Erro ao enviar arquivo');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Enviar Arquivo de Análise">
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
          <label>Equipamento Utilizado</label>
          {equipmentOptions.length > 0 ? (
            <Select
              value={equipmentId}
              onChange={(e) => setEquipmentId(e.target.value)}
              options={equipmentOptions}
            />
          ) : (
            <Input
              value={equipmentName}
              onChange={(e) => setEquipmentName(e.target.value)}
              placeholder="Equipamento"
            />
          )}
        </div>

        <div>
          <label>Método / Protocolo</label>
          <Input
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            placeholder="Método/Protocolo"
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
          <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Enviando...' : 'Enviar'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
