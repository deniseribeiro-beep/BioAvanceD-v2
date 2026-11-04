import { useParams, useNavigate } from 'react-router-dom';
import Button from '../components/UI/Button';
import Card from '../components/UI/Card';
import { useLanguage } from '../contexts/LanguageContext';

export default function SampleChainPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { t } = useLanguage();

  return (
    <div className="page-shell">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1>{t('samples.chain') || 'Cadeia de Custódia'}</h1>
      </div>

      <Card>
        <p style={{ marginBottom: '0.75rem', color: 'var(--text)' }}>
          {t('samples.chainDescription') || 'Acompanhe os registros de movimentação da amostra e utilize a tela dedicada para registrar retiradas e devoluções.'}
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => navigate(`/samples/${id}/movements`)}>
            {t('samples.viewSampleMovements', 'Ver movimentos da amostra')}
          </Button>
          <Button variant="primary" onClick={() => navigate('/samples/custody-reports')}>
            {t('navigation.custodyReports', 'Relatórios de Custódia')}
          </Button>
          <Button variant="secondary" onClick={() => navigate('/samples/withdrawal-return')}>
            {t('samples.withdrawalReturn', 'Ir para Retirada/Devolução')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
