import React, { useEffect, useRef, useState } from 'react';
import { Search, MapPin, AlertCircle, Loader, QrCode } from 'lucide-react';
import { storageApi } from '../services/storageApi';
import './SampleLocator.css';

interface SampleLocation {
  sampleID: string;
  barcode: string;
  storageLocation: {
    freezerName: string;
    shelfName: string;
    rackName: string;
    boxName: string;
    boxID: number;
    position: string;
    dimension: { rows: number; cols: number };
  };
}

interface SampleLocatorProps {}

export const SampleLocator: React.FC<SampleLocatorProps> = () => {
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SampleLocation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [scanMode, setScanMode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scanMode) {
      inputRef.current?.focus();
    }
  }, [scanMode]);

  const handleSearch = async () => {
    if (!searchInput.trim()) {
      setError('Por favor, insira um ID ou código de barras da amostra');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await storageApi.getSampleLocation(searchInput);
      if (response.success && response.data) {
        setResult(response.data as SampleLocation);
      } else {
        setError(`Amostra "${searchInput}" não encontrada no banco de dados.`);
      }
    } catch (err: any) {
      if (err.message?.includes('401') || err.message?.includes('token')) {
        setError('Sessão expirada. Por favor, faça login novamente.');
      } else if (err.message?.includes('404')) {
        setError(`Amostra "${searchInput}" não encontrada no banco de dados.`);
      } else {
        setError(`Erro ao buscar amostra: ${err.message || 'Erro desconhecido'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleToggleScanMode = () => {
    setScanMode((current) => !current);
    setError(null);
    inputRef.current?.focus();
  };

  const handleRelease = async () => {
    if (!result) return;

    setReleasing(true);
    setError(null);

    try {
      const response = await storageApi.releaseSample(result.sampleID);
      if (response.success) {
        setResult(null);
        setSearchInput('');
      } else {
        setError(`Erro ao liberar amostra: ${response.error}`);
      }
    } catch (err: any) {
      setError(`Erro ao liberar amostra: ${err.message || 'Erro desconhecido'}`);
    } finally {
      setReleasing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !loading) {
      handleSearch();
    }
  };

  return (
    <div className="sample-locator">
      <div className="sample-locator-header">
        <div className="sample-locator-title">
          <MapPin size={24} />
          <h3>Localizar Amostra</h3>
        </div>
        <p className="sample-locator-description">
          Encontre a localização exata de qualquer amostra no sistema de armazenagem
        </p>
      </div>

      <div className="sample-locator-search">
        <div className="search-input-group">
          <Search size={18} />
          <input
            ref={inputRef}
            type="text"
            placeholder={scanMode ? 'Escaneie barcode/QR code e pressione Enter...' : 'Digite o ID, barcode ou QR code da amostra...'}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            className="search-input"
          />
        </div>
        <div className="sample-locator-actions">
          <button onClick={handleSearch} disabled={loading} className="btn-search">
            {loading ? (
              <>
                <Loader size={16} className="spinner" />
                Buscando
              </>
            ) : (
              <>
                <Search size={16} />
                Pesquisar
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleToggleScanMode}
            disabled={loading}
            className={`btn-scan ${scanMode ? 'active' : ''}`}
            title="Ativar leitura por barcode/QR code"
          >
            <QrCode size={16} />
            {scanMode ? 'Leitura ativa' : 'Barcode/QR'}
          </button>
        </div>
      </div>

      <p className={`sample-locator-mode ${scanMode ? 'active' : ''}`}>
        {scanMode
          ? 'Modo de leitura ativo: mantenha o cursor no campo e escaneie o barcode ou QR code.'
          : 'Use a pesquisa manual ou ative a leitura para receber o código direto do leitor.'}
      </p>

      {error && (
        <div className="error-box">
          <AlertCircle size={20} />
          <div>
            <strong>Erro</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {result && (
        <div className="result-box">
          <div className="result-header">
            <h4>📍 Localização Encontrada</h4>
          </div>

          <div className="result-content">
            <div className="info-row">
              <span className="label">Amostra ID:</span>
              <code>{result.sampleID}</code>
            </div>
            <div className="info-row">
              <span className="label">Código de Barras:</span>
              <code>{result.barcode}</code>
            </div>

            <div className="hierarchy-section">
              <h5>Hierarquia de Armazenagem:</h5>
              <div className="hierarchy-badges">
                <span className="badge freezer-badge">{result.storageLocation.freezerName}</span>
                <span className="hierarchy-arrow">→</span>
                <span className="badge shelf-badge">{result.storageLocation.shelfName}</span>
                <span className="hierarchy-arrow">→</span>
                <span className="badge rack-badge">{result.storageLocation.rackName}</span>
                <span className="hierarchy-arrow">→</span>
                <span className="badge box-badge">{result.storageLocation.boxName}</span>
              </div>
            </div>

            <div className="info-row">
              <span className="label">Caixa ID:</span>
              <code>#{result.storageLocation.boxID}</code>
            </div>
            <div className="info-row">
              <span className="label">Dimensões:</span>
              <code>
                {result.storageLocation.dimension.rows}x{result.storageLocation.dimension.cols}
              </code>
            </div>
            <div className="info-row highlight">
              <span className="label">Posição:</span>
              <span className="position-badge">{result.storageLocation.position}</span>
            </div>
          </div>

          <div className="result-actions">
            <button
              onClick={handleSearch}
              className="btn-secondary"
              disabled={releasing}
            >
              Nova Busca
            </button>
            <button
              onClick={handleRelease}
              disabled={releasing}
              className="btn-danger"
            >
              {releasing ? (
                <>
                  <Loader size={16} className="spinner" />
                  Liberando...
                </>
              ) : (
                'Liberar Posição'
              )}
            </button>
          </div>
        </div>
      )}

      {!result && !loading && !error && (
        <div className="empty-state">
          <Search size={48} />
          <p>Digite um ID ou código de barras para localizar uma amostra</p>
        </div>
      )}
    </div>
  );
};
