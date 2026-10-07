import { useCallback, useEffect, useState } from 'react';
import Card from '../UI/Card';
import Table from '../UI/Table';
import Button from '../UI/Button';
import { logService, SessionAuditFilters, SessionAuditPage, SessionRevocationReason } from '../../services/api';

/**
 * #1005: the audit view over sessions, dict-02 P1X-0267's "Sessões > Motivo".
 * Every user's sessions, revoked ones included, with when, by whom and why.
 * Owners and revoking actors arrive already pseudonymised (USR-XXXX) and IPs
 * masked; the backend does the LGPD shaping, this only renders it.
 */

const REASON_LABELS: Record<SessionRevocationReason, string> = {
  user_request: 'Solicitação do usuário',
  admin_action: 'Ação administrativa',
  password_change: 'Troca de senha',
  risk: 'Risco',
  expiration: 'Expiração',
};

const PAGE_SIZE = 25;

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR');
}

function statusLabel(row: { isRevoked: boolean; isActive: boolean }): string {
  if (row.isRevoked) return 'Revogada';
  return row.isActive ? 'Ativa' : 'Inativa';
}

export default function SessionAuditPanel() {
  const [filters, setFilters] = useState<SessionAuditFilters>({ revocationReason: '', isRevoked: 'true' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SessionAuditPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: SessionAuditFilters = { page, limit: PAGE_SIZE };
      if (filters.revocationReason) params.revocationReason = filters.revocationReason;
      if (filters.isRevoked) params.isRevoked = filters.isRevoked;
      const response = await logService.getSessions(params);
      setData(response.data.data);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.response?.data?.error || 'Erro ao carregar sessões');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    load();
  }, [load]);

  const updateFilter = (patch: Partial<SessionAuditFilters>) => {
    setPage(1);
    setFilters((current) => ({ ...current, ...patch }));
  };

  return (
    <Card title="Sessões e motivos de revogação" className="session-audit-panel">
      <div
        data-testid="session-audit-filters"
        style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          Situação
          <select
            aria-label="Situação da sessão"
            value={filters.isRevoked ?? ''}
            onChange={(event) => updateFilter({ isRevoked: event.target.value as SessionAuditFilters['isRevoked'] })}
          >
            <option value="">Todas</option>
            <option value="true">Revogadas</option>
            <option value="false">Não revogadas</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          Motivo
          <select
            aria-label="Motivo da revogação"
            value={filters.revocationReason ?? ''}
            onChange={(event) =>
              updateFilter({ revocationReason: event.target.value as SessionAuditFilters['revocationReason'] })
            }
          >
            <option value="">Todos</option>
            {(Object.keys(REASON_LABELS) as SessionRevocationReason[]).map((reason) => (
              <option key={reason} value={reason}>
                {REASON_LABELS[reason]}
              </option>
            ))}
          </select>
        </label>
        <Button variant="secondary" onClick={() => load()} disabled={loading}>
          Atualizar
        </Button>
      </div>

      {error && (
        <p role="alert" style={{ color: 'var(--color-error, #b91c1c)' }}>
          {error}
        </p>
      )}

      <Table
        data-testid="session-audit-table"
        headers={['Usuário', 'Início', 'Última atividade', 'Situação', 'Revogada em', 'Motivo', 'Revogada por', 'IP', 'Navegador / SO']}
      >
        {(data?.sessions || []).map((row, index) => (
          <tr key={row.id || index} data-testid="session-audit-row">
            <td>{row.user}</td>
            <td>{formatDate(row.createdAt)}</td>
            <td>{formatDate(row.lastActivity)}</td>
            <td>{statusLabel(row)}</td>
            <td>{formatDate(row.revokedAt)}</td>
            <td data-testid="session-audit-reason">
              {row.revocationReason ? REASON_LABELS[row.revocationReason] || row.revocationReason : '—'}
            </td>
            <td>{row.revokedBy === 'system' ? 'Sistema' : row.revokedBy || '—'}</td>
            <td>{row.ipAddress || '—'}</td>
            <td>{[row.browser, row.os].filter(Boolean).join(' / ') || '—'}</td>
          </tr>
        ))}
      </Table>

      {!loading && data && data.sessions.length === 0 && <p>Nenhuma sessão encontrada para os filtros.</p>}

      {data && data.totalPages > 1 && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '1rem' }}>
          <Button variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <span>
            Página {data.page} de {data.totalPages} ({data.total} sessões)
          </span>
          <Button variant="secondary" disabled={page >= data.totalPages || loading} onClick={() => setPage((p) => p + 1)}>
            Próxima
          </Button>
        </div>
      )}
    </Card>
  );
}
