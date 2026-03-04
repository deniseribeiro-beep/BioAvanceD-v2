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

const emptyPermission = (): ConsentPolicyPermission => ({
  key: '',
  label: '',
  required: false
});

export default function ConsentManager() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [version, setVersion] = useState('');
  const [title, setTitle] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [caae, setCaae] = useState('');
  const [validFrom, setValidFrom] = useState(() => {
    const today = new Date();
    return today.toISOString().slice(0, 10);
  });
  const [permissions, setPermissions] = useState<ConsentPolicyPermission[]>([emptyPermission()]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [history, setHistory] = useState<ConsentPolicy[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);

  const canSubmit = useMemo(() => {
    const hasPermissions = permissions.some(permission => permission.key.trim() && permission.label.trim());
    return version.trim() && title.trim() && caae.trim() && htmlContent.trim() && hasPermissions;
  }, [version, title, caae, htmlContent, permissions]);

  const searchableHistory = useMemo(() => {
    const term = historySearch.trim().toLowerCase();
    if (!term) return history;
    return history.filter((item) => {
      const titleValue = String(item.title || '').toLowerCase();
      const versionValue = String(item.version || '').toLowerCase();
      const caaeValue = String((item as any).caae || '').toLowerCase();
      return titleValue.includes(term) || versionValue.includes(term) || caaeValue.includes(term);
    });
  }, [history, historySearch]);

  const displayedHistory = useMemo(() => {
    if (selectedHistoryIds.length === 0) {
      return searchableHistory;
    }
    const selectedSet = new Set(selectedHistoryIds);
    return searchableHistory.filter((item) => item._id && selectedSet.has(String(item._id)));
  }, [searchableHistory, selectedHistoryIds]);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const response = await consentService.getAllPolicies();
      const payload = (response as any)?.data?.data ?? (response as any)?.data ?? [];
      setHistory(Array.isArray(payload) ? payload : []);
    } catch (error: any) {
      showToast(error?.message || t('consentManager.toasts.loadHistoryError'), 'error');
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleAddPermission = () => {
    setPermissions((prev) => [...prev, emptyPermission()]);
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
        version: version.trim(),
        title: title.trim(),
        caae: caae.trim(),
        htmlContent: htmlContent.trim(),
        validFrom: new Date(validFrom).toISOString(),
        active: true,
        granularPermissions: permissions
          .filter(permission => permission.key.trim() && permission.label.trim())
          .map(permission => ({
            key: permission.key.trim(),
            label: permission.label.trim(),
            required: Boolean(permission.required)
          }))
      };

      await consentService.createPolicy(payload);
  showToast(t('consentManager.toasts.publishSuccess'), 'success');

      setVersion('');
      setTitle('');
      setCaae('');
      setHtmlContent('');
      setPermissions([emptyPermission()]);
      setActiveTab('history');
      await loadHistory();
    } catch (error: any) {
      showToast(error?.message || t('consentManager.toasts.publishError'), 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleHistorySelection = (id: string) => {
    setSelectedHistoryIds((prev) => (
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]
    ));
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
              <div className="consent-manager-form-row">
                <Input label={t('consentManager.form.version')} value={version} onChange={(event) => setVersion(event.target.value)} placeholder={t('consentManager.form.versionPlaceholder')} />
                <Input label={t('consentManager.form.title')} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('consentManager.form.titlePlaceholder')} />
                <Input label={t('consentManager.form.caae')} value={caae} onChange={(event) => setCaae(event.target.value)} placeholder={t('consentManager.form.caaePlaceholder')} />
                <Input
                  label={t('consentManager.form.effectiveDate')}
                  type="date"
                  value={validFrom}
                  onChange={(event) => setValidFrom(event.target.value)}
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
                <div key={`${permission.key}-${index}`} className="consent-permission-card">
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
            <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit || isSubmitting}>
              {isSubmitting
                ? t('consentManager.actions.publishing')
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
              placeholder={t('consentManager.history.searchPlaceholder')}
            />
          </div>

          <div className="consent-manager-history-checklist">
            {searchableHistory.length === 0 ? (
              <span className="consent-manager-empty">{t('consentManager.history.emptyFilter')}</span>
            ) : (
              searchableHistory.map((policy) => {
                const itemId = policy._id ? String(policy._id) : `${policy.version}-${policy.title}`;
                const checked = selectedHistoryIds.includes(itemId);
                return (
                  <label key={itemId} className="consent-manager-check-item">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleHistorySelection(itemId)}
                    />
                    <span>{policy.version} - {policy.title} {(policy as any).caae ? `(CAAE: ${(policy as any).caae})` : ''}</span>
                  </label>
                );
              })
            )}
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
              t('consentManager.table.status')
            ]}>
              {displayedHistory.length === 0 ? (
                <tr>
                  <td colSpan={5} className="consent-manager-empty">
                    {t('consentManager.history.emptyTable')}
                  </td>
                </tr>
              ) : (
                displayedHistory.map((policy) => (
                  <tr key={policy._id || `${policy.version}-${policy.title}`}>
                    <td className="consent-manager-version">{policy.version}</td>
                    <td>{policy.title}</td>
                    <td>{(policy as any).caae || '--'}</td>
                    <td>
                      {policy.validFrom ? new Date(policy.validFrom).toLocaleDateString() : '--'}
                    </td>
                    <td>
                      <span className={`consent-status ${policy.active ? 'active' : 'inactive'}`}>
                        {policy.active ? t('consentManager.status.active') : t('consentManager.status.inactive')}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
