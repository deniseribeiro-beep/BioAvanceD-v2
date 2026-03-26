
import { useRef, useState } from 'react';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import { UploadIcon } from 'lucide-react';
import ImportAdapter, { ImportDTO } from '../components/ImportAdapter';

export default function ImportPage() {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);

  // Função para enviar o array de ImportDTO ao backend
  const handleImportSubmit = async (importData: ImportDTO[]) => {
    setUploading(true);
    setResult(null);
    try {
      const response = await fetch('http://localhost:3000/api/import/fhir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importData),
      });
      const data = await response.json();
      setResult(data);
    } catch (err: any) {
      setResult({ error: err.message });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: '2rem auto' }}>
      <Card style={{ padding: 32, border: '1.5px dashed #a3a3a3', background: '#f9fafb' }}>
        <ImportAdapter onSubmit={handleImportSubmit} />
        {uploading && <div style={{ marginTop: 18, color: '#64748b' }}>Enviando dados para o backend...</div>}
        {result && (
          <div style={{ marginTop: 18, color: result.error ? '#dc2626' : '#16a34a', fontSize: 15 }}>
            {result.error ? result.error : result.message || 'Importação concluída!'}
            {result.patients !== undefined && (
              <div>
                Pacientes: {result.patients} | Amostras: {result.samples} | Consents: {result.consents}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
