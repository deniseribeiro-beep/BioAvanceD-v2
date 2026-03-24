import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Layers3, RotateCw, Search, ThermometerSnowflake } from 'lucide-react';
import Button from '../UI/Button';
import Card from '../UI/Card';
import Input from '../UI/Input';
import Select from '../UI/Select';
import Modal from '../UI/Modal';
import { storageApi } from '@/services/storageApi';

type TranslatorFn = (key: string) => string;

type SampleResult = {
  _id: string;
  barcode?: string;
  patientID?: string;
  sampleType?: string;
  quantity?: number;
  canAllocate?: boolean;
  consentMessage?: string;
  consentValid?: boolean;
};

type FreezerResult = {
  _id: string;
  freezerName?: string;
  name?: string;
};

interface SampleTraceabilityModalProps {
  isOpen: boolean;
  t: TranslatorFn;
  onClose: () => void;
  onCompleted?: () => void;
}

export default function SampleTraceabilityModal({
  isOpen,
  t,
  onClose,
  onCompleted,
}: SampleTraceabilityModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SampleResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedSample, setSelectedSample] = useState<SampleResult | null>(null);

  const [freezers, setFreezers] = useState<FreezerResult[]>([]);
  const [freezersLoading, setFreezersLoading] = useState(false);
  const [freezerError, setFreezerError] = useState<string | null>(null);
  const [selectedFreezerId, setSelectedFreezerId] = useState('');
  const [freezerTree, setFreezerTree] = useState<any>(null);
  const [treeLoading, setTreeLoading] = useState(false);

  const [selectedShelfIndex, setSelectedShelfIndex] = useState('');
  const [selectedRackIndex, setSelectedRackIndex] = useState('');
  const [selectedBoxId, setSelectedBoxId] = useState('');
  const [selectedPosition, setSelectedPosition] = useState('');
  const [availablePositions, setAvailablePositions] = useState<string[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);

  const [allocating, setAllocating] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackKind, setFeedbackKind] = useState<'success' | 'error' | 'info' | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let active = true;

    const loadFreezers = async () => {
      setFreezersLoading(true);
      setFreezerError(null);
      try {
        const result = await storageApi.listFreezers();
        if (!active) return;

        if (result.success && Array.isArray(result.data)) {
          setFreezers(result.data);
          setSelectedFreezerId((current) => current || result.data[0]?._id || '');
        } else {
          setFreezers([]);
          setFreezerError(result.error || t('samples.traceability.noFreezers'));
        }
      } catch (error) {
        if (!active) return;
        setFreezers([]);
        setFreezerError(t('samples.traceability.freezerLoadError'));
      } finally {
        if (active) {
          setFreezersLoading(false);
        }
      }
    };

    loadFreezers();

    return () => {
      active = false;
    };
  }, [isOpen, t]);

  useEffect(() => {
    if (!isOpen || !selectedFreezerId) {
      return;
    }

    let active = true;
    setTreeLoading(true);
    setFeedback(null);
    setFeedbackKind(null);
    setSelectedShelfIndex('');
    setSelectedRackIndex('');
    setSelectedBoxId('');
    setSelectedPosition('');
    setAvailablePositions([]);

    storageApi.getFreezerTree(selectedFreezerId)
      .then((result) => {
        if (!active) return;
        if (result.success && result.data) {
          setFreezerTree(result.data);
        } else {
          setFreezerTree(null);
          setFeedback(result.error || t('samples.traceability.treeLoadError'));
          setFeedbackKind('error');
        }
      })
      .catch(() => {
        if (!active) return;
        setFreezerTree(null);
        setFeedback(t('samples.traceability.treeLoadError'));
        setFeedbackKind('error');
      })
      .finally(() => {
        if (active) {
          setTreeLoading(false);
        }
      });

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
    storageApi.getAvailablePositions(selectedBoxId)
      .then((result) => {
        if (!active) return;
        if (result.success && result.data) {
          setAvailablePositions(result.data.availablePositions || []);
        } else {
          setAvailablePositions([]);
        }
      })
      .catch(() => {
        if (active) {
          setAvailablePositions([]);
        }
      })
      .finally(() => {
        if (active) {
          setPositionsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedBoxId]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const term = searchTerm.trim();
    if (term.length < 2) {
      setSearchResults([]);
      return;
    }

    let active = true;
    setSearchLoading(true);
    storageApi.searchSamples(term)
      .then((result) => {
        if (!active) return;
        if (result.success && Array.isArray(result.data)) {
          setSearchResults(result.data);
        } else {
          setSearchResults([]);
        }
      })
      .catch(() => {
        if (active) {
          setSearchResults([]);
        }
      })
      .finally(() => {
        if (active) {
          setSearchLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [isOpen, searchTerm]);

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      setSearchResults([]);
      setSelectedSample(null);
      setSelectedFreezerId('');
      setFreezerTree(null);
      setSelectedShelfIndex('');
      setSelectedRackIndex('');
      setSelectedBoxId('');
      setSelectedPosition('');
      setAvailablePositions([]);
      setFeedback(null);
      setFeedbackKind(null);
    }
  }, [isOpen]);

  const shelfOptions = shelves.map((shelf: any, index: number) => ({
    value: String(index),
    label: shelf.shelfName || `${t('samples.traceability.shelf')} ${index + 1}`,
  }));

  const rackOptions = racks.map((rack: any, index: number) => ({
    value: String(index),
    label: rack.rackName || `${t('samples.traceability.rack')} ${index + 1}`,
  }));

  const boxOptions = boxes.map((box: any) => ({
    value: box.boxId,
    label: `${box.boxName || t('samples.traceability.box')} - ${box.stats?.occupancyPercent ?? 0}%`,
  }));

  const handleClose = () => {
    setFeedback(null);
    setFeedbackKind(null);
    onClose();
  };

  const handleAllocate = async () => {
    if (!selectedSample) {
      setFeedback(t('samples.traceability.selectSample'));
      setFeedbackKind('error');
      return;
    }

    if (!selectedBoxId || !selectedPosition) {
      setFeedback(t('samples.traceability.selectPosition'));
      setFeedbackKind('error');
      return;
    }

    setAllocating(true);
    setFeedback(t('samples.traceability.processing'));
    setFeedbackKind('info');

    try {
      const result = await storageApi.allocateSample(selectedSample._id, selectedBoxId, selectedPosition);
      if (result.success) {
        setFeedback(t('samples.traceability.success'));
        setFeedbackKind('success');
        onCompleted?.();

        window.setTimeout(() => {
          handleClose();
        }, 1400);
        return;
      }

      setFeedback(result.message || result.error || t('samples.traceability.allocateError'));
      setFeedbackKind('error');
    } catch {
      setFeedback(t('samples.traceability.allocateError'));
      setFeedbackKind('error');
    } finally {
      setAllocating(false);
    }
  };

  const selectedBox = boxes.find((box: any) => box.boxId === selectedBoxId);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('samples.traceability.modalTitle')}>
      <div style={{ display: 'grid', gap: '1rem' }}>
        <Card style={{ background: 'linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)' }}>
          <div style={{ display: 'grid', gap: '0.65rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, color: '#0f172a' }}>
                <Layers3 size={16} />
                {t('samples.traceability.flowTitle')}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#334155' }}>
                <ArrowRight size={14} />
                {t('samples.traceability.flowPath')}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span className="traceability-pill"><ThermometerSnowflake size={14} /> Freezer</span>
              <span className="traceability-pill">Rack</span>
              <span className="traceability-pill">Box</span>
              <span className="traceability-pill">Posição</span>
            </div>
            <div style={{ color: '#475569', fontSize: '0.92rem' }}>{t('samples.traceability.flowDescription')}</div>
          </div>
        </Card>

        <Card>
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <Search size={16} />
                <strong>{t('samples.traceability.sampleLookup')}</strong>
              </div>
              <Input
                label={t('samples.traceability.sampleSearchLabel')}
                placeholder={t('samples.traceability.sampleSearchPlaceholder')}
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />

              {searchLoading && <div style={{ marginTop: '0.5rem', color: '#475569' }}>{t('common.loading')}</div>}

              {searchTerm.trim().length >= 2 && searchResults.length > 0 && (
                <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.75rem', maxHeight: 220, overflow: 'auto' }}>
                  {searchResults.map((sample) => {
                    const isSelected = selectedSample?._id === sample._id;
                    return (
                      <button
                        key={sample._id}
                        type="button"
                        onClick={() => {
                          setSelectedSample(sample);
                          setSearchTerm(sample.barcode || sample._id);
                        }}
                        className={`traceability-result ${isSelected ? 'selected' : ''}`}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                          <strong>{sample.barcode || sample._id}</strong>
                          <span style={{ color: sample.canAllocate ? '#166534' : '#b91c1c', fontWeight: 700 }}>
                            {sample.canAllocate ? t('samples.traceability.available') : t('samples.traceability.blocked')}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', color: '#475569', fontSize: '0.9rem' }}>
                          <span>{t('samples.patientID')}: {sample.patientID || 'N/A'}</span>
                          <span>{t('samples.sampleType')}: {sample.sampleType || 'N/A'}</span>
                          <span>{t('samples.quantity')}: {sample.quantity ?? 'N/A'}</span>
                        </div>
                        {sample.consentMessage && (
                          <div style={{ color: '#b45309', fontSize: '0.85rem' }}>{sample.consentMessage}</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {selectedSample && (
              <div className="traceability-selected-sample">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                  <CheckCircle2 size={16} color="#166534" />
                  <strong>{t('samples.traceability.selectedSample')}</strong>
                </div>
                <div style={{ color: '#334155' }}>{selectedSample.barcode || selectedSample._id}</div>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <strong>{t('samples.traceability.storageMovement')}</strong>
              <div style={{ color: '#64748b' }}>{t('samples.traceability.storageMovementHint')}</div>
            </div>

            <div style={{ display: 'grid', gap: '1rem' }}>
              <Select
                label={t('samples.traceability.freezer')}
                value={selectedFreezerId}
                onChange={(event) => setSelectedFreezerId(event.target.value)}
                options={freezersLoading ? [{ value: '', label: t('common.loading') }] : [
                  { value: '', label: t('samples.traceability.selectFreezer') },
                  ...freezers.map((freezer) => ({
                    value: freezer._id,
                    label: freezer.freezerName || freezer.name || freezer._id,
                  })),
                ]}
              />

              {freezerError && <div style={{ color: '#b91c1c' }}>{freezerError}</div>}

              {treeLoading ? (
                <div style={{ color: '#475569', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <RotateCw size={16} className="traceability-spin" />
                  {t('samples.traceability.loadingTree')}
                </div>
              ) : freezerTree ? (
                <div style={{ display: 'grid', gap: '0.85rem' }}>
                  <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                    <Select
                      label={t('samples.traceability.shelf')}
                      value={selectedShelfIndex}
                      onChange={(event) => {
                        setSelectedShelfIndex(event.target.value);
                        setSelectedRackIndex('');
                        setSelectedBoxId('');
                        setSelectedPosition('');
                      }}
                      options={[
                        { value: '', label: t('samples.traceability.selectShelf') },
                        ...shelfOptions,
                      ]}
                    />

                    <Select
                      label={t('samples.traceability.rack')}
                      value={selectedRackIndex}
                      onChange={(event) => {
                        setSelectedRackIndex(event.target.value);
                        setSelectedBoxId('');
                        setSelectedPosition('');
                      }}
                      options={[
                        { value: '', label: t('samples.traceability.selectRack') },
                        ...rackOptions,
                      ]}
                      disabled={!selectedShelf}
                    />

                    <Select
                      label={t('samples.traceability.box')}
                      value={selectedBoxId}
                      onChange={(event) => {
                        setSelectedBoxId(event.target.value);
                        setSelectedPosition('');
                      }}
                      options={[
                        { value: '', label: t('samples.traceability.selectBox') },
                        ...boxOptions,
                      ]}
                      disabled={!selectedRack}
                    />
                  </div>

                  {selectedBox && (
                    <div style={{ display: 'grid', gap: '0.5rem', background: '#f8fafc', borderRadius: 12, padding: '0.9rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                        <strong>{selectedBox.boxName || t('samples.traceability.box')}</strong>
                        <span>{t('samples.traceability.availablePositions')}: {availablePositions.length}</span>
                      </div>
                      <Select
                        label={t('samples.traceability.position')}
                        value={selectedPosition}
                        onChange={(event) => setSelectedPosition(event.target.value)}
                        options={[
                          { value: '', label: positionsLoading ? t('samples.traceability.loadingPositions') : t('samples.traceability.selectPosition') },
                          ...availablePositions.map((position) => ({ value: position, label: position })),
                        ]}
                        disabled={positionsLoading || availablePositions.length === 0}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ color: '#64748b' }}>{t('samples.traceability.selectFreezerHint')}</div>
              )}
            </div>
          </div>
        </Card>

        {feedback && (
          <div
            style={{
              padding: '0.8rem 1rem',
              borderRadius: 12,
              background:
                feedbackKind === 'success' ? '#ecfdf5' : feedbackKind === 'error' ? '#fef2f2' : '#eff6ff',
              color: feedbackKind === 'success' ? '#166534' : feedbackKind === 'error' ? '#991b1b' : '#1d4ed8',
            }}
          >
            {feedback}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={handleClose} disabled={allocating}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleAllocate} disabled={allocating || !selectedSample || !selectedBoxId || !selectedPosition}>
            {allocating ? t('samples.traceability.processing') : t('samples.traceability.confirmMove')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}