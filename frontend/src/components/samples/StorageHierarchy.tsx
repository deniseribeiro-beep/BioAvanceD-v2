import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Layers3, MapPin, RefreshCw } from 'lucide-react';
import Button from '../UI/Button';
import Card from '../UI/Card';
import Modal from '../UI/Modal';
import Select from '../UI/Select';
import { notifyApiToast } from '@/api/client';
import { storageApi } from '@/services/storageApi';
import { SampleWithId } from '@/hooks/samples/useSamplesPage';

type TranslatorFn = (key: string) => string;

type FreezerEntry = {
  _id: string;
  freezerName?: string;
  name?: string;
};

type TreeBox = {
  boxId: string;
  boxName?: string;
  stats?: {
    totalCapacity?: number;
    totalOccupied?: number;
    occupancyPercent?: number;
  };
};

type TreeRack = {
  rackName?: string;
  boxes?: TreeBox[];
};

type TreeShelf = {
  shelfName?: string;
  racks?: TreeRack[];
};

type FreezerTree = {
  freezerName?: string;
  temperature?: number;
  aggregateStats?: {
    totalCapacity?: number;
    totalOccupied?: number;
    occupancyPercent?: number;
  };
  shelves?: TreeShelf[];
};

interface StorageHierarchyProps {
  isOpen: boolean;
  sample: SampleWithId | null;
  t: TranslatorFn;
  onClose: () => void;
  onCompleted: () => void;
}

function getSelectedLabel(tree: FreezerTree | null, shelfIndex: string, rackIndex: string, boxId: string) {
  if (!tree) return '';

  const shelf = shelfIndex !== '' ? tree.shelves?.[Number(shelfIndex)] : null;
  const rack = shelf && rackIndex !== '' ? shelf.racks?.[Number(rackIndex)] : null;
  const box = rack?.boxes?.find((item) => item.boxId === boxId) || null;

  return [tree.freezerName, shelf?.shelfName, rack?.rackName, box?.boxName || box?.boxId].filter(Boolean).join(' > ');
}

export default function StorageHierarchy({ isOpen, sample, t, onClose, onCompleted }: StorageHierarchyProps) {
  const [freezers, setFreezers] = useState<FreezerEntry[]>([]);
  const [freezersLoading, setFreezersLoading] = useState(false);
  const [freezerTree, setFreezerTree] = useState<FreezerTree | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFreezerId, setSelectedFreezerId] = useState('');
  const [selectedShelfIndex, setSelectedShelfIndex] = useState('');
  const [selectedRackIndex, setSelectedRackIndex] = useState('');
  const [selectedBoxId, setSelectedBoxId] = useState('');
  const [selectedPosition, setSelectedPosition] = useState('');
  const [availablePositions, setAvailablePositions] = useState<string[]>([]);

  useEffect(() => {
    if (!isOpen) return;

    let active = true;

    const loadFreezers = async () => {
      setFreezersLoading(true);
      setError(null);
      try {
        const response = await storageApi.listFreezers();
        if (!active) return;

        if (response.success && Array.isArray(response.data)) {
          setFreezers(response.data);
          setSelectedFreezerId((current) => current || response.data[0]?._id || '');
        } else {
          setFreezers([]);
          setError(response.error || t('samples.storageInline.loadError'));
        }
      } catch {
        if (active) {
          setFreezers([]);
          setError(t('samples.storageInline.loadError'));
        }
      } finally {
        if (active) {
          setFreezersLoading(false);
        }
      }
    };

    void loadFreezers();

    return () => {
      active = false;
    };
  }, [isOpen, sample?.id, t]);

  useEffect(() => {
    if (!isOpen || !selectedFreezerId) return;

    let active = true;
    setTreeLoading(true);
    setError(null);
    setFreezerTree(null);
    setSelectedShelfIndex('');
    setSelectedRackIndex('');
    setSelectedBoxId('');
    setSelectedPosition('');
    setAvailablePositions([]);

    const loadTree = async () => {
      try {
        const response = await storageApi.getFreezerTree(selectedFreezerId);
        if (!active) return;

        if (response.success && response.data) {
          setFreezerTree(response.data);
        } else {
          setError(response.error || t('samples.storageInline.treeLoadError'));
        }
      } catch {
        if (active) {
          setError(t('samples.storageInline.treeLoadError'));
        }
      } finally {
        if (active) {
          setTreeLoading(false);
        }
      }
    };

    void loadTree();

    return () => {
      active = false;
    };
  }, [isOpen, selectedFreezerId, t]);

  const shelves = freezerTree?.shelves || [];
  const selectedShelf = selectedShelfIndex !== '' ? shelves[Number(selectedShelfIndex)] : null;
  const racks = selectedShelf?.racks || [];
  const selectedRack = selectedRackIndex !== '' ? racks[Number(selectedRackIndex)] : null;
  const boxes = selectedRack?.boxes || [];

  useEffect(() => {
    if (!selectedBoxId) {
      setAvailablePositions([]);
      return;
    }

    let active = true;
    setPositionsLoading(true);

    const loadPositions = async () => {
      try {
        const response = await storageApi.getAvailablePositions(selectedBoxId);
        if (!active) return;

        if (response.success && response.data) {
          setAvailablePositions(response.data.availablePositions || []);
        } else {
          setAvailablePositions([]);
        }
      } catch {
        if (active) {
          setAvailablePositions([]);
        }
      } finally {
        if (active) {
          setPositionsLoading(false);
        }
      }
    };

    void loadPositions();

    return () => {
      active = false;
    };
  }, [selectedBoxId]);

  const selectedPath = useMemo(
    () => getSelectedLabel(freezerTree, selectedShelfIndex, selectedRackIndex, selectedBoxId),
    [freezerTree, selectedShelfIndex, selectedRackIndex, selectedBoxId]
  );

  const canConfirm = Boolean(sample && selectedFreezerId && selectedBoxId && selectedPosition && !saving && !error && !treeLoading);

  const handleClose = () => {
    if (saving) return;
    onClose();
  };

  const handleConfirm = async () => {
    if (!sample || !selectedBoxId || !selectedPosition) {
      setError(t('samples.storageInline.selectDestination'));
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await storageApi.allocateSample(sample.id, selectedBoxId, selectedPosition);
      if (response.success) {
        notifyApiToast({
          message: t('samples.storageInline.success'),
          type: 'success',
          duration: 4500,
        });
        onCompleted();
        onClose();
        return;
      }

      const message = response.message || response.error || t('samples.storageInline.allocateError');
      setError(message);
      notifyApiToast({
        message,
        type: 'error',
        duration: 4500,
      });
    } catch {
      const message = t('samples.storageInline.allocateError');
      setError(message);
      notifyApiToast({
        message,
        type: 'error',
        duration: 4500,
      });
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  const freezerOptions = [
    { value: '', label: freezersLoading ? t('common.loading') : t('samples.storageInline.selectFreezer') },
    ...freezers.map((freezer) => ({ value: freezer._id, label: freezer.freezerName || freezer.name || freezer._id })),
  ];

  const shelfOptions = [
    { value: '', label: t('samples.storageInline.selectShelf') },
    ...shelves.map((shelf, index) => ({ value: String(index), label: shelf.shelfName || `${t('samples.storageInline.shelf')} ${index + 1}` })),
  ];

  const rackOptions = [
    { value: '', label: t('samples.storageInline.selectRack') },
    ...racks.map((rack, index) => ({ value: String(index), label: rack.rackName || `${t('samples.storageInline.rack')} ${index + 1}` })),
  ];

  const boxOptions = [
    { value: '', label: t('samples.storageInline.selectBox') },
    ...boxes.map((box) => ({ value: box.boxId, label: `${box.boxName || t('samples.storageInline.box')} - ${box.stats?.occupancyPercent ?? 0}%` })),
  ];

  return (
    <Modal isOpen title={t('samples.storageInline.title')} onClose={handleClose}>
      <div style={{ display: 'grid', gap: '1rem' }}>
        <Card>
          <div style={{ display: 'grid', gap: '0.65rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, color: '#0f172a' }}>
                <Layers3 size={16} />
                {t('samples.storageInline.action')}
              </span>
            </div>
            <div style={{ color: '#475569', fontSize: '0.92rem' }}>{t('samples.storageInline.subtitle')}</div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span className="traceability-pill">Freezer</span>
              <span className="traceability-pill">Rack</span>
              <span className="traceability-pill">Box</span>
              <span className="traceability-pill">Posição</span>
            </div>
          </div>
        </Card>

        <Card>
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <strong>{sample?.specimenId || sample?.barcode || sample?.id || t('samples.sampleFallback')}</strong>
              <div style={{ color: '#64748b' }}>{t('samples.storageInline.destination')}: {selectedPath || t('samples.storageInline.selectDestination')}</div>
            </div>

            {error ? (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', padding: '0.85rem 1rem', borderRadius: '0.9rem', background: 'rgba(254, 242, 242, 0.95)', border: '1px solid rgba(239, 68, 68, 0.16)', color: '#991b1b' }} role="alert">
                <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                <span>{error}</span>
              </div>
            ) : null}

            {treeLoading ? (
              <div style={{ color: '#475569', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <RefreshCw size={16} className="traceability-spin" />
                {t('samples.storageInline.loadingTree')}
              </div>
            ) : freezerTree ? (
              <div style={{ display: 'grid', gap: '0.85rem' }}>
                <Select
                  label={t('samples.storageInline.freezer')}
                  value={selectedFreezerId}
                  onChange={(event) => setSelectedFreezerId(event.target.value)}
                  options={freezerOptions}
                  disabled={freezersLoading}
                />

                <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                  <Select
                    label={t('samples.storageInline.shelf')}
                    value={selectedShelfIndex}
                    onChange={(event) => {
                      setSelectedShelfIndex(event.target.value);
                      setSelectedRackIndex('');
                      setSelectedBoxId('');
                      setSelectedPosition('');
                    }}
                    options={shelfOptions}
                  />

                  <Select
                    label={t('samples.storageInline.rack')}
                    value={selectedRackIndex}
                    onChange={(event) => {
                      setSelectedRackIndex(event.target.value);
                      setSelectedBoxId('');
                      setSelectedPosition('');
                    }}
                    options={rackOptions}
                    disabled={!selectedShelf}
                  />

                  <Select
                    label={t('samples.storageInline.box')}
                    value={selectedBoxId}
                    onChange={(event) => {
                      setSelectedBoxId(event.target.value);
                      setSelectedPosition('');
                    }}
                    options={boxOptions}
                    disabled={!selectedRack}
                  />
                </div>

                {selectedBoxId && (
                  <div style={{ display: 'grid', gap: '0.5rem', background: '#f8fafc', borderRadius: 12, padding: '0.9rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                      <strong>{t('samples.storageInline.selectPosition')}</strong>
                      <span>{t('samples.storageInline.availablePositions')}: {availablePositions.length}</span>
                    </div>
                    <Select
                      label={t('samples.storageInline.position')}
                      value={selectedPosition}
                      onChange={(event) => setSelectedPosition(event.target.value)}
                      options={[
                        { value: '', label: positionsLoading ? t('samples.storageInline.loadingPositions') : t('samples.storageInline.selectPosition') },
                        ...availablePositions.map((position) => ({ value: position, label: position })),
                      ]}
                      disabled={positionsLoading || availablePositions.length === 0}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div style={{ color: '#64748b' }}>{t('samples.storageInline.selectFreezer')}</div>
            )}
          </div>
        </Card>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={handleClose} disabled={saving}>
            {t('samples.storageInline.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            {saving ? t('samples.storageInline.processing') : t('samples.storageInline.confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}