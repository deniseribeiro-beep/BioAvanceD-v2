import { useEffect, useState } from 'react';
import Card from '../UI/Card';
import Button from '../UI/Button';
import { securityService } from '../../services/api';

/**
 * RF014 AC4: the security configuration's releases, newest first, with a
 * governed rollback to a superseded one. A rollback is a new release that
 * names the one it restores; the active release and the refused drafts
 * offer none (the API refuses both).
 */
export interface ConfigurationRelease {
  configurationReleaseId: string;
  semanticVersion: string;
  status: 'active' | 'superseded' | 'draft' | string;
  approvedBy?: string | null;
  effectivePeriod?: { start?: string | null; end?: string | null } | null;
  rollbackTargetId?: string | null;
}

interface Props {
  t: (key: string, fallback?: string) => string;
  onRolledBack: () => void | Promise<void>;
  showToast: (message: string, type: 'success' | 'error') => void;
}

const errorMessage = (err: unknown, fallback: string): string => {
  const apiError = err as { response?: { data?: { message?: string; error?: string } } } | null;
  return apiError?.response?.data?.message || apiError?.response?.data?.error || fallback;
};

const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleString() : '');

export default function ConfigurationReleasesPanel({ t, onRolledBack, showToast }: Props) {
  const [releases, setReleases] = useState<ConfigurationRelease[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [rollingBack, setRollingBack] = useState<string | null>(null);

  const load = async () => {
    try {
      const response = await securityService.getReleases();
      setReleases(response.data?.data ?? []);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const versionOf = (id?: string | null) => releases?.find((release) => release.configurationReleaseId === id)?.semanticVersion ?? '';

  const rollback = async (release: ConfigurationRelease) => {
    setRollingBack(release.configurationReleaseId);
    try {
      await securityService.rollbackConfig(release.configurationReleaseId);
      showToast(t('security.releases.rollbackSuccess').replace('{{version}}', release.semanticVersion), 'success');
      await load();
      await onRolledBack();
    } catch (err: unknown) {
      showToast(errorMessage(err, t('security.releases.rollbackError')), 'error');
    } finally {
      setRollingBack(null);
    }
  };

  return (
    <div data-testid="security-releases">
      <Card className="security-section">
        <h2>{t('security.releases.title')}</h2>
        <p className="config-help">{t('security.releases.intro')}</p>
        {loadFailed && <p className="config-help" data-testid="security-releases-error">{t('security.releases.loadError')}</p>}
        {releases && releases.length === 0 && <p className="config-help">{t('security.releases.empty')}</p>}
        {releases && releases.length > 0 && (
          <table className="security-releases-table">
            <thead>
              <tr>
                <th>{t('security.releases.version')}</th>
                <th>{t('security.releases.status')}</th>
                <th>{t('security.releases.approvedBy')}</th>
                <th>{t('security.releases.since')}</th>
                <th>{t('security.releases.restores')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {releases.map((release) => (
                <tr key={release.configurationReleaseId} data-testid="security-release-row" data-status={release.status}>
                  <td data-testid="security-release-version">{release.semanticVersion}</td>
                  <td>{t(`security.releases.statuses.${release.status}`, release.status)}</td>
                  <td>{release.approvedBy ?? ''}</td>
                  <td>{formatDate(release.effectivePeriod?.start)}</td>
                  <td data-testid="security-release-restores">{versionOf(release.rollbackTargetId)}</td>
                  <td>
                    {release.status === 'superseded' && (
                      <Button
                        data-testid="security-release-rollback"
                        onClick={() => rollback(release)}
                        disabled={rollingBack !== null}
                      >
                        {t('security.releases.rollback')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
