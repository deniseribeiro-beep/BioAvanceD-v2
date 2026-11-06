import { useState, useEffect } from 'react';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import ListPagination from '../components/UI/ListPagination';
import { Database, Download, RotateCcw, AlertCircle, CheckCircle, Clock, Save, Shield } from 'lucide-react';
import { useBackup, Backup } from '../hooks/useBackup';
import { useBackupPolicy, BackupPolicy } from '../hooks/useBackupPolicy';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { LIST_PAGE_SIZE, useClientPagination } from '../hooks/useClientPagination';

const CRON_FIELD_PATTERN = /^(\S+\s+){4}\S+$/;

// #728 (RF013 AC#5/AC#6): mirrors backup-policy.service.js's validatePolicy
// so the form can surface a field error before submitting, instead of only
// after a round-trip 422. Exported for BackupPage.test.tsx.
export function validateBackupPolicyDraft(draft: Partial<BackupPolicy>): string[] {
  const errors: string[] = [];

  if (draft.cronExpression !== undefined && !CRON_FIELD_PATTERN.test(String(draft.cronExpression || ''))) {
    errors.push('cronExpression deve ser uma expressão cron de 5 campos');
  }

  if (draft.retentionDays !== undefined) {
    const retentionDays = Number(draft.retentionDays);
    if (!Number.isFinite(retentionDays) || retentionDays < 30) {
      errors.push('retentionDays deve ser um número >= 30 (RNF010 AC#4)');
    }
  }

  if (draft.rpoHours !== undefined) {
    const rpoHours = Number(draft.rpoHours);
    if (!Number.isFinite(rpoHours) || rpoHours <= 0 || rpoHours > 24) {
      errors.push('rpoHours deve ser um número entre 1 e 24 (RNF010 AC#2)');
    }
  }

  if (draft.rtoHours !== undefined) {
    const rtoHours = Number(draft.rtoHours);
    if (!Number.isFinite(rtoHours) || rtoHours <= 0 || rtoHours > 12) {
      errors.push('rtoHours deve ser um número entre 1 e 12 (RNF010 AC#3)');
    }
  }

  return errors;
}

// #740 (RF013 AC#1 "Exibir estado, data e resultado das execuções"): the
// run status is rendered as a badge, so it needs an i18n key rather than
// the raw backend value. Anything the backend doesn't emit -- including the
// null a directory with no history row carries -- resolves to the unknown
// key rather than being echoed verbatim into the UI. Exported for
// BackupPage.test.tsx.
const BACKUP_STATUS_KEYS: Record<string, string> = {
  success: 'backup.statusSuccess',
  error: 'backup.statusError',
  skipped: 'backup.statusSkipped',
};

export function resolveBackupStatusKey(status?: string | null): string {
  return BACKUP_STATUS_KEYS[String(status || '')] || 'backup.statusUnknown';
}

// #740 (RF013 AC#3 "Registrar checksum e evidência de conclusão"): a sha256
// digest is 64 characters and would blow the column out, so the cell shows a
// prefix and carries the full value in its `title`.
const CHECKSUM_PREFIX_LENGTH = 12;

export function formatChecksum(checksum?: string | null): string {
  const value = String(checksum || '');
  if (!value) return '—';
  return value.length > CHECKSUM_PREFIX_LENGTH ? `${value.slice(0, CHECKSUM_PREFIX_LENGTH)}…` : value;
}

export default function BackupPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { performBackup, listBackups, restoreBackup, loading, error } = useBackup();
  const { policy, loading: policyLoading, error: policyError, saving: policySaving, updatePolicy } = useBackupPolicy();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<Backup | null>(null);
  const [backupStatus, setBackupStatus] = useState<'idle' | 'creating' | 'success' | 'error'>('idle');
  const [policyDraft, setPolicyDraft] = useState<BackupPolicy | null>(null);
  const [policyValidationErrors, setPolicyValidationErrors] = useState<string[]>([]);
  const [policySaveStatus, setPolicySaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

  useEffect(() => {
    if (policy) {
      setPolicyDraft(policy);
    }
  }, [policy]);

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

  const handlePolicyFieldChange = (field: keyof BackupPolicy, value: string | number | boolean) => {
    if (!policyDraft) return;
    setPolicyDraft({ ...policyDraft, [field]: value });
  };

  const handleSavePolicy = async () => {
    if (!policyDraft) return;

    const validationErrors = validateBackupPolicyDraft(policyDraft);
    setPolicyValidationErrors(validationErrors);
    if (validationErrors.length > 0) {
      return;
    }

    try {
      await updatePolicy(policyDraft);
      setPolicySaveStatus('success');
      setTimeout(() => setPolicySaveStatus('idle'), 3000);
    } catch (err) {
      setPolicySaveStatus('error');
      setTimeout(() => setPolicySaveStatus('idle'), 3000);
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

  const backupsPagination = useClientPagination(backups, LIST_PAGE_SIZE);

  if (!isAdmin) {
    return (
      <div className="page-shell backup-page">
        <div className="access-denied">
          <AlertCircle size={48} />
          <h2>{t('backup.accessDenied')}</h2>
          <p>{t('backup.accessDeniedMessage')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell backup-page">
      <div className="page-header backup-header">
          <h1 className="page-title">
            <Database /> {t('backup.management')}
          </h1>
          <p className="page-subtitle">{t('backup.description', 'Faça backup e restaure dados do sistema')}</p>
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
                    <th>{t('backup.status')}</th>
                    <th>{t('backup.checksum')}</th>
                    <th>{t('backup.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {backupsPagination.pagedItems.map((backup, index) => (
                    <tr key={backup.fileName || index}>
                      <td>{backup.fileName}</td>
                      <td>{formatFileSize(backup.size)}</td>
                      <td>{formatDate(backup.createdAt)}</td>
                      <td>
                        <span className="backup-status-badge" data-status={backup.status || 'unknown'}>
                          {t(resolveBackupStatusKey(backup.status))}
                        </span>
                      </td>
                      <td className="backup-checksum" title={backup.checksum || undefined}>
                        {formatChecksum(backup.checksum)}
                      </td>
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
              <ListPagination
                currentPage={backupsPagination.currentPage}
                totalPages={backupsPagination.totalPages}
                pageStart={backupsPagination.pageStart}
                pageEnd={backupsPagination.pageEnd}
                total={backupsPagination.total}
                onPageChange={backupsPagination.setCurrentPage}
                testIdPrefix="backups-pagination"
                emptyLabel={t('backup.noBackups')}
              />
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

      <Card className="backup-policy">
        <h2>
          <Shield size={20} /> {t('backup.policy.title')}
        </h2>
        <p>{t('backup.policy.description')}</p>

        {policyError && (
          <div className="error-message">
            <AlertCircle /> {policyError}
          </div>
        )}

        {policyValidationErrors.length > 0 && (
          <div className="error-message">
            <AlertCircle /> {policyValidationErrors.join('; ')}
          </div>
        )}

        {policySaveStatus === 'success' && (
          <div className="status-message success">
            <CheckCircle /> {t('backup.policy.saveSuccess')}
          </div>
        )}

        {policySaveStatus === 'error' && (
          <div className="status-message error">
            <AlertCircle /> {t('backup.policy.saveError')}
          </div>
        )}

        {policyLoading || !policyDraft ? (
          <p className="empty-message">{t('backup.policy.loadError')}</p>
        ) : (
          <div className="policy-form">
            <div className="policy-field">
              <label htmlFor="backup-policy-cron">{t('backup.policy.cronExpression')}</label>
              <input
                id="backup-policy-cron"
                type="text"
                value={policyDraft.cronExpression}
                onChange={(e) => handlePolicyFieldChange('cronExpression', e.target.value)}
              />
              <span className="policy-help">{t('backup.policy.cronExpressionHelp')}</span>
            </div>

            <div className="policy-field">
              <label htmlFor="backup-policy-retention">{t('backup.policy.retentionDays')}</label>
              <input
                id="backup-policy-retention"
                type="number"
                min="30"
                value={policyDraft.retentionDays}
                onChange={(e) => handlePolicyFieldChange('retentionDays', parseInt(e.target.value, 10))}
              />
              <span className="policy-help">{t('backup.policy.retentionDaysHelp')}</span>
            </div>

            <label className="policy-switch">
              <input
                type="checkbox"
                checked={policyDraft.encryptionEnabled}
                onChange={(e) => handlePolicyFieldChange('encryptionEnabled', e.target.checked)}
              />
              <span>{t('backup.policy.encryptionEnabled')}</span>
            </label>

            <div className="policy-field">
              <label htmlFor="backup-policy-rpo">{t('backup.policy.rpoHours')}</label>
              <input
                id="backup-policy-rpo"
                type="number"
                min="1"
                max="24"
                value={policyDraft.rpoHours}
                onChange={(e) => handlePolicyFieldChange('rpoHours', parseInt(e.target.value, 10))}
              />
              <span className="policy-help">{t('backup.policy.rpoHoursHelp')}</span>
            </div>

            <div className="policy-field">
              <label htmlFor="backup-policy-rto">{t('backup.policy.rtoHours')}</label>
              <input
                id="backup-policy-rto"
                type="number"
                min="1"
                max="12"
                value={policyDraft.rtoHours}
                onChange={(e) => handlePolicyFieldChange('rtoHours', parseInt(e.target.value, 10))}
              />
              <span className="policy-help">{t('backup.policy.rtoHoursHelp')}</span>
            </div>

            <p className="policy-last-updated">
              {t('backup.policy.lastUpdated')}:{' '}
              {policyDraft.updatedAt ? formatDate(policyDraft.updatedAt) : t('backup.policy.neverUpdated')}
            </p>

            <div className="policy-actions">
              <Button onClick={handleSavePolicy} disabled={policySaving}>
                <Save size={16} /> {t('backup.policy.save')}
              </Button>
            </div>
          </div>
        )}
      </Card>

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

