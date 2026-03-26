import React, { useState } from 'react';
import Modal from '../UI/Modal';

// Anonymization function for samples
function anonymizeSample(obj: any) {
  const { sampleID, patientCpf, patientRecordNumber, type, origin, ...rest } = obj;
  return {
    sampleID,
    patientCpf,
    patientRecordNumber,
    type,
    origin,
    // outros campos permitidos podem ser adicionados aqui
  };
}
  // State for Import Samples modal
  const [isSampleImportModalOpen, setIsSampleImportModalOpen] = useState(false);
  const [importedSampleFile, setImportedSampleFile] = useState<File | null>(null);
  const [importedSampleJson, setImportedSampleJson] = useState<any>(null);
  const [sampleImportLoading, setSampleImportLoading] = useState(false);
  const [sampleImportResult, setSampleImportResult] = useState<{ success?: boolean; message?: string; samples?: number; error?: string } | null>(null);

  // Handler for reading sample file
  const handleSampleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/json') {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const json = JSON.parse(ev.target?.result as string);
          setImportedSampleFile(file);
          setImportedSampleJson(json);
        } catch (err) {
          alert('Arquivo JSON inválido');
          setImportedSampleFile(null);
          setImportedSampleJson(null);
        }
      };
      reader.readAsText(file);
    } else {
      alert('Selecione um arquivo .json válido');
      setImportedSampleFile(null);
      setImportedSampleJson(null);
    }
  };

  // Handler for submitting sample import
  const handleSampleImportSubmit = async () => {
    if (!importedSampleJson) return;
    setSampleImportLoading(true);
    setSampleImportResult(null);
    try {
      // Basic anonymization: remove extra sensitive fields
      const anonymized = Array.isArray(importedSampleJson)
        ? importedSampleJson.map(obj => anonymizeSample(obj))
        : anonymizeSample(importedSampleJson);
      const response = await fetch('http://localhost:3000/api/import/samples', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(anonymized)
      });
      const data = await response.json();
      setSampleImportResult(data);
      if (data.success !== false && data.samples) {
        alert('Importação de amostras concluída!');
        setIsSampleImportModalOpen(false);
        setImportedSampleFile(null);
        setImportedSampleJson(null);
        // Optionally: refresh samples list here if needed
      } else {
        alert(data.message || data.error || 'Erro ao importar amostras');
      }
    } catch (err: any) {
      setSampleImportResult({ success: false, error: err.message });
      alert('Erro ao importar amostras: ' + err.message);
    } finally {
      setSampleImportLoading(false);
    }
  };
      {/* Import Samples Button (only on inventory page) */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button variant="secondary" onClick={() => setIsSampleImportModalOpen(true)}>
          Importar Amostras
        </Button>
      </div>
      {/* Modal de Importação de Amostras */}
      <Modal isOpen={isSampleImportModalOpen} onClose={() => { setIsSampleImportModalOpen(false); setImportedSampleFile(null); setImportedSampleJson(null); setSampleImportResult(null); }} title="Importação de Amostras (Vinculadas a Pacientes)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 320 }}>
          <label style={{ fontWeight: 500 }}>Selecione um arquivo de amostras (.json):</label>
          <input type="file" accept="application/json" onChange={handleSampleFileChange} disabled={sampleImportLoading} title="Selecione um arquivo .json de amostras" />
          {importedSampleJson && (
            <div style={{ maxHeight: 180, overflow: 'auto', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 6, padding: 8, fontSize: 13 }}>
              <pre style={{ margin: 0 }}>{JSON.stringify(importedSampleJson, null, 2).slice(0, 2000)}{JSON.stringify(importedSampleJson, null, 2).length > 2000 ? '... (truncado)' : ''}</pre>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button onClick={handleSampleImportSubmit} disabled={!importedSampleJson || sampleImportLoading}>
              {sampleImportLoading ? 'Processando...' : 'Processar Importação'}
            </Button>
            <Button variant="secondary" onClick={() => { setIsSampleImportModalOpen(false); setImportedSampleFile(null); setImportedSampleJson(null); setSampleImportResult(null); }} disabled={sampleImportLoading}>
              Cancelar
            </Button>
          </div>
          {sampleImportResult && (
            <div style={{ color: sampleImportResult.success === false ? '#dc2626' : '#16a34a', fontSize: 14, marginTop: 8 }}>
              {sampleImportResult.message || sampleImportResult.error}
              {sampleImportResult.samples !== undefined && (
                <div>
                  Amostras: {sampleImportResult.samples}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>


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
    <div className="page samples-page">
      <div className="page-header">
        <h1>{t('samples.title')}</h1>
      </div>

      <Card style={{ marginBottom: '1rem' }}>
        <div className="samples-toolbar">
          <div className="samples-search-panel">
            <Input
              label={t('samples.searchLabel')}
              placeholder={scanMode ? 'Escaneie barcode/QR code e pressione pesquisar' : t('samples.searchPlaceholder')}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
            <p className="samples-search-hint">
              {scanMode
                ? 'Modo leitura ativo: use o leitor de barcode ou QR code e depois pressione Pesquisar.'
                : t('samples.searchHint')}
            </p>
            <div className="samples-search-actions">
              <button type="button" className="samples-search-button" onClick={onSearchSubmit}>
                <Search size={15} />
                Pesquisar
              </button>
              <button
                type="button"
                className={`samples-search-button samples-search-button--scan ${scanMode ? 'active' : ''}`}
                onClick={() => setScanMode((current) => !current)}
              >
                <QrCode size={15} />
                {scanMode ? 'Leitura ativa' : 'Barcode/QR'}
              </button>
            </div>
          </div>
          {selectedSampleIds.length > 0 && (
            <div className="toolbar batch">
              <span>{selectedSampleIds.length} {t('samples.selectedItems')}</span>
              <Button variant="danger" onClick={onBatchDelete}>
                <Trash2 size={16} />
                {t('samples.delete')}
              </Button>
              <Button onClick={onOpenPrintModal}>
                <Printer size={16} />
                {t('samples.printLabels')}
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="samples-results-summary">
          <div>
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
          <tbody>
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
                    <tr className={isExpanded ? 'samples-row--expanded' : ''} key={sample.id}>
                    <td className="center">
                      <input
                        type="checkbox"
                        checked={selectedSampleIds.includes(sample.id)}
                        onChange={() => onToggleSelect(sample)}
                        aria-label={t('samples.selectOneAria')}
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
                          title={sample.canUse === false ? t('samples.editTooltip.consentPending') : t('samples.physicalStorageAction')}
                        >
                          <Package size={15} />
                          {isExpanded ? t('common.close') : t('samples.storageInline.action')}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={!canEdit || sample.canUse === false}
                          onClick={() => onEditSample(sample.id)}
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
