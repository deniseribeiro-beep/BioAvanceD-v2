import React from 'react';

const STATUS_MAP = {
  Optimal: { label: 'Boa / Adequada', color: '#22c55e' },
  Suboptimal: { label: 'Subótima / Com Restrições', color: '#eab308' },
  Compromised: { label: 'Comprometida / Inadequada', color: '#ef4444' },
};

export default function MiabisStatusLabel({ status = 'Optimal', i18n = {} }) {
  const { label, color } = STATUS_MAP[status] || STATUS_MAP.Optimal;
  const display = i18n[status] || label;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: '#f1f5f9',
        borderRadius: 6,
        padding: '4px 12px',
        border: `1px solid ${color}`,
        minWidth: 120,
        fontWeight: 600,
        color,
        fontSize: 14,
        opacity: 0.85,
        userSelect: 'none',
      }}
      aria-label={display}
      tabIndex={-1}
    >
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
      <span>{display}</span>
    </div>
  );
}
