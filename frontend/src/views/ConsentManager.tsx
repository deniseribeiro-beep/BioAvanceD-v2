import { useEffect, useMemo, useState } from 'react';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import Spinner from '../components/UI/Spinner';
import Table from '../components/UI/Table';
import { useToast } from '../components/UI/ToastContainer';
import { consentService } from '../services/api';
import { ConsentPolicy, ConsentPolicyPermission } from '../types/models';
import { useLanguage } from '../contexts/LanguageContext';
import './ConsentManager.css';

type PermissionRow = ConsentPolicyPermission & { tempId: string };

const buildPermissionRow = (permission?: Partial<ConsentPolicyPermission>): PermissionRow => ({
  tempId: `permission-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  key: String(permission?.key || ''),
  label: String(permission?.label || ''),
  required: Boolean(permission?.required)
});

export default function ConsentManager() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [caae, setCaae] = useState('');
  const [validFrom, setValidFrom] = useState(() => {
    const today = new Date();
    return today.toISOString().slice(0, 10);
  });
  const [validTo, setValidTo] = useState(() => {
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    return nextYear.toISOString().slice(0, 10);
  });
  const [permissions, setPermissions] = useState<PermissionRow[]>([buildPermissionRow()]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [history, setHistory] = useState<ConsentPolicy[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyLimit, setHistoryLimit] = useState(10);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<ConsentPolicy | null>(null);

  const canSubmit = useMemo(() => {
    const hasPermissions = permissions.length > 0 && permissions.every(permission => permission.key.trim() && permission.label.trim());
    if (!title.trim() || !caae.trim() || !htmlContent.trim() || !validFrom || !validTo || !hasPermissions) {
      return false;
    }

    const startDate = new Date(validFrom);
    const endDate = new Date(validTo);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return false;
    return endDate.getTime() >= startDate.getTime();
  }, [title, caae, htmlContent, validFrom, validTo, permissions]);

  const loadHistory = async (page = historyPage, limit = historyLimit, search = historySearch) => {
    setLoadingHistory(true);
    try {
      const response = await consentService.getPoliciesHistory({ page, limit, search: search.trim() || undefined });
      const payload = (response as any)?.data?.data ?? [];
      const pagination = (response as any)?.data?.pagination || {};

      setHistory(Array.isArray(payload) ? payload : []);
      setHistoryPage(Number(pagination.page) || page);
      setHistoryLimit(Number(pagination.limit) || limit);
      setHistoryTotal(Number(pagination.total) || 0);
      setHistoryTotalPages(Number(pagination.totalPages) || 1);
    } catch (error: any) {
      showToast(error?.message || t('consentManager.toasts.loadHistoryError'), 'error');
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (activeTab === 'history') {
        loadHistory(1, historyLimit, historySearch);
      }
    }, 300);

    return () => clearTimeout(handler);
  }, [historySearch]);

  const handleAddPermission = () => {
    setPermissions((prev) => [...prev, buildPermissionRow()]);
  };

  const handleRemovePermission = (index: number) => {
    setPermissions((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleUpdatePermission = (index: number, field: keyof ConsentPolicyPermission, value: string | boolean) => {
    setPermissions((prev) =>
      prev.map((permission, idx) =>
        idx === index ? { ...permission, [field]: value } : permission
      )
    );
  };

  const handleSubmit = async () => {
    if (!canSubmit) {
      showToast(t('consentManager.toasts.requiredFields'), 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        title: title.trim(),
        caae: caae.trim(),
        htmlContent: htmlContent.trim(),
        validFrom: new Date(validFrom).toISOString(),
        validTo: new Date(validTo).toISOString(),
        active: true,
        granularPermissions: permissions
          .filter(permission => permission.key.trim() && permission.label.trim())
          .map(permission => ({
            key: permission.key.trim(),
            label: permission.label.trim(),
            required: Boolean(permission.required)
          }))
      };

      if (editingPolicyId) {
        await consentService.updatePolicy(editingPolicyId, payload);
        showToast(t('consentManager.toasts.updateSuccess'), 'success');
      } else {
        await consentService.createPolicy(payload);
        showToast(t('consentManager.toasts.publishSuccess'), 'success');
      }

      setEditingPolicyId(null);
      setTitle('');
      setCaae('');
      setHtmlContent('');
      const today = new Date();
      const nextYear = new Date();
      nextYear.setFullYear(nextYear.getFullYear() + 1);
      setValidFrom(today.toISOString().slice(0, 10));
      setValidTo(nextYear.toISOString().slice(0, 10));
      setPermissions([buildPermissionRow()]);
      setActiveTab('history');
      await loadHistory(1, historyLimit, historySearch);
    } catch (error: any) {
      showToast(error?.message || t('consentManager.toasts.publishError'), 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrepareUpdate = (policy: ConsentPolicy) => {
    setEditingPolicyId(String(policy._id || ''));
    setTitle(String(policy.title || ''));
    setCaae(String(policy.caae || ''));
    setHtmlContent(String(policy.htmlContent || (policy as any).content || ''));
    setValidFrom(policy.validFrom ? new Date(policy.validFrom).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
    setValidTo(policy.validTo ? new Date(policy.validTo).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
    setPermissions(
      Array.isArray(policy.granularPermissions) && policy.granularPermissions.length > 0
        ? policy.granularPermissions.map((permission) =>
            buildPermissionRow({
              key: String(permission.key || ''),
              label: String(permission.label || ''),
              required: Boolean(permission.required)
            })
          )
        : [buildPermissionRow()]
    );
    setActiveTab('new');
  };

  const handleCancelUpdate = () => {
    setEditingPolicyId(null);
    setTitle('');
    setCaae('');
    setHtmlContent('');
    const today = new Date();
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    setValidFrom(today.toISOString().slice(0, 10));
    setValidTo(nextYear.toISOString().slice(0, 10));
    setPermissions([buildPermissionRow()]);
  };

  return (
    <div className="page consent-manager">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('consentManager.title')}</h1>
          <p className="page-subtitle">{t('consentManager.subtitle')}</p>
        </div>
      </div>

      <div className="consent-manager-tabs">
        <Button
          variant={activeTab === 'new' ? 'primary' : 'secondary'}
          className={`btn-small ${activeTab === 'new' ? '' : 'btn-ghost'}`}
          onClick={() => setActiveTab('new')}
        >
          {t('consentManager.tabs.new')}
        </Button>
        <Button
          variant={activeTab === 'history' ? 'primary' : 'secondary'}
          className={`btn-small ${activeTab === 'history' ? '' : 'btn-ghost'}`}
          onClick={() => setActiveTab('history')}
        >
          {t('consentManager.tabs.history')}
        </Button>
      </div>

      {activeTab === 'new' ? (
        <div className="consent-manager-grid">
          <Card className="consent-manager-form">
            <div className="consent-manager-form-fields">
              {editingPolicyId && (
                <div className="consent-manager-edit-banner">
                  {t('consentManager.form.editingBanner')}
                </div>
              )}

              <div className="consent-manager-form-row">
                <Input label={t('consentManager.form.title')} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('consentManager.form.titlePlaceholder')} />
                <Input label={t('consentManager.form.caae')} value={caae} onChange={(event) => setCaae(event.target.value)} placeholder={t('consentManager.form.caaePlaceholder')} />
                <Input
                  label={t('consentManager.form.effectiveDate')}
                  type="date"
                  value={validFrom}
                  onChange={(event) => setValidFrom(event.target.value)}
                />
                <Input
                  label={t('consentManager.form.expirationDate')}
                  type="date"
                  value={validTo}
                  onChange={(event) => setValidTo(event.target.value)}
                />
              </div>

              <div className="consent-manager-textarea">
                <label htmlFor="consent-html-content" className="input-label">{t('consentManager.form.content')}</label>
                <textarea
                  id="consent-html-content"
                  value={htmlContent}
                  onChange={(event) => setHtmlContent(event.target.value)}
                  rows={12}
                  className="consent-textarea"
                  placeholder={t('consentManager.form.contentPlaceholder')}
                />
              </div>
            </div>
          </Card>

          <Card className="consent-manager-permissions">
            <div className="consent-manager-permissions-header">
              <h2 className="consent-manager-section-title">{t('consentManager.permissions.title')}</h2>
              <Button variant="secondary" className="btn-small btn-ghost" onClick={handleAddPermission}>
                + {t('consentManager.permissions.add')}
              </Button>
            </div>
            <div className="consent-manager-permissions-list">
              {permissions.map((permission, index) => (
                <div key={permission.tempId} className="consent-permission-card">
                  <Input
                    label={t('consentManager.permissions.id')}
                    value={permission.key}
                    onChange={(event) => handleUpdatePermission(index, 'key', event.target.value)}
                    placeholder={t('consentManager.permissions.idPlaceholder')}
                  />
                  <Input
                    label={t('consentManager.permissions.patientText')}
                    value={permission.label}
                    onChange={(event) => handleUpdatePermission(index, 'label', event.target.value)}
                    placeholder={t('consentManager.permissions.patientTextPlaceholder')}
                  />
                  <label className="consent-required-toggle">
                    <input
                      type="checkbox"
                      checked={!!permission.required}
                      onChange={(event) => handleUpdatePermission(index, 'required', event.target.checked)}
                      aria-label={`${t('consentManager.permissions.requiredAria')} ${permission.key || index + 1}`}
                    />
                    {t('consentManager.permissions.required')}
                  </label>
                  {permissions.length > 1 && (
                    <Button
                      variant="secondary"
                      className="btn-small btn-ghost consent-remove-button"
                      onClick={() => handleRemovePermission(index)}
                    >
                      {t('consentManager.permissions.remove')}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <div className="consent-manager-actions">
            {editingPolicyId && (
              <Button variant="secondary" className="btn-ghost" onClick={handleCancelUpdate} disabled={isSubmitting}>
                {t('consentManager.actions.cancelUpdate')}
              </Button>
            )}
            <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit || isSubmitting}>
              {isSubmitting
                ? t('consentManager.actions.publishing')
                : editingPolicyId
                  ? t('consentManager.actions.update')
                  : t('consentManager.actions.publish')}
            </Button>
          </div>
        </div>
      ) : (
        <Card className="consent-manager-history">
          <div className="consent-manager-history-header">
            <h2 className="consent-manager-section-title">{t('consentManager.history.title')}</h2>
            <Button variant="secondary" className="btn-small btn-ghost" onClick={loadHistory}>
              {t('consentManager.history.refresh')}
            </Button>
          </div>

          <div className="consent-manager-history-filters">
            <Input
              label={t('consentManager.history.searchLabel')}
              value={historySearch}
              onChange={(event) => setHistorySearch(event.target.value)}
              placeholder={t('consentManager.history.searchPlaceholderUnified')}
            />
          </div>

          <div className="consent-manager-history-pagination">
            <label>
              {t('consentManager.history.itemsPerPage')}
              <select
                value={historyLimit}
                onChange={(event) => {
                  const nextLimit = Number(event.target.value) || 10;
                  setHistoryLimit(nextLimit);
                  loadHistory(1, nextLimit, historySearch);
                }}
              >
                {[10, 20, 50, 100].map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <span>{historyTotal} {t('consentManager.history.records')}</span>
          </div>

          {loadingHistory ? (
            <div className="consent-manager-loading">
              <Spinner size="sm" />
              <span>{t('consentManager.history.loading')}</span>
            </div>
          ) : (
            <Table headers={[
              t('consentManager.table.version'),
              t('consentManager.table.title'),
              t('consentManager.table.caae'),
              t('consentManager.table.effectiveDate'),
              t('consentManager.table.expirationDate'),
              t('consentManager.table.status'),
              t('consentManager.table.permissions'),
              t('consentManager.table.content'),
              t('common.actions')
            ]}>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={9} className="consent-manager-empty">
                    {t('consentManager.history.emptyTable')}
                  </td>
                </tr>
              ) : (
                history.map((policy) => (
                  <tr key={policy._id || `${policy.version}-${policy.title}`}>
                    <td className="consent-manager-version">{policy.version}</td>
                    <td>{policy.title}</td>
                    <td>{(policy as any).caae || '--'}</td>
                    <td>
                      {policy.validFrom ? new Date(policy.validFrom).toLocaleDateString() : '--'}
                    </td>
                    <td>
                      {policy.validTo ? new Date(policy.validTo).toLocaleDateString() : '--'}
                    </td>
                    <td>
                      <span className={`consent-status ${policy.active ? 'active' : 'inactive'}`}>
                        {policy.active ? t('consentManager.status.active') : t('consentManager.status.inactive')}
                      </span>
                    </td>
                    <td>{Array.isArray(policy.granularPermissions) ? policy.granularPermissions.length : 0}</td>
                    <td>{String(policy.htmlContent || '').slice(0, 80)}{String(policy.htmlContent || '').length > 80 ? '...' : ''}</td>
                    <td>
                      <div className="consent-manager-row-actions">
                        <Button variant="secondary" className="btn-small btn-ghost" onClick={() => setSelectedHistoryItem(policy)}>
                          {t('common.details')}
                        </Button>
                        <Button variant="secondary" className="btn-small" onClick={() => handlePrepareUpdate(policy)}>
                          {t('consentManager.actions.update')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </Table>
          )}

          <div className="consent-manager-history-pagination-controls">
            <Button
              variant="secondary"
              className="btn-small btn-ghost"
              disabled={historyPage <= 1 || loadingHistory}
              onClick={() => loadHistory(historyPage - 1, historyLimit, historySearch)}
            >
              {t('common.previous')}
            </Button>
            <span>{t('consentManager.history.page')} {historyPage} {t('consentManager.history.of')} {historyTotalPages}</span>
            <Button
              variant="secondary"
              className="btn-small btn-ghost"
              disabled={historyPage >= historyTotalPages || loadingHistory}
              onClick={() => loadHistory(historyPage + 1, historyLimit, historySearch)}
            >
              {t('common.next')}
            </Button>
          </div>

          {selectedHistoryItem && (
            <Card className="consent-manager-details">
              <div className="consent-manager-history-header">
                <h3 className="consent-manager-section-title">{t('consentManager.details.title')} {selectedHistoryItem.version}</h3>
                <Button variant="secondary" className="btn-small btn-ghost" onClick={() => setSelectedHistoryItem(null)}>
                  {t('common.close')}
                </Button>
              </div>
              <div className="consent-manager-details-grid">
                <p><strong>{t('consentManager.details.titleLabel')}:</strong> {selectedHistoryItem.title}</p>
                <p><strong>{t('consentManager.details.caaeLabel')}:</strong> {selectedHistoryItem.caae}</p>
                <p><strong>{t('consentManager.details.validFromLabel')}:</strong> {selectedHistoryItem.validFrom ? new Date(selectedHistoryItem.validFrom).toLocaleDateString() : '--'}</p>
                <p><strong>{t('consentManager.details.validToLabel')}:</strong> {selectedHistoryItem.validTo ? new Date(selectedHistoryItem.validTo).toLocaleDateString() : '--'}</p>
                <p><strong>{t('consentManager.details.statusLabel')}:</strong> {selectedHistoryItem.active ? t('consentManager.status.active') : t('consentManager.status.inactive')}</p>
                <p><strong>{t('consentManager.details.createdAtLabel')}:</strong> {selectedHistoryItem.createdAt ? new Date(selectedHistoryItem.createdAt).toLocaleString() : '--'}</p>
              </div>
              <div className="consent-manager-details-content">
                <strong>{t('consentManager.details.permissionsLabel')}</strong>
                <ul>
                  {(selectedHistoryItem.granularPermissions || []).map((permission, index) => (
                    <li key={`${permission.key}-${index}`}>
                      {permission.key} - {permission.label} {permission.required ? `(${t('consentManager.details.required')})` : ''}
                    </li>
                  ))}
                </ul>
                <strong>{t('consentManager.details.fullContent')}</strong>
                <pre>{selectedHistoryItem.htmlContent || ''}</pre>
              </div>
            </Card>
          )}
        </Card>
      )}
    </div>
  );
}
