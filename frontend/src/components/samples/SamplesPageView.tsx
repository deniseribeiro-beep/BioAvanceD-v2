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
import { getStorageLabel, buildSprecSummary } from './sampleListFormatters';
import InventoryBoxGrid from './InventoryBoxGrid';
import { resolveSampleLifecycleStatus } from '../../foundation/contracts';
import { BLOCKED_SPECIMEN_STATUSES, resolveSpecimenStatus } from '../../utils/sampleHelpers';

type TranslatorFn = (key: string, fallback?: string) => string;

interface SamplesPageViewProps {
  t: TranslatorFn;
  language: 'pt-BR' | 'en-US' | 'es-ES';
  loading: boolean;
  error: string | null;
  search: string;
  selectedSampleIds: string[];
  filteredSamples: SampleWithId[];
  pagedSamples: SampleWithId[];
  selectedSamples: SampleWithId[];
  allSelected: boolean;
  canEdit: boolean;
  printModalOpen: boolean;
  currentPage: number;
  totalPages: number;
  pageSize: number;
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
  onResendConsent: (sample: SampleWithId) => void;
  onAttachExternalDocument: (sample: SampleWithId) => void;
  onViewPending: (sample: SampleWithId) => void;
  onPageChange: (page: number) => void;
}

// The list row's status badge. #532: specimenStatus is the canonical,
// always-populated signal (see models.ts's own comment on the field).
// RF006 AC2/AC3: specimenStatus gives the operational state (closed, or
// blocked as quarantine), and quantityStatus gives PARTIAL/DEPLETED; the
// retired currentStatus/status fields are not read.
export function mapStatus(sample: Sample): Sample['status'] {
  const specimenStatus = resolveSpecimenStatus(sample);
  const consentStatus = String((sample as any).consentStatus || '').toUpperCase();
  if (specimenStatus === 'closed') return 'CLOSED';
  if (BLOCKED_SPECIMEN_STATUSES.includes(specimenStatus) || consentStatus === 'PENDING') {
    return 'QUARANTINED';
  }
  return resolveSampleLifecycleStatus(sample) as Sample['status'];
}

function computeVolume(sample: Sample) {
  const legacy = sample as Sample & { volumeInitial?: number | null; volumeCurrent?: number | null };
  const initialRaw = sample.initialQuantity ?? legacy.volumeInitial ?? sample.quantity;
  const currentRaw = sample.currentQuantity ?? legacy.volumeCurrent ?? sample.quantity;
  // #1436: keep null when nothing was recorded; do not coerce to 0.
  return {
    initial: initialRaw == null ? null : Number(initialRaw),
    current: currentRaw == null ? null : Number(currentRaw),
  };
}

export default function SamplesPageView({
  t,
  language,
  loading,
  error,
  search,
  selectedSampleIds,
  filteredSamples,
  pagedSamples,
  selectedSamples,
  allSelected,
  canEdit,
  printModalOpen,
  currentPage,
  totalPages,
  pageSize,
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
  onResendConsent,
  onAttachExternalDocument,
  onViewPending,
  onPageChange,
}: SamplesPageViewProps) {
  const [scanMode, setScanMode] = useState(false);
  const hasSearch = search.trim().length > 0;
  const pageStart = filteredSamples.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, filteredSamples.length);

  return (
    <div className="page-shell samples-page" data-testid="sample-list-root">
      <div className="page-header">
        <h1 data-testid="samples-page-title">{t('samples.title')}</h1>
      </div>

      <Card style={{ marginBottom: '1rem' }}>
        <div className="samples-toolbar">
          <div className="samples-search-panel">
            <Input
              label={t('samples.searchLabel')}
              placeholder={scanMode ? t('samples.searchScanPlaceholder', 'Escaneie barcode/QR code e pressione pesquisar') : t('samples.searchPlaceholder')}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              data-testid="samples-search-input"
            />
            <p className="samples-search-hint">
              {scanMode
                ? t('samples.searchScanHint', 'Modo leitura ativo: use o leitor de barcode ou QR code e depois pressione Pesquisar.')
                : t('samples.searchHint')}
            </p>
            <div className="samples-search-actions">
              <button type="button" className="samples-search-button" onClick={onSearchSubmit} data-testid="samples-search-button">
                <Search size={15} />
                {t('samples.searchButton', 'Pesquisar')}
              </button>
              <button
                type="button"
                className={`samples-search-button samples-search-button--scan ${scanMode ? 'active' : ''}`}
                onClick={() => setScanMode((current) => !current)}
                data-testid="samples-scan-button"
              >
                <QrCode size={15} />
                {scanMode ? t('samples.scanModeOn', 'Leitura ativa') : t('samples.scanModeOff', 'Barcode/QR')}
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
            <strong data-testid="samples-page-summary">
              {filteredSamples.length === 0
                ? t('samples.displayedNone', 'Nenhuma amostra exibida')
                : t('samples.displayedRange', 'Mostrando {start}–{end} de {total}')
                    .replace('{start}', String(pageStart))
                    .replace('{end}', String(pageEnd))
                    .replace('{total}', String(filteredSamples.length))}
            </strong>
            <p>
              {hasSearch
                ? t('samples.searchResultPrefix', 'Resultado da pesquisa para "{query}".').replace('{query}', search.trim())
                : t('samples.inventoryDescription', 'Lista completa de amostras carregadas no inventário.')}
            </p>
          </div>
        </div>

        <InventoryBoxGrid samples={filteredSamples} t={t} />

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
              <th>{t('samples.tableHeaders.consent', 'TCLE')}</th>
              <th>{t('samples.volume')}</th>
              <th>{t('samples.participantIdColumn')}</th>
              <th>{t('samples.tableHeaders.storage', 'Armazenagem')}</th>
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
                {/* RNF027 C2 (#1324): --danger on white is 3.8:1; this is 8.3:1. */}
                <td colSpan={10} style={{ textAlign: 'center', padding: '1.5rem', color: '#991b1b' }}>
                  {error}
                </td>
              </tr>
            ) : filteredSamples.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: '1.5rem' }}>
                  <div className="samples-empty-state">
                    <Search size={34} />
                    <strong>{hasSearch ? t('samples.empty.search', 'Nenhuma amostra encontrada') : t('samples.empty.loaded', 'Nenhuma amostra carregada')}</strong>
                    <p>
                      {hasSearch
                        ? t('samples.empty.searchHint', 'Tente outro código de barras, ID ou nome de paciente.')
                        : t('samples.empty.loadedHint', 'Verifique a conexão com a API ou recarregue a listagem para exibir os registros.')}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              pagedSamples.map((sample) => {
                const { initial, current } = computeVolume(sample);
                const participantId = sample.participantId ?? (sample as any).patient?.participantId;
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
                      <td>
                        <div>{sample.sampleType || 'N/A'}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginTop: '0.2rem' }}>
                          {buildSprecSummary(sample, t)}
                        </div>
                      </td>
                      <td>{sample.sampleOrigin || 'N/A'}</td>
                      <td style={{ fontFamily: 'monospace' }}>
                        <div>{sample.specimenId || 'N/A'}</div>
                        {sample.barcode && String(sample.barcode) !== String(sample.specimenId || '') ? (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginTop: '0.2rem' }}>
                            {sample.barcode}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <SampleStatusBadge status={mapStatus(sample) as any} />
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                          {renderSampleBadges(sample, t)}
                        </div>
                      </td>
                      <td>
                        <strong>
                          {current == null
                            ? '—'
                            : current.toLocaleString(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                          {' / '}
                          {initial == null
                            ? '—'
                            : initial.toLocaleString(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                        </strong>
                      </td>
                      <td>{participantId ?? 'N/A'}</td>
                      <td style={{ fontSize: '0.92rem' }}>{getStorageLabel(sample, t)}</td>
                      <td>
                        <div className="table-actions samples-row-actions">
                          {isQuarantined(sample) && (
                            <>
                              <Button
                                variant="secondary"
                                className="samples-row-action"
                                onClick={() => onResendConsent(sample)}
                                data-testid={`sample-resend-consent-button-${sample.id}`}
                                title={sample.consentMessage || t('samples.consent.pendingTitle')}
                              >
                                {t('samples.actions.resendConsent', 'Enviar/Reenviar TCLE')}
                              </Button>
                              <Button
                                variant="secondary"
                                className="samples-row-action"
                                disabled={!canEdit}
                                onClick={() => onAttachExternalDocument(sample)}
                                data-testid={`sample-attach-external-button-${sample.id}`}
                                title={canEdit ? t('samples.actions.attachExternalDocumentTitle', 'Anexar documentação externa e liberar amostra') : t('samples.editTooltip.noPermission')}
                              >
                                {t('samples.actions.attachExternalDocument', 'Anexar documento externo')}
                              </Button>
                              <Button
                                variant="secondary"
                                className="samples-row-action"
                                onClick={() => onViewPending(sample)}
                                data-testid={`sample-view-pending-button-${sample.id}`}
                              >
                                {t('samples.actions.viewPending', 'Visualizar pendência')}
                              </Button>
                            </>
                          )}
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

        {!loading && !error && filteredSamples.length > 0 && (
          <div className="samples-pagination" data-testid="samples-pagination">
            <div className="samples-pagination__summary" data-testid="samples-pagination-summary">
              {t('samples.displayedRange', 'Mostrando {start}–{end} de {total}')
                .replace('{start}', String(pageStart))
                .replace('{end}', String(pageEnd))
                .replace('{total}', String(filteredSamples.length))}
            </div>
            <div className="samples-pagination__controls">
              <Button
                variant="secondary"
                onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                data-testid="samples-pagination-prev"
              >
                {t('common.previous', 'Anterior')}
              </Button>
              <span className="samples-pagination__page" data-testid="samples-pagination-page">
                {t('common.page', 'Página')} {currentPage} {t('common.of', 'de')} {totalPages}
              </span>
              <Button
                variant="secondary"
                onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                data-testid="samples-pagination-next"
              >
                {t('common.next', 'Próxima')}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {printModalOpen && (
        <Modal isOpen title={t('samples.printLabels')} onClose={onClosePrintModal}>
          <div id="printable-area">
            {selectedSamples.map((sample) => {
              const barcodeValue = sample.barcode || sample.specimenId || sample.id;
              const participantId = sample.participantId ?? (sample as any).patient?.participantId;

              return (
                <div key={sample.id} className="qr-label">
                  <div className="qr-label__title">{sample.sampleType || t('samples.sampleFallback')}</div>
                  <div className="qr-label__code">{barcodeValue || 'N/A'}</div>
                  {barcodeValue && (
                    <div className="qr-label__barcode">
                      <Barcode value={String(barcodeValue)} height={42} width={1.4} displayValue={false} margin={0} />
                    </div>
                  )}
                  <div className="qr-label__patient">{participantId ?? 'N/A'}</div>
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

// The consent/document actions apply to a blocked specimen that can still be
// released; a closed one is final (RF026 AC7), so it offers none.
export function isQuarantined(sample: SampleWithId) {
  const specimenStatus = resolveSpecimenStatus(sample);
  if (specimenStatus === 'closed') return false;
  return BLOCKED_SPECIMEN_STATUSES.includes(specimenStatus) || sample.canUse === false;
}

export function renderSampleBadges(sample: SampleWithId, t: TranslatorFn) {
  const specimenStatus = (sample as any).specimenStatus ? resolveSpecimenStatus(sample) : '';
  const consentStatus = String((sample as any).consentStatus || '').toUpperCase();
  // No specimenStatus equivalent carries the human-readable reason text —
  // quarantineReason stays legacy-sourced per #407's scope (dual-written, still correct).
  const quarantineReason = String((sample as any).quarantineReason || '').toUpperCase();

  const badges: Array<{ label: string; className: string; title: string }> = [];

  if (specimenStatus === 'closed') {
    badges.push({ label: t('samples.badges.closed', 'Encerrada'), className: 'unknown', title: t('samples.badges.closedTitle', 'Amostra encerrada: consumo total validado ou descarte executado') });
  } else if (BLOCKED_SPECIMEN_STATUSES.includes(specimenStatus)) {
    badges.push({ label: t('samples.badges.quarantine', 'Quarentena'), className: 'pending', title: quarantineReason || t('samples.badges.quarantineTitle', 'Amostra bloqueada aguardando regularização ética') });
  }

  if (consentStatus === 'PENDING' || sample.canUse === false) {
    badges.push({ label: t('samples.badges.consentPending', 'TCLE pendente'), className: 'pending', title: sample.consentMessage || t('samples.consent.pendingTitle') });
  }

  if (quarantineReason === 'EXTERNAL_DOCUMENT_REQUIRED' || quarantineReason === 'TRANSFER_REVIEW_REQUIRED') {
    badges.push({ label: t('samples.badges.externalDocPending', 'Documento externo pendente'), className: 'unknown', title: t('samples.badges.externalDocPendingTitle', 'Documento externo necessário para liberação') });
  }

  if (consentStatus === 'SIGNED') {
    badges.push({ label: t('samples.badges.consentSigned', 'TCLE assinado'), className: 'approved', title: t('samples.badges.consentSigned', 'TCLE assinado') });
  }

  if (consentStatus === 'EXTERNAL_ATTACHED' || consentStatus === 'WAIVED_TRANSFER') {
    badges.push({ label: t('samples.badges.externalDocAttached', 'Documento anexado'), className: 'approved', title: t('samples.badges.externalDocAttachedTitle', 'Documento externo anexado e validado') });
  }

  if (specimenStatus && !BLOCKED_SPECIMEN_STATUSES.includes(specimenStatus)) {
    badges.push({ label: t('samples.badges.released', 'Liberada'), className: 'approved', title: t('samples.badges.releasedTitle', 'Disponível para uso autorizado') });
  }

  if (badges.length === 0) {
    badges.push({ label: t('samples.badges.released', 'Liberada'), className: 'approved', title: t('samples.badges.noBlocks', 'Sem bloqueios de quarentena') });
  }

  return badges.map((badge) => (
    <span key={`${badge.label}-${badge.title}`} className={`consent-badge ${badge.className}`} title={badge.title}>
      {badge.label}
    </span>
  ));
}

