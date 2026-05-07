import { Fragment, useState } from 'react';
import { Edit3, Package, Printer, QrCode, Search } from 'lucide-react';
import Barcode from 'react-barcode';
import Button from '../UI/Button';
import Card from '../UI/Card';
import Input from '../UI/Input';
import Modal from '../UI/Modal';
import Table from '../UI/Table';
import SampleStatusBadge from '../SampleStatusBadge';
import InlineStorageMovementPanel from './InlineStorageMovementPanel';
import type { Sample } from '../../types/models';
import type { SampleWithId } from '../../hooks/samples/useSamplesPage';

type TranslatorFn = (key: string) => string;

interface SamplesPageViewProps {
  t: TranslatorFn;
  language: 'pt-BR' | 'en-US' | 'es-ES';
  loading: boolean;
  error: string | null;
  search: string;
  selectedSampleIds: string[];
  filteredSamples: SampleWithId[];
  selectedSamples: SampleWithId[];
  allSelected: boolean;
  canEdit: boolean;
  printModalOpen: boolean;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  onToggleSelectAll: () => void;
  onToggleSelect: (sample: SampleWithId) => void;
  onBatchDelete: () => Promise<void>;
  onOpenPrintModal: () => void;
  onClosePrintModal: () => void;
  onPrint: () => void;
  onEditSample: (sampleId: string) => void;
  onOpenStorage: (sample: SampleWithId) => void;
  expandedStorageSample: SampleWithId | null;
  onCloseExpandedStorage: () => void;
  onStorageCompleted: () => void;
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

function getStorageLabel(sample: SampleWithId) {
  const storageLocation = (sample as any).storageLocation;
  const freezerName = storageLocation?.freezerName ? String(storageLocation.freezerName) : '';
  const shelfName = storageLocation?.shelfName ? String(storageLocation.shelfName) : '';
  const rackName = storageLocation?.rackName ? String(storageLocation.rackName) : '';
  const boxName = storageLocation?.boxName ? String(storageLocation.boxName) : '';
  const position = storageLocation?.position ? String(storageLocation.position) : '';
  const path = storageLocation?.path ? String(storageLocation.path) : '';

  const hierarchy = [freezerName, shelfName, rackName, boxName].filter(Boolean).join(' > ');

  if (!hierarchy && !position) {
    return 'Aguardando Armazenagem';
  }

  if (path) {
    return position ? `${path} / Posição ${position}` : path;
  }

  if (hierarchy) {
    return position ? `${hierarchy} / Posição ${position}` : hierarchy;
  }

  if (position) {
    return `Posição ${position}`;
  }

  return 'Caixa definida';
}

export default function SamplesPageView({
  t,
  language,
  loading,
  error,
  search,
  selectedSampleIds,
  filteredSamples,
  selectedSamples,
  allSelected,
  canEdit,
  printModalOpen,
  onSearchChange,
  onSearchSubmit,
  onToggleSelectAll,
  onToggleSelect,
  onBatchDelete,
  onOpenPrintModal,
  onClosePrintModal,
  onPrint,
  onEditSample,
  onOpenStorage,
  expandedStorageSample,
  onCloseExpandedStorage,
  onStorageCompleted,
}: SamplesPageViewProps) {
  const [scanMode, setScanMode] = useState(false);
  const hasSearch = search.trim().length > 0;

  return (
    <div className="page samples-page" data-testid="sample-list-root">
      <div className="page-header">
        <h1 data-testid="samples-page-title">{t('samples.title')}</h1>
      </div>

      <Card style={{ marginBottom: '1rem' }}>
        <div className="samples-toolbar">
          <div className="samples-search-panel">
            <Input
              label={t('samples.searchLabel')}
              placeholder={scanMode ? 'Escaneie barcode/QR code e pressione pesquisar' : t('samples.searchPlaceholder')}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              data-testid="samples-search-input"
            />
            <p className="samples-search-hint">
              {scanMode
                ? 'Modo leitura ativo: use o leitor de barcode ou QR code e depois pressione Pesquisar.'
                : t('samples.searchHint')}
            </p>
            <div className="samples-search-actions">
              <button type="button" className="samples-search-button" onClick={onSearchSubmit} data-testid="samples-search-button">
                <Search size={15} />
                Pesquisar
              </button>
              <button
                type="button"
                className={`samples-search-button samples-search-button--scan ${scanMode ? 'active' : ''}`}
                onClick={() => setScanMode((current) => !current)}
                data-testid="samples-scan-button"
              >
                <QrCode size={15} />
                {scanMode ? 'Leitura ativa' : 'Barcode/QR'}
              </button>
            </div>
          </div>
          {selectedSampleIds.length > 0 && (
            <div className="toolbar batch">
              <span>
                {selectedSampleIds.length} {t('samples.selectedItems')}
              </span>
              <Button variant="danger" onClick={onBatchDelete} data-testid="samples-batch-delete">
                {t('samples.delete')}
              </Button>
            </div>
          )}
          <div className="toolbar info">
            <strong>
              {filteredSamples.length} {filteredSamples.length === 1 ? 'amostra exibida' : 'amostras exibidas'}
            </strong>
            <p>
              {hasSearch
                ? `Resultado da pesquisa para "${search.trim()}".`
                : 'Lista completa de amostras carregadas no inventário.'}
            </p>
          </div>
        </div>

        <Table>
          <thead>
            <tr>
              <th className="center" style={{ width: 48 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleSelectAll}
                  aria-label={t('samples.selectAllAria')}
                  data-testid="samples-select-all-checkbox"
                />
              </th>
              <th>{t('samples.tableHeaders.type')}</th>
              <th>{t('samples.tableHeaders.origin')}</th>
              <th>{t('samples.tableHeaders.barcode')}</th>
              <th>{t('samples.tableHeaders.status')}</th>
              <th>TCLE</th>
              <th>{t('samples.volume')}</th>
              <th>{t('samples.patientIdColumn')}</th>
              <th>Armazenagem</th>
              <th>{t('samples.tableHeaders.actions')}</th>
            </tr>
          </thead>
          <tbody data-testid="samples-table">
            {loading ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: '1.5rem' }}>
                  {t('common.loading')}
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--danger)' }}>
                  {error}
                </td>
              </tr>
            ) : filteredSamples.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: '1.5rem' }}>
                  <div className="samples-empty-state">
                    <Search size={34} />
                    <strong>{hasSearch ? 'Nenhuma amostra encontrada' : 'Nenhuma amostra carregada'}</strong>
                    <p>
                      {hasSearch
                        ? 'Tente outro código de barras, ID ou nome de paciente.'
                        : 'Verifique a conexão com a API ou recarregue a listagem para exibir os registros.'}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredSamples.map((sample) => {
                const { initial, current } = computeVolume(sample);
                const patientId = sample.patientID ?? (sample as any).patient?.patientID;
                const isExpanded = expandedStorageSample?.id === sample.id;

                return (
                  <Fragment key={sample.id}>
                    <tr className={isExpanded ? 'samples-row--expanded' : ''} data-testid={`sample-row-${sample.id}`}>
                      <td className="center">
                        <input
                          type="checkbox"
                          checked={selectedSampleIds.includes(sample.id)}
                          onChange={() => onToggleSelect(sample)}
                          aria-label={t('samples.selectOneAria')}
                          data-testid={`sample-checkbox-${sample.id}`}
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
                          <span className="consent-badge pending" title={sample.consentMessage || t('samples.consent.pendingTitle')}>
                            ⚠️ {t('samples.consent.pending')}
                          </span>
                        ) : sample.consentValid ? (
                          <span className="consent-badge approved" title={sample.consentMessage || t('samples.consent.signedTitle')}>
                            ✓ {t('samples.consent.signed')}
                          </span>
                        ) : (
                          <span className="consent-badge unknown" title={t('samples.consent.unknownStatus')}>
                            ? {t('samples.consent.check')}
                          </span>
                        )}
                      </td>
                      <td>
                        <strong>
                          {current.toLocaleString(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} /{' '}
                          {initial.toLocaleString(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                        </strong>
                      </td>
                      <td>{patientId ?? 'N/A'}</td>
                      <td style={{ fontSize: '0.92rem' }}>{getStorageLabel(sample)}</td>
                      <td>
                        <div className="samples-row-actions">
                          <Button
                            variant="secondary"
                            className="samples-row-action samples-row-action--storage"
                            disabled={sample.canUse === false}
                            onClick={() => onOpenStorage(sample)}
                            data-testid={`sample-storage-button-${sample.id}`}
                            title={sample.canUse === false ? t('samples.editTooltip.consentPending') : t('samples.physicalStorageAction')}
                          >
                            <Package size={15} />
                            {isExpanded ? t('common.close') : t('samples.storageInline.action')}
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={!canEdit || sample.canUse === false}
                            onClick={() => onEditSample(sample.id)}
                            data-testid={`sample-edit-button-${sample.id}`}
                            title={
                              !canEdit
                                ? t('samples.editTooltip.noPermission')
                                : sample.canUse === false
                                  ? t('samples.editTooltip.consentPending')
                                  : t('samples.editTooltip.edit')
                            }
                            style={{ padding: '0.35rem 0.65rem' }}
                          >
                            <Edit3 size={15} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="samples-inline-row">
                        <td colSpan={10}>
                          <div className="samples-inline-row__body">
                            <InlineStorageMovementPanel
                              sample={sample}
                              t={t}
                              onCancel={onCloseExpandedStorage}
                              onCompleted={onStorageCompleted}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </Table>
      </Card>

      {printModalOpen && (
        <Modal isOpen title={t('samples.printLabels')} onClose={onClosePrintModal}>
          <div id="printable-area">
            {selectedSamples.map((sample) => {
              const barcodeValue = sample.barcode || sample.sampleID || sample.id;
              const patientId = sample.patientID ?? (sample as any).patient?.patientID;

              return (
                <div key={sample.id} className="qr-label">
                  <div className="qr-label__title">{sample.sampleType || t('samples.sampleFallback')}</div>
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
              {t('common.close')}
            </Button>
            <Button onClick={onPrint}>
              <Printer size={16} />
              {t('common.print')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
