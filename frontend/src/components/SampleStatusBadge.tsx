import { Sample } from '../types/models';

export type SampleLifecycleStatus = NonNullable<Sample['status']>;

type Props = {
  status: SampleLifecycleStatus;
};

const palette: Record<SampleLifecycleStatus, { bg: string; fg: string; label: string }> = { // RNF027 C2 (#1324): each fg was 2.0-4.1:1 on its bg at 12px; these are the same hues darkened to 4.6:1 or more.
  AVAILABLE: { bg: '#e1f5eb', fg: '#007a59', label: 'Disponível' },
  QUARANTINED: { bg: '#fff4db', fg: '#966319', label: 'Quarentena' },
  PARTIAL: { bg: '#e6f3fb', fg: '#1571a5', label: 'Parcial' },
  DEPLETED: { bg: '#f4f4f4', fg: '#6e6e6e', label: 'Esgotada' },
  UNAVAILABLE: { bg: '#ffe8dc', fg: '#ac4c00', label: 'Indisponível' },
  CLOSED: { bg: '#e9e9ee', fg: '#4a4a55', label: 'Encerrada' },
  UNKNOWN: { bg: '#f4f4f4', fg: '#6e6e6e', label: 'Não registrada' },
};

export default function SampleStatusBadge({ status }: Props) {
  const normalized = (status || 'AVAILABLE').toUpperCase() as SampleLifecycleStatus;
  const colors = palette[normalized] || palette.AVAILABLE;

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.35rem 0.7rem',
        borderRadius: '999px',
        fontSize: '0.78rem',
        fontWeight: 700,
        letterSpacing: '0.2px',
        backgroundColor: colors.bg,
        color: colors.fg,
        textTransform: 'uppercase',
      }}
    >
      {colors.label}
    </span>
  );
}
