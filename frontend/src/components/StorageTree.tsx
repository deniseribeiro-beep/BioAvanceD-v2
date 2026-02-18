import React, { useState, useEffect, useCallback } from 'react';
import { storageApi } from '../services/storageApi';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import Modal from '../components/UI/Modal';
import { ChevronDown, ChevronRight, AlertCircle, Package, Grid3x3, RefreshCw } from 'lucide-react';

interface StorageTreeProps {
  freezerId?: string;
}

export const StorageTree: React.FC<StorageTreeProps> = ({ 
  freezerId: initialFreezerId
}) => {
  const [treeData, setTreeData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string>('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['freezer']));
  const [allocateModal, setAllocateModal] = useState(false);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [selectedBoxName, setSelectedBoxName] = useState<string>('');
  const [selectedBoxDimension, setSelectedBoxDimension] = useState<any>(null);
  const [selectedBoxStats, setSelectedBoxStats] = useState<any>(null);
  const [selectedPosition, setSelectedPosition] = useState<string>('');
  const [sampleId, setSampleId] = useState<string>('');
  const [allocateLoading, setAllocateLoading] = useState(false);
  const [allocateMessage, setAllocateMessage] = useState<string | null>(null);
  const [availablePositions, setAvailablePositions] = useState<string[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [activeFreezer, setActiveFreezer] = useState<string | null>(initialFreezerId || null);
  
  // Estados para busca de amostras
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);

  // Carregar árvore ao montar
  useEffect(() => {
    initializeFreezer();
  }, [initialFreezerId]);

  const initializeFreezer = async () => {
    setLoading(true);
    setError(null);
    setErrorDetails('');

    try {
      // Se um freezerId foi fornecido, usá-lo diretamente
      if (initialFreezerId) {
        setActiveFreezer(initialFreezerId);
        await loadFreezerTree(initialFreezerId);
        return;
      }

      // Caso contrário, buscar lista de freezers disponíveis
      const listResult = await storageApi.listFreezers();
      if (listResult.success && listResult.data && listResult.data.length > 0) {
        const firstFreezerId = listResult.data[0]._id;
        setActiveFreezer(firstFreezerId);
        await loadFreezerTree(firstFreezerId);
      } else {
        setError('Nenhum congelador disponível');
        setErrorDetails('Não há congeladores cadastrados no sistema. Execute o script de seed para criar congeladores teste.');
      }
    } catch (err: any) {
      setError('Erro ao inicializar congelador');
      setErrorDetails(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadFreezerTree = async (freezerId: string) => {
    setLoading(true);
    setError(null);
    setErrorDetails('');
    
    try {
      const result = await storageApi.getFreezerTree(freezerId);

      if (result.success && result.data) {
        setTreeData(result.data);
      } else {
        const errorMsg = result.error || 'Erro ao carregar árvore';
        setError(errorMsg);
        
        // Fornecer detalhes úteis baseado no tipo de erro
        if (errorMsg === 'TREE_ERROR') {
          setErrorDetails('Verifique se o backend está rodando em http://localhost:3000 e se você está autenticado.');
        } else if (errorMsg === 'FREEZER_NOT_FOUND') {
          setErrorDetails(`Nenhum congelador encontrado com ID: ${freezerId}`);
        }
      }
    } catch (err: any) {
      setError('Erro ao conectar com o backend');
      setErrorDetails(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleNode = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    setExpandedNodes(newExpanded);
  };

  const loadPositions = useCallback(async (boxId: string) => {
    console.log('📦 [LoadPositions] Iniciando carregamento para caixa:', boxId);
    console.log('📦 [LoadPositions] Tipo do boxId:', typeof boxId);
    console.log('📦 [LoadPositions] URL que será chamada:', `/storage/box/${boxId}/available`);
    setPositionsLoading(true);
    setAvailablePositions([]); // Limpar posições anteriores
    setSelectedBoxStats(null);
    
    try {
      const result = await storageApi.getAvailablePositions(boxId);
      console.log('📦 [LoadPositions] Resultado completo da API:', JSON.stringify(result, null, 2));
      
      if (result.success && result.data) {
        const positions = result.data.availablePositions || [];
        console.log(`✅ [LoadPositions] ${positions.length} posições disponíveis`);
        if (positions.length > 0) {
          console.log('📍 [LoadPositions] Primeiras 10 posições:', positions.slice(0, 10).join(', '));
          setAvailablePositions(positions);
        } else {
          console.warn('⚠️ [LoadPositions] Array de posições vazio!');
          console.warn('⚠️ [LoadPositions] Stats:', result.data.stats);
          setAvailablePositions([]);
        }
        // Salvar informações da caixa
        setSelectedBoxName(result.data.boxName || boxId);
        setSelectedBoxDimension(result.data.dimension);
        setSelectedBoxStats(result.data.stats);
      } else {
        console.warn('⚠️ [LoadPositions] API não retornou sucesso:', result);
        setAvailablePositions([]);
      }
    } catch (err: any) {
      console.error('❌ [LoadPositions] Erro ao buscar posições:', err);
      console.error('❌ [LoadPositions] Detalhes do erro:', err.message);
      setAvailablePositions([]);
    } finally {
      setPositionsLoading(false);
      console.log('📦 [LoadPositions] Carregamento finalizado');
    }
  }, []);

  const handleBoxClick = async (boxId: string, boxName?: string) => {
    console.log('🖱️ [BoxClick] Caixa clicada:', boxId, boxName);
    setSelectedBoxId(boxId);
    setSelectedBoxName(boxName || boxId);
    await loadPositions(boxId);
  };

  // Carregar posições quando o modal é aberto e já existe uma caixa selecionada
  useEffect(() => {
    console.log('🔄 [UseEffect] Modal:', allocateModal, 'BoxId:', selectedBoxId);
    if (allocateModal && selectedBoxId) {
      console.log('🔄 [UseEffect] Carregando posições...');
      loadPositions(selectedBoxId);
    }
  }, [allocateModal, selectedBoxId, loadPositions]);

  const handleSampleSearch = async (term: string) => {
    setSearchTerm(term);
    
    if (term.length < 2) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    setSearchLoading(true);
    try {
      const result = await storageApi.searchSamples(term);
      if (result.success && result.data) {
        setSearchResults(result.data);
        setShowSearchResults(true);
      } else {
        setSearchResults([]);
        setShowSearchResults(false);
      }
    } catch (err) {
      console.error('Erro ao buscar amostras:', err);
      setSearchResults([]);
      setShowSearchResults(false);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSelectSample = (sample: any) => {
    setSampleId(sample._id);
    setSearchTerm(sample.barcode || sample._id);
    setShowSearchResults(false);
  };

  const handleAllocate = async () => {
    // Validação mais detalhada
    if (!sampleId) {
      setAllocateMessage('❌ Selecione uma amostra');
      return;
    }
    if (!selectedPosition) {
      setAllocateMessage('❌ Selecione uma posição');
      return;
    }
    if (!selectedBoxId) {
      setAllocateMessage('❌ Erro: nenhuma caixa selecionada');
      return;
    }

    setAllocateLoading(true);
    const result = await storageApi.allocateSample(sampleId, selectedBoxId, selectedPosition);

    if (result.success) {
      setAllocateMessage('✅ Amostra alocada com sucesso!');
      setSampleId('');
      setSelectedPosition('');
      setTimeout(() => {
        setAllocateModal(false);
        setAllocateMessage(null);
        loadFreezerTree();
      }, 1500);
    } else {
      setAllocateMessage(`❌ ${result.error}: ${result.message}`);
    }
    setAllocateLoading(false);
  };

  if (loading) {
    return (
      <div className="storage-loading">
        <div className="spinner"></div>
        <p>Carregando árvore de armazenagem...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="storage-error">
        <AlertCircle size={24} />
        <div className="error-content">
          <h3>Erro ao carregar armazenagem</h3>
          <p className="error-type">{error}</p>
          {errorDetails && <p className="error-details">{errorDetails}</p>}
          <div className="error-actions">
            <Button onClick={() => activeFreezer && loadFreezerTree(activeFreezer)} variant="primary">
              <RefreshCw size={18} />
              Tentar Novamente
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!treeData) {
    return (
      <div className="storage-empty">
        <Package size={40} />
        <p>Nenhum dado de armazenagem disponível</p>
      </div>
    );
  }

  return (
    <div className="storage-tree">
      <div className="tree-header">
        <h2>{treeData.freezerName} {treeData.temperature && `(${treeData.temperature}°C)`}</h2>
        <div className="tree-stats">
          <span>Capacidade: {treeData.aggregateStats?.totalCapacity || 0}</span>
          <span>Ocupadas: {treeData.aggregateStats?.totalOccupied || 0}</span>
          <span>Ocupação: {treeData.aggregateStats?.occupancyPercent || 0}%</span>
        </div>
      </div>

      <div className="tree-content">
        {treeData.shelves?.map((shelf: any, shelfIdx: number) => {
          const shelfKey = `shelf-${shelfIdx}`;
          const isShelfExpanded = expandedNodes.has(shelfKey);

          return (
            <div key={shelfKey} className="tree-node">
              <div className="tree-node-header" onClick={() => toggleNode(shelfKey)}>
                <span className="tree-icon">
                  {isShelfExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </span>
                <span className="tree-label">📚 {shelf.shelfName}</span>
                <span className="tree-count">
                  {shelf.stats?.boxes} caixas - {shelf.stats?.totalOccupied}/{shelf.stats?.totalCapacity}
                </span>
              </div>

              {isShelfExpanded && (
                <div className="tree-children">
                  {shelf.racks?.map((rack: any, rackIdx: number) => {
                    const rackKey = `${shelfKey}-rack-${rackIdx}`;
                    const isRackExpanded = expandedNodes.has(rackKey);

                    return (
                      <div key={rackKey} className="tree-node">
                        <div className="tree-node-header" onClick={() => toggleNode(rackKey)}>
                          <span className="tree-icon">
                            {isRackExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                          </span>
                          <span className="tree-label">🗂️ {rack.rackName}</span>
                          <span className="tree-count">
                            {rack.boxes?.length} caixas - {rack.stats?.totalOccupied}/{rack.stats?.totalCapacity}
                          </span>
                        </div>

                        {isRackExpanded && (
                          <div className="tree-children">
                            {rack.boxes?.map((box: any, boxIdx: number) => (
                              <div key={`${rackKey}-box-${boxIdx}`} className="tree-node box-node">
                                <div
                                  className={`tree-node-header box-clickable ${
                                    selectedBoxId === box.boxId ? 'selected' : ''
                                  }`}
                                  onClick={() => handleBoxClick(box.boxId, box.boxName)}
                                >
                                  <span className="tree-icon">
                                    <Grid3x3 size={16} />
                                  </span>
                                  <span className="tree-label">{box.boxName}</span>
                                  <span className="tree-count">
                                    {box.stats?.occupied}/{box.stats?.capacity}
                                    <span
                                      className={`occupancy-badge ${
                                        box.stats?.occupancyPercent >= 80 ? 'high' : 'normal'
                                      }`}
                                    >
                                      {box.stats?.occupancyPercent}%
                                    </span>
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="tree-footer">
        <Button
          onClick={() => {
            if (!selectedBoxId) {
              alert('Selecione uma caixa primeiro');
              return;
            }
            setAllocateModal(true);
          }}
        >
          <Package size={18} />
          Alocar Amostra
        </Button>
      </div>

      {allocateModal && (
        <Modal isOpen={allocateModal} onClose={() => setAllocateModal(false)} title="Alocar Amostra">
          <div className="allocate-form">
            {selectedBoxId && (
              <div className="box-info-card">
                <div className="box-info-header">
                  <Grid3x3 size={20} color="#0066cc" />
                  <div className="box-info-text">
                    <h4>{selectedBoxName}</h4>
                    {selectedBoxDimension && (
                      <span className="box-dimension">
                        {selectedBoxDimension.rows}x{selectedBoxDimension.cols} ({selectedBoxDimension.rows * selectedBoxDimension.cols} posições)
                      </span>
                    )}
                  </div>
                </div>
                
                {selectedBoxStats && (
                  <div className="box-stats">
                    <div className="stat-item">
                      <span className="stat-label">Disponíveis:</span>
                      <span className="stat-value stat-available">{selectedBoxStats.available}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">Ocupadas:</span>
                      <span className="stat-value stat-occupied">{selectedBoxStats.occupied}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">Ocupação:</span>
                      <span className="stat-value">{selectedBoxStats.occupancyPercent}%</span>
                    </div>
                  </div>
                )}

                <button 
                  type="button"
                  onClick={() => loadPositions(selectedBoxId)}
                  disabled={positionsLoading}
                  className="reload-button"
                >
                  <RefreshCw size={14} />
                  {positionsLoading ? 'Carregando...' : 'Recarregar'}
                </button>
              </div>
            )}

            <div className="form-group">
              <label>Amostra (Código de Barras ou ID) *</label>
              <div className="autocomplete-container">
                <Input
                  type="text"
                  placeholder="Digite o código de barras ou ID da amostra"
                  value={searchTerm}
                  onChange={(e) => handleSampleSearch(e.target.value)}
                />
                {searchLoading && <span className="search-loading">Buscando...</span>}
              </div>
              
              {showSearchResults && searchResults.length > 0 && (
                <div className="search-results-dropdown">
                  {searchResults.map((sample) => (
                    <div
                      key={sample._id}
                      className={`search-result-item ${!sample.canAllocate ? 'disabled' : ''}`}
                      onClick={() => sample.canAllocate && handleSelectSample(sample)}
                      title={!sample.canAllocate ? sample.consentMessage : ''}
                    >
                      <div className="sample-header">
                        <div className="sample-barcode">
                          {sample.barcode || sample._id}
                        </div>
                        {sample.canAllocate ? (
                          <span className="sample-badge available">✓ Disponível</span>
                        ) : (
                          <span className="sample-badge unavailable">✗ Bloqueada</span>
                        )}
                      </div>
                      <div className="sample-info">
                        <span>Paciente: {sample.patientID}</span>
                        <span>Tipo: {sample.sampleType}</span>
                        <span>Quantidade: {sample.quantity} µL</span>
                      </div>
                      {sample.consentMessage && (
                        <div className="sample-consent">
                          {sample.consentValid ? '✓' : '⚠'} {sample.consentMessage}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {showSearchResults && searchResults.length === 0 && searchTerm.length >= 2 && !searchLoading && (
                <div className="no-results-message">
                  Nenhuma amostra disponível encontrada para "{searchTerm}"
                </div>
              )}
            </div>

            <div className="form-group">
              <label>
                Posição *
                {availablePositions.length > 0 && (
                  <span className="positions-count">
                    ({availablePositions.length} disponíveis)
                  </span>
                )}
              </label>
              {positionsLoading ? (
                <div className="loading-positions">
                  <RefreshCw size={16} className="spinning" />
                  Carregando posições disponíveis...
                </div>
              ) : availablePositions.length === 0 ? (
                <div className="no-positions-warning">
                  <AlertCircle size={16} />
                  Todas as posições desta caixa estão ocupadas
                </div>
              ) : (
                <select
                  value={selectedPosition}
                  onChange={(e) => setSelectedPosition(e.target.value)}
                  className="form-select"
                  aria-label="Selecione uma posição na caixa"
                >
                  <option value="">Selecione a posição na grade</option>
                  {availablePositions.map((pos) => (
                    <option key={pos} value={pos}>
                      Posição {pos}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {allocateMessage && (
              <div className={`allocate-message ${allocateMessage.startsWith('✅') ? 'success' : 'error'}`}>
                {allocateMessage}
              </div>
            )}

            <div className="form-actions">
              <Button
                onClick={handleAllocate}
                disabled={allocateLoading || availablePositions.length === 0}
                variant="primary"
              >
                {allocateLoading ? 'Alocando...' : 'Alocar'}
              </Button>
              <Button onClick={() => setAllocateModal(false)} variant="secondary">
                Cancelar
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
