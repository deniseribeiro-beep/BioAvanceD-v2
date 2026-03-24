import { useRef, useState } from 'react';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import { CloudUpload } from 'lucide-react';

export default function ImportPage() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Dropzone handlers
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files).filter(f =>
      ['application/json', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'].includes(f.type) ||
      f.name.endsWith('.json') || f.name.endsWith('.csv') || f.name.endsWith('.xlsx')
    );
    setSelectedFiles(prev => [...prev, ...files]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setSelectedFiles(prev => [...prev, ...files]);
  };

  const handleRemoveFile = (idx: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const handleClickDropzone = () => {
    inputRef.current?.click();
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleProcess = async () => {
    if (selectedFiles.length === 0) return;
    setUploading(true);
    setResult(null);
    const formData = new FormData();
    selectedFiles.forEach(file => formData.append('files', file));
    try {
      const response = await fetch('http://localhost:3000/api/import/fhir', {
        method: 'POST',
        body: formData
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
    <div style={{ maxWidth: 600, margin: '2rem auto' }}>
      <Card style={{ padding: 32, border: '1.5px dashed #a3a3a3', background: '#f9fafb' }}>
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={handleClickDropzone}
          style={{
            border: '2px dashed #60a5fa',
            borderRadius: 12,
            padding: '2.5rem 1rem',
            textAlign: 'center',
            background: '#f1f5f9',
            cursor: 'pointer',
            marginBottom: 24,
            transition: 'border-color 0.2s',
          }}
        >
          <CloudUpload size={56} color="#60a5fa" style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 18, fontWeight: 500, color: '#334155' }}>Arraste e solte arquivos aqui</div>
          <div style={{ fontSize: 14, color: '#64748b', marginTop: 4 }}>
            ou clique para selecionar arquivos (.json, .csv, .xlsx)
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".json,.csv,.xlsx"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileChange}
            disabled={uploading}
          />
        </div>
        {selectedFiles.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontWeight: 500, marginBottom: 8 }}>Arquivos selecionados:</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {selectedFiles.map((file, idx) => (
                <li key={file.name + idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #e5e7eb' }}>
                  <span>{file.name} <span style={{ color: '#64748b', fontSize: 13 }}>({(file.size / 1024).toFixed(1)} KB)</span></span>
                  <button
                    onClick={e => { e.stopPropagation(); handleRemoveFile(idx); }}
                    style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: 18, cursor: 'pointer' }}
                    title="Remover arquivo"
                  >×</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Button onClick={handleProcess} disabled={uploading || selectedFiles.length === 0} style={{ width: '100%', fontSize: 16, padding: '0.75rem 0' }}>
          {uploading ? 'Processando...' : 'Processar Arquivos'}
        </Button>
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
