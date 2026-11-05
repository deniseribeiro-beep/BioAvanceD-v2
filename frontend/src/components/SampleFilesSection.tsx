import { useState, useEffect } from 'react';
import { Upload, Download, Trash2, File, AlertCircle } from 'lucide-react';
import Button from './UI/Button';
import Modal from './UI/Modal';
import Table from './UI/Table';
import { useSampleFiles } from '../hooks/useSampleFiles';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { SampleFile } from '../types/models';

// Botão Exportar removido conforme solicitado

interface SampleFilesSectionProps {
  sampleID: string;
}

export default function SampleFilesSection({ sampleID }: SampleFilesSectionProps) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { files, loading, error, loadFiles, uploadFile, downloadFile, deleteFile } = useSampleFiles(sampleID);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);

  // Verifica permissões
  const canUploadDelete = user?.roleName === 'Administrador' || user?.roleName === 'Coordenador' || 
                          user?.accessType === 4 || user?.accessType === 3;

  // Carrega arquivos ao montar e quando sampleID mudar
  useEffect(() => {
    if (sampleID) {
      loadFiles();
    }
  }, [sampleID]);


  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Valida tipo de arquivo
      const allowedExtensions = ['.raw', '.zip', '.csv', '.xls', '.xlsx', '.pdf', '.txt'];
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      
      if (!allowedExtensions.includes(ext)) {
        setUploadError(t('sampleFiles.invalidFileType') || 'Tipo de arquivo inválido');
        return;
      }

      // Valida tamanho (100MB)
      if (file.size > 100 * 1024 * 1024) {
        setUploadError(t('sampleFiles.maxSize') || 'Arquivo muito grande. Tamanho máximo: 100MB');
        return;
      }

      setSelectedFile(file);
      setUploadError(null);
    }
  };

  const handleUpload = async () => {
    // The submit button is disabled while no file is selected; this guard only
    // narrows selectedFile for the type checker.
    if (!selectedFile) return;

    try {
      setUploading(true);
      setUploadError(null);
      await uploadFile(selectedFile);
      setShowUploadModal(false);
      setSelectedFile(null);
      // Limpa input
      const fileInput = document.getElementById('file-upload-input') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    } catch (err: any) {
      setUploadError(err.message || t('sampleFiles.uploadError') || 'Erro ao fazer upload');
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (file: SampleFile) => {
    if (!file._id) return;
    
    try {
      await downloadFile(file._id, file.fileName);
    } catch (err: any) {
      alert(err.message || t('sampleFiles.downloadError') || 'Erro ao fazer download');
    }
  };

  const handleDelete = async (file: SampleFile) => {
    if (!file._id) return;

    if (!confirm(t('sampleFiles.deleteConfirm') || 'Tem certeza que deseja excluir este arquivo?')) {
      return;
    }

    try {
      setDeletingFileId(file._id);
      await deleteFile(file._id);
    } catch (err: any) {
      alert(err.message || t('sampleFiles.deleteError') || 'Erro ao excluir arquivo');
    } finally {
      setDeletingFileId(null);
    }
  };


  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} bytes`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const getFileTypeLabel = (fileType: string): string => {
    const typeMap: Record<string, string> = {
      'RAW': t('sampleFiles.fileTypes.RAW') || 'RAW',
      'ZIP': t('sampleFiles.fileTypes.ZIP') || 'ZIP',
      'CSV': t('sampleFiles.fileTypes.CSV') || 'CSV',
      'XLS': t('sampleFiles.fileTypes.XLS') || 'XLS',
      'XLSX': t('sampleFiles.fileTypes.XLSX') || 'XLSX',
      'PDF': t('sampleFiles.fileTypes.PDF') || 'PDF',
      'TXT': t('sampleFiles.fileTypes.TXT') || 'TXT'
    };
    return typeMap[fileType] || fileType;
  };

  return (
    <div className="sample-files-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: 'var(--text)' }}>
          {t('sampleFiles.title') || 'Arquivos de Análise'}
        </h3>
        {canUploadDelete && (
          <Button
            variant="primary"
            data-testid="sample-files-open-upload-button"
            onClick={() => setShowUploadModal(true)}
            style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
          >
            <Upload size={16} style={{ marginRight: '0.5rem' }} />
            {t('sampleFiles.uploadFile') || 'Enviar Arquivo'}
          </Button>
        )}
        {!canUploadDelete && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', fontStyle: 'italic' }}>
            {t('sampleFiles.viewOnly') || 'Você pode visualizar e fazer download dos arquivos'}
          </span>
        )}
      </div>

      {error && (
        <div style={{ 
          padding: '0.75rem', 
          backgroundColor: '#fee', 
          border: '1px solid #fcc', 
          borderRadius: '4px',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <AlertCircle size={16} color="var(--danger)" />
          <span style={{ color: 'var(--danger)', fontSize: '0.875rem' }}>{error}</span>
        </div>
      )}

      {loading ? (
        <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-light)' }}>
          {t('common.loading') || 'Carregando...'}
        </p>
      ) : files.length === 0 ? (
        <div style={{ 
          textAlign: 'center', 
          padding: '2rem', 
          backgroundColor: 'var(--surface)', 
          borderRadius: '6px',
          color: 'var(--text-light)'
        }}>
          <File size={48} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
          <p>{t('sampleFiles.noFiles') || 'Nenhum arquivo associado a esta amostra'}</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <Table>
            <thead>
              <tr>
                <th>{t('sampleFiles.fileName') || 'Nome do Arquivo'}</th>
                <th>{t('sampleFiles.fileType') || 'Tipo'}</th>
                <th>{t('sampleFiles.fileSize') || 'Tamanho'}</th>
                <th>{t('sampleFiles.uploadDate') || 'Data de Upload'}</th>
                <th>{t('sampleFiles.uploadedBy') || 'Enviado por'}</th>
                <th>{t('sampleFiles.actions') || 'Ações'}</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file._id} data-testid={`sample-file-row-${file._id}`}>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                      {file.fileName}
                    </span>
                  </td>
                  <td>
                    <span className="file-type-badge" data-type={file.fileType}>
                      {getFileTypeLabel(file.fileType)}
                    </span>
                  </td>
                  <td>{formatFileSize(file.fileSize)}</td>
                  <td>
                    {new Date(file.uploadDate).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </td>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-light)' }}>
                      {file.uploaderAnonId || 'N/A'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <Button
                        variant="secondary"
                        data-testid={`sample-file-download-button-${file._id}`}
                        onClick={() => handleDownload(file)}
                        style={{ padding: '0.375rem', minWidth: 'auto' }}
                        title={t('sampleFiles.download') || 'Download'}
                      >
                        <Download size={14} />
                      </Button>
                      {canUploadDelete && (
                        <Button
                          variant="danger"
                          data-testid={`sample-file-delete-button-${file._id}`}
                          onClick={() => handleDelete(file)}
                          disabled={deletingFileId === file._id}
                          style={{ padding: '0.375rem', minWidth: 'auto' }}
                          title={t('sampleFiles.delete') || 'Excluir'}
                        >
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {/* Modal de Upload */}
      {showUploadModal && (
        <Modal
          isOpen={showUploadModal}
          onClose={() => {
            setShowUploadModal(false);
            setSelectedFile(null);
            setUploadError(null);
          }}
          title={t('sampleFiles.uploadTitle') || 'Upload de Arquivo de Análise'}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-light)' }}>
              {t('sampleFiles.uploadDescription') || 'Envie arquivos de análise gerados por equipamentos laboratoriais'}
            </p>
            
            <div>
              <label htmlFor="file-upload-input" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                {t('sampleFiles.selectFile') || 'Selecionar Arquivo'} *
              </label>
              <input
                id="file-upload-input"
                data-testid="file-upload-input"
                type="file"
                onChange={handleFileSelect}
                accept=".raw,.zip,.csv,.xls,.xlsx,.pdf,.txt"
                aria-label={t('sampleFiles.selectFile') || 'Selecionar Arquivo'}
                title={t('sampleFiles.selectFile') || 'Selecionar Arquivo'}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  fontSize: '0.875rem'
                }}
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: '0.25rem' }}>
                {t('sampleFiles.allowedTypes') || 'Tipos permitidos: .raw, .zip, .csv, .xls, .xlsx, .pdf, .txt'}
              </p>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
                {t('sampleFiles.maxSize') || 'Tamanho máximo: 100MB'}
              </p>
            </div>

            {selectedFile && (
              <div style={{ 
                padding: '0.75rem', 
                backgroundColor: 'var(--surface)', 
                borderRadius: '4px',
                fontSize: '0.875rem'
              }}>
                <strong>{selectedFile.name}</strong>
                <br />
                <span style={{ color: 'var(--text-light)' }}>
                  {formatFileSize(selectedFile.size)}
                </span>
              </div>
            )}

            {uploadError && (
              <div style={{ 
                padding: '0.75rem', 
                backgroundColor: '#fee', 
                border: '1px solid #fcc', 
                borderRadius: '4px',
                color: 'var(--danger)',
                fontSize: '0.875rem'
              }}>
                {uploadError}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <Button
                variant="secondary"
                onClick={() => {
                  setShowUploadModal(false);
                  setSelectedFile(null);
                  setUploadError(null);
                }}
                disabled={uploading}
              >
                {t('common.cancel') || 'Cancelar'}
              </Button>
              <Button
                data-testid="sample-files-upload-submit"
                onClick={handleUpload}
                disabled={!selectedFile || uploading}
              >
                {uploading ? (t('common.loading') || 'Enviando...') : (t('sampleFiles.uploadFile') || 'Enviar Arquivo')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

