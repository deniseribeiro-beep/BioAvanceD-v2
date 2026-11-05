import { useMemo, useState } from 'react';
import type { Sample } from '../../types/models';
import { CryoBoxGrid, type CryoBoxOccupant } from '../CryoBoxGrid';

type TranslatorFn = (key: string, fallback?: string) => string;

export type InventoryBox = {
  id: string;
  label: string;
  occupants: CryoBoxOccupant[];
};

function sampleWellCode(sample: Sample): string {
  const specimenId = String(sample.specimenId || '').trim();
  if (specimenId) return specimenId;
  const barcode = String(sample.barcode || '').trim();
  if (barcode) return barcode;
  return String(sample.id || '').trim();
}

function normalizeWell(position: string): string {
  const match = String(position || '').trim().toUpperCase().match(/^([A-I])\s*([1-9])$/);
  return match ? `${match[1]}${match[2]}` : '';
}

export function groupAllocatedBoxes(samples: Sample[]): InventoryBox[] {
  const boxes = new Map<string, InventoryBox>();

  samples.forEach((sample) => {
    const box = sample.resolvedStorageLocation?.box;
    const well = normalizeWell(String(box?.position || ''));
    const sampleCode = sampleWellCode(sample);
    if (!well || !sampleCode) return;

    const id = String(box?.boxId || box?.boxName || 'caixa').trim() || 'caixa';
    const label = String(box?.boxName || box?.boxId || 'Caixa').trim() || 'Caixa';
    const current = boxes.get(id) || { id, label, occupants: [] };
    const existing = current.occupants.find((occupant) => occupant.position === well);
    if (existing) {
      if (!existing.sampleCode.split(', ').includes(sampleCode)) {
        existing.sampleCode = `${existing.sampleCode}, ${sampleCode}`;
      }
    } else {
      current.occupants.push({ position: well, sampleCode });
    }
    boxes.set(id, current);
  });

  return [...boxes.values()];
}

export default function InventoryBoxGrid({ samples, t }: { samples: Sample[]; t: TranslatorFn }) {
  const boxes = useMemo(() => groupAllocatedBoxes(samples), [samples]);
  const [boxId, setBoxId] = useState('');
  const selectedId = boxes.some((box) => box.id === boxId) ? boxId : boxes[0]?.id || '';
  const selected = boxes.find((box) => box.id === selectedId) || null;

  return (
    <section className="inventory-box-grid" data-testid="inventory-box-grid">
      <div className="inventory-box-grid__header">
        <h2>{t('samples.boxGrid.title', 'Grade da caixa')}</h2>
        <p>{t('samples.boxGrid.hint', 'Passe o mouse sobre um poço ocupado para ver o código da amostra.')}</p>
      </div>
      {boxes.length > 1 && (
        <label className="inventory-box-grid__picker">
          {t('samples.boxGrid.box', 'Caixa')}
          <select
            aria-label={t('samples.boxGrid.box', 'Caixa')}
            value={selectedId}
            onChange={(event) => setBoxId(event.target.value)}
          >
            {boxes.map((box) => (
              <option key={box.id} value={box.id}>{box.label}</option>
            ))}
          </select>
        </label>
      )}
      {selected && <p className="inventory-box-grid__box">{selected.label}</p>}
      <CryoBoxGrid occupants={selected?.occupants || []} />
    </section>
  );
}
