/* eslint-disable no-inline-styles */
import { Check, Download, Edit3, Plus, Printer, Trash2, Upload } from 'lucide-react';
import Barcode from 'react-barcode';
import Card from '../UI/Card';
import Button from '../UI/Button';
import Input from '../UI/Input';
import Modal from '../UI/Modal';
import Table from '../UI/Table';
import SampleStatusBadge from '../SampleStatusBadge';
import { Sample } from '../../types/models';
import { SampleWithId } from '../../hooks/samples/useSamplesPage';
import { TemplateFormat } from '../../services/samples/samplesApi';
import '../../views/SamplesPage.css';

type TranslatorFn = (key: string) => string;

interface SamplesPageViewProps {
  t: TranslatorFn;
  loading: boolean;
  error: string | null;
  search: string;
  selectedSampleIds: string[];
  filteredSamples: SampleWithId[];
  selectedSamples: SampleWithId[];
  allSelected: boolean;
  canEdit: boolean;
  printModalOpen: boolean;
  isImporting: boolean;
  importProgress?: number;
  importCompleted: boolean;
  importError: string | null;
  onSearchChange: (value: string) => void;
  onToggleSelectAll: () => void;
  onToggleSelect: (sample: SampleWithId) => void;
  onBatchDelete: () => Promise<void>;
  onOpenPrintModal: () => void;
  onClosePrintModal: () => void;
  onPrint: () => void;
  onNewSample: () => void;
  onImport: () => void;
  onDownloadTemplate: (format: TemplateFormat) => void;
  onEditSample: (sampleId: string) => void;
}

function mapStatus(sample: Sample): Sample['status'] {
  const status = sample.status || sample.currentStatus?.toString().toUpperCase();
  if (status === 'AVAILABLE' || status === 'PARTIAL' || status === 'DEPLETED' || status === 'UNAVAILABLE') {
    return status as Sample['status'];
  }
  return 'AVAILABLE';
}

function computeVolume(sample: Sample) {
  const initial = sample.volumeInitial ?? sample.originalQuantity ?? sample.quantity ?? 0;
  const current = sample.volumeCurrent ?? sample.availableQuantity ?? sample.quantity ?? 0;
  return { initial, current };
}

export default function SamplesPageView({
  t,
  loading,
  error,
  search,
  selectedSampleIds,
  filteredSamples,
  selectedSamples,
  allSelected,
  canEdit,
  printModalOpen,
  isImporting,
  importProgress,
  importCompleted,
  importError,
  onSearchChange,
  onToggleSelectAll,
  onToggleSelect,
  onBatchDelete,
  onOpenPrintModal,
  onClosePrintModal,
  onPrint,
  onNewSample,
  onImport,
  onDownloadTemplate,
  onEditSample,
}: SamplesPageViewProps) {
  return (
    <div className="page">
      <div className="page-header">
        <h1>{t('samples.title') || 'Amostras'}</h1>
        {isImporting && (
          <div className="import-banner">
            <div className="spinner" />
            <div>
              <strong>Importando amostras</strong>
              <div style={{ fontSize: '0.85rem' }}>{importProgress ? `${importProgress}%` : 'Processando...'}</div>
            </div>
          </div>
        )}
        {importCompleted && (
          <div className="import-banner success">
            <Check size={16} />
            <span>Importação concluída</span>
          </div>
        )}
        {importError && <div className="import-error">Erro na importação: {importError}</div>}
      </div>

      <Card style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '220px' }}>
            <Input
              label="Pesquisar"
              placeholder="Código, tipo ou paciente"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
          {selectedSampleIds.length === 0 ? (
            <div className="toolbar" style={{ width: '100%', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <Button onClick={onNewSample}>
                  <Plus size={16} />
                  {t('samples.new') || 'Nova Amostra'}
                </Button>
                <Button variant="secondary" onClick={onImport}>
                  <Upload size={16} />
                  {t('import.samples.import') || 'Importar'}
                </Button>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginLeft: 'auto' }}>
                <Button variant="secondary" onClick={() => onDownloadTemplate('xlsx')}>
                  <Download size={16} />
                  Baixar Template Excel
                </Button>
                <Button variant="secondary" onClick={() => onDownloadTemplate('csv')}>
                  <Download size={16} />
                  Baixar Template CSV
                </Button>
              </div>
            </div>
          ) : (
            <div className="toolbar batch">
              <span>{selectedSampleIds.length} itens selecionados</span>
              <Button variant="danger" onClick={onBatchDelete}>
                <Trash2 size={16} />
                Excluir
              </Button>
              <Button onClick={onOpenPrintModal}>
                <Printer size={16} />
                Imprimir Etiquetas
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <Table>
          <thead>
            <tr>
              <th className="center" style={{ width: 48 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleSelectAll}
                  aria-label="Selecionar todas as amostras"
                />
              </th>
              <th>Tipo</th>
              <th>Origem</th>
              <th>Código</th>
              <th>Status</th>
              <th>TCLE</th>
              <th>Volume</th>
              <th>Paciente (ID)</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '1.5rem' }}>
                  {t('common.loading') || 'Carregando...'}
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--danger)' }}>
                  {error}
                </td>
              </tr>
            ) : filteredSamples.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '1.5rem' }}>
                  Nenhuma amostra encontrada.
                </td>
              </tr>
            ) : (
              filteredSamples.map((sample) => {
                const { initial, current } = computeVolume(sample);
                const patientId = sample.patientID ?? (sample as any).patient?.patientID;
                return (
                  <tr key={sample.id}>
                    <td className="center">
                      <input
                        type="checkbox"
                        checked={selectedSampleIds.includes(sample.id)}
                        onChange={() => onToggleSelect(sample)}
                        aria-label="Selecionar amostra"
                      />
                    </td>
                    <td>{sample.sampleType || 'N/A'}</td>
                    <td>{sample.sampleOrigin || 'N/A'}</td>
                    <td style={{ fontFamily: 'monospace' }}>{sample.barcode || sample.sampleID || 'N/A'}</td>
                    <td>
                      <SampleStatusBadge status={mapStatus(sample) as any} />
                    </td>
                    <td>
                      {sample.canUse === false ? (
                        <span className="consent-badge pending" title={sample.consentMessage || 'TCLE Pendente'}>
                          ⚠️ Pendente
                        </span>
                      ) : sample.consentValid ? (
                        <span className="consent-badge approved" title={sample.consentMessage || 'TCLE Assinado'}>
                          ✓ Assinado
                        </span>
                      ) : (
                        <span className="consent-badge unknown" title="Status desconhecido">
                          ? Verificar
                        </span>
                      )}
                    </td>
                    <td>
                      <strong>
                        {current.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} /{' '}
                        {initial.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                      </strong>
                    </td>
                    <td>{patientId ?? 'N/A'}</td>
                    <td>
                      <Button
                        variant="secondary"
                        disabled={!canEdit || sample.canUse === false}
                        onClick={() => onEditSample(sample.id)}
                        title={
                          !canEdit
                            ? 'Apenas administradores e coordenadores podem editar'
                            : sample.canUse === false
                              ? 'Amostra bloqueada: TCLE pendente'
                              : 'Editar amostra'
                        }
                        style={{ padding: '0.35rem 0.65rem' }}
                      >
                        <Edit3 size={15} />
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Table>
      </Card>

      {printModalOpen && (
        <Modal isOpen title="Imprimir Etiquetas" onClose={onClosePrintModal}>
          <div id="printable-area">
            {selectedSamples.map((sample) => {
              const barcodeValue = sample.barcode || sample.sampleID || sample.id;
              const patientId = sample.patientID ?? (sample as any).patient?.patientID;
              return (
                <div key={sample.id} className="qr-label">
                  <div className="qr-label__title">{sample.sampleType || 'Amostra'}</div>
                  <div className="qr-label__code">{barcodeValue || 'N/A'}</div>
                  {barcodeValue && (
                    <div className="qr-label__barcode">
                      <Barcode value={String(barcodeValue)} height={42} width={1.4} displayValue={false} margin={0} />
                    </div>
                  )}
                  <div className="qr-label__patient">{patientId ?? 'N/A'}</div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <Button variant="secondary" onClick={onClosePrintModal}>
              Fechar
            </Button>
            <Button onClick={onPrint}>
              <Printer size={16} />
              Imprimir
            </Button>
          </div>
        </Modal>
      )}

      <style>
        {`
          #printable-area {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 12px;
            padding: 4px;
          }
          .qr-label {
            border: 1px dashed #d1d5db;
            border-radius: 8px;
            padding: 10px;
            background: #fff;
          }
          .qr-label__title { font-weight: 700; margin-bottom: 6px; }
          .qr-label__code { font-family: monospace; color: #0f172a; margin-bottom: 4px; }
          .qr-label__patient { font-size: 0.85rem; color: #475569; }
          .toolbar { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
          .toolbar.batch { background: #f8fafc; padding: 0.5rem 0.75rem; border-radius: 8px; }
          .center { text-align: center; }
          .import-banner { display: inline-flex; gap: 0.75rem; align-items: center; background: #e0f2fe; padding: 0.5rem 0.75rem; border-radius: 8px; }
          .import-banner.success { background: #e7f6ed; color: #166534; }
          .import-error { margin-top: 0.5rem; color: #b91c1c; font-size: 0.9rem; }
          .spinner { width: 12px; height: 12px; border: 2px solid #0284c7; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite; }
          @keyframes spin { to { transform: rotate(360deg); } }
          @media print {
            body * { visibility: hidden; }
            #printable-area, #printable-area * { visibility: visible; }
            #printable-area { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
            .modal-overlay, .modal-content, .modal-body, .modal-header, .modal-title, .modal-close { all: unset; }
          }
        `}
      </style>
    </div>
  );
}
