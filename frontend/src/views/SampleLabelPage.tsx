import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import { apiClient } from '../api/client';

type SymbologyAsset = {
  payload: string;
  scannerPrefix: string;
  renderer: string;
  imagePng: { mimeType: string; base64: string | null };
};

type LabelData = {
  sampleId: string;
  barcode: string;
  code128: SymbologyAsset;
  dataMatrix: SymbologyAsset;
  qr: SymbologyAsset;
};

const SYMBOLOGY_ROWS: Array<{ key: 'code128' | 'dataMatrix' | 'qr'; testSlug: string; title: string }> = [
  { key: 'code128', testSlug: 'code128', title: 'Code128' },
  { key: 'dataMatrix', testSlug: 'data-matrix', title: 'DataMatrix' },
  { key: 'qr', testSlug: 'qr', title: 'QR' },
];

export default function SampleLabelPage() {
  const { id } = useParams<{ id: string }>();
  const [label, setLabel] = useState<LabelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);

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
        const sampleResponse = await apiClient.get(`/samples/${encodeURIComponent(id)}`);
        const sample = sampleResponse?.data?.data;
        if (!sample?.barcode) {
          throw new Error('Amostra sem código de barras gerado.');
        }

        const symbologyResponse = await apiClient.get(
          `/samples/by-barcode/${encodeURIComponent(sample.barcode)}/symbology-assets`,
          { params: { includePayload: true } },
        );
        const assets = symbologyResponse?.data?.data;

        if (active) {
          setLabel({
            sampleId: String(sample.specimenId ?? sample._id ?? id),
            barcode: assets.barcode,
            code128: assets.code128,
            dataMatrix: assets.dataMatrix,
            qr: assets.qr,
          });
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

  const downloadPrintJob = async () => {
    // The button renders only once a label has loaded, which needs an id; this
    // guard only narrows useParams' optional id for the type checker.
    if (!id) return;

    setActionError('');
    setBusyAction('print-job');

    try {
      const response = await apiClient.get(`/samples/${encodeURIComponent(id)}/label/print-job`, {
        suppressErrorToast: true,
      } as any);
      const payload = response?.data?.data || {};
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `label-${id}-print-job.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setActionError(err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Falha ao gerar job de impressão.');
    } finally {
      setBusyAction(null);
    }
  };

  if (loading) {
    return (
      <div className="page-shell" data-testid="sample-label-loading">
        <p>Carregando...</p>
      </div>
    );
  }

  if (error || !label) {
    return (
      <div className="page-shell" data-testid="sample-label-error">
        <p>{error || 'Amostra não encontrada.'}</p>
      </div>
    );
  }

  return (
    <div className="page-shell" data-testid="sample-label-page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">Etiqueta</h1>
        <Button
          type="button"
          variant="primary"
          data-testid="sample-label-print-job-button"
          disabled={busyAction === 'print-job'}
          onClick={() => void downloadPrintJob()}
        >
          {busyAction === 'print-job' ? 'Gerando...' : 'Print job (ZPL)'}
        </Button>
      </div>

      {actionError && (
        <Card>
          <p style={{ color: 'var(--danger)' }} data-testid="sample-label-action-error">{actionError}</p>
        </Card>
      )}

      <Card>
        <div style={{ display: 'grid', gap: '1.5rem', justifyItems: 'center', padding: '2rem' }} data-testid="sample-label-symbology">
          <p style={{ fontWeight: 600 }} data-testid="sample-label-barcode">{label.barcode}</p>
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            {SYMBOLOGY_ROWS.map(({ key, testSlug, title }) => {
              const asset = label[key];
              return (
                <div key={key} data-testid={`sample-label-${testSlug}`} style={{ textAlign: 'center' }}>
                  <p>{title}</p>
                  {asset.imagePng.base64 ? (
                    <img
                      src={`data:${asset.imagePng.mimeType};base64,${asset.imagePng.base64}`}
                      alt={`${title} ${label.barcode}`}
                      data-testid={`sample-label-${testSlug}-image`}
                    />
                  ) : (
                    <p data-testid={`sample-label-${testSlug}-pending`}>Gerando imagem...</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </div>
  );
}
