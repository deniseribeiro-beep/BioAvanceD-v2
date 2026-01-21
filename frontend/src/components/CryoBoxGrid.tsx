import { useMemo } from 'react';
import styles from './CryoBoxGrid.module.css';

type CryoBoxGridProps = {
  occupiedPositions?: string[]; // ['A1','A2',...]
  selectedPosition?: string | null;
  onSelect?: (position: string) => void;
};

export function CryoBoxGrid({
  occupiedPositions = [],
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

  return (
    <div className={styles.grid} aria-label="CryoBox 9x9">
      {positions.map((pos) => {
        const isOccupied = occupiedPositions.includes(pos);
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
            aria-label={`Posição ${pos} ${ariaState}`}
            onClick={() => onSelect?.(pos)}
            data-tooltip={isOccupied ? `Amostra em ${pos}` : undefined}
          >
            <span className={styles.dot} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
