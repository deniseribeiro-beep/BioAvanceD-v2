import { useEffect, useState } from 'react';
import Card from '../UI/Card';
import { securityService } from '../../services/api';

/**
 * RF014 AC1, CFG-002: the setting catalog of the security configuration,
 * one row per key with its type, scope, allowed values, default,
 * dependencies, owner and validity, in the order the API lists them.
 * An entry's allowedValues kind names which of its other fields it carries.
 */
export interface AllowedValues {
  kind: 'range' | 'enum' | 'any' | 'fixed' | 'governed' | 'follows' | string;
  min?: number;
  max?: number;
  integer?: boolean;
  values?: unknown[];
  value?: unknown;
  reason?: string;
  invariantId?: string;
  by?: string;
  path?: string;
}

export interface CatalogEntry {
  path: string;
  type: string;
  scope: string;
  allowedValues: AllowedValues;
  default: unknown;
  dependencies: { path: string; rule: string }[];
  owner: string;
  validity: string;
}

interface Catalog {
  catalogVersion: string;
  settings: CatalogEntry[];
}

interface Props {
  t: (key: string, fallback?: string) => string;
}

export function formatAllowed(allowed: AllowedValues, t: Props['t']): string {
  switch (allowed.kind) {
    case 'range':
      return `${allowed.min}..${allowed.max}`;
    case 'enum':
      return (allowed.values ?? []).map(String).join(', ');
    case 'any':
      return t('security.catalog.anyValue');
    case 'fixed':
      return `= ${String(allowed.value)}` + (allowed.invariantId ? ` (${allowed.invariantId})` : '');
    case 'governed':
      return allowed.by ?? '';
    case 'follows':
      return `= ${allowed.path}`;
    default:
      return allowed.kind;
  }
}

export default function SettingCatalogPanel({ t }: Props) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await securityService.getCatalog();
        setCatalog(response.data?.data ?? null);
        setLoadFailed(false);
      } catch {
        setLoadFailed(true);
      }
    };
    load();
  }, []);

  return (
    <div data-testid="security-catalog">
      <Card className="security-section">
        <h2>{t('security.catalog.title')}</h2>
        <p className="config-help">{t('security.catalog.intro')}</p>
        <p className="config-help">
          {t('security.catalog.version')}: <span data-testid="security-catalog-version">{catalog?.catalogVersion ?? ''}</span>
        </p>
        {loadFailed && <p className="config-help" data-testid="security-catalog-error">{t('security.catalog.loadError')}</p>}
        {catalog && (
          <table className="security-catalog-table">
            <thead>
              <tr>
                <th>{t('security.catalog.path')}</th>
                <th>{t('security.catalog.type')}</th>
                <th>{t('security.catalog.scope')}</th>
                <th>{t('security.catalog.allowedValues')}</th>
                <th>{t('security.catalog.default')}</th>
                <th>{t('security.catalog.dependencies')}</th>
                <th>{t('security.catalog.owner')}</th>
                <th>{t('security.catalog.validity')}</th>
              </tr>
            </thead>
            <tbody>
              {catalog.settings.map((entry) => (
                <tr key={entry.path} data-testid="security-catalog-row" data-path={entry.path}>
                  <td data-testid="security-catalog-path">{entry.path}</td>
                  <td>{entry.type}</td>
                  <td>{entry.scope}</td>
                  <td data-testid="security-catalog-allowed">{formatAllowed(entry.allowedValues, t)}</td>
                  <td>{String(entry.default)}</td>
                  <td>{entry.dependencies.map((d) => d.rule).join('; ')}</td>
                  <td>{entry.owner}</td>
                  <td>{entry.validity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
