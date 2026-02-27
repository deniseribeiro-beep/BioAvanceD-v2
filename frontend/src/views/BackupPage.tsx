import { useState, useEffect } from 'react';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import { Database, Download, RotateCcw, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { useBackup, Backup } from '../hooks/useBackup';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import './BackupPage.css';

export default function BackupPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { performBackup, listBackups, restoreBackup, loading, error } = useBackup();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<Backup | null>(null);
  const [backupStatus, setBackupStatus] = useState<'idle' | 'creating' | 'success' | 'error'>('idle');

  useEffect(() => {
    loadBackups();
  }, []);

  const loadBackups = async () => {
    try {
      const backupsList = await listBackups();
      setBackups(backupsList);
    } catch (err) {
      console.error('Erro ao carregar backups:', err);
    }
  };

  const handleCreateBackup = async () => {
    try {
      setBackupStatus('creating');
      await performBackup();
      setBackupStatus('success');
      await loadBackups();
      setTimeout(() => setBackupStatus('idle'), 3000);
    } catch (err) {
      setBackupStatus('error');
      setTimeout(() => setBackupStatus('idle'), 3000);
    }
  };

  const handleRestore = async () => {
    if (!selectedBackup) return;

    const confirmMessage = t('backup.restoreConfirm').replace('{fileName}', selectedBackup.fileName);
    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      await restoreBackup(selectedBackup.fileName);
      alert(t('backup.restoreSuccess'));
      setIsRestoreModalOpen(false);
      setSelectedBackup(null);
    } catch (err: any) {
      const errorMessage = t('backup.restoreError').replace('{error}', err.message);
      alert(errorMessage);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleString('pt-BR');
  };

  // Verifica se o usuário é Administrador
  const isAdmin = user?.roleName === 'Administrador' || user?.accessType === 4;

  if (!isAdmin) {
    return (
      <div className="backup-page">
        <div className="access-denied">
          <AlertCircle size={48} />
          <h2>{t('backup.accessDenied')}</h2>
          <p>{t('backup.accessDeniedMessage')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="backup-page">
      <div className="backup-header">
          <h1>
            <Database /> {t('backup.management')}
          </h1>
          <p>{t('backup.description')}</p>
      </div>

      <div className="backup-content">
        <Card className="backup-actions">
          <h2>{t('backup.createTitle')}</h2>
          <p>{t('backup.createDescription')}</p>
          
          <div className="backup-status">
            {backupStatus === 'creating' && (
              <div className="status-message creating">
                <Clock /> {t('backup.creating')}
              </div>
            )}
            {backupStatus === 'success' && (
              <div className="status-message success">
                <CheckCircle /> {t('backup.success')}
              </div>
            )}
            {backupStatus === 'error' && (
              <div className="status-message error">
                <AlertCircle /> {t('backup.error')}
              </div>
            )}
          </div>

          <Button
            onClick={handleCreateBackup}
            disabled={loading || backupStatus === 'creating'}
            className="create-backup-button"
          >
            <Database /> {t('backup.create')}
          </Button>
        </Card>

        <Card className="backups-list">
          <h2>{t('backup.listTitle')}</h2>
          {error && (
            <div className="error-message">
              <AlertCircle /> {error}
            </div>
          )}

          {backups.length === 0 ? (
            <p className="empty-message">{t('backup.noBackups')}</p>
          ) : (
            <div className="backups-table">
              <table>
                <thead>
                  <tr>
                    <th>{t('backup.fileName')}</th>
                    <th>{t('backup.size')}</th>
                    <th>{t('backup.createdAt')}</th>
                    <th>{t('backup.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((backup, index) => (
                    <tr key={index}>
                      <td>{backup.fileName}</td>
                      <td>{formatFileSize(backup.size)}</td>
                      <td>{formatDate(backup.createdAt)}</td>
                      <td>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setSelectedBackup(backup);
                            setIsRestoreModalOpen(true);
                          }}
                        >
                          <RotateCcw size={16} /> {t('backup.restore')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Button
            variant="secondary"
            onClick={loadBackups}
            disabled={loading}
            className="refresh-button"
          >
            {t('common.refresh')}
          </Button>
        </Card>
      </div>

      {isRestoreModalOpen && selectedBackup && (
        <Modal
          isOpen={isRestoreModalOpen}
          onClose={() => {
            setIsRestoreModalOpen(false);
            setSelectedBackup(null);
          }}
          title={t('backup.restore')}
        >
          <div className="restore-modal">
            <p>
              {t('backup.restoreAbout')}
            </p>
            <div className="backup-info">
              <strong>{selectedBackup.fileName}</strong>
              <p>{t('backup.size')}: {formatFileSize(selectedBackup.size)}</p>
              <p>{t('backup.createdAt')}: {formatDate(selectedBackup.createdAt)}</p>
            </div>
            <div className="warning-message">
              <AlertCircle />
              <p>
                <strong>{t('common.warning')}:</strong> {t('backup.restoreWarning')}
              </p>
            </div>
            <div className="modal-actions">
              <Button
                variant="secondary"
                onClick={() => {
                  setIsRestoreModalOpen(false);
                  setSelectedBackup(null);
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleRestore}
                disabled={loading}
                className="restore-button"
              >
                <RotateCcw /> {t('backup.confirmRestore')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

