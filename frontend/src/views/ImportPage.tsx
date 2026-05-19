
import { useState } from 'react';
import Card from '../components/UI/Card';
import ImportAdapter, { ImportDTO } from '../components/ImportAdapter';
import ImportResultSummary, { type ImportResultSummaryData } from '../components/ImportResultSummary';

export default function ImportPage() {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResultSummaryData | null>(null);

  // Fluxo legado descontinuado: importação FHIR deve usar staging/TCLE/commit.
  const handleImportSubmit = async (importData: ImportDTO[]) => {
    setUploading(true);
    setResult(null);
    try {
      setResult({
        success: false,
        error: `Fluxo legado descontinuado. ${importData.length} registro(s) não foram enviados. Use a Importação Inteligente FHIR com Validar lote.`,
      });
    } catch (err: any) {
      const errorMessage = err?.response?.data?.error || err?.response?.data?.message || err?.message;
      setResult({ success: false, error: errorMessage || 'Erro ao importar FHIR' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: '2rem auto' }}>
      <Card style={{ padding: 32, border: '1.5px dashed #a3a3a3', background: '#f9fafb' }}>
        <ImportAdapter onSubmit={handleImportSubmit} />
        {uploading && <div style={{ marginTop: 18, color: '#64748b' }}>Enviando dados para o backend...</div>}
        <ImportResultSummary result={result} style={{ marginTop: 18, fontSize: 15 }} />
      </Card>
    </div>
  );
}
