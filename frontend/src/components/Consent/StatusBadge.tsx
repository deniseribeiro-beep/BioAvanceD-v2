import { CSSProperties, useMemo } from 'react';

export type ConsentStatus = 'GRANTED' | 'PENDING' | 'REVOKED' | 'EXPIRED' | string;

type StatusBadgeProps = {
  status?: ConsentStatus;
};

type BadgePalette = {
  bg: string;
  fg: string;
  label: string;
};

const palette: Record<string, BadgePalette> = {
  GRANTED: { bg: '#e1f5eb', fg: '#007a4d', label: 'Assinado' },
  PENDING: { bg: '#fff1db', fg: '#b65a00', label: 'Pendente' },
  REVOKED: { bg: '#ffe3e3', fg: '#b00020', label: 'Revogado' },
  DEFAULT: { bg: '#f1f3f5', fg: '#6b7280', label: 'Expirado' }
};

const styles: Record<string, CSSProperties> = {
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.35rem 0.75rem',
    borderRadius: '999px',
    fontSize: '0.75rem',
    fontWeight: 700,
    letterSpacing: '0.3px',
    textTransform: 'uppercase',
    lineHeight: 1
  }
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const normalized = useMemo(() => (status || '').toString().trim().toUpperCase(), [status]);
  const colors = palette[normalized] || palette.DEFAULT;
  const badgeStyle: CSSProperties = {
    ...styles.badge,
    backgroundColor: colors.bg,
    color: colors.fg
  };

  return <span style={badgeStyle}>{colors.label}</span>;
}
