import { useEffect, useId, useState } from 'react';
import Button from '../components/UI/Button';
import { userService, UserOrganizationScopes as Scopes } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';

interface OrganizationOption {
  organizationId: string;
  officialName?: string;
}

interface Props {
  userId: string | number;
  organizations: OrganizationOption[];
}

/**
 * #1358: an administrator adds and removes the organizations a user's role
 * is scoped to, beyond the home organization the form's own select sets.
 * Each change goes straight to POST/DELETE /api/users/:id/organizations,
 * which applies and audits it; nothing here waits for the form's save.
 */
export default function UserOrganizationScopes({ userId, organizations }: Props) {
  const { t } = useLanguage();
  const selectId = useId();
  const [scopes, setScopes] = useState<Scopes | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    userService.getOrganizationScopes(userId)
      .then((response) => { if (!cancelled) setScopes(response.data.data ?? null); })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.message || err.message); });
    return () => { cancelled = true; };
  }, [userId]);

  const nameOf = (organizationId: string) =>
    organizations.find((org) => org.organizationId === organizationId)?.officialName || organizationId;

  const apply = async (change: () => Promise<{ data: { data?: Scopes } }>) => {
    setBusy(true);
    setError(null);
    try {
      const response = await change();
      setScopes(response.data.data ?? null);
      setSelected('');
    } catch (err: any) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!scopes) {
    return error ? <p className="form-help-text" role="alert">{error}</p> : null;
  }

  const additional = scopes.organizationIds.filter((id) => id !== scopes.homeOrganizationId);
  const available = organizations.filter((org) => !scopes.organizationIds.includes(org.organizationId));

  return (
    <div className="form-grid-full" data-testid="user-organization-scopes">
      <label htmlFor={selectId} className="form-label">{t('users.additionalOrganizations')}</label>
      {scopes.global ? (
        <p className="form-help-text">{t('users.additionalOrganizationsGlobal')}</p>
      ) : (
        <>
          {additional.length === 0 ? (
            <p className="form-help-text">{t('users.additionalOrganizationsNone')}</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.5rem 0', display: 'grid', gap: '0.25rem' }}>
              {additional.map((organizationId) => (
                <li key={organizationId} data-testid={`user-organization-scope-${organizationId}`} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>{nameOf(organizationId)}</span>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    data-testid={`user-organization-scope-remove-${organizationId}`}
                    onClick={() => apply(() => userService.removeOrganizationScope(userId, organizationId))}
                  >
                    {t('users.removeOrganization')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select
              id={selectId}
              data-testid="user-organization-scope-select"
              className="form-select"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={busy}
            >
              <option value="">{t('common.select')}</option>
              {available.map((org) => (
                <option key={org.organizationId} value={org.organizationId}>{org.officialName}</option>
              ))}
            </select>
            <Button
              type="button"
              disabled={busy || !selected}
              data-testid="user-organization-scope-add"
              onClick={() => apply(() => userService.addOrganizationScope(userId, selected))}
            >
              {t('users.addOrganization')}
            </Button>
          </div>
          <p className="form-help-text">{t('users.additionalOrganizationsHelp')}</p>
        </>
      )}
      {error && <p className="form-help-text" role="alert">{error}</p>}
    </div>
  );
}
