import { SampleMovementItem } from '@/hooks/samples/useSampleMovements';
import { mapMovementTypeLabel, TranslatorFn } from './movementTypeLabel';

interface SampleMovementsViewProps {
  t: TranslatorFn;
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  movements: SampleMovementItem[];
}

export default function SampleMovementsView({ t, loading, error, errorCode, movements }: SampleMovementsViewProps) {
  return (
    <div className="page-shell">
      <h1>{t('samples.movements', 'Movimentações')}</h1>

      {loading && <p>{t('common.loading', 'Carregando...')}</p>}

      {!loading && error && (
        <div>
          <p style={{ color: 'var(--danger)' }}>{error}</p>
          {errorCode && (
            <p style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>
              Código de auditoria: {errorCode}
            </p>
          )}
        </div>
      )}

      {!loading && !error && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>{t('common.date', 'Data')}</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>{t('samples.type', 'Tipo')}</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>{t('samples.responsible', 'Responsável')}</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>{t('common.details', 'Detalhes')}</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((item) => (
                <tr key={item.id} style={{ borderTop: '1px solid var(--surface)' }}>
                  <td style={{ padding: '0.5rem' }}>{item.timestamp}</td>
                  <td style={{ padding: '0.5rem' }}>{mapMovementTypeLabel(item.type, t)}</td>
                  <td style={{ padding: '0.5rem' }}>{item.responsible}</td>
                  <td style={{ padding: '0.5rem' }}>{item.details}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {movements.length === 0 && (
            <p style={{ color: 'var(--text-light)', marginTop: '0.5rem' }}>
              {t('samples.noMovements', 'Nenhuma movimentação encontrada')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
