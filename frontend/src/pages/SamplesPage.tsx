import { useState, useEffect, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import Input from '../components/UI/Input';
import { Plus, Upload, Download, Search, Eye, Edit, Trash2, ArrowDown, ArrowUp, QrCode, FileText } from 'lucide-react';
import { Sample, Location as LocationModel } from '../types/models';
import {
  validateMIABIS,
  type MIABISValidationResult,
} from '../utils/validations';
import { useSamples } from '../hooks/useSamples';
import { sampleService, patientService, importLGPDService, locationService } from '../services/api';
import { useAsyncImport } from '../hooks/useAsyncImport';
import { ImportJob as ImportJobFromHook } from '../hooks/useImportJob';
import { validateCSVFile } from '../utils/csvValidator';
// Removido useQualityDescriptions - agora usamos escala MIABIS diretamente (0, 1, 2)
import { useMeasurementUnits } from '../hooks/useMeasurementUnits';
import { useLocations } from '../hooks/useLocations';
import { useEquipment } from '../hooks/useEquipment';
import { useSampleTypes } from '../hooks/useSampleTypes';
import { useSampleOrigins } from '../hooks/useSampleOrigins';
import { useExtractionProtocols } from '../hooks/useExtractionProtocols';
import { useAuth } from '../contexts/AuthContext';
import { formatPatientDisplay } from '../utils/patientAnonymization';
import { useLanguage } from '../contexts/LanguageContext';
import './SamplesPage.css';

export default function SamplesPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user } = useAuth();
  const { samples, loading, error, loadSamples, updateSample, deleteSample } = useSamples();
  const { locations = [], loadLocations } = useLocations();
  const { equipment = [] } = useEquipment();
  
  // Verifica se o usuário é Administrador ou Coordenador
  const canEditDelete = user?.roleName === 'Administrador' || user?.roleName === 'Coordenador' || 
                        user?.accessType === 4 || user?.accessType === 3;
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<string>('');
  const [barcodeSearch, setBarcodeSearch] = useState<string>('');
  const [filteredSamples, setFilteredSamples] = useState<Sample[]>([]);
  const [selectedLocationForImport, setSelectedLocationForImport] = useState<number | undefined>(undefined);
  const [editingSample, setEditingSample] = useState<Sample | null>(null);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [selectedFileForImport, setSelectedFileForImport] = useState<File | null>(null);
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [csvValidationErrors, setCsvValidationErrors] = useState<string[]>([]);
  const [csvValidationWarnings, setCsvValidationWarnings] = useState<string[]>([]);
  const [selectedSamples, setSelectedSamples] = useState<Set<string>>(new Set());
  const [isDeletingBatch, setIsDeletingBatch] = useState(false);

  // Hook para importação assíncrona
  const {
    validating,
    creating,
    isPolling,
    job,
    importFile,
    reset,
  } = useAsyncImport();

  // Carrega localizações ao montar (as amostras já são carregadas pelo hook useSamples)
  useEffect(() => {
    if (loadLocations) {
      loadLocations().catch(err => {
        console.error('Erro ao carregar localizações:', err);
      });
    }
  }, [loadLocations]);

  // Debug: verifica quando localizações são carregadas
  useEffect(() => {
    if (locations && locations.length > 0) {
      console.debug('Localizações carregadas:', locations.length, 'localizações');
      console.debug('IDs das localizações:', locations.map(l => ({ locationID: l.locationID, block: l.block, rack: l.rack, drawer: l.drawer, box: l.box })));
    }
  }, [locations]);

  // Filtra amostras por código de barras
  useEffect(() => {
    if (!barcodeSearch || barcodeSearch.trim() === '') {
      setFilteredSamples(samples);
    } else {
      const searchTerm = barcodeSearch.trim().toUpperCase();
      const filtered = samples.filter(sample => 
        sample.barcode && sample.barcode.toUpperCase().includes(searchTerm)
      );
      setFilteredSamples(filtered);
    }
  }, [barcodeSearch, samples]);

  // Função para obter informações de localização resumida (para tabela)
  const getLocationSummary = (locationID?: number): string => {
    if (locationID === undefined || locationID === null) return 'N/A';
    if (!locations || !Array.isArray(locations) || locations.length === 0) {
      return `ID: ${locationID}`;
    }
    
    // Tenta encontrar a localização por locationID
    const location = locations.find(loc => {
      // Compara locationID (pode ser number ou string)
      const locID = loc.locationID;
      const match = locID === locationID || 
                    Number(locID) === Number(locationID) ||
                    String(locID) === String(locationID);
      return match;
    });
    
    if (!location) {
      // Se não encontrou, tenta buscar pelo _id também (caso locationID não esteja preenchido)
      const locationById = locations.find(loc => {
        const id = (loc as any)._id;
        return String(id) === String(locationID);
      });
      
      if (locationById) {
        const loc = locationById;
        const parts = [];
        const blockNum = typeof loc.block === 'number' ? loc.block : (typeof loc.block === 'string' ? Number(loc.block) : NaN);
        if (loc.block !== undefined && loc.block !== null && (typeof loc.block !== 'string' || loc.block !== '') && !isNaN(blockNum)) {
          parts.push(`B${blockNum}`);
        }
        const rackNum = typeof loc.rack === 'number' ? loc.rack : (typeof loc.rack === 'string' ? Number(loc.rack) : NaN);
        if (loc.rack !== undefined && loc.rack !== null && (typeof loc.rack !== 'string' || loc.rack !== '') && !isNaN(rackNum)) {
          parts.push(`P${rackNum}`);
        }
        const drawerNum = typeof loc.drawer === 'number' ? loc.drawer : (typeof loc.drawer === 'string' ? Number(loc.drawer) : NaN);
        if (loc.drawer !== undefined && loc.drawer !== null && (typeof loc.drawer !== 'string' || loc.drawer !== '') && !isNaN(drawerNum)) {
          parts.push(`G${drawerNum}`);
        }
        const boxNum = typeof loc.box === 'number' ? loc.box : (typeof loc.box === 'string' ? Number(loc.box) : NaN);
        if (loc.box !== undefined && loc.box !== null && (typeof loc.box !== 'string' || loc.box !== '') && !isNaN(boxNum)) {
          parts.push(`C${boxNum}`);
        }
        const well = loc.eppendorfWell;
        if (well !== undefined && well !== null && well !== '') {
          if (Array.isArray(well)) {
            parts.push(`P${well.join('x')}`);
          } else {
            parts.push(`P${well}`);
          }
        }
        return parts.length > 0 ? parts.join('-') : `ID: ${locationID}`;
      }
      
      return `ID: ${locationID}`;
    }
    
    // Formato resumido: B1-P1-G1-C1 ou B1-P1-G1-C1-P1
    const parts = [];
    
    // block, rack, drawer, box podem ser 0, então verificamos !== null e !== undefined
    // Mas também verificamos se não é string vazia
    const block = location.block;
    const rack = location.rack;
    const drawer = location.drawer;
    const box = location.box;
    
    const blockNum = typeof block === 'number' ? block : (typeof block === 'string' ? Number(block) : NaN);
    if (block !== undefined && block !== null && (typeof block !== 'string' || block !== '') && !isNaN(blockNum)) {
      parts.push(`B${blockNum}`);
    }
    const rackNum = typeof rack === 'number' ? rack : (typeof rack === 'string' ? Number(rack) : NaN);
    if (rack !== undefined && rack !== null && (typeof rack !== 'string' || rack !== '') && !isNaN(rackNum)) {
      parts.push(`P${rackNum}`);
    }
    const drawerNum = typeof drawer === 'number' ? drawer : (typeof drawer === 'string' ? Number(drawer) : NaN);
    if (drawer !== undefined && drawer !== null && (typeof drawer !== 'string' || drawer !== '') && !isNaN(drawerNum)) {
      parts.push(`G${drawerNum}`);
    }
    const boxNum = typeof box === 'number' ? box : (typeof box === 'string' ? Number(box) : NaN);
    if (box !== undefined && box !== null && (typeof box !== 'string' || box !== '') && !isNaN(boxNum)) {
      parts.push(`C${boxNum}`);
    }
    
    // wellPosition ou eppendorfWell pode ser string ou array
    const well = location.wellPosition || location.eppendorfWell;
    if (well !== undefined && well !== null && well !== '') {
      if (Array.isArray(well)) {
        parts.push(`P${well.join('x')}`);
      } else {
        parts.push(`P${well}`);
      }
    }
    
    return parts.length > 0 ? parts.join('-') : `ID: ${locationID}`;
  };

  // Função para obter informações de localização completa (para modal de detalhes)

  // Função helper para obter descrição completa da localização para dropdowns
  const getLocationDropdownDescription = (location: LocationModel): string => {
    // Obtém descrição do tipo de equipamento
    const getEquipmentTypeDescription = (equipmentType: number | undefined): string => {
      if (!equipmentType) return '';
      const types: Record<number, string> = {
        1: 'Freezer -80°C #1',
        2: 'Freezer -80°C #2',
        3: 'Freezer -20°C',
        4: 'Refrigerador 4°C',
        5: 'Nitrogênio Líquido',
      };
      return types[equipmentType] || `Tipo ${equipmentType}`;
    };
    
    // Monta descrição completa e organizada
    const parts: string[] = [];
    
    // 1. Localização física (sempre presente)
    parts.push(`B${location.block}-P${location.rack}-G${location.drawer}-C${location.box}`);
    
    // 2. Tipo de equipamento
    const equipmentTypeDesc = getEquipmentTypeDescription(location.equipmentType);
    if (equipmentTypeDesc) {
      parts.push(equipmentTypeDesc);
    }
    
    // 3. Equipamento vinculado (se houver)
    if (location.equipmentID) {
      const eq = equipment.find((e) => e.equipmentID === location.equipmentID);
      if (eq) {
        let eqDesc = `Equip. ${eq.equipmentID}: ${eq.equipmentDescription}`;
        if (eq.model) {
          eqDesc += ` (${eq.model})`;
        }
        if (eq.serialNumber) {
          eqDesc += ` | S/N: ${eq.serialNumber}`;
        }
        parts.push(eqDesc);
      }
    }
    
    // 4. Poço Eppendorf (se houver)
    const wellInfo = location.wellPosition || location.eppendorfWell || '';
    if (wellInfo) {
      parts.push(`Poço ${wellInfo}`);
    }
    
    // Junta todas as partes com separador mais legível
    return parts.join(' • ');
  };

  const handleAdd = () => {
    navigate('/samples/new');
  };

  // Função para obter o ID único de uma amostra
  const getSampleId = (sample: Sample): string => {
    return (sample as any)._id || String(sample.sampleID) || `sample-${Math.random()}`;
  };

  // Função para alternar seleção de uma amostra
  const toggleSampleSelection = (sample: Sample) => {
    const sampleId = getSampleId(sample);
    setSelectedSamples(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sampleId)) {
        newSet.delete(sampleId);
      } else {
        newSet.add(sampleId);
      }
      return newSet;
    });
  };

  // Função para selecionar/desselecionar todas as amostras
  const toggleSelectAll = () => {
    const currentSamples = barcodeSearch ? filteredSamples : samples;
    const allSelected = currentSamples.length > 0 && 
      currentSamples.every(sample => selectedSamples.has(getSampleId(sample)));
    
    if (allSelected) {
      // Desselecionar todas
      setSelectedSamples(new Set());
    } else {
      // Selecionar todas
      const allIds = new Set(currentSamples.map(sample => getSampleId(sample)));
      setSelectedSamples(allIds);
    }
  };

  // Função para deletar amostras em lote
  const handleBatchDelete = async () => {
    if (selectedSamples.size === 0) {
      alert('Nenhuma amostra selecionada');
      return;
    }

    const count = selectedSamples.size;
    const confirmMessage = `Tem certeza que deseja excluir ${count} amostra(s) selecionada(s)?\n\nEsta ação não pode ser desfeita.`;
    
    if (!confirm(confirmMessage)) {
      return;
    }

    setIsDeletingBatch(true);
    const currentSamples = barcodeSearch ? filteredSamples : samples;
    const samplesToDelete = currentSamples.filter(sample => 
      selectedSamples.has(getSampleId(sample))
    );

    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    try {
      for (const sample of samplesToDelete) {
        try {
          const sampleId = (sample as any)._id || sample.sampleID;
          if (!sampleId) {
            errorCount++;
            errors.push(`Amostra ${sample.barcode || 'desconhecida'}: ID não encontrado`);
            continue;
          }
          
          const idToUse = typeof sampleId === 'string' ? sampleId : Number(sampleId);
          await deleteSample(idToUse as any);
          successCount++;
        } catch (err: any) {
          errorCount++;
          errors.push(`Amostra ${sample.barcode || 'desconhecida'}: ${err.message || 'Erro ao excluir'}`);
        }
      }

      // Recarrega a lista
      await loadSamples();
      
      // Limpa seleção
      setSelectedSamples(new Set());

      // Mostra resultado
      if (errorCount === 0) {
        alert(`✅ ${successCount} amostra(s) excluída(s) com sucesso!`);
      } else {
        alert(
          `⚠️ Processamento concluído:\n\n` +
          `✅ Sucesso: ${successCount}\n` +
          `❌ Erros: ${errorCount}\n\n` +
          (errors.length > 0 ? `Erros:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n... e mais ${errors.length - 5} erro(s)` : ''}` : '')
        );
      }
    } catch (err: any) {
      alert(`Erro ao processar exclusão em lote: ${err.message || 'Erro desconhecido'}`);
    } finally {
      setIsDeletingBatch(false);
    }
  };

  const handleImportSamples = async () => {
    // Cria input de arquivo dinamicamente
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.csv,.xlsx';
    fileInput.style.display = 'none';
    
    fileInput.onchange = async (e: Event) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      
      if (!file) {
        return;
      }

      const fileName = file.name.toLowerCase();
      const ext = fileName.split('.').pop();
      
      // Valida extensão
      if (ext !== 'csv' && ext !== 'xlsx') {
        alert(t('import.errors.invalidFileType') || 'Apenas arquivos CSV ou Excel (.xlsx) são aceitos');
        return;
      }
      
      // Valida tamanho (máximo 10MB)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        alert('Arquivo muito grande. Tamanho máximo: 10MB');
        return;
      }

      // Validação CSV no frontend (apenas para CSV)
      if (ext === 'csv') {
        try {
          const validation = await validateCSVFile(file);
          
          if (!validation.isValid) {
            setCsvValidationErrors(validation.errors);
            setCsvValidationWarnings(validation.warnings);
            setShowValidationModal(true);
            return;
          }

          if (validation.warnings.length > 0) {
            setCsvValidationWarnings(validation.warnings);
            const proceed = confirm(
              'Avisos de validação:\n' + validation.warnings.join('\n') + 
              '\n\nDeseja continuar com a importação?'
            );
            if (!proceed) {
              return;
            }
          }
        } catch (error: any) {
          alert('Erro ao validar arquivo CSV: ' + error.message);
          return;
        }
      }

      // Armazena o arquivo e abre o modal de seleção de localização
      setSelectedFileForImport(file);
      setShowLocationModal(true);
    };
    
    // Adiciona ao DOM, clica e remove
    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
  };

  const handleConfirmLocationAndImport = async () => {
    if (!selectedFileForImport || !selectedLocationForImport) {
      alert('Por favor, selecione uma localização para iniciar o armazenamento.');
      return;
    }

    setShowLocationModal(false);
    setImporting(true);
    setImportProgress(`Arquivo: ${selectedFileForImport.name} (${(selectedFileForImport.size / 1024).toFixed(1)} KB)`);
    reset(); // Reseta estado do hook assíncrono
    
    try {
      // Usa fluxo assíncrono com validação e criação de job
      await importFile(
        selectedFileForImport,
        'samples',
        {
          startLocationID: selectedLocationForImport,
          autoIncrement: true,
          onValidationSuccess: (metadata) => {
            setImportProgress(`Arquivo validado: ${metadata?.rowCount || 0} linhas encontradas`);
          },
          onValidationError: (errors) => {
            setCsvValidationErrors(errors);
            setShowValidationModal(true);
            setImporting(false);
          },
          onJobCreated: (jobID) => {
            setImportProgress(`Job criado: ${jobID}. Processando...`);
          },
          onProgress: (job: ImportJobFromHook) => {
            if (job.progress !== undefined) {
              setImportProgress(`Processando: ${job.progress}% (${job.successCount || 0}/${job.totalRecords || 0} registros)`);
            }
          },
          onCompleted: async (job: ImportJobFromHook) => {
            setImportProgress('');
            const total = job.totalRecords || 0;
            const success = job.successCount || 0;
            const errors = job.errorCount || 0;
            
            if (errors > 0) {
              alert(`⚠️ Importação concluída com avisos!\n\n📊 Resumo:\n   • Total: ${total}\n   • Sucesso: ${success}\n   • Erros: ${errors}\n\nVerifique os detalhes no relatório.`);
            } else {
              alert(`✅ Importação concluída com sucesso!\n\n📊 Resumo:\n   • Total: ${total}\n   • Sucesso: ${success}\n\n✨ Todas as amostras foram cadastradas.`);
            }
            
            await loadSamples();
            setSelectedFileForImport(null);
            setSelectedLocationForImport(undefined);
            setImporting(false);
          },
          onFailed: async (job) => {
            const errorMsg = job.errors?.[0]?.error || 'Erro ao processar importação';
            alert(`❌ Importação falhou: ${errorMsg}`);
            setImportProgress('');
            setImporting(false);
          },
        }
      );
    } catch (err: any) {
      const errorMessage = err.message || err.response?.data?.error || 'Erro ao iniciar importação';
      alert(errorMessage);
      setImportProgress('');
      setImporting(false);
    }
  };

  const handleDownloadTemplate = async (format: 'csv' | 'xlsx' = 'xlsx') => {
    try {
      const response = await importLGPDService.downloadTemplate('samples', format);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `amostras_template.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.response?.data?.error || t('import.errors.templateError') || 'Erro ao baixar template');
    }
  };


  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('samples.title')}</h1>
          <p className="page-subtitle">{t('samples.subtitle')}</p>
        </div>
      </div>

      {/* Campo de busca por código de barras com botões alinhados */}
      <Card style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <Input
              label="Código de Barras"
              type="text"
              value={barcodeSearch}
              onChange={(e) => setBarcodeSearch(e.target.value)}
              placeholder="BR-2024-001"
            />
          </div>
          
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Botão de Download Template */}
            <Button 
              onClick={() => handleDownloadTemplate('xlsx')}
              variant="secondary"
              title={t('import.samples.downloadTemplate') || 'Baixar template Excel'}
            >
              <Download size={18} />
              Template
            </Button>
            
            {/* Botão de Importar Amostras - integra seleção e importação */}
            <Button
              onClick={handleImportSamples}
              disabled={importing || validating || creating || isPolling}
              variant="primary"
              title={t('import.samples.import') || 'Importar amostras de arquivo CSV ou Excel'}
            >
              <Upload size={18} />
              {validating && 'Validando...'}
              {creating && 'Criando job...'}
              {isPolling && job && `Processando... ${job.progress || 0}%`}
              {importing && !validating && !creating && !isPolling && (importProgress || t('import.samples.importing') || 'Importando...')}
              {!importing && !validating && !creating && !isPolling && (t('import.samples.import') || 'Importar Amostras')}
            </Button>
            
            {/* Botão Nova Amostra */}
            <Button onClick={handleAdd} variant="primary">
              <Plus size={18} />
              {t('samples.new') || 'Nova Amostra'}
            </Button>
            
            {/* Botão Delete em Lote */}
            {canEditDelete && selectedSamples.size > 0 && (
              <Button
                onClick={handleBatchDelete}
                disabled={isDeletingBatch}
                variant="danger"
                title={`Excluir ${selectedSamples.size} amostra(s) selecionada(s)`}
              >
                <Trash2 size={18} />
                {isDeletingBatch ? 'Excluindo...' : `Excluir (${selectedSamples.size})`}
              </Button>
            )}
            
            {/* Botão Limpar (quando há busca) */}
            {barcodeSearch && (
              <Button
                variant="secondary"
                onClick={() => setBarcodeSearch('')}
              >
                Limpar
              </Button>
            )}
          </div>
          
          {/* Status da importação */}
          {importing && importProgress && (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              backgroundColor: 'var(--surface)',
              borderRadius: '6px',
              fontSize: '0.875rem',
              color: 'var(--text)',
              width: '100%',
              marginTop: '0.5rem'
            }}>
              <div style={{
                width: '12px',
                height: '12px',
                border: '2px solid var(--primary)',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
              <span>{importProgress}</span>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '40px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={
                      (barcodeSearch ? filteredSamples : samples).length > 0 &&
                      (barcodeSearch ? filteredSamples : samples).every(sample => 
                        selectedSamples.has(getSampleId(sample))
                      )
                    }
                    onChange={toggleSelectAll}
                    title="Selecionar todas as amostras"
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                <th>{t('samples.tableHeaders.type') || 'Tipo'}</th>
                <th>{t('samples.tableHeaders.origin') || 'Origem'}</th>
                <th>{t('samples.tableHeaders.barcode') || 'Código de Barras'}</th>
                <th>{t('samples.tableHeaders.registrationDate') || 'Data de Registro'}</th>
                <th>{t('samples.tableHeaders.quantity') || 'Quantidade'}</th>
                <th>Disponível</th>
                <th>Status</th>
                <th>Localização</th>
                <th>Paciente</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} style={{ padding: '2rem', textAlign: 'center' }}>
                    {t('common.loading') || 'Carregando...'}
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={11} style={{ padding: '2rem', textAlign: 'center', color: 'var(--danger)' }}>
                    {t('common.error') || 'Erro'}: {error}
                  </td>
                </tr>
              ) : (barcodeSearch ? filteredSamples : samples).length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-light)' }}>
                    {barcodeSearch ? `Nenhuma amostra encontrada com o código de barras "${barcodeSearch}"` : 'Nenhuma amostra cadastrada.'}
                  </td>
                </tr>
              ) : (
                (barcodeSearch ? filteredSamples : samples).map((sample) => {
                  const sampleId = getSampleId(sample);
                  const isSelected = selectedSamples.has(sampleId);
                  return (
                    <tr key={sampleId} className="sample-row">
                      <td style={{ textAlign: 'center', width: '40px' }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSampleSelection(sample)}
                          title="Selecionar amostra"
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td>
                        <span style={{ fontWeight: 500, color: 'var(--text)' }}>{sample.sampleType}</span>
                      </td>
                      <td>
                        <span style={{ color: 'var(--text)' }}>{sample.sampleOrigin}</span>
                      </td>
                      <td>
                        <span style={{ 
                          fontFamily: 'monospace', 
                          fontWeight: 600, 
                          color: 'var(--primary)',
                          fontSize: '0.875rem',
                          letterSpacing: '0.5px'
                        }}>
                          {sample.barcode || 'N/A'}
                        </span>
                      </td>
                      <td>
                        <span style={{ color: 'var(--text)', fontSize: '0.875rem' }}>
                          {new Date(sample.registrationDate || '').toLocaleDateString('pt-BR')}
                        </span>
                      </td>
                      <td>
                        <span style={{ 
                          fontWeight: 500, 
                          color: 'var(--text)',
                          fontSize: '0.875rem'
                        }}>
                          {sample.quantity?.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} µL
                        </span>
                      </td>
                      <td>
                        <span className={`availability-badge availability-${(sample.availabilityStatus || 'Disponível').toLowerCase().replace(' ', '-')}`}>
                          {sample.availableQuantity?.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) ?? sample.quantity?.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) ?? 0} / {sample.quantity?.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) ?? 0}
                        </span>
                      </td>
                      <td>
                        <span className={`status-badge status-${(sample.currentStatus || 'Available').toLowerCase()}`}>
                          {sample.currentStatus === 'Available' ? 'Disponível' : 
                           sample.currentStatus === 'Withdrawn' ? 'Retirada' : 
                           sample.currentStatus || 'Disponível'}
                        </span>
                      </td>
                      <td>
                        <div style={{ 
                          fontSize: '0.8125rem', 
                          color: 'var(--text)',
                          lineHeight: '1.4',
                          fontFamily: 'monospace',
                          fontWeight: 500
                        }}>
                          {getLocationSummary(sample.locationID)}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ 
                            fontFamily: 'monospace',
                            fontSize: '0.8125rem', 
                            color: 'var(--text)',
                            fontWeight: 500
                          }}>
                            {sample.patientID}
                          </span>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                              const sampleId = sample._id || sample.sampleID;
                              if (sampleId) {
                                navigate(`/samples/${sampleId}`);
                              }
                            }}
                            style={{ 
                              padding: '0.25rem 0.5rem',
                              minWidth: 'auto',
                              fontSize: '0.75rem'
                            }}
                            title="Visualizar detalhes da amostra"
                          >
                            <Eye size={14} />
                          </Button>
                        </div>
                      </td>
                      <td>
                  {canEditDelete ? (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={() => setEditingSample(sample)}
                        style={{
                          padding: '0.375rem',
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--primary)',
                          cursor: 'pointer',
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'background-color 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = 'var(--surface)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                        title="Editar amostra"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (confirm(`Tem certeza que deseja excluir a amostra ${sample.barcode || sample.sampleID}?`)) {
                            try {
                              // Backend espera _id (ObjectId) ou sampleID
                              const sampleId = (sample as any)._id || sample.sampleID;
                              if (!sampleId) {
                                alert('ID da amostra não encontrado');
                                return;
                              }
                              // Se for _id (string ObjectId), usa diretamente; se for sampleID (número), converte
                              const idToUse = typeof sampleId === 'string' ? sampleId : Number(sampleId);
                              await deleteSample(idToUse as any);
                              await loadSamples();
                              alert('Amostra excluída com sucesso');
                            } catch (err: any) {
                              alert(err.message || 'Erro ao excluir amostra');
                            }
                          }
                        }}
                        style={{
                          padding: '0.375rem',
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--danger)',
                          cursor: 'pointer',
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'background-color 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = 'var(--surface)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                        title="Excluir amostra"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ) : (
                    <span style={{ color: 'var(--text-light)', fontSize: '0.875rem' }}>
                      Sem permissão
                    </span>
                  )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>


      {/* Modal de edição de amostra */}
      {editingSample && (
        <Modal
          isOpen={!!editingSample}
          onClose={() => setEditingSample(null)}
          title="Editar Amostra"
        >
          <SampleForm
            sample={editingSample}
            onSave={async (data) => {
              try {
                // Backend espera _id (ObjectId) ou sampleID
                const sampleId = (editingSample as any)._id || editingSample.sampleID;
                if (!sampleId) {
                  alert('ID da amostra não encontrado');
                  return;
                }
                // Se for _id (string ObjectId), usa diretamente; se for sampleID (número), converte
                const idToUse = typeof sampleId === 'string' ? sampleId : Number(sampleId);
                await updateSample(idToUse as any, data);
                await loadSamples();
                setEditingSample(null);
                alert('Amostra atualizada com sucesso');
              } catch (err: any) {
                alert(err.message || 'Erro ao atualizar amostra');
              }
            }}
            onCancel={() => setEditingSample(null)}
          />
        </Modal>
      )}

      {/* Modal de seleção de localização para importação */}
      {showLocationModal && (
        <Modal
          isOpen={showLocationModal}
          onClose={() => {
            setShowLocationModal(false);
            setSelectedFileForImport(null);
            setSelectedLocationForImport(undefined);
          }}
          title="Selecionar Localização para Importação"
        >
          <LocationSelectionContent
            fileName={selectedFileForImport?.name || ''}
            selectedLocation={selectedLocationForImport}
            onLocationChange={setSelectedLocationForImport}
            onConfirm={handleConfirmLocationAndImport}
            onCancel={() => {
              setShowLocationModal(false);
              setSelectedFileForImport(null);
              setSelectedLocationForImport(undefined);
            }}
            locations={locations}
            loadLocations={loadLocations}
            getLocationDescription={getLocationDropdownDescription}
          />
        </Modal>
      )}


      {/* Modal de Validação CSV */}
      {showValidationModal && (
        <Modal
          isOpen={showValidationModal}
          onClose={() => {
            setShowValidationModal(false);
            setCsvValidationErrors([]);
            setCsvValidationWarnings([]);
          }}
          title="Erros de Validação CSV"
        >
          <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {csvValidationErrors.length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <h4 style={{ color: '#d32f2f', marginBottom: '0.5rem' }}>❌ Erros encontrados:</h4>
                <ul style={{ listStyle: 'none', padding: 0 }}>
                  {csvValidationErrors.map((error, index) => (
                    <li key={index} style={{ 
                      padding: '0.5rem', 
                      marginBottom: '0.25rem', 
                      backgroundColor: '#ffebee', 
                      borderRadius: '4px',
                      color: '#c62828'
                    }}>
                      • {error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {csvValidationWarnings.length > 0 && (
              <div>
                <h4 style={{ color: '#f57c00', marginBottom: '0.5rem' }}>⚠️ Avisos:</h4>
                <ul style={{ listStyle: 'none', padding: 0 }}>
                  {csvValidationWarnings.map((warning, index) => (
                    <li key={index} style={{ 
                      padding: '0.5rem', 
                      marginBottom: '0.25rem', 
                      backgroundColor: '#fff3e0', 
                      borderRadius: '4px',
                      color: '#e65100'
                    }}>
                      • {warning}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-light)' }}>
                💡 Corrija os erros no arquivo CSV e tente novamente.
              </p>
            </div>
          </div>
        </Modal>
      )}

      {/* Feedback Visual de Processamento Assíncrono */}
      {(validating || creating || isPolling) && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '1rem',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          zIndex: 1000,
          minWidth: '300px',
          maxWidth: '400px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            {validating && <span style={{ fontSize: '1.25rem' }}>🔍</span>}
            {creating && <span style={{ fontSize: '1.25rem' }}>📝</span>}
            {isPolling && <span style={{ fontSize: '1.25rem' }}>⚙️</span>}
            <div>
              <div style={{ fontWeight: 500, color: 'var(--text)' }}>
                {validating && 'Validando arquivo...'}
                {creating && 'Criando job de importação...'}
                {isPolling && job && `Processando: ${job.progress || 0}%`}
                {isPolling && !job && 'Processando...'}
              </div>
              {job && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: '0.25rem' }}>
                  Status: {job.status === 'pending' ? 'Pendente' : 
                           job.status === 'processing' ? 'Processando' :
                           job.status === 'completed' ? 'Concluído' :
                           job.status === 'failed' ? 'Falhou' : job.status}
                </div>
              )}
            </div>
          </div>
          {isPolling && job && job.progress !== undefined && (
            <div style={{
              width: '100%',
              height: '8px',
              backgroundColor: 'var(--border)',
              borderRadius: '4px',
              overflow: 'hidden',
              marginTop: '0.5rem'
            }}>
              <div style={{
                width: `${job.progress}%`,
                height: '100%',
                backgroundColor: job.status === 'failed' ? '#d32f2f' : '#4caf50',
                transition: 'width 0.3s ease'
              }} />
            </div>
          )}
          {job && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: '0.5rem' }}>
              {job.successCount || 0} / {job.totalRecords || 0} registros processados
            </div>
          )}
        </div>
      )}

    </div>
  );
}

// Componente para conteúdo do modal de seleção de localização
function LocationSelectionContent({
  fileName,
  selectedLocation,
  onLocationChange,
  onConfirm,
  onCancel,
  locations,
  loadLocations,
  getLocationDescription,
}: {
  fileName: string;
  selectedLocation: number | undefined;
  onLocationChange: (locationID: number | undefined) => void;
  onConfirm: () => void;
  onCancel: () => void;
  locations: LocationModel[];
  loadLocations: () => Promise<void>;
  getLocationDescription: (location: LocationModel) => string;
}) {
  const [loading, setLoading] = useState(false);

  // Função para corrigir localizações sem locationID
  const fixMissingLocationIDs = async () => {
    try {
      const response = await locationService.fixMissingLocationIDs();
      console.debug('Localizações corrigidas:', response.data);
      // Recarrega localizações após correção
      if (loadLocations) {
        await loadLocations();
      }
      return response.data;
    } catch (error: any) {
      console.error('Erro ao corrigir localizações:', error);
      const errorMessage = error.response?.data?.message || error.response?.data?.error || error.message || 'Erro desconhecido ao corrigir localizações';
      const statusCode = error.response?.status;
      
      if (statusCode === 404) {
        throw new Error('Endpoint de correção não encontrado. Verifique se o servidor está atualizado e reinicie o backend.');
      } else if (statusCode === 403) {
        throw new Error('Você não tem permissão para executar esta ação. É necessário ter permissão para criar amostras.');
      } else if (statusCode === 401) {
        throw new Error('Sessão expirada. Por favor, faça login novamente.');
      }
      
      throw new Error(errorMessage);
    }
  };

  // Recarrega localizações quando o componente monta
  useEffect(() => {
    if (loadLocations) {
      setLoading(true);
      loadLocations()
        .then(() => {
          setLoading(false);
          console.debug('Localizações recarregadas no modal:', locations.length);
          console.debug('Localizações detalhadas:', locations.map((l: LocationModel) => ({
            locationID: l.locationID,
            type: typeof l.locationID,
            block: l.block,
            rack: l.rack
          })));
        })
        .catch((err) => {
          console.error('Erro ao carregar localizações:', err);
          setLoading(false);
        });
    }
  }, []); // Executa apenas uma vez ao montar

  // Filtra e ordena localizações
  const availableLocations = (locations || [])
    .filter((loc: LocationModel) => {
      // Aceita localizações com locationID válido (número ou string numérica)
      if (!loc) return false;
      
      const locationID = loc.locationID;
      // Aceita se for número válido ou string que pode ser convertida para número
      if (locationID === undefined || locationID === null) return false;
      
      // Tenta converter para número
      const numID = Number(locationID);
      const isValid = !isNaN(numID) && numID > 0;
      
      if (!isValid) {
        console.debug('Localização filtrada (locationID inválido):', {
          locationID,
          type: typeof locationID,
          loc
        });
      }
      
      return isValid;
    })
    .sort((a: LocationModel, b: LocationModel) => {
      // Ordena por locationID
      const aID = Number(a.locationID) || 0;
      const bID = Number(b.locationID) || 0;
      return aID - bID;
    });
  
  // Detecta localizações sem locationID válido e oferece correção
  const locationsWithoutValidID = (locations || []).filter((loc: LocationModel) => {
    if (!loc) return false;
    const locationID = loc.locationID;
    if (locationID === undefined || locationID === null) return true;
    const numID = Number(locationID);
    return isNaN(numID) || numID <= 0;
  });
  
  // Debug: log das localizações disponíveis
  useEffect(() => {
    console.debug('=== DEBUG LOCALIZAÇÕES ===');
    console.debug('Total de localizações recebidas:', (locations || []).length);
    console.debug('Localizações disponíveis no select:', availableLocations.length);
    console.debug('Localizações sem locationID válido:', locationsWithoutValidID.length);
    if ((locations || []).length > 0) {
      console.debug('Todas as localizações:', locations.map((l: LocationModel) => ({
        locationID: l.locationID,
        type: typeof l.locationID,
        block: l.block,
        rack: l.rack,
        drawer: l.drawer,
        box: l.box
      })));
    }
    if (availableLocations.length > 0) {
      console.debug('Primeiras localizações disponíveis:', availableLocations.slice(0, 3).map((l: LocationModel) => ({
        locationID: l.locationID,
        description: getLocationDescription(l)
      })));
    }
    console.debug('========================');
  }, [locations, availableLocations.length, locationsWithoutValidID.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <p style={{ marginBottom: '0.5rem', color: 'var(--text)' }}>
          <strong>Arquivo selecionado:</strong> {fileName}
        </p>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-light)', marginBottom: '1rem' }}>
          Selecione a localização inicial para armazenamento. As posições serão incrementadas automaticamente conforme a disponibilidade de vagas cadastradas.
        </p>
      </div>
      
      <div>
        <label style={{ 
          display: 'block', 
          marginBottom: '0.5rem', 
          fontSize: '0.875rem',
          fontWeight: 500,
          color: 'var(--text)'
        }}>
          Localização Inicial *
        </label>
        {loading ? (
          <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-light)' }}>
            Carregando localizações...
          </div>
        ) : (
          <select
            value={selectedLocation || ''}
            onChange={(e) => onLocationChange(e.target.value ? parseInt(e.target.value) : undefined)}
            style={{
              width: '100%',
              padding: '0.625rem 0.75rem',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: '0.875rem',
              backgroundColor: 'var(--surface)',
              color: 'var(--text)'
            }}
          >
            <option value="">Selecione uma localização</option>
            {availableLocations.length > 0 ? (
              availableLocations.map((loc: LocationModel) => {
                const locationID = Number(loc.locationID);
                return (
                  <option key={locationID} value={String(locationID)}>
                    {getLocationDescription(loc)}
                  </option>
                );
              })
            ) : (
              <option value="" disabled>
                {(locations || []).length === 0 
                  ? 'Nenhuma localização cadastrada. Cadastre localizações em "Gerenciamento de Instalações".'
                  : `Nenhuma localização disponível com locationID válido (${(locations || []).length} localização(ões) sem locationID válido)`}
              </option>
            )}
          </select>
        )}
        {availableLocations.length === 0 && !loading && (
          <div style={{ 
            marginTop: '0.75rem', 
            padding: '0.75rem',
            backgroundColor: '#fff3cd',
            border: '1px solid #ffc107',
            borderRadius: '4px',
            fontSize: '0.75rem',
            color: '#856404'
          }}>
            <strong>⚠️ Atenção:</strong>
            <p style={{ margin: '0.25rem 0 0 0' }}>
              {locations && locations.length > 0 
                ? `${locations.length} localização(ões) encontrada(s), mas nenhuma possui locationID válido. As localizações precisam ter locationID numérico maior que zero para serem usadas na importação.`
                : 'Nenhuma localização cadastrada. Cadastre localizações em "Gerenciamento de Instalações" antes de importar amostras.'}
            </p>
            {locationsWithoutValidID.length > 0 && (
              <div style={{ marginTop: '0.5rem' }}>
                <Button
                  onClick={async () => {
                    try {
                      setLoading(true);
                      const result = await fixMissingLocationIDs();
                      const message = result?.message || `${locationsWithoutValidID.length} localização(ões) corrigida(s) com sucesso!`;
                      alert(message);
                    } catch (error: any) {
                      const errorMessage = error.message || 'Erro desconhecido';
                      alert(`Erro ao corrigir localizações:\n\n${errorMessage}\n\nSe o erro persistir, verifique:\n1. Se o servidor backend está rodando\n2. Se você tem permissão para criar amostras\n3. Se o servidor foi reiniciado após atualizações`);
                      console.error('Detalhes do erro:', error);
                    } finally {
                      setLoading(false);
                    }
                  }}
                  disabled={loading}
                  style={{
                    fontSize: '0.7rem',
                    padding: '0.5rem 1rem',
                    marginTop: '0.5rem',
                    opacity: loading ? 0.6 : 1,
                    cursor: loading ? 'wait' : 'pointer'
                  }}
                >
                  {loading ? '⏳ Corrigindo...' : '🔧 Corrigir Localizações Automaticamente'}
                </Button>
                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.7rem' }}>
                  Clique no botão acima para gerar locationID automaticamente para {locationsWithoutValidID.length} localização(ões) antiga(s).
                </p>
              </div>
            )}
            {locations && locations.length > 0 && locationsWithoutValidID.length === 0 && (
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.7rem' }}>
                💡 Dica: As localizações criadas recentemente têm locationID gerado automaticamente. Verifique o console do navegador (F12) para mais detalhes.
              </p>
            )}
          </div>
        )}
      </div>

      <div style={{ 
        display: 'flex', 
        gap: '0.75rem', 
        justifyContent: 'flex-end',
        marginTop: '1rem',
        paddingTop: '1rem',
        borderTop: '1px solid var(--border)'
      }}>
        <Button
          variant="secondary"
          onClick={onCancel}
        >
          Cancelar
        </Button>
        <Button
          onClick={onConfirm}
          disabled={!selectedLocation || loading}
        >
          Confirmar e Importar
        </Button>
      </div>
    </div>
  );
}

function SampleForm({
  sample,
  onSave,
  onCancel,
}: {
  sample: Sample | null;
  onSave: (data: Partial<Sample>) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const sampleTypeSelectId = useId();
  // Removido useQualityDescriptions - agora usamos escala MIABIS diretamente (0, 1, 2)
  const { units = [] } = useMeasurementUnits();
  const { locations = [] } = useLocations();
  const { equipment = [] } = useEquipment();
  const { sampleTypes = [], loading: loadingSampleTypes } = useSampleTypes();
  const { origins = [], loading: loadingOrigins } = useSampleOrigins();
  const { protocols = [], loading: loadingProtocols } = useExtractionProtocols();
  const [validatingID, setValidatingID] = useState(false);
  const [patientIDValid, setPatientIDValid] = useState<boolean | null>(null);
  const [patientIDError, setPatientIDError] = useState<string>('');
  const [formData, setFormData] = useState<Partial<Sample>>(
    sample || {
      patientID: '',
      sampleType: '',
      sampleOrigin: '',
      extractionProtocol: '',
      barcode: '',
      registrationDate: new Date(),
      quantity: 0,
      quality: undefined,
      qualityID: undefined, // Mantido para compatibilidade
      unitID: undefined,
      locationID: undefined,
      linkedProject: '',
      movementType: 'Armazenamento',
      availabilityStatus: 'Disponível',
      availableQuantity: undefined, // Será inicializado igual à quantity
      currentStatus: 'Available',
    }
  );

  const [miabisValidation, setMiabisValidation] = useState<MIABISValidationResult | null>(null);

  // Validação MIABIS em tempo real
  useEffect(() => {
    if (formData.sampleType || formData.patientID || formData.registrationDate) {
      const validation = validateMIABIS(formData);
      setMiabisValidation(validation);
    }
  }, [formData]);

  // Valida formato do ID de paciente (8 dígitos)
  const validatePatientIDFormat = (id: string | number): boolean => {
    const idStr = String(id).trim();
    return /^\d{8}$/.test(idStr);
  };

  // Valida ID de paciente via API
  const validatePatientID = async (patientID: string | number): Promise<boolean> => {
    const idStr = String(patientID).trim();
    
    // Valida formato primeiro
    if (!validatePatientIDFormat(idStr)) {
      setPatientIDError(t('samples.patientIDInvalid'));
      setPatientIDValid(false);
      return false;
    }
    
    try {
      setValidatingID(true);
      setPatientIDError('');
      const response = await patientService.validateID(idStr);
      
      if (response.data.valid) {
        setPatientIDValid(true);
        return true;
      } else {
        setPatientIDError('ID de paciente não encontrado no sistema');
        setPatientIDValid(false);
        return false;
      }
    } catch (err: any) {
      setPatientIDError(err.response?.data?.error || t('samples.patientIDError'));
      setPatientIDValid(false);
      return false;
    } finally {
      setValidatingID(false);
    }
  };

  // Valida ID quando o campo muda (debounced)
  useEffect(() => {
    const patientID = String(formData.patientID || '').trim();
    
    if (patientID.length === 0) {
      setPatientIDValid(null);
      setPatientIDError('');
      return;
    }
    
    // Valida formato imediatamente
    if (!validatePatientIDFormat(patientID)) {
      if (patientID.length === 8) {
        setPatientIDError('ID deve conter apenas números');
        setPatientIDValid(false);
      } else {
        setPatientIDValid(null);
        setPatientIDError('');
      }
      return;
    }
    
    // Valida existência via API após 500ms de inatividade
    const timeoutId = setTimeout(() => {
      validatePatientID(patientID);
    }, 500);
    
    return () => clearTimeout(timeoutId);
  }, [formData.patientID]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validação: ID de paciente é obrigatório
    const patientID = String(formData.patientID || '').trim();
    if (!patientID) {
      alert('Por favor, informe o ID de paciente de 8 dígitos antes de salvar a amostra.');
      return;
    }
    
    // Valida formato
    if (!validatePatientIDFormat(patientID)) {
      alert('ID de paciente inválido. Deve ter exatamente 8 dígitos numéricos.');
      return;
    }
    
    // Valida existência no sistema
    const isValid = await validatePatientID(patientID);
    if (!isValid) {
      alert('ID de paciente inválido ou não encontrado. Verifique o ID e tente novamente.');
      return;
    }
    
    // Valida quality MIABIS (0, 1 ou 2)
    const qualityValue = formData.quality;
    if (qualityValue === undefined || qualityValue === null) {
      alert((t('samples.requiredField') || 'Campo obrigatório') + ': ' + (t('samples.quality') || 'Qualidade'));
      return;
    }
    if (!Number.isInteger(qualityValue) || (qualityValue !== 0 && qualityValue !== 1 && qualityValue !== 2)) {
      alert(t('samples.invalidQuality') || 'Qualidade deve estar na escala MIABIS: 0 (Não avaliada), 1 (Adequada) ou 2 (Inadequada)');
      return;
    }
    
    // Validação MIABIS antes de enviar
    const validation = validateMIABIS(formData);
    if (!validation.isValid) {
      alert(t('samples.miabisValidationError') + ':\n' + validation.errors.join('\n'));
      return;
    }
    
    if (validation.warnings.length > 0) {
      const proceed = confirm(
        t('samples.miabisValidationWarnings') + ':\n' + 
        validation.warnings.join('\n') + 
        '\n\n' + t('common.confirmContinue')
      );
      if (!proceed) {
        return;
      }
    }
    
    // Garante que patientID seja string, locationID seja número e quality seja número MIABIS antes de salvar
    const dataToSave = {
      ...formData,
      patientID: String(formData.patientID).trim(),
      locationID: formData.locationID ? Number(formData.locationID) : undefined,
      quality: qualityValue // Garante que quality está na escala MIABIS (0, 1, 2)
    };
    
    // Validação adicional: locationID deve ser um número válido
    if (!dataToSave.locationID || isNaN(dataToSave.locationID)) {
      alert('Por favor, selecione uma localização válida antes de salvar a amostra.');
      return;
    }
    
    onSave(dataToSave);
  };

  return (
    <form onSubmit={handleSubmit} className="form">
      {/* Indicador de Validação MIABIS */}
      {miabisValidation && (
        <div style={{ 
          marginBottom: '1rem', 
          padding: '0.75rem', 
          borderRadius: '6px',
          backgroundColor: miabisValidation.isValid 
            ? (miabisValidation.miabisCompliant ? '#d4edda' : '#fff3cd')
            : '#f8d7da',
          border: `1px solid ${miabisValidation.isValid 
            ? (miabisValidation.miabisCompliant ? '#c3e6cb' : '#ffeaa7')
            : '#f5c6cb'}`,
        }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.5rem',
            marginBottom: miabisValidation.errors.length > 0 || miabisValidation.warnings.length > 0 ? '0.5rem' : '0'
          }}>
            <strong style={{ color: miabisValidation.isValid ? '#155724' : '#721c24' }}>
              {miabisValidation.miabisCompliant 
                ? '✅ Conforme MIABIS' 
                : miabisValidation.isValid 
                  ? '⚠️ Conforme MIABIS (com avisos)' 
                  : '❌ Não conforme MIABIS'}
            </strong>
          </div>
          {miabisValidation.errors.length > 0 && (
            <div style={{ marginTop: '0.5rem' }}>
              <strong style={{ color: '#721c24' }}>Erros:</strong>
              <ul style={{ margin: '0.25rem 0', paddingLeft: '1.5rem', color: '#721c24' }}>
                {miabisValidation.errors.map((error, idx) => (
                  <li key={idx} style={{ fontSize: '0.9rem' }}>{error}</li>
                ))}
              </ul>
            </div>
          )}
          {miabisValidation.warnings.length > 0 && (
            <div style={{ marginTop: '0.5rem' }}>
              <strong style={{ color: '#856404' }}>Avisos:</strong>
              <ul style={{ margin: '0.25rem 0', paddingLeft: '1.5rem', color: '#856404' }}>
                {miabisValidation.warnings.map((warning, idx) => (
                  <li key={idx} style={{ fontSize: '0.9rem' }}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <div className="form-grid">
        <div className="form-grid-full">
          <Input
            label="ID do Paciente (8 dígitos) *"
            type="text"
            name="patientID"
            value={String(formData.patientID || '')}
            onChange={(e) => {
              const value = e.target.value.replace(/\D/g, ''); // Remove tudo que não é dígito
              // Limita a 8 dígitos
              const limitedValue = value.slice(0, 8);
              setFormData({
                ...formData,
                patientID: limitedValue,
              });
              // Reseta validação quando o usuário digita
              if (limitedValue.length < 8) {
                setPatientIDValid(null);
                setPatientIDError('');
              }
            }}
            placeholder="Digite o ID de 8 dígitos"
            maxLength={8}
            required
            error={patientIDError}
            style={{
              borderColor: patientIDValid === false ? '#dc2626' : patientIDValid === true ? '#16a34a' : undefined
            }}
          />
          {validatingID && (
            <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '0.25rem' }}>
              Validando ID...
            </p>
          )}
          {patientIDError && (
            <p style={{ fontSize: '0.875rem', color: '#dc2626', marginTop: '0.25rem' }}>
              {patientIDError}
            </p>
          )}
          {patientIDValid === true && (
            <p style={{ fontSize: '0.875rem', color: '#16a34a', marginTop: '0.25rem' }}>
              {t('samples.patientIDValid')}
            </p>
          )}
          <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
            {t('samples.patientIDHint')}
          </p>
        </div>
        <div className="form-grid-full">
          <label htmlFor={sampleTypeSelectId} className="input-label">Tipo de Amostra *</label>
          <select
            id={sampleTypeSelectId}
            name="sampleType"
            className="input"
            value={formData.sampleType || ''}
            onChange={(e) =>
              setFormData({ ...formData, sampleType: e.target.value })
            }
            required
          >
            <option value="">{t('samples.selectSampleType') || 'Selecione o tipo de amostra'}</option>
            {loadingSampleTypes ? (
              <option value="" disabled>Carregando tipos...</option>
            ) : Array.isArray(sampleTypes) && sampleTypes.length > 0 ? (
              sampleTypes.map((type) => (
                <option key={type.sampleTypeID} value={type.description}>
                  {type.description}
                </option>
              ))
            ) : (
              <option value="" disabled>
                Nenhum tipo disponível. Cadastre em "Gerenciamento do Sistema".
              </option>
            )}
          </select>
        </div>
        <div className="form-grid-full">
          <label className="input-label">Origem *</label>
          <select
            className="input"
            value={formData.sampleOrigin || ''}
            onChange={(e) =>
              setFormData({ ...formData, sampleOrigin: e.target.value })
            }
            required
          >
            <option value="">{t('samples.selectOrigin') || 'Selecione a origem'}</option>
            {loadingOrigins ? (
              <option value="" disabled>Carregando origens...</option>
            ) : Array.isArray(origins) && origins.length > 0 ? (
              origins.map((origin) => (
                <option key={origin.originID} value={origin.description}>
                  {origin.description}
                </option>
              ))
            ) : (
              <option value="" disabled>
                Nenhuma origem disponível. Cadastre em "Gerenciamento do Sistema".
              </option>
            )}
          </select>
        </div>
        <div className="form-grid-full">
          <label className="input-label">Protocolo de Extração *</label>
          <select
            className="input"
            value={formData.extractionProtocol || ''}
            onChange={(e) =>
              setFormData({ ...formData, extractionProtocol: e.target.value })
            }
            required
          >
            <option value="">Selecione o protocolo de extração</option>
            {loadingProtocols ? (
              <option value="" disabled>Carregando protocolos...</option>
            ) : Array.isArray(protocols) && protocols.length > 0 ? (
              protocols.map((protocol) => (
                <option key={protocol.protocolID} value={protocol.description}>
                  {protocol.description}
                </option>
              ))
            ) : (
              <option value="" disabled>
                Nenhum protocolo disponível. Cadastre em "Gerenciamento do Sistema".
              </option>
            )}
          </select>
        </div>
        <Input
          label="Código de Barras *"
          type="text"
          value={formData.barcode ? String(formData.barcode) : ''}
          onChange={(e) =>
            setFormData({ ...formData, barcode: e.target.value })
          }
          required
          placeholder="BR-YYYY-NNN (será gerado automaticamente se vazio)"
        />
        <Input
          label="Quantidade (µL) *"
          type="number"
          step="0.1"
          value={formData.quantity || ''}
          onChange={(e) => {
            const qty = parseFloat(e.target.value) || 0;
            setFormData({ 
              ...formData, 
              quantity: qty,
              availableQuantity: formData.availableQuantity === undefined ? qty : formData.availableQuantity
            });
          }}
          required
        />
        <Input
          label="Quantidade Disponível"
          type="number"
          step="0.1"
          value={formData.availableQuantity ?? formData.quantity ?? ''}
          onChange={(e) =>
            setFormData({ ...formData, availableQuantity: parseFloat(e.target.value) })
          }
          placeholder="Igual à quantidade inicial"
        />
        <div className="form-grid-full">
          <label 
            className="input-label"
            title={t('samples.qualityTooltip') || 'Escala MIABIS oficial: 0 = Não avaliada, 1 = Adequada, 2 = Inadequada'}
          >
            {t('samples.quality') || 'Qualidade (MIABIS)'} *
          </label>
          <select
            className="input"
            value={formData.quality !== undefined && formData.quality !== null ? formData.quality : ''}
            onChange={(e) => {
              const value = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
              // Valida se é 0, 1 ou 2
              if (value !== undefined && (value === 0 || value === 1 || value === 2)) {
                setFormData({ ...formData, quality: value });
              } else if (value === undefined) {
                setFormData({ ...formData, quality: undefined });
              }
            }}
            required
            title={t('samples.qualityTooltip') || 'Escala MIABIS oficial: 0 = Não avaliada, 1 = Adequada, 2 = Inadequada'}
          >
            <option value="">{t('samples.selectQuality') || 'Selecione a qualidade (MIABIS)'}</option>
            <option value="0">{t('samples.qualityMIABIS.0') || '0 - Não avaliada (Not assessed)'}</option>
            <option value="1">{t('samples.qualityMIABIS.1') || '1 - Adequada (Suitable)'}</option>
            <option value="2">{t('samples.qualityMIABIS.2') || '2 - Inadequada (Not suitable)'}</option>
          </select>
        </div>
        <div className="form-grid-full">
          <label className="input-label">Unidade de Medida</label>
          <select
            className="input"
            value={formData.unitID || ''}
            onChange={(e) =>
              setFormData({
                ...formData,
                unitID: e.target.value ? parseInt(e.target.value) : undefined,
              })
            }
          >
            <option value="">Selecione uma unidade de medida</option>
            {Array.isArray(units) && units.length > 0 ? (
              units.map((unit) => (
                <option key={unit.unitID} value={unit.unitID}>
                  {unit.description} (ID: {unit.unitID})
                </option>
              ))
            ) : (
              <option value="" disabled>Carregando unidades...</option>
            )}
          </select>
        </div>
        <div className="form-grid-full">
          <label className="input-label">Localização *</label>
          <select
            className="input"
            value={formData.locationID ? String(formData.locationID) : ''}
            onChange={(e) => {
              const value = e.target.value;
              setFormData({
                ...formData,
                locationID: value && value !== '' ? Number(value) : undefined,
              });
            }}
            required
          >
            <option value="">Selecione uma localização</option>
            {Array.isArray(locations) && locations.length > 0 ? (
              locations.map((location) => {
                // Usa locationID como valor principal, _id como fallback apenas para key
                const locationID = location.locationID;
                const locationKey = locationID || (location as any)._id || `loc-${Math.random()}`;
                
                // Se não tiver locationID, pula esta localização (não deve aparecer no dropdown)
                if (!locationID) {
                  return null;
                }
                
                // Função helper para descrição do tipo de equipamento
                const getEquipmentTypeDescription = (equipmentType: number | undefined): string => {
                  if (!equipmentType) return '';
                  const types: Record<number, string> = {
                    1: 'Freezer -80°C #1',
                    2: 'Freezer -80°C #2',
                    3: 'Freezer -20°C',
                    4: 'Refrigerador 4°C',
                    5: 'Nitrogênio Líquido',
                  };
                  return types[equipmentType] || `Tipo ${equipmentType}`;
                };
                
                // Monta descrição completa e organizada
                const parts: string[] = [];
                
                // 1. Localização física (sempre presente)
                parts.push(`B${location.block}-P${location.rack}-G${location.drawer}-C${location.box}`);
                
                // 2. Tipo de equipamento
                const equipmentTypeDesc = getEquipmentTypeDescription(location.equipmentType);
                if (equipmentTypeDesc) {
                  parts.push(equipmentTypeDesc);
                }
                
                // 3. Equipamento vinculado (se houver)
                if (location.equipmentID) {
                  const eq = equipment.find((e) => e.equipmentID === location.equipmentID);
                  if (eq) {
                    let eqDesc = `Equip. ${eq.equipmentID}: ${eq.equipmentDescription}`;
                    if (eq.model) {
                      eqDesc += ` (${eq.model})`;
                    }
                    if (eq.serialNumber) {
                      eqDesc += ` | S/N: ${eq.serialNumber}`;
                    }
                    parts.push(eqDesc);
                  }
                }
                
                // 4. Poço Eppendorf (se houver)
                const wellInfo = location.wellPosition || location.eppendorfWell || '';
                if (wellInfo) {
                  parts.push(`Poço ${wellInfo}`);
                }
                
                // Junta todas as partes com separador mais legível
                const fullDescription = parts.join(' • ');
                
                return (
                  <option key={locationKey} value={String(locationID)}>
                    {fullDescription}
                  </option>
                );
              }).filter(Boolean) // Remove nulls
            ) : (
              <option value="" disabled>Carregando localizações...</option>
            )}
          </select>
        </div>
        <Input
          label="Projeto Vinculado *"
          value={formData.linkedProject || ''}
          onChange={(e) =>
            setFormData({ ...formData, linkedProject: e.target.value })
          }
          required
        />
        <Input
          label="Data de Registro *"
          type="date"
          value={
            formData.registrationDate
              ? new Date(formData.registrationDate).toISOString().split('T')[0]
              : ''
          }
          onChange={(e) =>
            setFormData({
              ...formData,
              registrationDate: e.target.value ? new Date(e.target.value) : undefined,
            })
          }
          required
        />
        <div className="form-grid-full">
          <label className="input-label">Tipo de Movimentação</label>
          <select
            className="input"
            value={formData.movementType || 'Armazenamento'}
            onChange={(e) =>
              setFormData({ 
                ...formData, 
                movementType: e.target.value as 'Armazenamento' | 'Transferência' 
              })
            }
          >
            <option value="Armazenamento">Armazenamento</option>
            <option value="Transferência">Transferência</option>
          </select>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            {formData.movementType === 'Transferência' 
              ? 'Transferência definitiva remove a amostra do estoque'
              : 'Armazenamento mantém a amostra no estoque'}
          </p>
        </div>
        <div className="form-grid-full">
          <label className="input-label">Status *</label>
          <select
            className="input"
            value={formData.currentStatus || 'Available'}
            onChange={(e) => {
              const newStatus = e.target.value;
              setFormData({ 
                ...formData, 
                currentStatus: newStatus
              });
            }}
            required
          >
            <option value="Available">Available</option>
            <option value="Withdrawn">Withdrawn</option>
          </select>
        </div>
        {/* Nota: Campos de retirada devem ser gerenciados através do modal de retirada (WithdrawalModal) */}
      </div>
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit">Salvar</Button>
      </div>
    </form>
  );
}


// Componente para retirada e devolução de amostra (não utilizado - mantido para referência futura)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function WithdrawalModal({ 
  onClose, 
  onSuccess 
}: { 
  onClose: () => void; 
  onSuccess: () => void;
}) {
  const { units } = useMeasurementUnits();
  const { user } = useAuth();
  const [mode, setMode] = useState<'withdrawal' | 'return'>('withdrawal'); // Modo: retirada ou devolução
  const [barcodeInput, setBarcodeInput] = useState('');
  const [searchedSample, setSearchedSample] = useState<Sample | null>(null);
  const [patientInfo, setPatientInfo] = useState<{ patientID: number; patientName: string; recordNumber: number } | null>(null);
  const [searching, setSearching] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [qrScanner, setQrScanner] = useState<any>(null);
  const [withdrawalType, setWithdrawalType] = useState<'Parcial' | 'Total'>('Total');
  const [withdrawalQuantity, setWithdrawalQuantity] = useState<number>(0);
  const [withdrawalResponsible, setWithdrawalResponsible] = useState('');
  const [withdrawalDestination, setWithdrawalDestination] = useState('');
  const [linkedProject, setLinkedProject] = useState('');
  const [justification, setJustification] = useState('');
  const [condition, setCondition] = useState(''); // Condição da amostra (para devolução)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const availableQuantity = searchedSample ? (searchedSample.availableQuantity ?? searchedSample.quantity ?? 0) : 0;
  const totalQuantity = searchedSample ? (searchedSample.quantity ?? 0) : 0;
  const withdrawnQuantity = totalQuantity - availableQuantity; // Quantidade retirada (disponível para devolução)
  const unit = searchedSample ? units.find(u => u.unitID === searchedSample.unitID) : undefined;

  const handleSearchByBarcode = async () => {
    if (!barcodeInput || barcodeInput.trim() === '') {
      setError('Digite ou escaneie o código de barras');
      return;
    }

    setSearching(true);
    setError('');
    try {
      // Remove espaços e valida formato BR-YYYY-NNN
      const barcode = barcodeInput.trim();
      
      // Valida formato BR-YYYY-NNN (mas aceita também números antigos para compatibilidade)
      if (!barcode.match(/^(BR-\d{4}-\d{3}|\d+)$/)) {
        setError('Formato de código de barras inválido. Esperado: BR-YYYY-NNN');
        setSearching(false);
        return;
      }

      const response = await sampleService.getByBarcode(barcode);
      
      // Verifica se a resposta contém dados válidos
      if (!response || !response.data) {
        setError('Resposta inválida do servidor');
        setSearchedSample(null);
        setPatientInfo(null);
        setSearching(false);
        return;
      }
      
      // Compatibilidade com estrutura { success, data: { sample, patient } }
      const result = response.data?.data || response.data;
      
      if (!result.sample) {
        setError('Amostra não encontrada com este código de barras');
        setSearchedSample(null);
        setPatientInfo(null);
        setSearching(false);
        return;
      }
      
      setSearchedSample(result.sample);
      setPatientInfo(result.patient);

      // Validação baseada no modo
      const availableQty = result.sample.availableQuantity ?? result.sample.quantity ?? 0;
      const totalQty = result.sample.quantity ?? 0;
      const withdrawnQty = totalQty - availableQty;
      
      if (mode === 'withdrawal' && availableQty <= 0) {
        setError('Esta amostra não está disponível para retirada');
        setSearchedSample(null);
      } else if (mode === 'return' && withdrawnQty <= 0) {
        setError('Esta amostra não possui quantidade retirada para devolução');
        setSearchedSample(null);
      }
    } catch (err: any) {
      console.error('Erro ao buscar amostra por código de barras:', err);
      const errorMessage = err.response?.data?.error || err.message || 'Amostra não encontrada com este código de barras';
      setError(errorMessage);
      setSearchedSample(null);
      setPatientInfo(null);
    } finally {
      setSearching(false);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleQRCodeScan = async (decodedText: string) => {
    setBarcodeInput(decodedText);
    setShowQRScanner(false);
    if (qrScanner) {
      qrScanner.stop().catch(() => {});
    }
    // Aguarda um pouco e faz a busca
    setTimeout(() => {
      handleSearchByBarcode();
    }, 500);
  };

  const startQRScanner = async () => {
    try {
      // Verifica se a API de câmera está disponível
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Câmera não disponível. Verifique as permissões do navegador.');
      }

      setShowQRScanner(true);
      setError('');
      
      // Aguarda um pouco para garantir que o elemento foi renderizado
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const elementId = 'qr-reader';
      const element = document.getElementById(elementId);
      
      if (!element) {
        throw new Error('Elemento do leitor QR Code não encontrado. Tente novamente.');
      }

      // Limpa qualquer scanner anterior
      if (qrScanner) {
        try {
          await qrScanner.stop();
          qrScanner.clear();
        } catch (e) {
          // Ignora erros ao limpar scanner anterior
        }
      }

      // TODO: Implementar scanner de QR Code com biblioteca apropriada
      // Por enquanto, desabilitado até que a biblioteca seja instalada
      // Para implementar, instale: npm install html5-qrcode
      console.warn('Scanner de QR Code não implementado. Use uma biblioteca como html5-qrcode');
      throw new Error('Scanner de QR Code não está disponível. Por favor, digite o código de barras manualmente.');
      
      /* Código comentado até implementação:
      const scanner = new Html5Qrcode(elementId);
      
      // Tenta iniciar com câmera traseira primeiro, depois frontal
      let started = false;
      try {
        await scanner.start(
          { facingMode: 'environment' },
          {
            qrbox: { width: 250, height: 250 },
            fps: 10,
          },
          handleQRCodeScan,
          (errorMessage: string) => {
            // Ignora erros de leitura (continua tentando)
            // Não mostra erro para cada tentativa falha de leitura
          }
        );
        started = true;
      } catch (envError) {
        // Se falhar com câmera traseira, tenta frontal
        try {
          await scanner.start(
            { facingMode: 'user' },
            {
              qrbox: { width: 250, height: 250 },
              fps: 10,
            },
            handleQRCodeScan,
            (errorMessage: string) => {
              // Ignora erros de leitura
            }
          );
          started = true;
        } catch (userError) {
          throw new Error('Não foi possível acessar a câmera. Verifique as permissões.');
        }
      }
      */
      
      // Código comentado - scanner não está implementado ainda
      // if (started) {
      //   setQrScanner(scanner);
      // }
    } catch (err: any) {
      console.error('Erro ao iniciar leitor de QR Code:', err);
      const errorMsg = err?.message || err?.toString() || 'Erro desconhecido ao acessar a câmera';
      setError('Erro ao iniciar leitor de QR Code: ' + errorMsg + '. Você pode digitar o código manualmente.');
      setShowQRScanner(false);
      if (qrScanner) {
        try {
          await qrScanner.stop();
          qrScanner.clear();
        } catch (e) {
          // Ignora
        }
        setQrScanner(null);
      }
    }
  };

  const stopQRScanner = async () => {
    if (qrScanner) {
      try {
        await qrScanner.stop();
        qrScanner.clear();
      } catch (err) {
        // Ignora erros ao parar o scanner
        console.warn('Erro ao parar scanner:', err);
      }
      setQrScanner(null);
    }
    setShowQRScanner(false);
  };

  useEffect(() => {
    return () => {
      if (qrScanner) {
        qrScanner.stop().catch(() => {});
        qrScanner.clear().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!searchedSample) {
      setError('Busque uma amostra pelo código de barras antes de continuar');
      return;
    }

    if (!withdrawalResponsible || withdrawalResponsible.trim().split(' ').length < 2) {
      setError('Nome do responsável deve conter nome e sobrenome');
      return;
    }

    if (!linkedProject || linkedProject.trim() === '') {
      setError('Projeto vinculado é obrigatório');
      return;
    }

    // Validações específicas por modo
    if (mode === 'withdrawal') {
      if (withdrawalType === 'Parcial') {
        if (!withdrawalQuantity || withdrawalQuantity <= 0) {
          setError('Digite a quantidade a ser retirada');
          return;
        }
        if (withdrawalQuantity > availableQuantity) {
          setError(`Quantidade não pode ser maior que a disponível (${availableQuantity} ${unit?.description || ''})`);
          return;
        }
      }
    } else {
      // Modo devolução
      if (withdrawalType === 'Parcial') {
        if (!withdrawalQuantity || withdrawalQuantity <= 0) {
          setError('Digite a quantidade a ser devolvida');
          return;
        }
        if (withdrawalQuantity > withdrawnQuantity) {
          setError(`Quantidade não pode ser maior que a retirada (${withdrawnQuantity} ${unit?.description || ''})`);
          return;
        }
      } else {
        // Total
        if (withdrawnQuantity <= 0) {
          setError('Não há quantidade retirada para devolução total');
          return;
        }
      }
    }

    setLoading(true);
    try {
      if (mode === 'withdrawal') {
        const sampleID = searchedSample.sampleID || searchedSample._id;
        if (!sampleID) {
          throw new Error('ID da amostra não encontrado');
        }
        const sampleIDNum = typeof sampleID === 'number' ? sampleID : Number(sampleID);
        if (isNaN(sampleIDNum)) {
          throw new Error('ID da amostra inválido');
        }
        await sampleService.withdraw(sampleIDNum, {
          withdrawalType,
          withdrawalQuantity: withdrawalType === 'Parcial' ? withdrawalQuantity : undefined,
          withdrawalResponsible,
          withdrawalDestination: withdrawalDestination || undefined,
          linkedProject: linkedProject,
          justification: justification || undefined
        });
        alert('Retirada registrada com sucesso!');
      } else {
        const sampleID = searchedSample.sampleID || searchedSample._id;
        if (!sampleID) {
          throw new Error('ID da amostra não encontrado');
        }
        const sampleIDNum = typeof sampleID === 'number' ? sampleID : Number(sampleID);
        if (isNaN(sampleIDNum)) {
          throw new Error('ID da amostra inválido');
        }
        await sampleService.return(sampleIDNum, {
          returnType: withdrawalType,
          returnQuantity: withdrawalType === 'Parcial' ? withdrawalQuantity : withdrawnQuantity,
          returnResponsible: withdrawalResponsible,
          linkedProject: linkedProject,
          condition: condition || undefined,
          notes: justification || undefined
        });
        alert('Devolução registrada com sucesso!');
      }
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || `Erro ao registrar ${mode === 'withdrawal' ? 'retirada' : 'devolução'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={() => {
        stopQRScanner();
        onClose();
      }}
      title={mode === 'withdrawal' ? 'Retirar Amostra' : 'Devolver Amostra'}
    >
      <form onSubmit={handleSubmit} className="withdrawal-form">
        {error && (
          <div className="error-message" style={{ marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {/* Toggle entre Retirada e Devolução */}
        <div style={{ 
          marginBottom: '1.5rem', 
          padding: '1rem', 
          backgroundColor: '#f8f9fa', 
          borderRadius: '6px',
          border: '1px solid var(--border)'
        }}>
          <label style={{ 
            display: 'block', 
            marginBottom: '0.75rem', 
            fontWeight: 600,
            fontSize: '0.9rem',
            color: 'var(--text)'
          }}>
            Tipo de Operação
          </label>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={() => {
                setMode('withdrawal');
                setSearchedSample(null);
                setPatientInfo(null);
                setBarcodeInput('');
                setWithdrawalType('Total');
                setWithdrawalQuantity(0);
                setWithdrawalResponsible('');
                setWithdrawalDestination('');
                setLinkedProject('');
                setJustification('');
                setCondition('');
                setError('');
              }}
              style={{
                flex: 1,
                padding: '0.75rem',
                border: `2px solid ${mode === 'withdrawal' ? 'var(--primary)' : 'var(--border)'}`,
                borderRadius: '6px',
                backgroundColor: mode === 'withdrawal' ? 'var(--primary)' : 'white',
                color: mode === 'withdrawal' ? 'white' : 'var(--text)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                fontWeight: 500,
                transition: 'all 0.2s'
              }}
            >
              <ArrowDown size={18} />
              Retirar
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('return');
                setSearchedSample(null);
                setPatientInfo(null);
                setBarcodeInput('');
                setWithdrawalType('Total');
                setWithdrawalQuantity(0);
                setWithdrawalResponsible('');
                setWithdrawalDestination('');
                setLinkedProject('');
                setJustification('');
                setCondition('');
                setError('');
              }}
              style={{
                flex: 1,
                padding: '0.75rem',
                border: `2px solid ${mode === 'return' ? 'var(--primary)' : 'var(--border)'}`,
                borderRadius: '6px',
                backgroundColor: mode === 'return' ? 'var(--primary)' : 'white',
                color: mode === 'return' ? 'white' : 'var(--text)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                fontWeight: 500,
                transition: 'all 0.2s'
              }}
            >
              <ArrowUp size={18} />
              Devolver
            </button>
          </div>
        </div>

        {/* Busca por QRCode */}
        {!searchedSample && (
          <div style={{ marginBottom: '1.5rem' }}>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>
              Código de Barras (QRCode) *
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <Input
                type="text"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                placeholder="Digite ou escaneie o código"
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSearchByBarcode();
                  }
                }}
                style={{ flex: 1 }}
              />
              <Button
                type="button"
                onClick={handleSearchByBarcode}
                disabled={searching || !barcodeInput}
              >
                <Search size={18} />
                Buscar
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={showQRScanner ? stopQRScanner : startQRScanner}
              >
                <QrCode size={18} />
                {showQRScanner ? 'Parar' : 'Escanear'}
              </Button>
            </div>
            {showQRScanner && (
              <div 
                id="qr-reader" 
                style={{ 
                  width: '100%', 
                  marginTop: '1rem',
                  minHeight: '250px',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center'
                }}
              >
                <p style={{ color: 'var(--text-secondary)' }}>Iniciando câmera...</p>
              </div>
            )}
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
              * Obrigatório buscar a amostra pelo código de barras antes de registrar {mode === 'withdrawal' ? 'a retirada' : 'a devolução'}
            </p>
          </div>
        )}

        {/* Informações da amostra encontrada */}
        {searchedSample && (
          <div className="sample-info" style={{ 
            padding: '1rem', 
            backgroundColor: '#f8f9fa', 
            borderRadius: '6px', 
            marginBottom: '1.5rem' 
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h4 style={{ margin: 0 }}>Amostra #{searchedSample.sampleID}</h4>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setSearchedSample(null);
                  setPatientInfo(null);
                  setBarcodeInput('');
                }}
              >
                Alterar
              </Button>
            </div>
            {patientInfo && (
              <p style={{ margin: '0.5rem 0', padding: '0.5rem', backgroundColor: '#e3f2fd', borderRadius: '4px' }}>
                <strong>Paciente:</strong> {formatPatientDisplay(patientInfo, user)}
              </p>
            )}
            <p><strong>Tipo:</strong> {searchedSample.sampleType}</p>
            <p><strong>Quantidade Total:</strong> {totalQuantity} {unit?.description || ''}</p>
            <p><strong>Quantidade Disponível:</strong> {availableQuantity} {unit?.description || ''}</p>
            {mode === 'return' && (
              <p><strong>Quantidade Retirada:</strong> {withdrawnQuantity} {unit?.description || ''}</p>
            )}
            <p><strong>Status:</strong> {searchedSample.availabilityStatus || 'Disponível'}</p>
          </div>
        )}

        {searchedSample && (
          <>
        <div className="form-grid-full">
          <label className="input-label">Tipo de {mode === 'withdrawal' ? 'Retirada' : 'Devolução'} *</label>
          <select
            className="input"
            value={withdrawalType}
            onChange={(e) => {
              setWithdrawalType(e.target.value as 'Parcial' | 'Total');
              if (e.target.value === 'Total') {
                setWithdrawalQuantity(0);
              }
            }}
            required
          >
            <option value="Total">Total</option>
            <option value="Parcial">Parcial</option>
          </select>
        </div>

        {withdrawalType === 'Parcial' && (
          <Input
            label={`Quantidade a ${mode === 'withdrawal' ? 'Retirar' : 'Devolver'} (máx: ${mode === 'withdrawal' ? availableQuantity : withdrawnQuantity} ${unit?.description || ''}) *`}
            type="number"
            step="0.1"
            min="0.1"
            max={mode === 'withdrawal' ? availableQuantity : withdrawnQuantity}
            value={withdrawalQuantity || ''}
            onChange={(e) => setWithdrawalQuantity(parseFloat(e.target.value) || 0)}
            required
            placeholder="Digite a quantidade"
          />
        )}

        {mode === 'return' && (
          <div className="form-grid-full">
            <label className="input-label">Condição da Amostra</label>
            <select
              className="input"
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
            >
              <option value="">Selecione a condição</option>
              <option value="Boa">Boa</option>
              <option value="Regular">Regular</option>
              <option value="Danificada">Danificada</option>
              <option value="Comprometida">Comprometida</option>
            </select>
          </div>
        )}

        <Input
          label="Responsável pela Retirada *"
          value={withdrawalResponsible}
          onChange={(e) => setWithdrawalResponsible(e.target.value)}
          required
          placeholder="Nome e sobrenome"
          error={
            withdrawalResponsible &&
            withdrawalResponsible.trim().split(' ').length < 2
              ? 'Nome deve conter nome e sobrenome'
              : undefined
          }
        />

        <Input
          label="Projeto Vinculado *"
          value={linkedProject}
          onChange={(e) => setLinkedProject(e.target.value)}
          required
          placeholder="Digite o projeto vinculado"
        />

        {mode === 'withdrawal' && (
          <div className="form-grid-full">
            <label className="input-label">Destino da Retirada</label>
            <select
              className="input"
              value={withdrawalDestination}
              onChange={(e) => setWithdrawalDestination(e.target.value)}
            >
              <option value="">Selecione o destino</option>
              <option value="Laboratório">Laboratório</option>
              <option value="Análise">Análise</option>
              <option value="Descarte">Descarte</option>
              <option value="Transferência">Transferência</option>
            </select>
          </div>
        )}

        <Input
          label={mode === 'withdrawal' ? 'Justificativa (opcional)' : 'Observações (opcional)'}
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          placeholder={mode === 'withdrawal' ? 'Justificativa para a retirada (opcional)' : 'Observações sobre a devolução (opcional)'}
        />

        <div className="form-actions" style={{ marginTop: '1.5rem' }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? 'Registrando...' : `Registrar ${mode === 'withdrawal' ? 'Retirada' : 'Devolução'}`}
          </Button>
        </div>
          </>
        )}
      </form>
    </Modal>
  );
}

// Componente para histórico de resultados (não utilizado - mantido para referência futura)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function HistoryModal({ 
  sampleID: _sampleID, 
  files, 
  onClose 
}: { 
  sampleID: number; 
  files: any[]; 
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);

  const handleDownload = async (resultID: string) => {
    try {
      setLoading(true);
      const response = await sampleService.downloadFile(resultID, '');
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `result_${resultID}.${response.data.type || 'file'}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.response?.data?.error || t('samples.uploadError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={t('samples.historyTitle')}
    >
      <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        {files.length === 0 ? (
          <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
            {t('samples.historyEmpty')}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {files.map((file: any) => (
              <Card key={file.resultID} style={{ padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div style={{ flex: 1 }}>
                    <h4 style={{ margin: '0 0 0.5rem 0' }}>
                      <FileText size={18} style={{ verticalAlign: 'middle', marginRight: '0.5rem' }} />
                      {file.fileName || file.description}
                    </h4>
                    {file.description && (
                      <p style={{ margin: '0.25rem 0', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                        {file.description}
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '0.875rem', color: 'var(--text-light)' }}>
                      {file.fileSize && (
                        <span>{t('samples.fileSize')}: {(file.fileSize / 1024).toFixed(2)} KB</span>
                      )}
                      {file.createdAt && (
                        <span>{t('samples.uploadDate')}: {new Date(file.createdAt).toLocaleDateString('pt-BR')}</span>
                      )}
                      {file.method && (
                        <span>{t('samples.method')}: {file.method}</span>
                      )}
                    </div>
                    {file.responsibleResearcher && (
                      <p style={{ margin: '0.25rem 0', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                        {t('samples.responsible')}: {file.responsibleResearcher}
                      </p>
                    )}
                  </div>
                  <Button
                    onClick={() => handleDownload(file.resultID)}
                    disabled={loading}
                    variant="secondary"
                    style={{ marginLeft: '1rem' }}
                  >
                    <Download size={16} />
                    {t('samples.downloadFile')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
      <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </Modal>
  );
}

// Componente para upload de arquivos (não utilizado - mantido para referência futura)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function UploadFileModal({ 
  sampleID, 
  onClose, 
  onSuccess 
}: { 
  sampleID: number; 
  onClose: () => void; 
  onSuccess: () => void;
}) {
  const { t } = useLanguage();
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [method, setMethod] = useState('');
  const [responsible, setResponsible] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // Validação de tipo de arquivo
    const allowedExtensions = ['.zip', '.xls', '.xlsx', '.csv'];
    const ext = selectedFile.name.toLowerCase().substring(selectedFile.name.lastIndexOf('.'));
    
    if (!allowedExtensions.includes(ext)) {
      setError(t('samples.invalidFileType'));
      setFile(null);
      return;
    }

    // Validação de tamanho (100MB)
    if (selectedFile.size > 100 * 1024 * 1024) {
      setError(t('samples.fileSizeError'));
      setFile(null);
      return;
    }

    setFile(selectedFile);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError(t('samples.selectFile'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      const sampleResponse = await sampleService.getById(sampleID);
      const sampleData = (sampleResponse as any).data || sampleResponse;
      const sampleId = sampleData?._id || sampleData?.sampleID || sampleID;
      if (!sampleId) {
        throw new Error(t('samples.sampleNotFound'));
      }

      const formData = new FormData();
      formData.append('file', file);
      if (description) formData.append('description', description);
      if (method) formData.append('method', method);
      if (responsible) formData.append('responsibleResearcher', responsible);

      await sampleService.uploadFile(String(sampleId), formData);
      alert(t('samples.uploadSuccess'));
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || t('samples.uploadError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={t('samples.uploadFileTitle')}
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <div style={{ 
            padding: '0.75rem', 
            backgroundColor: '#fee2e2', 
            border: '1px solid #fca5a5', 
            borderRadius: '6px', 
            marginBottom: '1rem',
            color: '#dc2626'
          }}>
            {error}
          </div>
        )}

        <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {t('samples.uploadFileDescription')}
        </p>

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
            {t('samples.selectFile')} *
          </label>
          <input
            type="file"
            accept=".zip,.xls,.xlsx,.csv"
            onChange={handleFileChange}
            required
            style={{
              width: '100%',
              padding: '0.5rem',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: '0.875rem'
            }}
          />
          {file && (
            <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              {file.name} ({(file.size / 1024).toFixed(2)} KB)
            </p>
          )}
        </div>

        <Input
          label={t('samples.fileDescription')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('samples.fileDescription')}
        />

        <Input
          label={t('samples.fileMethod')}
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          placeholder={t('samples.fileMethod')}
        />

        <Input
          label={t('samples.fileResponsible')}
          value={responsible}
          onChange={(e) => setResponsible(e.target.value)}
          placeholder={t('samples.fileResponsible')}
        />

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem', justifyContent: 'flex-end' }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={loading || !file}>
            {loading ? t('common.loading') : t('samples.uploadFile')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
