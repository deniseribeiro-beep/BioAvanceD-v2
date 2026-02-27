import { useRef, useState } from 'react';
import { FileText, UploadCloud, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import './UploadConsentimento.css';

const MAX_FILE_SIZE_MB = 5;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const isPdfFile = (file) => {
  if (!file) return false;

  const mimeIsPdf = file.type === 'application/pdf';
  const extensionIsPdf = file.name.toLowerCase().endsWith('.pdf');
  return mimeIsPdf || extensionIsPdf;
};

const formatFileSize = (sizeInBytes) => {
  const sizeInMb = sizeInBytes / (1024 * 1024);
  return `${sizeInMb.toFixed(2)} MB`;
};

export default function UploadConsentimento() {
  const inputRef = useRef(null);
  const [doadorId, setDoadorId] = useState('');
  const [arquivo, setArquivo] = useState(null);
  const [dragAtivo, setDragAtivo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sucesso, setSucesso] = useState('');
  const [erro, setErro] = useState('');

  const limparFeedback = () => {
    setSucesso('');
    setErro('');
  };

  const validarArquivo = (file) => {
    if (!file) {
      setErro('Selecione um arquivo PDF para continuar.');
      return false;
    }

    if (!isPdfFile(file)) {
      setErro('Formato inválido. Apenas arquivos .pdf são permitidos.');
      return false;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setErro(`O arquivo excede ${MAX_FILE_SIZE_MB} MB. Tamanho atual: ${formatFileSize(file.size)}.`);
      return false;
    }

    return true;
  };

  const selecionarArquivo = (file) => {
    limparFeedback();

    if (!validarArquivo(file)) {
      setArquivo(null);
      return;
    }

    setArquivo(file);
  };

  const onInputChange = (event) => {
    const file = event.target.files?.[0] || null;
    selecionarArquivo(file);
  };

  const onDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!loading) {
      setDragAtivo(true);
    }
  };

  const onDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragAtivo(false);
  };

  const onDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragAtivo(false);

    if (loading) return;

    const file = event.dataTransfer.files?.[0] || null;
    selecionarArquivo(file);
  };

  const enviarConsentimento = async (event) => {
    event.preventDefault();
    limparFeedback();

    const donorIdLimpo = doadorId.trim();
    if (!donorIdLimpo) {
      setErro('Informe o ID do Doador.');
      return;
    }

    if (!validarArquivo(arquivo)) {
      return;
    }

    const formData = new FormData();
    formData.append('doadorId', donorIdLimpo);
    formData.append('arquivo', arquivo);

    setLoading(true);

    try {
      const response = await fetch('/api/v1/consent/upload', {
        method: 'POST',
        body: formData,
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const mensagemErro = payload?.message || payload?.error || 'Falha ao enviar o consentimento. Tente novamente.';
        throw new Error(mensagemErro);
      }

      setSucesso('PDF de consentimento enviado com sucesso e persistido no sistema.');
      setDoadorId('');
      setArquivo(null);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro inesperado ao enviar consentimento.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="upload-consentimento" aria-label="Upload de consentimento em PDF">
      <header className="upload-consentimento__header">
        <div>
          <h2>Upload do TCLE (PDF)</h2>
          <p>Anexe o termo de consentimento para manter a rastreabilidade documental do doador.</p>
        </div>
        <FileText size={24} aria-hidden="true" />
      </header>

      <form className="upload-consentimento__form" onSubmit={enviarConsentimento}>
        <label className="upload-consentimento__label" htmlFor="doador-id">
          ID do Doador
        </label>
        <input
          id="doador-id"
          type="text"
          value={doadorId}
          onChange={(event) => setDoadorId(event.target.value)}
          placeholder="Ex.: D-2026-000145"
          disabled={loading}
          className="upload-consentimento__input"
        />

        <label className="upload-consentimento__label" htmlFor="arquivo-consentimento">
          Documento de Consentimento (.pdf)
        </label>
        <div
          className={`upload-consentimento__dropzone ${dragAtivo ? 'is-drag-active' : ''} ${loading ? 'is-disabled' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          role="button"
          tabIndex={0}
          onClick={() => !loading && inputRef.current?.click()}
          onKeyDown={(event) => {
            if ((event.key === 'Enter' || event.key === ' ') && !loading) {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
        >
          <UploadCloud size={24} aria-hidden="true" />
          <p>
            {arquivo ? arquivo.name : 'Arraste e solte o PDF aqui ou clique para selecionar'}
          </p>
          <span>Limite de {MAX_FILE_SIZE_MB} MB • Apenas .pdf</span>

          <input
            ref={inputRef}
            id="arquivo-consentimento"
            type="file"
            accept=".pdf,application/pdf"
            onChange={onInputChange}
            disabled={loading}
            className="upload-consentimento__file-input"
          />
        </div>

        {loading && (
          <div className="upload-consentimento__feedback upload-consentimento__feedback--loading" role="status" aria-live="polite">
            <Loader2 size={18} className="upload-consentimento__spinner" />
            Enviando consentimento...
          </div>
        )}

        {sucesso && !loading && (
          <div className="upload-consentimento__feedback upload-consentimento__feedback--success" role="status" aria-live="polite">
            <CheckCircle2 size={18} />
            {sucesso}
          </div>
        )}

        {erro && !loading && (
          <div className="upload-consentimento__feedback upload-consentimento__feedback--error" role="alert" aria-live="assertive">
            <AlertCircle size={18} />
            {erro}
          </div>
        )}

        <button type="submit" className="upload-consentimento__submit" disabled={loading}>
          {loading ? 'Enviando...' : 'Enviar Consentimento'}
        </button>
      </form>
    </section>
  );
}
