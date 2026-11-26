import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Layers3, RefreshCw } from 'lucide-react';
import Button from '../UI/Button';
import Card from '../UI/Card';
import Input from '../UI/Input';
import Select from '../UI/Select';
import { notifyApiToast } from '@/api/client';
import { storageApi } from '@/services/storageApi';
import { SampleWithId } from '@/hooks/samples/useSamplesPage';
import type { SampleStorageLocationDTO } from '@/types/models';

const POSITION_PATTERN = /^[A-Za-z]\d+$/;

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

interface InlineStorageMovementPanelProps {
  sample: SampleWithId;
  t: TranslatorFn;
  onCancel: () => void;
  onCompleted: () => void;
}

function getSelectedLabel(tree: FreezerTree | null, shelfIndex: string, rackIndex: string, boxId: string) {
  if (!tree) return '';

  const shelf = shelfIndex !== '' ? tree.shelves?.[Number(shelfIndex)] : null;
  const rack = shelf && rackIndex !== '' ? shelf.racks?.[Number(rackIndex)] : null;
  const box = rack?.boxes?.find((item) => item.boxId === boxId) || null;

  return [tree.freezerName, shelf?.shelfName, rack?.rackName, box?.boxName || box?.boxId].filter(Boolean).join(' > ');
}

export default function InlineStorageMovementPanel({ sample, t, onCancel, onCompleted }: InlineStorageMovementPanelProps) {
  const [freezers, setFreezers] = useState<FreezerEntry[]>([]);
  const [freezersLoading, setFreezersLoading] = useState(true);
  const [freezerTree, setFreezerTree] = useState<FreezerTree | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [selectedFreezerId, setSelectedFreezerId] = useState('');
  const [selectedShelfIndex, setSelectedShelfIndex] = useState('');
  const [selectedRackIndex, setSelectedRackIndex] = useState('');
  const [selectedBoxId, setSelectedBoxId] = useState('');
  const [useSpecificPosition, setUseSpecificPosition] = useState(false);
  const [targetPosition, setTargetPosition] = useState('');
  const [currentLocation, setCurrentLocation] = useState<SampleStorageLocationDTO | null>(null);

  const isAlreadyStored = Boolean(currentLocation?.box?.boxId && currentLocation?.box?.position);

  useEffect(() => {
    let active = true;

    const loadCurrentLocation = async () => {
      const response = await storageApi.getSampleLocation(sample.id);
      if (!active) return;
      setCurrentLocation(response.success && response.data ? (response.data as SampleStorageLocationDTO) : null);
    };

    void loadCurrentLocation();

    return () => {
      active = false;
    };
  }, [sample.id]);

  useEffect(() => {
    let active = true;

    const loadFreezers = async () => {
      setFreezersLoading(true);
      setError(null);
      setConfirmError(null);
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
  }, [sample.id, t]);

  useEffect(() => {
    if (!selectedFreezerId) return;

    let active = true;
    setTreeLoading(true);
    setError(null);
    setConfirmError(null);
    setFreezerTree(null);
    setSelectedShelfIndex('');
    setSelectedRackIndex('');
    setSelectedBoxId('');

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
  }, [selectedFreezerId, t]);

  const shelves = freezerTree?.shelves || [];
  const selectedShelf = selectedShelfIndex !== '' ? shelves[Number(selectedShelfIndex)] : null;
  const racks = selectedShelf?.racks || [];
  const selectedRack = selectedRackIndex !== '' ? racks[Number(selectedRackIndex)] : null;
  const boxes = selectedRack?.boxes || [];

  const selectedPath = useMemo(
    () => getSelectedLabel(freezerTree, selectedShelfIndex, selectedRackIndex, selectedBoxId),
    [freezerTree, selectedShelfIndex, selectedRackIndex, selectedBoxId]
  );

  const normalizedTargetPosition = targetPosition.trim().toUpperCase();
  const positionValid = !useSpecificPosition || POSITION_PATTERN.test(normalizedTargetPosition);

  const canConfirm = Boolean(
    selectedFreezerId && selectedBoxId && positionValid && !saving && !error && !treeLoading
  );

  const handleConfirm = async () => {
    // Destination / position validity is enforced by canConfirm (button disabled).
    setSaving(true);
    setConfirmError(null);

    try {
      const response = useSpecificPosition
        ? isAlreadyStored
          ? await storageApi.moveSample(sample.id, selectedBoxId, normalizedTargetPosition)
          : await storageApi.allocateSample(sample.id, selectedBoxId, normalizedTargetPosition)
        : await storageApi.autoAssignSampleToBox(sample.id, selectedBoxId);
      if (response.success) {
        const assignedPosition = response.data?.position || response.sampleLocation?.position || '';
        notifyApiToast({
          message: assignedPosition
            ? `Sucesso! Amostra alocada automaticamente na Posição ${assignedPosition}`
            : t('samples.storageInline.success'),
          type: 'success',
          duration: 4500,
        });
        onCompleted();
        return;
      }

      const message = response.message || response.error || t('samples.storageInline.allocateError');
      setConfirmError(message);
      notifyApiToast({
        message,
        type: 'error',
        duration: 4500,
      });
    } catch {
      const message = t('samples.storageInline.allocateError');
      setConfirmError(message);
      notifyApiToast({
        message,
        type: 'error',
        duration: 4500,
      });
    } finally {
      setSaving(false);
    }
  };

  const freezerOptions = [
    { value: '', label: freezersLoading ? t('common.loading') : t('samples.storageInline.selectFreezer') },
    ...freezers.map((freezer) => ({
      value: freezer._id,
      label: freezer.freezerName || freezer.name || freezer._id,
    })),
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
    <Card className="samples-inline-storage-card">
      <div className="samples-inline-storage-grid">
        <div className="samples-inline-storage-summary">
          <div className="samples-inline-storage-summary__eyebrow">
            <Layers3 size={16} />
            <span>{t('samples.storageInline.title')}</span>
          </div>
          <h3>{sample.barcode || sample.specimenId || sample.id}</h3>
          <p>{t('samples.storageInline.subtitle')}</p>
          <div className="samples-inline-storage-summary__meta">
            <span>{t('samples.participantIdColumn')}: {sample.participantId || 'N/A'}</span>
            <span>{t('samples.tableHeaders.type')}: {sample.sampleType || 'N/A'}</span>
            <span>{t('samples.storageInline.destination')}: {selectedPath || t('samples.storageInline.selectDestination')}</span>
          </div>
        </div>

        <div className="samples-inline-storage-form">
          <div className="samples-inline-storage-fields">
            <Select
              label={t('samples.storageInline.freezer')}
              value={selectedFreezerId}
              onChange={(event) => setSelectedFreezerId(event.target.value)}
              options={freezerOptions}
              disabled={freezersLoading}
            />

            {treeLoading ? (
              <div className="samples-inline-storage-state">
                <RefreshCw size={16} className="samples-inline-storage-spin" />
                <span>{t('samples.storageInline.loadingTree')}</span>
              </div>
            ) : error ? (
              <div className="samples-inline-storage-state samples-inline-storage-state--error" role="alert">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            ) : freezerTree ? (
              <>
                <div className="samples-inline-storage-hierarchy">
                  <Select
                    label={t('samples.storageInline.shelf')}
                    value={selectedShelfIndex}
                    onChange={(event) => {
                      setSelectedShelfIndex(event.target.value);
                      setSelectedRackIndex('');
                      setSelectedBoxId('');
                      setConfirmError(null);
                    }}
                    options={shelfOptions}
                  />

                  <Select
                    label={t('samples.storageInline.rack')}
                    value={selectedRackIndex}
                    onChange={(event) => {
                      setSelectedRackIndex(event.target.value);
                      setSelectedBoxId('');
                      setConfirmError(null);
                    }}
                    options={rackOptions}
                    disabled={!selectedShelf}
                  />

                  <Select
                    label={t('samples.storageInline.box')}
                    value={selectedBoxId}
                    onChange={(event) => {
                      setSelectedBoxId(event.target.value);
                      setConfirmError(null);
                    }}
                    options={boxOptions}
                    disabled={!selectedRack}
                  />
                </div>

                <div className="samples-inline-storage-position-note">
                  <label className="samples-inline-storage-position-toggle">
                    <input
                      type="checkbox"
                      checked={useSpecificPosition}
                      onChange={(event) => {
                        setUseSpecificPosition(event.target.checked);
                        setTargetPosition('');
                        setConfirmError(null);
                      }}
                    />
                    <span>{t('samples.storageInline.specifyPosition')}</span>
                  </label>

                  {useSpecificPosition ? (
                    <Input
                      label={t('samples.storageInline.targetPosition')}
                      value={targetPosition}
                      onChange={(event) => {
                        setTargetPosition(event.target.value);
                        setConfirmError(null);
                      }}
                      placeholder="A1"
                      error={
                        targetPosition && !positionValid
                          ? t('samples.storageInline.invalidPosition')
                          : undefined
                      }
                    />
                  ) : (
                    <span>
                      A caixa selecionada será preenchida automaticamente pela próxima posição vazia disponível.
                    </span>
                  )}
                </div>
              </>
            ) : null}

            {confirmError ? (
              <div className="samples-inline-storage-state samples-inline-storage-state--error" role="alert">
                <AlertCircle size={16} />
                <span>{confirmError}</span>
              </div>
            ) : null}
          </div>

          <div className="samples-inline-storage-actions">
            <Button variant="secondary" onClick={onCancel} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleConfirm} disabled={!canConfirm}>
              {saving ? t('samples.storageInline.processing') : t('samples.storageInline.confirm')}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
