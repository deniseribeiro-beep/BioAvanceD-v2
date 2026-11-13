import { useMemo } from 'react';
import styles from './CryoBoxGrid.module.css';

export type CryoBoxOccupant = {
  position: string;
  sampleCode: string;
};

type CryoBoxGridProps = {
  occupiedPositions?: string[]; // ['A1','A2',...]
  occupants?: CryoBoxOccupant[];
  selectedPosition?: string | null;
  onSelect?: (position: string) => void;
};

function normalizeWell(position: string): string {
  const match = String(position || '').trim().toUpperCase().match(/^([A-I])\s*([1-9])$/);
  return match ? `${match[1]}${match[2]}` : '';
}

export function CryoBoxGrid({
  occupiedPositions = [],
  occupants = [],
  selectedPosition = null,
  onSelect,
}: CryoBoxGridProps) {
  const positions = useMemo(() => {
    const list: string[] = [];
    for (let r = 0; r < 9; r++) {
      const rowLabel = String.fromCharCode(65 + r); // A..I
      for (let c = 1; c <= 9; c++) {
        list.push(`${rowLabel}${c}`);
      }
    }
    return list;
  }, []);

  const occupantsByWell = useMemo(() => {
    const wells = new Map<string, string>();
    occupiedPositions.forEach((position) => {
      const well = normalizeWell(position);
      if (well) wells.set(well, wells.get(well) || '');
    });
    occupants.forEach((occupant) => {
      const well = normalizeWell(occupant.position);
      const sampleCode = String(occupant.sampleCode || '').trim();
      if (well && sampleCode) wells.set(well, sampleCode);
    });
    return wells;
  }, [occupiedPositions, occupants]);

  return (
    <div className={styles.grid} aria-label="CryoBox 9x9">
      {positions.map((pos) => {
        const sampleCode = occupantsByWell.get(pos) || '';
        const isOccupied = occupantsByWell.has(pos);
        const isSelected = selectedPosition === pos;
        const ariaState = isSelected ? 'selecionado' : isOccupied ? 'ocupado' : 'livre';
        const classes = [
          styles.cell,
          isOccupied && styles.occupied,
          isSelected && styles.selected,
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <button
            key={pos}
            type="button"
            className={classes}
            aria-label={sampleCode ? `Posição ${pos} ${ariaState}, amostra ${sampleCode}` : `Posição ${pos} ${ariaState}`}
            onClick={() => onSelect?.(pos)}
            data-tooltip={sampleCode || undefined}
          >
            <span className={styles.dot} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
