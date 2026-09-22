import { useMemo, useState } from 'react';
import { Archive, File, FileImage, FileText, UploadCloud, Barcode, AlertCircle, CheckCircle, Loader } from 'lucide-react';
import Button from './UI/Button';
import Input from './UI/Input';
import { analysisFileService } from '../services/api';
import './AnalysisUpload.css';

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

export default function AnalysisUpload({ specimenId: initialSpecimenId = '' }) {
  const [file, setFile] = useState(null);
  const [specimenId, setSpecimenId] = useState(initialSpecimenId);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(null);
  const [dataMatrixScanMode, setQrScanMode] = useState(false);

  const extension = useMemo(() => getExtension(file?.name), [file]);
  const FileIcon = useMemo(() => getFileIcon(extension), [extension]);

  const handleFileChange = (event) => {
    const selectedFile = event.target.files?.[0] || null;
    setFile(selectedFile);
    setProgress(0);
    setError('');
    setSuccess('');
  };

  const validateSpecimenId = async (id) => {
    if (!id || id.trim() === '') {
      setValidated(null);
      return;
    }

    setValidating(true);
    setError('');
    try {
      const response = await analysisFileService.validateSample(id);
      
      if (response.success) {
        setValidated({
          success: true,
          sample: response.sample,
          patient: response.patient
        });
      } else {
        setValidated({
          success: false,
          error: response.error || 'Falha na validação'
        });
      }
    } catch (err) {
      const errorMessage = err?.response?.data?.error || err?.message || 'Erro ao validar amostra';
      setValidated({
        success: false,
        error: errorMessage
      });
    } finally {
      setValidating(false);
    }
  };

  const handleSpecimenIdChange = async (event) => {
    const value = event.target.value;
    setSpecimenId(value);
    
    // Valida apenas após parar de digitar (com delay)
    if (value.trim().length > 0) {
      setTimeout(() => {
        if (value === specimenId) { // Verifica se o valor não mudou
          validateSpecimenId(value);
        }
      }, 800);
    } else {
      setValidated(null);
    }
  };

  const handleDataMatrixInput = async (event) => {
    const scannedValue = event.target.value.trim();
    if (scannedValue) {
      setSpecimenId(scannedValue);
      await validateSpecimenId(scannedValue);
      setQrScanMode(false);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Selecione um arquivo para upload');
      return;
    }
    if (!specimenId) {
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
      formData.append('specimenId', specimenId);

      await analysisFileService.upload(formData, (event) => {
        if (!event.total) return;
        const percent = Math.round((event.loaded * 100) / event.total);
        setProgress(percent);
      });

      setSuccess('Arquivo enviado com sucesso');
      setFile(null);
      setProgress(0);
      setSpecimenId('');
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
              onClick={() => setQrScanMode(!dataMatrixScanMode)}
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
              <Barcode size={14} /> Data Matrix
            </button>
          </div>
          
          {dataMatrixScanMode ? (
            <Input
              autoFocus
              type="text"
              onBlur={() => setQrScanMode(false)}
              onChange={handleDataMatrixInput}
              placeholder="Escaneie o Data Matrix"
              disabled={uploading}
            />
          ) : (
            <Input
              value={specimenId}
              onChange={handleSpecimenIdChange}
              placeholder="Digite o specimenId ou escaneie o Data Matrix"
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
                  <strong>✓ Amostra válida:</strong> {validated.sample.specimenId} ({validated.sample.barcode})
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
