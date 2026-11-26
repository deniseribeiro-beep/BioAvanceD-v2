import { Search, X } from 'lucide-react';
import Button from '../UI/Button';
import Input from '../UI/Input';
import type { SampleWithId } from '../../hooks/samples/useSamplesPage';
import { getStorageLabel } from './sampleListFormatters';

type TranslatorFn = (key: string, fallback?: string) => string;

export interface InventoryLookupDrawerProps {
  open: boolean;
  t: TranslatorFn;
  loading: boolean;
  searchInput: string;
  searchApplied: string;
  filteredSamples: SampleWithId[];
  onClose: () => void;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  onOpenDetail: (sampleId: string) => void;
  onOpenStorage: (sample: SampleWithId) => void;
  onOpenLabel: (sampleId: string) => void;
}

export default function InventoryLookupDrawer({
  open,
  t,
  loading,
  searchInput,
  searchApplied,
  filteredSamples,
  onClose,
  onSearchChange,
  onSearchSubmit,
  onOpenDetail,
  onOpenStorage,
  onOpenLabel,
}: InventoryLookupDrawerProps) {
  if (!open) return null;

  const hasSearch = searchApplied.trim().length > 0;

  return (
    <div className="inventory-lookup-drawer" data-testid="inventory-lookup-drawer">
      <button
        type="button"
        className="inventory-lookup-drawer__backdrop"
        aria-label={t('common.close', 'Fechar')}
        onClick={onClose}
        data-testid="inventory-lookup-drawer-backdrop"
      />
      <aside className="inventory-lookup-drawer__panel" role="dialog" aria-modal="true" data-testid="inventory-lookup-drawer-panel">
        <header className="inventory-lookup-drawer__header">
          <h2>{t('samples.lookupDrawer.title', 'Consulta rápida')}</h2>
          <button type="button" className="inventory-lookup-drawer__close" onClick={onClose} data-testid="inventory-lookup-drawer-close">
            <X size={18} />
          </button>
        </header>

        <p className="inventory-lookup-drawer__hint">
          {t('samples.lookupDrawer.hint', 'Use o mesmo campo de busca do inventário — escaneie ou digite e pressione Pesquisar.')}
        </p>

        <LookupSearchField
          label={t('samples.searchLabel')}
          placeholder={t('samples.searchScanPlaceholder', 'Escaneie barcode/QR code e pressione pesquisar')}
          value={searchInput}
          onChange={onSearchChange}
          onSubmit={onSearchSubmit}
          t={t}
        />

        <div className="inventory-lookup-drawer__results" data-testid="inventory-lookup-drawer-results">
          {loading ? (
            <p>{t('common.loading')}</p>
          ) : !hasSearch ? (
            <p className="inventory-lookup-drawer__empty">
              {t('samples.lookupDrawer.emptyQuery', 'Digite ou escaneie um código e pressione Pesquisar.')}
            </p>
          ) : filteredSamples.length === 0 ? (
            <p className="inventory-lookup-drawer__empty">
              {t('samples.empty.searchHint', 'Tente outro código de barras, ID ou nome de paciente.')}
            </p>
          ) : (
            <ul className="inventory-lookup-drawer__list">
              {filteredSamples.slice(0, 12).map((sample) => {
                const code = sample.barcode || sample.specimenId || sample.id;
                return (
                  <li key={sample.id} className="inventory-lookup-drawer__item" data-testid={`lookup-result-${sample.id}`}>
                    <div>
                      <strong>{sample.sampleType || t('samples.sampleFallback', 'Amostra')}</strong>
                      <p className="inventory-lookup-drawer__meta">
                        <code>{code}</code>
                        <span>{getStorageLabel(sample, t)}</span>
                      </p>
                    </div>
                    <div className="inventory-lookup-drawer__actions">
                      <Button variant="secondary" onClick={() => onOpenDetail(sample.id)} data-testid={`lookup-detail-${sample.id}`}>
                        {t('samples.lookupDrawer.detail', 'Detalhe')}
                      </Button>
                      <Button variant="secondary" onClick={() => onOpenStorage(sample)} data-testid={`lookup-storage-${sample.id}`}>
                        {t('samples.storageInline.action', 'Armazenagem')}
                      </Button>
                      <Button variant="secondary" onClick={() => onOpenLabel(sample.id)} data-testid={`lookup-label-${sample.id}`}>
                        {t('samples.lookupDrawer.label', 'Etiqueta')}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

function LookupSearchField({
  label,
  placeholder,
  value,
  onChange,
  onSubmit,
  t,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  t: TranslatorFn;
}) {
  return (
    <div className="inventory-lookup-drawer__search">
      <Input
        label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid="inventory-lookup-search-input"
      />
      <button type="button" className="samples-search-button" onClick={onSubmit} data-testid="inventory-lookup-search-button">
        <Search size={15} />
        {t('samples.searchButton', 'Pesquisar')}
      </button>
    </div>
  );
}