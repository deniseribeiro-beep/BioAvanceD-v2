import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Button from '../components/UI/Button';
import { useLanguage } from '../contexts/LanguageContext';
import { sampleChainApi } from '../services/sampleChainApi';

export default function SampleLabelPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    sampleChainApi.getLabelBlob(id)
      .then(res => {
        const url = URL.createObjectURL(res.data);
        setBlobUrl(url);
      })
      .catch(err => {
        console.error(err);
        setError(err?.message || 'Erro ao buscar etiqueta');
      })
      .finally(() => setLoading(false));

    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [id]);

  const handleDownload = () => {
    if (!blobUrl || !id) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `label_${id}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handlePrint = () => {
    if (!blobUrl) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<img src="${blobUrl}" style="max-width:100%;height:auto;" />`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1>{t('samples.label') || 'Etiqueta da Amostra'}</h1>
        <div>
          <Button variant="secondary" onClick={handleDownload} style={{ marginRight: '0.5rem', padding: '0.35rem 0.6rem', fontSize: '0.9rem' }}>
            {t('common.download') || 'Download'}
          </Button>
          <Button variant="secondary" onClick={handlePrint} style={{ padding: '0.35rem 0.6rem', fontSize: '0.9rem' }}>
            {t('common.print') || 'Print'}
          </Button>
        </div>
      </div>

      {loading && <p>{t('common.loading') || 'Carregando...'}</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{t('common.error') || 'Erro'}: {error}</p>}
      {blobUrl && (
        <div style={{ textAlign: 'center' }}>
          <img src={blobUrl} alt="Label" style={{ maxWidth: '100%', border: '1px solid var(--surface)' }} />
        </div>
      )}
    </div>
  );
}
