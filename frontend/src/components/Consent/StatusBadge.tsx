import React from 'react';

export type ConsentStatus =
  | 'GRANTED'
  | 'PARTIALLY_REVOKED'
  | 'REVOKED'
  | 'SUPERSEDED'
  | 'PENDING'
  | 'EXPIRED'
  | 'UNKNOWN';

interface StatusBadgeProps {
  status: ConsentStatus;
}

const statusMap: Record<ConsentStatus, { label: string; color: string; text: string }> = { // RNF027 C2 (#1324): `color` on its own 13% tint was 1.9-3.9:1 at 13px; `text` is the same hue darkened to 4.6:1 or more.
  GRANTED: { label: 'Assinado', color: '#22c55e', text: '#15793a' },
  PARTIALLY_REVOKED: { label: 'Revogado parcialmente', color: '#f97316', text: '#af4a04' },
  REVOKED: { label: 'Recusado', color: '#ef4444', text: '#cb1111' },
  SUPERSEDED: { label: 'Substituído', color: '#6366f1', text: '#4c4fef' },
  PENDING: { label: 'Pendente', color: '#f59e42', text: '#a25809' },
  EXPIRED: { label: 'Expirado', color: '#6b7280', text: '#616773' },
  UNKNOWN: { label: 'Desconhecido', color: '#9ca3af', text: '#626a79' }
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const { label, color, text } = statusMap[status] || statusMap.EXPIRED;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.25em 0.75em',
        borderRadius: '999px',
        background: color + '22',
        color: text,
        fontWeight: 600,
        fontSize: '0.95em'
      }}
      title={label}
    >
      {label}
    </span>
  );
}
