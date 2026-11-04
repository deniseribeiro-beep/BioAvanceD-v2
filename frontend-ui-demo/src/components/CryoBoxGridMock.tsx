import { cn } from '../lib/cn';

const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const COLS = Array.from({ length: 10 }, (_, i) => i + 1);

/** Mock de ocupação: algumas posições preenchidas para visual de localização. */
const OCCUPIED = new Set([
  'A1', 'A2', 'A5', 'B3', 'B4', 'C1', 'C8', 'D2', 'D3', 'D4',
  'E6', 'E7', 'F1', 'F10', 'G5', 'H2', 'H3', 'H9',
]);

const SELECTED = 'D3';

export function CryoBoxGridMock() {
  return (
    <div className="card-surface overflow-x-auto">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-foreground">CryoBox · Localização de amostras</h3>
          <p className="text-sm text-muted-foreground">Grade 8×10 mock — posições ocupadas / livres / selecionada</p>
        </div>
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-primary" /> Ocupada</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-border bg-white" /> Livre</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-brand-cyan" /> Selecionada</span>
        </div>
      </div>
      <div className="inline-block min-w-max">
        <div className="mb-1 grid grid-cols-[28px_repeat(10,minmax(36px,1fr))] gap-1">
          <div />
          {COLS.map((c) => (
            <div key={c} className="text-center text-xs font-medium text-muted-foreground">{c}</div>
          ))}
        </div>
        {ROWS.map((row) => (
          <div key={row} className="mb-1 grid grid-cols-[28px_repeat(10,minmax(36px,1fr))] gap-1">
            <div className="flex items-center justify-center text-xs font-medium text-muted-foreground">{row}</div>
            {COLS.map((col) => {
              const id = `${row}${col}`;
              const occupied = OCCUPIED.has(id);
              const selected = id === SELECTED;
              return (
                <button
                  key={id}
                  type="button"
                  title={id}
                  className={cn(
                    'flex h-9 items-center justify-center rounded-md border text-[10px] font-semibold transition-colors',
                    selected && 'border-brand-cyan bg-brand-cyan text-white',
                    !selected && occupied && 'border-primary/30 bg-primary text-white',
                    !selected && !occupied && 'border-border bg-white text-muted-foreground hover:bg-primary-soft',
                  )}
                >
                  {id}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
