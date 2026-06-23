import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Card from '../components/UI/Card';
import { apiClient } from '../api/client';
import '../components/UI/Button.css';

type LabelData = {
  sampleId: string;
  barcode: string;
  location: string;
  sprecCode?: string;
  svg?: string;
};

export default function SampleLabelPage() {
  const { id } = useParams<{ id: string }>();
  const [label, setLabel] = useState<LabelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyFormat, setBusyFormat] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadLabel() {
      if (!id) {
        setError('Amostra não informada.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');

      try {
        const response = await apiClient.get(`/labels/samples/${encodeURIComponent(id)}`);
        if (active) {
          setLabel(response?.data?.data || null);
        }
      } catch (err: any) {
        if (active) {
          setError(err?.response?.data?.error || err?.message || 'Amostra não encontrada.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadLabel();

    return () => {
      active = false;
    };
  }, [id]);

  const downloadOrOpenLabel = async (format: 'json' | 'zpl' | 'svg' | 'html' | 'print-job') => {
    if (!id) {
      return;
    }

    setActionError('');
    setBusyFormat(format);

    try {
      const endpoint = format === 'print-job'
        ? `/labels/samples/${encodeURIComponent(id)}/print-job`
        : `/labels/samples/${encodeURIComponent(id)}`;
      const response = await apiClient.get(endpoint, {
        params: format === 'print-job' ? undefined : { format },
        responseType: format === 'json' || format === 'print-job' ? 'json' : 'text',
        suppressErrorToast: true,
      } as any);

      if (format === 'json' || format === 'print-job') {
        const payload = format === 'print-job' ? response?.data?.data || response?.data || {} : response?.data?.data || response?.data || {};
        const fileName = format === 'print-job' ? `label-${id}-print-job.json` : `label-${id}.json`;
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
        return;
      }

      const text = String(response?.data || '');
      const mimeType = format === 'svg'
        ? 'image/svg+xml;charset=utf-8'
        : format === 'html'
          ? 'text/html;charset=utf-8'
          : 'text/plain;charset=utf-8';
      const blob = new Blob([text], { type: mimeType });
      const url = URL.createObjectURL(blob);

      if (format === 'html' || format === 'svg') {
        window.open(url, '_blank', 'noopener,noreferrer');
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        return;
      }

      const link = document.createElement('a');
      link.href = url;
      link.download = format === 'zpl' ? `label-${id}.zpl` : `label-${id}.txt`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setActionError(err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Falha ao gerar etiqueta.');
    } finally {
      setBusyFormat(null);
    }
  };

  const sampleId = label?.sampleId || id || '';
  const encodedSampleId = encodeURIComponent(sampleId);

  if (loading) {
    return (
      <div className="page">
        <p>Carregando...</p>
      </div>
    );
  }

  if (error || !label) {
    return (
      <div className="page">
        <p>{error || 'Amostra não encontrada.'}</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">Etiqueta</h1>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" type="button" disabled={busyFormat === 'json'} onClick={() => void downloadOrOpenLabel('json')}>
            {busyFormat === 'json' ? 'Gerando...' : 'JSON'}
          </button>
          <button className="btn btn-secondary" type="button" disabled={busyFormat === 'zpl'} onClick={() => void downloadOrOpenLabel('zpl')}>
            {busyFormat === 'zpl' ? 'Gerando...' : 'ZPL'}
          </button>
          <button className="btn btn-secondary" type="button" disabled={busyFormat === 'svg'} onClick={() => void downloadOrOpenLabel('svg')}>
            {busyFormat === 'svg' ? 'Abrindo...' : 'SVG'}
          </button>
          <button className="btn btn-secondary" type="button" disabled={busyFormat === 'html'} onClick={() => void downloadOrOpenLabel('html')}>
            {busyFormat === 'html' ? 'Abrindo...' : 'HTML'}
          </button>
          <button className="btn btn-primary" type="button" disabled={busyFormat === 'print-job'} onClick={() => void downloadOrOpenLabel('print-job')}>
            {busyFormat === 'print-job' ? 'Gerando...' : 'Print job'}
          </button>
        </div>
      </div>

      {actionError && (
        <Card>
          <p style={{ color: 'var(--danger)' }}>{actionError}</p>
        </Card>
      )}

      <Card>
        <div style={{ display: 'grid', gap: '1rem', justifyItems: 'center', padding: '2rem' }}>
          {label.svg ? (
            <div dangerouslySetInnerHTML={{ __html: label.svg }} />
          ) : (
            <div style={{ padding: '1rem', border: '1px solid #d1d5db', borderRadius: 8 }}>
              <strong>{label.sampleId}</strong>
              <p>{label.barcode}</p>
              <p>{label.location}</p>
              <p>{label.sprecCode || 'SPREC N/A'}</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
