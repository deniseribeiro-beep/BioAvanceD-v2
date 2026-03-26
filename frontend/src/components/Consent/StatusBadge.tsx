import React from 'react';

export type ConsentStatus = 'GRANTED' | 'REVOKED' | 'PENDING' | 'EXPIRED';

interface StatusBadgeProps {
  status: ConsentStatus;
}

const statusMap: Record<ConsentStatus, { label: string; color: string }> = {
  GRANTED: { label: 'Assinado', color: '#22c55e' },
  REVOKED: { label: 'Revogado', color: '#ef4444' },
  PENDING: { label: 'Pendente', color: '#f59e42' },
  EXPIRED: { label: 'Expirado', color: '#6b7280' }
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const { label, color } = statusMap[status] || statusMap.EXPIRED;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.25em 0.75em',
        borderRadius: '999px',
        background: color + '22',
        color,
        fontWeight: 600,
        fontSize: '0.95em'
      }}
      title={label}
    >
      {label}
    </span>
  );
}
