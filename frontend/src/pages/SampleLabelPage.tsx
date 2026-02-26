import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import BarcodeLabel from '../components/BarcodeLabel';
import { useSamples } from '../hooks/useSamples';

export default function SampleLabelPage() {
  const { id } = useParams<{ id: string }>();
  const { samples, loading } = useSamples();
  const [hasPrinted, setHasPrinted] = useState(false);

  const sample = useMemo(() => {
    if (!samples || !id) return null;
    const search = String(id).trim().toLowerCase();
    return samples.find((s) => {
      const keys = [
        s._id,
        s.sampleID,
        s.barcode,
      ].map((v) => String(v ?? '').trim().toLowerCase());
      return keys.includes(search);
    }) || null;
  }, [samples, id]);

  const formattedBarcode = useMemo(() => {
    if (!sample) return '';
    const base =
      sample.barcode ||
      sample.sampleID ||
      sample._id ||
      '';
    const value = String(base).trim();
    if (!value) return '';
    return value.startsWith('BR-') ? value : `BR-${value}`;
  }, [sample]);

  const displaySampleId = useMemo(() => {
    if (!sample) return '';
    return sample.sampleID || sample._id || formattedBarcode || '';
  }, [sample, formattedBarcode]);

  const handlePrint = () => {
    if (hasPrinted) return;
    window.print();
    setHasPrinted(true);
  };

  if (loading && !sample) {
    return (
      <div className="page">
        <p>Carregando...</p>
      </div>
    );
  }

  if (!sample) {
    return (
      <div className="page">
        <p>Amostra não encontrada.</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">Etiqueta</h1>
        <Button variant="primary" onClick={handlePrint} disabled={hasPrinted}>
          {hasPrinted ? 'Impressão realizada' : 'Imprimir Etiqueta'}
        </Button>
      </div>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
          <BarcodeLabel
            sampleId={String(displaySampleId)}
            barcode={formattedBarcode}
            acronym={sample.sampleType || 'Amostra'}
          />
        </div>
      </Card>
    </div>
  );
}
