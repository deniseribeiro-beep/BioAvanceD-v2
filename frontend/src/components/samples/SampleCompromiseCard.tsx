import { useEffect, useState } from 'react';
import Card from '../UI/Card';
import { sampleService, type SampleGraphStatus } from '../../services/api';

type TranslatorFn = (key: string, fallback?: string) => string;

type GraphState = 'loading' | 'clear' | 'compromised' | 'unavailable';

interface SampleCompromiseCardProps {
  sampleId: string;
  t: TranslatorFn;
  locale: string;
}

// #1559: the projected graph status is compromised only for COMPROMISED; any
// other status, or none, is clear. A body without `data` is unavailable.
export function graphStateOf(data: SampleGraphStatus | null | undefined): GraphState {
  if (!data) return 'unavailable';
  if (data.status === 'COMPROMISED') return 'compromised';
  return 'clear';
}

const rowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '0.75rem',
  padding: '0.5rem',
  backgroundColor: 'var(--surface)',
  borderRadius: '4px',
} as const;

const labelStyle = { fontWeight: 500, color: 'var(--text-light)' } as const;

// #1559: GET /samples/:id/graph-status projects the cold-chain compromise a
// freezer breach marked on the sample; the card names the freezer and the
// times the breach began and the sample was marked compromised.
export default function SampleCompromiseCard({ sampleId, t, locale }: SampleCompromiseCardProps) {
  const [state, setState] = useState<GraphState>('loading');
  const [data, setData] = useState<SampleGraphStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setData(null);
    const load = async () => {
      try {
        const response = await sampleService.getGraphStatus(sampleId);
        const next = response?.data?.data ?? null;
        if (cancelled) return;
        setData(next);
        setState(graphStateOf(next));
      } catch {
        if (!cancelled) setState('unavailable');
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [sampleId]);

  const notAvailable = t('common.notAvailable', 'N/A');
  const formatTime = (value: string | null | undefined) => {
    if (!value) return notAvailable;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? notAvailable : parsed.toLocaleString(locale);
  };

  return (
    <div data-testid="sample-graph-status" data-state={state}>
      {state === 'compromised' && data && (
        <Card>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--danger)' }}>
            {t('samples.detail.compromiseTitle', 'Cadeia de frio comprometida')}
          </h3>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={rowStyle}>
              <span style={labelStyle}>{t('samples.detail.compromiseFreezer', 'Freezer')}:</span>
              <span data-testid="sample-compromise-freezer" style={{ color: 'var(--text)' }}>
                {data.compromiseFreezerKey ?? notAvailable}
              </span>
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>{t('samples.detail.compromiseBreachedSince', 'Fora da faixa desde')}:</span>
              <span data-testid="sample-compromise-breached-since" style={{ color: 'var(--text)' }}>
                {formatTime(data.compromiseBreachedSince)}
              </span>
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>{t('samples.detail.compromisedAt', 'Marcada como comprometida em')}:</span>
              <span data-testid="sample-compromise-marked-at" style={{ color: 'var(--text)' }}>
                {formatTime(data.compromisedAt)}
              </span>
            </div>
          </div>
        </Card>
      )}
      {state === 'unavailable' && (
        <p style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>
          {t('samples.detail.compromiseUnavailable', 'Estado projetado indisponível.')}
        </p>
      )}
    </div>
  );
}
