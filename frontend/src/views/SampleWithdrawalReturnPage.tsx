import { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { sampleService } from '../services/api';
import { storageApi } from '../services/storageApi';
import { CurrentStoragePlacementDTO, Sample, SampleMovement } from '../types/models';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import Select from '../components/UI/Select';
import Card from '../components/UI/Card';
import { MIABIS_QUALITY } from '../config/constants/specimen.constants';
import { resolveSpecimenStatus, getSpecimenStatusColor, translateSpecimenStatus } from '../utils/sampleHelpers';
import './SampleWithdrawalReturnPage.css';

export { resolveSpecimenStatus, getSpecimenStatusColor, translateSpecimenStatus };

interface WithdrawalFormData {
  withdrawalType: 'Parcial' | 'Total' | '';
  withdrawalQuantity: string;
  withdrawalResponsible: string;
  sampleDestination: string;
  purpose: string;
  linkedProject: string;
  observations: string;
}

interface ReturnFormData {
  returnType: 'Parcial' | 'Total' | '';
  returnQuantity: string;
  returnResponsible: string;
  condition: 'Íntegra' | 'Parcialmente comprometida' | 'Inutilizada' | '';
  observations: string;
}

type WithdrawalSample = Pick<Sample, 'specimenStatus' | 'totalWithdrawn' | 'totalReturned' | 'initialQuantity' | 'quantity'>;

const WITHDRAWAL_BLOCKED_STATUSES = ['depleted', 'quarantined', 'destroyed', 'unavailable', 'disposed'];

export function canWithdrawSample(sample: WithdrawalSample | null): boolean {
  if (!sample) return false;
  return !WITHDRAWAL_BLOCKED_STATUSES.includes(resolveSpecimenStatus(sample));
}

export function getPendingReturnQuantity(sample: WithdrawalSample | null): number {
  if (!sample) return 0;
  const totalWithdrawn = sample.totalWithdrawn || 0;
  const totalReturned = sample.totalReturned || 0;
  if (resolveSpecimenStatus(sample) === 'depleted' && totalWithdrawn === 0) {
    return sample.initialQuantity ?? sample.quantity ?? 0;
  }
  return totalWithdrawn - totalReturned;
}

export function resolveInitialTab(sample: WithdrawalSample | null): 'withdraw' | 'return' {
  const status = resolveSpecimenStatus(sample);
  return status === 'partial' || status === 'depleted' ? 'return' : 'withdraw';
}

export function getStorageLabel(placement: CurrentStoragePlacementDTO | null): string {
  const boxName = placement?.box?.boxName
    ? String(placement.box.boxName)
    : placement?.boxName
      ? String(placement.boxName)
      : placement?.boxId
        ? String(placement.boxId)
        : '';
  const position = placement?.box?.position
    ? String(placement.box.position)
    : placement?.positionCode
      ? String(placement.positionCode)
      : '';
  const path = placement?.path ? String(placement.path) : '';

  if (!boxName && !path && !position) return 'Aguardando Armazenagem';
  if (path) return position ? `${path} / Posição ${position}` : path;
  if (boxName) return position ? `${boxName} / Posição ${position}` : boxName;
  return `Posição ${position}`;
}

export default function SampleWithdrawalReturnPage() {
  const { t } = useLanguage();
  const [searchBarcode, setSearchBarcode] = useState('');
  const [sample, setSample] = useState<Sample | null>(null);
  const [participantInfo, setParticipantInfo] = useState<{ participantId: string; patientName: string } | null>(null);
  const [movements, setMovements] = useState<SampleMovement[]>([]);
  const [currentStoragePlacement, setCurrentStoragePlacement] = useState<CurrentStoragePlacementDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const getQualityLabel = (quality?: string | number) => {
    if (quality === undefined || quality === null || quality === '') return '-';
    const match = MIABIS_QUALITY.find((item) => item.id === String(quality));
    return match?.label || String(quality);
  };

  const getRcsQualityLabel = (currentSample: Sample | null) => {
    if (!currentSample) return '-';
    const rcs = currentSample.rcs_evaluation || currentSample;
    const grade = String(rcs.final_grade || '').trim();
    const score = rcs.rcs_score ?? null;
    if (grade) {
      const route = String(rcs.grade_route || '').trim();
      const reasons = Array.isArray(rcs.governance_failure_reasons)
        ? rcs.governance_failure_reasons.map((reason) => String(reason || '').trim()).filter(Boolean)
        : [];
      const failureDetail = rcs.governance_status === 0 && reasons.length ? `: ${reasons.join('; ')}` : '';
      return `Grade ${grade}${score !== null && score !== undefined ? ` | RCS ${score}` : ''}${route ? ` | ${route}${failureDetail}` : ''}`;
    }
    return getQualityLabel(currentSample.quality);
  };

  const [activeTab, setActiveTab] = useState<'withdraw' | 'return'>('withdraw');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<'withdraw' | 'return' | null>(null);

  const [withdrawForm, setWithdrawForm] = useState<WithdrawalFormData>({
    withdrawalType: '',
    withdrawalQuantity: '',
    withdrawalResponsible: '',
    sampleDestination: '',
    purpose: '',
    linkedProject: '',
    observations: ''
  });

  const [returnForm, setReturnForm] = useState<ReturnFormData>({
    returnType: '',
    returnQuantity: '',
    returnResponsible: '',
    condition: '',
    observations: ''
  });

  const handleSearch = async () => {
    if (!searchBarcode.trim()) {
      setMessage({ type: 'error', text: t('samples.barcodeRequired') || 'Código de barras é obrigatório' });
      return;
    }

    setSearchLoading(true);
    setMessage(null);
    setSample(null);
    setParticipantInfo(null);
    setMovements([]);
    setCurrentStoragePlacement(null);

    try {
      const response = await sampleService.getByBarcode(searchBarcode.trim());
      const responseData = response.data as any;
      const result = responseData?.data || responseData;

      if (result?.sample) {
        setSample(result.sample);
        if (result.participant) {
          setParticipantInfo({
            participantId: String(result.participant.participantId),
            patientName: result.participant.patientName
          });
        }
        if (result.sample.linkedProject) {
          setWithdrawForm(prev => ({ ...prev, linkedProject: result.sample.linkedProject || '' }));
        }
        await loadMovements(result.sample.specimenId || '');
        await loadCurrentStoragePlacement(result.sample.specimenId || '');
        setActiveTab(resolveInitialTab(result.sample));
      } else {
        setMessage({ type: 'error', text: t('samples.sampleNotFound') || 'Amostra não encontrada' });
      }
    } catch (error: any) {
      console.error('Erro ao buscar amostra:', error);
      setMessage({ type: 'error', text: error?.response?.data?.error || error?.message || 'Erro ao buscar amostra' });
    } finally {
      setSearchLoading(false);
    }
  };

  const loadMovements = async (specimenId: string) => {
    try {
      const response = await sampleService.getMovements(specimenId);
      if (response.data?.data) setMovements(response.data.data);
    } catch (error) {
      console.error('Erro ao carregar movimentações:', error);
    }
  };

  const loadCurrentStoragePlacement = async (specimenId: string) => {
    const response = await storageApi.getCurrentStoragePlacement(specimenId);
    setCurrentStoragePlacement(response.success && response.data ? response.data : null);
  };

  const validateWithdrawForm = (): string | null => {
    if (!withdrawForm.withdrawalType) return 'Tipo de retirada é obrigatório';
    if (withdrawForm.withdrawalType === 'Parcial') {
      const qty = parseFloat(withdrawForm.withdrawalQuantity);
      if (!qty || qty <= 0) return 'Quantidade é obrigatória para retirada parcial';
      const available = sample?.currentQuantity ?? sample?.quantity ?? 0;
      if (qty > available) return `Quantidade indisponível. Disponível: ${available} ${sample?.unit || 'µL'}`;
    }
    if (!withdrawForm.withdrawalResponsible || withdrawForm.withdrawalResponsible.trim().split(' ').length < 2) {
      return 'Nome do responsável deve conter nome e sobrenome';
    }
    if (!withdrawForm.sampleDestination?.trim()) return 'Destino da amostra é obrigatório';
    if (!withdrawForm.linkedProject?.trim()) return 'Projeto vinculado é obrigatório';
    return null;
  };

  const validateReturnForm = (): string | null => {
    const pendingQty = getPendingReturnQuantity(sample);
    if (pendingQty <= 0) return 'Não há quantidade pendente de devolução';
    if (!returnForm.returnType) return 'Tipo de devolução é obrigatório';
    if (returnForm.returnType === 'Parcial') {
      const qty = parseFloat(returnForm.returnQuantity);
      if (!qty || qty <= 0) return 'Quantidade é obrigatória para devolução parcial';
      if (qty > pendingQty) return `Quantidade excede o pendente. Pendente: ${pendingQty} ${sample?.unit || 'µL'}`;
    }
    if (!returnForm.returnResponsible || returnForm.returnResponsible.trim().length < 3) {
      return 'Responsável pela devolução é obrigatório';
    }
    if (!returnForm.condition) return 'Condição da amostra é obrigatória';
    if (returnForm.condition !== 'Íntegra' && !returnForm.observations?.trim()) {
      return 'Observações são obrigatórias quando a condição não é Íntegra';
    }
    return null;
  };

  const handleConfirmAction = (action: 'withdraw' | 'return') => {
    const error = action === 'withdraw' ? validateWithdrawForm() : validateReturnForm();
    if (error) {
      setMessage({ type: 'error', text: error });
      return;
    }
    setPendingAction(action);
    setShowConfirmModal(true);
  };

  const handleWithdraw = async () => {
    if (!sample?.specimenId) return;
    setLoading(true);
    setMessage(null);
    setShowConfirmModal(false);

    try {
      const data = {
        withdrawalType: withdrawForm.withdrawalType as 'Parcial' | 'Total',
        withdrawalQuantity: withdrawForm.withdrawalType === 'Parcial' ? parseFloat(withdrawForm.withdrawalQuantity) : undefined,
        withdrawalResponsible: withdrawForm.withdrawalResponsible,
        sampleDestination: withdrawForm.sampleDestination,
        purpose: withdrawForm.purpose,
        linkedProject: withdrawForm.linkedProject,
        observations: withdrawForm.observations
      };

      const response = await sampleService.withdraw(sample.specimenId, data);
      if (response.data?.success) {
        setMessage({ type: 'success', text: `Retirada registrada com sucesso! Quantidade retirada: ${response.data.data?.withdrawnQuantity || '-'} ${sample.unit || 'µL'}` });
        await handleSearch();
        setWithdrawForm({
          withdrawalType: '',
          withdrawalQuantity: '',
          withdrawalResponsible: '',
          sampleDestination: '',
          purpose: '',
          linkedProject: sample.linkedProject || '',
          observations: ''
        });
      }
    } catch (error: any) {
      console.error('Erro ao registrar retirada:', error);
      setMessage({ type: 'error', text: error?.response?.data?.message || error?.message || 'Erro ao registrar retirada' });
    } finally {
      setLoading(false);
    }
  };

  const handleReturn = async () => {
    if (!sample?._id) return;
    setLoading(true);
    setMessage(null);
    setShowConfirmModal(false);

    try {
      const data = {
        returnType: returnForm.returnType as 'Parcial' | 'Total',
        returnQuantity: returnForm.returnType === 'Parcial' ? parseFloat(returnForm.returnQuantity) : getPendingReturnQuantity(sample),
        returnResponsible: returnForm.returnResponsible,
        condition: returnForm.condition as 'Íntegra' | 'Parcialmente comprometida' | 'Inutilizada',
        observations: returnForm.observations
      };

      const response = await sampleService.return(sample.specimenId, data);
      if (response.data?.success) {
        setMessage({ type: 'success', text: `Devolução registrada com sucesso! Quantidade devolvida: ${response.data.data?.returnedQuantity || '-'} ${sample.unit || 'µL'}` });
        await handleSearch();
        setReturnForm({
          returnType: '',
          returnQuantity: '',
          returnResponsible: '',
          condition: '',
          observations: ''
        });
      }
    } catch (error: any) {
      console.error('Erro ao registrar devolução:', error);
      setMessage({ type: 'error', text: error?.response?.data?.message || error?.message || 'Erro ao registrar devolução' });
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (date: string | Date | undefined): string => {
    if (!date) return '-';
    return new Date(date).toLocaleString('pt-BR');
  };

  const formatMovementType = (type: string): string => {
    switch (type) {
      case 'withdraw': return 'Retirada';
      case 'return': return 'Devolução';
      case 'adjust': return 'Ajuste';
      default: return type;
    }
  };

  return (
    <div className="page withdrawal-return-page">
      <h1>{t('samples.withdrawalReturn') || 'Retirada e Devolução de Amostras'}</h1>
      <p className="page-subtitle">{t('samples.withdrawalReturnSubtitle') || 'Registre retiradas e devoluções de amostras biológicas'}</p>

      {message && <div className={`message message-${message.type}`}>{message.text}</div>}

      <Card className="search-card">
        <div className="search-section">
          <Input
            label={t('samples.barcode') || 'Código de Barras'}
            placeholder="Ex: BR-2026-001"
            value={searchBarcode}
            onChange={(e) => setSearchBarcode(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          />
          <Button onClick={handleSearch} disabled={searchLoading} variant="primary">
            {searchLoading ? 'Buscando...' : (t('common.search') || 'Buscar')}
          </Button>
        </div>
      </Card>

      {sample && (
        <>
          <Card title={t('samples.sampleData') || 'Dados da Amostra'} className="sample-info-card">
            <div className="sample-info-grid">
              <div className="info-section">
                <h4>Identificação</h4>
                <div className="info-row"><span className="info-label">ID da Amostra:</span><span className="info-value">{sample.specimenId || '-'}</span></div>
                <div className="info-row"><span className="info-label">Código de Barras:</span><span className="info-value barcode">{sample.barcode || '-'}</span></div>
                <div className="info-row"><span className="info-label">Tipo:</span><span className="info-value">{sample.sampleType || '-'}</span></div>
                <div className="info-row"><span className="info-label">Projeto:</span><span className="info-value">{sample.linkedProject || '-'}</span></div>
                {participantInfo && (
                  <div className="info-row"><span className="info-label">Participante:</span><span className="info-value">{participantInfo.participantId} - {participantInfo.patientName}</span></div>
                )}
              </div>

              <div className="info-section">
                <h4>Controle Físico</h4>
                <div className="info-row"><span className="info-label">Quantidade Original:</span><span className="info-value">{sample.initialQuantity ?? sample.quantity ?? '-'} {sample.unit || 'µL'}</span></div>
                <div className="info-row highlight"><span className="info-label">Quantidade Disponível:</span><span className="info-value available-qty">{sample.currentQuantity ?? sample.quantity ?? '-'} {sample.unit || 'µL'}</span></div>
                <div className="info-row"><span className="info-label">Total Retirado:</span><span className="info-value">{sample.totalWithdrawn || 0} {sample.unit || 'µL'}</span></div>
                <div className="info-row"><span className="info-label">Pendente Devolução:</span><span className="info-value pending-qty">{getPendingReturnQuantity(sample)} {sample.unit || 'µL'}</span></div>
                <div className="info-row"><span className="info-label">Armazenagem:</span><span className="info-value">{getStorageLabel(currentStoragePlacement)}</span></div>
              </div>

              <div className="info-section">
                <h4>Estado</h4>
                <div className="info-row">
                  <span className="info-label">Status Atual:</span>
                  <span className="info-value status-badge" style={{ color: getSpecimenStatusColor(resolveSpecimenStatus(sample)) }}>
                    {translateSpecimenStatus(resolveSpecimenStatus(sample))}
                  </span>
                </div>
                <div className="info-row"><span className="info-label">Qualidade:</span><span className="info-value">{getRcsQualityLabel(sample)}</span></div>
                {sample.withdrawalDate && <div className="info-row"><span className="info-label">Última Retirada:</span><span className="info-value">{formatDate(sample.withdrawalDate)}</span></div>}
              </div>
            </div>
          </Card>

          <div className="operation-tabs">
            <button className={`tab-button ${activeTab === 'withdraw' ? 'active' : ''}`} onClick={() => setActiveTab('withdraw')} disabled={!canWithdrawSample(sample)}>
              {t('samples.withdraw') || 'Retirar Amostra'}
            </button>
            <button className={`tab-button ${activeTab === 'return' ? 'active' : ''}`} onClick={() => setActiveTab('return')} disabled={getPendingReturnQuantity(sample) <= 0}>
              {t('samples.return') || 'Registrar Devolução'}
            </button>
          </div>

          {activeTab === 'withdraw' && (
            <Card title={t('samples.withdrawForm') || 'Formulário de Retirada'} className="operation-card">
              <div className="form-grid">
                <Select label="Tipo de Retirada *" value={withdrawForm.withdrawalType} onChange={(e) => setWithdrawForm({ ...withdrawForm, withdrawalType: e.target.value as any })} options={[{ value: '', label: 'Selecione...' }, { value: 'Parcial', label: 'Parcial' }, { value: 'Total', label: 'Total' }]} />
                {withdrawForm.withdrawalType === 'Parcial' && (
                  <Input label={`Quantidade a Retirar (${sample.unit || 'µL'}) *`} type="number" step="0.01" min="0.01" max={sample.currentQuantity ?? sample.quantity} value={withdrawForm.withdrawalQuantity} onChange={(e) => setWithdrawForm({ ...withdrawForm, withdrawalQuantity: e.target.value })} helperText={`Disponível: ${sample.currentQuantity ?? sample.quantity} ${sample.unit || 'µL'}`} />
                )}
                <Input label="Responsável pela Retirada *" placeholder="Nome e sobrenome" value={withdrawForm.withdrawalResponsible} onChange={(e) => setWithdrawForm({ ...withdrawForm, withdrawalResponsible: e.target.value })} helperText="Nome completo com nome e sobrenome" />
                <Input label="Destino da Amostra *" placeholder="Ex: Laboratório de Análises" value={withdrawForm.sampleDestination} onChange={(e) => setWithdrawForm({ ...withdrawForm, sampleDestination: e.target.value })} />
                <Input label="Finalidade da Retirada" placeholder="Ex: Análise de DNA" value={withdrawForm.purpose} onChange={(e) => setWithdrawForm({ ...withdrawForm, purpose: e.target.value })} />
                <Input label="Projeto Vinculado *" placeholder="Ex: Projeto XYZ" value={withdrawForm.linkedProject} onChange={(e) => setWithdrawForm({ ...withdrawForm, linkedProject: e.target.value })} />
                <div className="form-full-width"><Input label="Observações" placeholder="Observações adicionais (opcional)" value={withdrawForm.observations} onChange={(e) => setWithdrawForm({ ...withdrawForm, observations: e.target.value })} /></div>
                <div className="form-actions"><Button variant="primary" onClick={() => handleConfirmAction('withdraw')} disabled={loading || !canWithdrawSample(sample)}>{loading ? 'Processando...' : 'Confirmar Retirada'}</Button></div>
              </div>
            </Card>
          )}

          {activeTab === 'return' && (
            <Card title={t('samples.returnForm') || 'Formulário de Devolução'} className="operation-card">
              <div className="form-grid">
                <Select label="Tipo de Devolução *" value={returnForm.returnType} onChange={(e) => setReturnForm({ ...returnForm, returnType: e.target.value as any })} options={[{ value: '', label: 'Selecione...' }, { value: 'Parcial', label: 'Parcial' }, { value: 'Total', label: `Total (${getPendingReturnQuantity(sample)} ${sample.unit || 'µL'})` }]} />
                {returnForm.returnType === 'Parcial' && (
                  <Input label={`Quantidade a Devolver (${sample.unit || 'µL'}) *`} type="number" step="0.01" min="0.01" max={getPendingReturnQuantity(sample)} value={returnForm.returnQuantity} onChange={(e) => setReturnForm({ ...returnForm, returnQuantity: e.target.value })} helperText={`Pendente: ${getPendingReturnQuantity(sample)} ${sample.unit || 'µL'}`} />
                )}
                <Input label="Responsável pela Devolução *" placeholder="Nome do responsável" value={returnForm.returnResponsible} onChange={(e) => setReturnForm({ ...returnForm, returnResponsible: e.target.value })} />
                <Select label="Condição da Amostra *" value={returnForm.condition} onChange={(e) => setReturnForm({ ...returnForm, condition: e.target.value as any })} options={[{ value: '', label: 'Selecione...' }, { value: 'Íntegra', label: 'Íntegra' }, { value: 'Parcialmente comprometida', label: 'Parcialmente comprometida' }, { value: 'Inutilizada', label: 'Inutilizada (não retorna ao estoque)' }]} />
                <div className="form-full-width">
                  <Input label={`Observações ${returnForm.condition && returnForm.condition !== 'Íntegra' ? '*' : ''}`} placeholder={returnForm.condition && returnForm.condition !== 'Íntegra' ? 'Obrigatório: descreva o motivo da condição' : 'Observações adicionais (opcional)'} value={returnForm.observations} onChange={(e) => setReturnForm({ ...returnForm, observations: e.target.value })} />
                </div>
                {returnForm.condition === 'Inutilizada' && <div className="form-full-width warning-box">⚠️ <strong>Atenção:</strong> Amostras marcadas como "Inutilizada" NÃO retornam ao estoque disponível. A quantidade será registrada como perda no histórico.</div>}
                <div className="form-actions"><Button variant="success" onClick={() => handleConfirmAction('return')} disabled={loading || getPendingReturnQuantity(sample) <= 0}>{loading ? 'Processando...' : 'Confirmar Devolução'}</Button></div>
              </div>
            </Card>
          )}

          <Card title={t('samples.movementHistory') || 'Histórico de Movimentações'} className="history-card">
            {movements.length > 0 ? (
              <div className="table-wrapper">
                <table className="movements-table">
                  <thead><tr><th>Data/Hora</th><th>Tipo</th><th>Quantidade</th><th>Responsável</th><th>Destino/Condição</th><th>Saldo Anterior</th><th>Novo Saldo</th><th>Observações</th></tr></thead>
                  <tbody>
                    {movements.map((m, idx) => (
                      <tr key={m.movementID || idx} className={`movement-row movement-${m.type}`}>
                        <td>{formatDate(m.timestamp)}</td>
                        <td><span className={`movement-type-badge ${m.type}`}>{formatMovementType(m.type)}</span></td>
                        <td>{m.quantity !== undefined && m.quantity !== null ? `${m.quantity} ${m.unit || 'µL'}` : '-'}</td>
                        <td>{m.responsible || m.userName || '-'}</td>
                        <td>{m.type === 'withdraw' ? (m.destination || m.purpose || '-') : (m.condition || '-')}</td>
                        <td>{m.previousQuantity !== undefined && m.previousQuantity !== null ? `${m.previousQuantity} ${m.unit || 'µL'}` : '-'}</td>
                        <td>{m.newQuantity !== undefined && m.newQuantity !== null ? `${m.newQuantity} ${m.unit || 'µL'}` : '-'}</td>
                        <td className="observations-cell">{m.observations || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="no-movements">{t('samples.noMovements') || 'Nenhuma movimentação registrada'}</p>}
          </Card>
        </>
      )}

      {showConfirmModal && (
        <div className="modal-overlay">
          <div className="confirm-modal">
            <h3>Confirmar {pendingAction === 'withdraw' ? 'Retirada' : 'Devolução'}</h3>
            <p>
              {pendingAction === 'withdraw'
                ? `Você está prestes a registrar uma retirada ${withdrawForm.withdrawalType.toLowerCase()} da amostra ${sample?.barcode}.`
                : `Você está prestes a registrar uma devolução ${returnForm.returnType.toLowerCase()} da amostra ${sample?.barcode}.`}
            </p>
            {pendingAction === 'withdraw' && (
              <div className="confirm-details">
                <p><strong>Quantidade:</strong> {withdrawForm.withdrawalType === 'Total' ? (sample?.currentQuantity ?? sample?.quantity) : withdrawForm.withdrawalQuantity} {sample?.unit || 'µL'}</p>
                <p><strong>Responsável:</strong> {withdrawForm.withdrawalResponsible}</p>
                <p><strong>Destino:</strong> {withdrawForm.sampleDestination}</p>
              </div>
            )}
            {pendingAction === 'return' && (
              <div className="confirm-details">
                <p><strong>Quantidade:</strong> {returnForm.returnType === 'Total' ? getPendingReturnQuantity(sample) : returnForm.returnQuantity} {sample?.unit || 'µL'}</p>
                <p><strong>Responsável:</strong> {returnForm.returnResponsible}</p>
                <p><strong>Condição:</strong> {returnForm.condition}</p>
                {returnForm.condition === 'Inutilizada' && <p className="warning-text">⚠️ Esta quantidade NÃO retornará ao estoque!</p>}
              </div>
            )}
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setShowConfirmModal(false)}>Cancelar</Button>
              <Button variant={pendingAction === 'withdraw' ? 'primary' : 'success'} onClick={pendingAction === 'withdraw' ? handleWithdraw : handleReturn}>Confirmar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
