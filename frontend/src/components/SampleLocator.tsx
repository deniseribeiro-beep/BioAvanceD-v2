import React, { useEffect, useRef, useState } from 'react';
import { Search, MapPin, AlertCircle, Loader, QrCode } from 'lucide-react';
import { storageApi } from '../services/storageApi';
import type { SampleStorageLocationDTO } from '../types/models';

interface SampleLocatorProps {}

export const SampleLocator: React.FC<SampleLocatorProps> = () => {
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SampleStorageLocationDTO | null>(null);
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
        setResult(response.data as SampleStorageLocationDTO);
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

  const handleNewSearch = () => {
    setSearchInput('');
    setResult(null);
    setError(null);
    inputRef.current?.focus();
  };

  const handleRelease = async () => {
    if (!result) return;

    setReleasing(true);
    setError(null);

    try {
      const response = await storageApi.releaseSample(result.specimenId);
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
    <div className="sample-locator" data-testid="sample-locator">
      <div className="sample-locator-header" data-testid="sample-locator-header">
        <div className="sample-locator-title" data-testid="sample-locator-title">
          <MapPin size={24} />
          <h3>Buscar amostra</h3>
        </div>
        <p className="sample-locator-description">Busque por ID, barcode ou QR code.</p>
      </div>

      <div className="sample-locator-search" data-testid="sample-locator-search">
        <div className="search-input-group">
          <Search size={18} />
          <input
            ref={inputRef}
            type="text"
            placeholder={scanMode ? 'Escaneie e pressione Enter...' : 'Digite ID, barcode ou QR code...'}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            className="search-input"
            data-testid="sample-locator-input"
          />
        </div>
        <div className="sample-locator-actions" data-testid="sample-locator-actions">
          <button onClick={handleSearch} disabled={loading} className="btn-search" data-testid="sample-locator-search-button">
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
            data-testid="sample-locator-scan-button"
          >
            <QrCode size={16} />
            {scanMode ? 'Leitura ativa' : 'Barcode/QR'}
          </button>
        </div>
      </div>

      <p className={`sample-locator-mode ${scanMode ? 'active' : ''}`}>
        {scanMode
          ? 'Leitura ativa: escaneie no campo e pressione Enter.'
          : 'Use busca manual ou ative a leitura.'}
      </p>

      {error && (
        <div className="error-box" data-testid="sample-locator-error-box">
          <AlertCircle size={20} />
          <div>
            <strong>Erro</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {result && (
        <div className="result-box" data-testid="sample-locator-result-box">
          <div className="result-header" data-testid="sample-locator-result-header">
            <h4>Localização encontrada</h4>
          </div>

          <div className="result-content" data-testid="sample-locator-result-content">
            <div className="info-row">
              <span className="label">ID</span>
              <code>{result.specimenId}</code>
            </div>
            <div className="info-row">
              <span className="label">Barcode</span>
              <code>{result.barcode}</code>
            </div>

            <div className="hierarchy-section">
              <h5>Hierarquia</h5>
              <div className="hierarchy-badges">
                {result.path.split('/').filter(Boolean).map((segment, index) => (
                  <React.Fragment key={`${segment}-${index}`}>
                    {index > 0 && <span className="hierarchy-arrow">→</span>}
                    <span className="badge">{segment}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>

            <div className="info-row">
              <span className="label">Caixa</span>
              <code>{result.box.boxName || result.box.boxId}</code>
            </div>
            <div className="info-row highlight">
              <span className="label">Posição</span>
              <span className="position-badge">{result.box.position}</span>
            </div>
          </div>

          <div className="result-actions" data-testid="sample-locator-result-actions">
            <button
              onClick={handleNewSearch}
              className="btn-secondary"
              disabled={releasing}
              data-testid="sample-locator-new-search-button"
            >
              Nova Busca
            </button>
            <button
              onClick={handleRelease}
              disabled={releasing}
              className="btn-danger"
              data-testid="sample-locator-release-button"
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
