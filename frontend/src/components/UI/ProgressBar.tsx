type ProgressBarProps = {
  value: number;
  label?: string;
  status?: string;
};

export default function ProgressBar({ value, label, status }: ProgressBarProps) {
  const clampedValue = Math.max(0, Math.min(100, Number(value || 0)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      {(label || status) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.875rem' }}>
          <span style={{ color: 'var(--text-light)' }}>{label || 'Progresso'}</span>
          <span style={{ fontWeight: 600 }}>{status || `${clampedValue}%`}</span>
        </div>
      )}
      <div
        aria-label={label || 'Progresso'}
        style={{
          width: '100%',
          height: '10px',
          borderRadius: '999px',
          overflow: 'hidden',
          backgroundColor: 'var(--surface-2, #e5e7eb)',
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.04)'
        }}
      >
        <div
          style={{
            width: `${clampedValue}%`,
            height: '100%',
            borderRadius: '999px',
            transition: 'width 250ms ease',
            background: clampedValue >= 100
              ? 'linear-gradient(90deg, #16a34a, #22c55e)'
              : 'linear-gradient(90deg, #0f766e, #14b8a6)'
          }}
        />
      </div>
    </div>
  );
}