/* eslint-disable no-inline-styles */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Download, Plus, Printer, Trash2, Upload, Edit3 } from 'lucide-react';
import Barcode from 'react-barcode';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import Modal from '../components/UI/Modal';
import Table from '../components/UI/Table';
import SampleStatusBadge from '../components/SampleStatusBadge';
import { useSamples } from '../hooks/useSamples';
import { useImportJob } from '../hooks/useImportJob';
import { useLanguage } from '../contexts/LanguageContext';
import { Sample } from '../types/models';
import { importLGPDService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import './SamplesPage.css';

function getSampleId(sample: Sample): string {
  return (sample as any)._id || String(sample.sampleID ?? sample.barcode ?? sample.patientID);
}

function getPatientName(sample: Sample): string {
  return (
    (sample as any).patient?.name ||
    (sample as any).patient?.patientName ||
    (sample as any).patientName ||
    'N/A'
  );
}

function mapStatus(sample: Sample): Sample['status'] {
  const status = sample.status || sample.currentStatus?.toString().toUpperCase();
  if (status === 'AVAILABLE' || status === 'PARTIAL' || status === 'DEPLETED' || status === 'UNAVAILABLE') {
    return status as Sample['status'];
  }
  return 'AVAILABLE';
}

function computeVolume(sample: Sample) {
  const initial = sample.volumeInitial ?? sample.originalQuantity ?? sample.quantity ?? 0;
  const current = sample.volumeCurrent ?? sample.availableQuantity ?? sample.quantity ?? 0;
  return { initial, current };
}

export default function SamplesPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user } = useAuth();
  const { samples, loading, error, loadSamples, deleteSample } = useSamples();

  const [search, setSearch] = useState('');
  const [selectedSampleIds, setSelectedSampleIds] = useState<string[]>([]);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [activeImportJobId] = useState<string | null>(() =>
    localStorage.getItem('lastImportJobId') || localStorage.getItem('currentImportJobId')
  );
  const [downloadingTemplate, setDownloadingTemplate] = useState<'csv' | 'xlsx' | null>(null);
  const canEdit = user?.roleName === 'Administrador' || user?.roleName === 'Coordenador';

  const {
    job: importJob,
    loading: importLoading,
    error: importError,
    fetchJobStatus,
  } = useImportJob(activeImportJobId, {
    onCompleted: () => {
      loadSamples();
      setSelectedSampleIds([]);
    },
  });

  useEffect(() => {
    if (activeImportJobId && fetchJobStatus) {
      fetchJobStatus();
    }
  }, [activeImportJobId, fetchJobStatus]);

  useEffect(() => {
    const preselected = samples.filter((s) => s.checked).map((s) => getSampleId(s));
    if (preselected.length) {
      setSelectedSampleIds(preselected);
    }
  }, [samples]);

  const filteredSamples = useMemo(() => {
    if (!search.trim()) {
      return samples.map((s) => ({ ...s, id: getSampleId(s) }));
    }
    const term = search.trim().toLowerCase();
    return samples
      .filter((sample) => {
        const barcode = sample.barcode || '';
        const type = sample.sampleType || '';
        const patient = getPatientName(sample);
        return (
          barcode.toLowerCase().includes(term) ||
          type.toLowerCase().includes(term) ||
          patient.toLowerCase().includes(term)
        );
      })
      .map((s) => ({ ...s, id: getSampleId(s) }));
  }, [samples, search]);

  const allSelected = filteredSamples.length > 0 && selectedSampleIds.length === filteredSamples.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedSampleIds([]);
      return;
    }
    setSelectedSampleIds(filteredSamples.map((s) => (s as any).id));
  };

  const toggleSelect = (sample: Sample & { id: string }) => {
    setSelectedSampleIds((prev) =>
      prev.includes(sample.id) ? prev.filter((id) => id !== sample.id) : [...prev, sample.id]
    );
  };

  const handleBatchDelete = async () => {
    if (selectedSampleIds.length === 0) return;
    const confirmed = window.confirm(`Excluir ${selectedSampleIds.length} amostra(s)?`);
    if (!confirmed) return;

    for (const id of selectedSampleIds) {
      await deleteSample(id);
    }
    setSelectedSampleIds([]);
    loadSamples();
  };

  const selectedSamples = filteredSamples.filter((s: any) => selectedSampleIds.includes(s.id));
  const isImporting = importLoading || importJob?.status === 'pending' || importJob?.status === 'processing';

  // Download de template estático com instruções
  const downloadTemplate = (format: 'csv' | 'xlsx') => {
    const fileName = format === 'csv' ? 'samples-template.csv' : 'samples-template.xlsx';
    const url = `/import-templates/${fileName}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>{t('samples.title') || 'Amostras'}</h1>
        {isImporting && (
          <div className="import-banner">
            <div className="spinner" />
            <div>
              <strong>Importando amostras</strong>
              <div style={{ fontSize: '0.85rem' }}>
                {importJob?.progress ? `${importJob.progress}%` : 'Processando...'}
              </div>
            </div>
          </div>
        )}
        {importJob?.status === 'completed' && (
          <div className="import-banner success">
            <Check size={16} />
            <span>Importação concluída</span>
          </div>
        )}
        {importError && <div className="import-error">Erro na importação: {importError}</div>}
      </div>

      <Card style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '220px' }}>
            <Input
              label="Pesquisar"
              placeholder="Código, tipo ou paciente"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {selectedSampleIds.length === 0 ? (
            <div className="toolbar" style={{ width: '100%', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <Button onClick={() => navigate('/samples/new')}>
                  <Plus size={16} />
                  {t('samples.new') || 'Nova Amostra'}
                </Button>
                <Button variant="secondary" onClick={() => navigate('/import')}>
                  <Upload size={16} />
                  {t('import.samples.import') || 'Importar'}
                </Button>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginLeft: 'auto' }}>
                <Button variant="secondary" onClick={() => downloadTemplate('xlsx')}>
                  <Download size={16} />
                  Baixar Template Excel
                </Button>
                <Button variant="secondary" onClick={() => downloadTemplate('csv')}>
                  <Download size={16} />
                  Baixar Template CSV
                </Button>
              </div>
            </div>
          ) : (
            <div className="toolbar batch">
              <span>{selectedSampleIds.length} itens selecionados</span>
              <Button variant="danger" onClick={handleBatchDelete}>
                <Trash2 size={16} />
                Excluir
              </Button>
              <Button onClick={() => setPrintModalOpen(true)}>
                <Printer size={16} />
                Imprimir Etiquetas
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <Table>
          <thead>
            <tr>
              <th className="center" style={{ width: 48 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  aria-label="Selecionar todas as amostras"
                />
              </th>
              <th>Tipo</th>
              <th>Origem</th>
              <th>Código</th>
              <th>Status</th>
              <th>Volume</th>
              <th>Paciente (ID)</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '1.5rem' }}>
                  {t('common.loading') || 'Carregando...'}
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--danger)' }}>
                  {error}
                </td>
              </tr>
            ) : filteredSamples.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '1.5rem' }}>
                  Nenhuma amostra encontrada.
                </td>
              </tr>
            ) : (
              filteredSamples.map((sample: any) => {
                const { initial, current } = computeVolume(sample);
                const patientId = sample.patientID ?? (sample as any).patient?.patientID;
                return (
                  <tr key={sample.id}>
                    <td className="center">
                      <input
                        type="checkbox"
                        checked={selectedSampleIds.includes(sample.id)}
                        onChange={() => toggleSelect(sample)}
                        aria-label="Selecionar amostra"
                      />
                    </td>
                    <td>{sample.sampleType || 'N/A'}</td>
                    <td>{sample.sampleOrigin || 'N/A'}</td>
                    <td style={{ fontFamily: 'monospace' }}>{sample.barcode || sample.sampleID || 'N/A'}</td>
                    <td>
                      <SampleStatusBadge status={mapStatus(sample) as any} />
                    </td>
                    <td>
                      <strong>
                        {current.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} /{' '}
                        {initial.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                      </strong>
                    </td>
                    <td>{patientId ?? 'N/A'}</td>
                    <td>
                      <Button
                        variant="secondary"
                        disabled={!canEdit}
                        onClick={() => navigate(`/samples/${sample.id}`)}
                        title={canEdit ? 'Editar amostra' : 'Apenas administradores e coordenadores podem editar'}
                        style={{ padding: '0.35rem 0.65rem' }}
                      >
                        <Edit3 size={15} />
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Table>
      </Card>

      {printModalOpen && (
        <Modal isOpen title="Imprimir Etiquetas" onClose={() => setPrintModalOpen(false)}>
          <div id="printable-area">
            {selectedSamples.map((sample: any) => {
              const barcodeValue = sample.barcode || sample.sampleID || sample.id;
              const patientId = sample.patientID ?? (sample as any).patient?.patientID;
              return (
                <div key={sample.id} className="qr-label">
                  <div className="qr-label__title">{sample.sampleType || 'Amostra'}</div>
                  <div className="qr-label__code">{barcodeValue || 'N/A'}</div>
                  {barcodeValue && (
                    <div className="qr-label__barcode">
                      <Barcode value={String(barcodeValue)} height={42} width={1.4} displayValue={false} margin={0} />
                    </div>
                  )}
                  <div className="qr-label__patient">{patientId ?? 'N/A'}</div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <Button variant="secondary" onClick={() => setPrintModalOpen(false)}>
              Fechar
            </Button>
            <Button onClick={() => window.print()}>
              <Printer size={16} />
              Imprimir
            </Button>
          </div>
        </Modal>
      )}

      <style>
        {`
          #printable-area {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 12px;
            padding: 4px;
          }
          .qr-label {
            border: 1px dashed #d1d5db;
            border-radius: 8px;
            padding: 10px;
            background: #fff;
          }
          .qr-label__title { font-weight: 700; margin-bottom: 6px; }
          .qr-label__code { font-family: monospace; color: #0f172a; margin-bottom: 4px; }
          .qr-label__patient { font-size: 0.85rem; color: #475569; }
          .toolbar { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
          .toolbar.batch { background: #f8fafc; padding: 0.5rem 0.75rem; border-radius: 8px; }
          .center { text-align: center; }
          .import-banner { display: inline-flex; gap: 0.75rem; align-items: center; background: #e0f2fe; padding: 0.5rem 0.75rem; border-radius: 8px; }
          .import-banner.success { background: #e7f6ed; color: #166534; }
          .import-error { margin-top: 0.5rem; color: #b91c1c; font-size: 0.9rem; }
          .spinner { width: 12px; height: 12px; border: 2px solid #0284c7; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite; }
          @keyframes spin { to { transform: rotate(360deg); } }
          @media print {
            body * { visibility: hidden; }
            #printable-area, #printable-area * { visibility: visible; }
            #printable-area { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
            .modal-overlay, .modal-content, .modal-body, .modal-header, .modal-title, .modal-close { all: unset; }
          }
        `}
      </style>
    </div>
  );
}
