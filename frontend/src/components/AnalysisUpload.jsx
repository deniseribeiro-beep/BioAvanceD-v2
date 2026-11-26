import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, File, FileImage, FileText, UploadCloud, Barcode, AlertCircle, CheckCircle, Loader } from 'lucide-react';
import Button from './UI/Button';
import Input from './UI/Input';
import { analysisFileService } from '../services/api';

const formatBytes = (bytes) => {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(2)} ${units[index]}`;
};

const getExtension = (name) => {
  const parts = String(name || '').toLowerCase().split('.');
  return parts.length > 1 ? `.${parts.pop()}` : '';
};

const getFileIcon = (extension) => {
  if (['.jpg', '.jpeg', '.png'].includes(extension)) {
    return FileImage;
  }
  if (['.pdf', '.txt', '.csv', '.raw', '.fcs'].includes(extension)) {
    return FileText;
  }
  if (['.zip', '.rar'].includes(extension)) {
    return Archive;
  }
  return File;
};

export default function AnalysisUpload({ sampleId: initialSampleId = '' }) {
  const [file, setFile] = useState(null);
  const [sampleId, setSampleId] = useState(initialSampleId);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(null);
  const [qrScanMode, setQrScanMode] = useState(false);
  // Debounce timer for the typed sample id (#1444): each keystroke cancels the
  // pending one, so only the latest value is validated once typing pauses.
  const validationTimerRef = useRef(null);
  // Sequence number of the latest validation (#1444): a newer request or an
  // edit of the id bumps it, so a late response for a superseded id is dropped.
  const validationSeqRef = useRef(0);

  useEffect(() => () => clearTimeout(validationTimerRef.current), []);

  const extension = useMemo(() => getExtension(file?.name), [file]);
  const FileIcon = useMemo(() => getFileIcon(extension), [extension]);

  const handleFileChange = (event) => {
    const selectedFile = event.target.files?.[0] || null;
    setFile(selectedFile);
    setProgress(0);
    setError('');
    setSuccess('');
  };

  const validateSampleId = async (id) => {
    const seq = ++validationSeqRef.current;
    setValidated(null);
    if (!id || id.trim() === '') {
      return;
    }

    setValidating(true);
    setError('');
    try {
      const response = await analysisFileService.validateSample(id);
      if (seq !== validationSeqRef.current) return;
      // validateSample resolves to the Axios response; the result is its body.
      const result = response?.data ?? {};

      if (result.success) {
        setValidated({
          success: true,
          sample: result.sample,
          patient: result.patient
        });
      } else {
        setValidated({
          success: false,
          error: result.error || 'Falha na validação'
        });
      }
    } catch (err) {
      if (seq !== validationSeqRef.current) return;
      const errorMessage = err?.response?.data?.error || err?.message || 'Erro ao validar amostra';
      setValidated({
        success: false,
        error: errorMessage
      });
    } finally {
      if (seq === validationSeqRef.current) setValidating(false);
    }
  };

  const handleSampleIdChange = async (event) => {
    const value = event.target.value;
    setSampleId(value);
    
    // Valida apenas após parar de digitar (com delay)
    clearTimeout(validationTimerRef.current);
    validationTimerRef.current = null;
    // An edited id drops the previous result and any validation in flight.
    validationSeqRef.current += 1;
    setValidated(null);
    setValidating(false);
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      validationTimerRef.current = setTimeout(() => {
        validationTimerRef.current = null;
        validateSampleId(trimmed);
      }, 800);
    }
  };

  const handleQrInput = async (event) => {
    const scannedValue = event.target.value.trim();
    if (scannedValue) {
      clearTimeout(validationTimerRef.current);
      validationTimerRef.current = null;
      setSampleId(scannedValue);
      await validateSampleId(scannedValue);
      setQrScanMode(false);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Selecione um arquivo para upload');
      return;
    }
    if (!sampleId) {
      setError('Informe o ID da amostra');
      return;
    }
    if (!validated?.success) {
      setError('Valide a amostra antes de enviar');
      return;
    }

    setUploading(true);
    setError('');
    setSuccess('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('sampleId', sampleId);

      await analysisFileService.upload(formData, (event) => {
        if (!event.total) return;
        const percent = Math.round((event.loaded * 100) / event.total);
        setProgress(percent);
      });

      setSuccess('Arquivo enviado com sucesso');
      setFile(null);
      setProgress(0);
      setSampleId('');
      setValidated(null);
    } catch (err) {
      const message = err?.response?.data?.error || err?.message || 'Erro ao enviar arquivo';
      setError(message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="analysis-upload">
      <div className="analysis-upload-header">
        <div>
          <h3 className="analysis-upload-title">Upload de Arquivo de Analise</h3>
          <p className="analysis-upload-subtitle">Envie imagens, documentos e dados brutos com acompanhamento de progresso.</p>
        </div>
        <UploadCloud size={24} className="analysis-upload-icon" />
      </div>

      <div className="analysis-upload-grid">
        <div className="analysis-upload-field">
          <label htmlFor="analysis-file">Arquivo</label>
          <input
            id="analysis-file"
            type="file"
            onChange={handleFileChange}
            disabled={uploading}
          />
        </div>

        <div className="analysis-upload-field">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <label>ID da Amostra</label>
            <button 
              type="button"
              onClick={() => setQrScanMode(!qrScanMode)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                fontSize: '12px',
                background: 'none',
                border: 'none',
                color: '#0066cc',
                cursor: 'pointer'
              }}
            >
              <Barcode size={14} /> QR Code
            </button>
          </div>
          
          {qrScanMode ? (
            <Input
              autoFocus
              type="text"
              onBlur={() => setQrScanMode(false)}
              onChange={handleQrInput}
              placeholder="Escaneie o código de barras/QR code"
              disabled={uploading}
            />
          ) : (
            <Input
              value={sampleId}
              onChange={handleSampleIdChange}
              placeholder="Digite o ID, código de barras ou escaneie QR code"
              disabled={uploading}
            />
          )}
        </div>
      </div>

      {/* Validação Status */}
      {validating && (
        <div className="analysis-upload-validating">
          <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} />
          <span>Validando amostra...</span>
        </div>
      )}

      {validated && (
        <div className={`analysis-upload-validation ${validated.success ? 'success' : 'error'}`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {validated.success ? (
              <>
                <CheckCircle size={18} style={{ color: '#22c55e' }} />
                <div style={{ fontSize: '14px', color: '#16a34a' }}>
                  <strong>✓ Amostra válida:</strong> {validated.sample.specimenId || validated.sample._id} ({validated.sample.barcode})
                  <br />
                  <small>Paciente com consentimento assinado</small>
                </div>
              </>
            ) : (
              <>
                <AlertCircle size={18} style={{ color: '#ef4444' }} />
                <div style={{ fontSize: '14px', color: '#991b1b' }}>
                  <strong>✗ Erro:</strong> {validated.error}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {file && (
        <div className="analysis-upload-file">
          <div className="analysis-upload-file-icon">
            <FileIcon size={20} />
          </div>
          <div className="analysis-upload-file-details">
            <div className="analysis-upload-file-name">{file.name}</div>
            <div className="analysis-upload-file-meta">
              <span>{extension || 'Sem extensao'}</span>
              <span>{formatBytes(file.size)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="analysis-upload-progress">
        <div className="analysis-upload-progress-bar">
          <div
            className="analysis-upload-progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="analysis-upload-progress-label">{progress}%</span>
      </div>

      {error && <div className="analysis-upload-error">{error}</div>}
      {success && <div className="analysis-upload-success">{success}</div>}

      <Button 
        variant="primary" 
        onClick={handleUpload} 
        disabled={uploading || !validated?.success}
      >
        {uploading ? 'Enviando...' : 'Enviar Arquivo'}
      </Button>
    </div>
  );
}
