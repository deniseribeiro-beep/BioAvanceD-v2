import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { sampleChainApi } from '../services/sampleChainApi';

export default function SampleMovementsPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLanguage();
  const [movements, setMovements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    sampleChainApi.getMovements(id)
      .then(res => setMovements(res.data || []))
      .catch(err => {
        console.error(err);
        setError(err?.message || 'Erro ao carregar movimentos');
      })
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="page">
      <h1>{t('samples.movements') || 'Movimentações'}</h1>

      {loading && <p>{t('common.loading') || 'Carregando...'}</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {!loading && !error && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>{t('common.date') || 'Data'}</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>{t('samples.type') || 'Tipo'}</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>{t('samples.responsible') || 'Responsável'}</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>{t('common.details') || 'Detalhes'}</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--surface)' }}>
                  <td style={{ padding: '0.5rem' }}>{m.timestamp || m.createdAt || '-'}</td>
                  <td style={{ padding: '0.5rem' }}>{m.type || '-'}</td>
                  <td style={{ padding: '0.5rem' }}>{m.userAnonId || '-'}</td>
                  <td style={{ padding: '0.5rem' }}>{m.metadata ? JSON.stringify(m.metadata) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {movements.length === 0 && <p style={{ color: 'var(--text-light)', marginTop: '0.5rem' }}>{t('samples.noMovements') || 'Nenhuma movimentação encontrada'}</p>}
        </div>
      )}
    </div>
  );
}
