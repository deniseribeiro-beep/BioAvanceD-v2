import { Sample } from '../types/models';

export type SampleLifecycleStatus = NonNullable<Sample['status']>;

type Props = {
  status: SampleLifecycleStatus;
};

const palette: Record<SampleLifecycleStatus, { bg: string; fg: string; label: string }> = {
  AVAILABLE: { bg: '#e1f5eb', fg: '#009E73', label: 'Disponível' },
  QUARANTINED: { bg: '#fff4db', fg: '#b7791f', label: 'Quarentena' },
  PARTIAL: { bg: '#e6f3fb', fg: '#56B4E9', label: 'Parcial' },
  DEPLETED: { bg: '#f4f4f4', fg: '#777777', label: 'Esgotada' },
  UNAVAILABLE: { bg: '#ffe8dc', fg: '#D55E00', label: 'Indisponível' },
  CLOSED: { bg: '#e9e9ee', fg: '#4a4a55', label: 'Encerrada' },
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
