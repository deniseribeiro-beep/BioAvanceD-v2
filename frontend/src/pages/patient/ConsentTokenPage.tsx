import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import Button from '../../components/UI/Button';
import {
  consentTokenService,
  govbrConsentService,
  type ConsentIdentityProof,
} from '../../services/api';
import {
  ConsentTokenTemplate,
  initialConsentResponses,
  mapConsentTokenRequestError,
  missingRequiredPermissions,
  normalizeConsentTemplate,
  readPanelLocation,
  resolveConsentTokenParams,
} from '../../views/consentTokenView';

type PanelMode = 'pending' | 'manage' | 'closed';

type PanelConsent = {
  status: string;
  currentStateDerived: string | null;
  signedAt: string | null;
  hasSignedTcle: boolean;
  effectivePermissions: Record<string, boolean>;
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString('pt-BR') : '-';
}

function stateLabel(state: string | null): string {
  if (state === 'partially_revoked') return 'Parcialmente revogado';
  if (state === 'revoked') return 'Revogado';
  if (state === 'superseded') return 'Substituído';
  return 'Ativo';
}

// The link emailed with the TCLE. Pending, it records the acceptance.
// Afterwards the same address, still bound to the participant id, is the
// panel where that person reads the term and revokes it in whole or in part.
export default function ConsentTokenPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const tokenParam = searchParams.get('token');
  const params = useMemo(() => resolveConsentTokenParams(id, tokenParam), [id, tokenParam]);

  const [template, setTemplate] = useState<ConsentTokenTemplate | null>(null);
  const [responses, setResponses] = useState<Record<string, boolean>>({});
  const [granted, setGranted] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [panel, setPanel] = useState<PanelMode>('pending');
  const [consent, setConsent] = useState<PanelConsent | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [govbrEnabled, setGovbrEnabled] = useState(false);
  const [identityProof, setIdentityProof] = useState<ConsentIdentityProof | null>(null);

  const loadPanel = useCallback(async () => {
    if (!params.ok) {
      setError(params.message);
      setLoading(false);
      return;
    }
    const resp = await consentTokenService.validate(params.participantId, params.token);
    const data = resp.data?.data;
    const normalized = normalizeConsentTemplate(data?.template);
    const nextPanel: PanelMode = data?.panel === 'manage' || data?.panel === 'closed' ? data.panel : 'pending';
    const permissions = data?.consent?.effectivePermissions || {};
    setTemplate(normalized);
    setPanel(nextPanel);
    setConsent(data?.consent
      ? {
        status: data.consent.status,
        currentStateDerived: data.consent.currentStateDerived,
        signedAt: data.consent.signedAt || null,
        hasSignedTcle: data.consent.hasSignedTcle === true,
        effectivePermissions: permissions,
      }
      : null);
    setResponses(normalized ? initialConsentResponses(normalized.permissions) : {});
    setGranted(permissions);
    setSelected([]);
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        await loadPanel();
        try {
          const status = await govbrConsentService.status();
          if (!cancelled) setGovbrEnabled(Boolean(status.data?.enabled));
        } catch {
          if (!cancelled) setGovbrEnabled(false);
        }
      } catch (err: unknown) {
        if (!cancelled) setError(mapConsentTokenRequestError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [loadPanel]);

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    if (!code || !state) return;
    let cancelled = false;
    async function resumeGovbr() {
      try {
        const resp = await govbrConsentService.callback(code!, state!);
        if (!cancelled && resp.data?.identityProof) {
          setIdentityProof(resp.data.identityProof);
          setNotice('Identidade gov.br verificada. Confirme o aceite do termo.');
        }
      } catch {
        if (!cancelled) setError('Não foi possível concluir a autenticação gov.br.');
      }
    }
    void resumeGovbr();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  async function startGovbr() {
    if (!params.ok) return;
    setSubmitting(true);
    setError('');
    try {
      const resp = await govbrConsentService.start(params.participantId, params.token);
      const url = resp.data?.authorizationUrl;
      if (!url) throw new Error('authorizationUrl ausente');
      window.location.assign(url);
    } catch (err: unknown) {
      setError(mapConsentTokenRequestError(err));
      setSubmitting(false);
    }
  }

  async function acceptConsent() {
    if (!params.ok || !template) return;
    setSubmitting(true);
    setError('');
    try {
      const location = await readPanelLocation();
      await consentTokenService.accept(params.participantId, params.token, {
        consentTemplateId: template.id,
        responses,
        location,
        identityProof: identityProof || { provider: 'panel' },
      });
      await loadPanel();
      setNotice('Aceite registrado. Este mesmo link continua disponível para revogar o termo inteiro ou algumas permissões.');
    } catch (err: unknown) {
      setError(mapConsentTokenRequestError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(scope?: string[]) {
    if (!params.ok) return;
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const location = await readPanelLocation();
      await consentTokenService.revoke(params.participantId, params.token, {
        ...(scope ? { scope } : {}),
        location,
      });
      await loadPanel();
      setNotice('Revogação registrada. O estado deste termo já está atualizado.');
    } catch (err: unknown) {
      setError(mapConsentTokenRequestError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function openSignedTcle(download: boolean) {
    if (!params.ok) return;
    setError('');
    try {
      const response = await consentTokenService.signedTcle(params.participantId, params.token);
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      if (download) {
        const link = document.createElement('a');
        link.href = url;
        link.download = 'tcle.pdf';
        link.click();
      } else {
        window.open(url, '_blank', 'noopener');
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError('Não foi possível abrir o termo assinado.');
    }
  }

  if (loading) {
    return (
      <div className="page-shell consent-token-page">
        <p>Carregando...</p>
      </div>
    );
  }

  if (error && !template) {
    return (
      <div className="page-shell consent-token-page">
        <div className="page-header">
          <h1 className="page-title">Consentimento Eletrônico</h1>
        </div>
        <p role="alert" data-testid="consent-token-error" style={{ color: 'var(--danger)' }}>{error}</p>
      </div>
    );
  }

  if (!template && panel === 'pending') {
    return (
      <div className="page-shell consent-token-page">
        <div className="page-header">
          <h1 className="page-title">Consentimento Eletrônico</h1>
        </div>
        <section className="card-surface">
          <p data-testid="consent-token-no-template">
            Nenhum termo de consentimento está ativo no momento. Tente novamente mais tarde ou
            entre em contato com a equipe do biobanco.
          </p>
        </section>
      </div>
    );
  }

  const missingRequired = template ? missingRequiredPermissions(template.permissions, responses) : [];
  const participantLabel = params.ok ? params.participantId : '';
  const grantedPermissions = template
    ? template.permissions.filter(permission => granted[permission.key] === true)
    : [];

  return (
    <div className="page-shell consent-token-page">
      <div className="page-header">
        <div>
          <h1 className="page-title" data-testid="consent-token-title">{template?.title || 'Consentimento Eletrônico'}</h1>
          {template?.version && <p className="page-subtitle">Versão {template.version}</p>}
          <p className="page-subtitle" data-testid="consent-token-participant">Participante {participantLabel}</p>
        </div>
      </div>

      {notice && <p role="status" data-testid="consent-token-notice">{notice}</p>}
      {error && <p role="alert" data-testid="consent-token-error" style={{ color: 'var(--danger)' }}>{error}</p>}

      {template && (
        <section className="card-surface">
          <h3 className="text-base font-semibold text-foreground">Texto do termo</h3>
          <div data-testid="consent-token-content" className="mt-3 whitespace-pre-wrap text-sm text-foreground">
            {template.content}
          </div>
        </section>
      )}

      <section className="card-surface" data-testid="consent-token-signed">
        <h3 className="text-base font-semibold text-foreground">Termo assinado</h3>
        {consent?.signedAt && (
          <p className="mt-2 text-sm text-muted-foreground">Assinado em {formatDate(consent.signedAt)}</p>
        )}
        {consent?.hasSignedTcle ? (
          <div className="form-actions">
            <Button type="button" data-testid="consent-token-view" onClick={() => { void openSignedTcle(false); }}>Ver</Button>
            <Button type="button" variant="secondary" data-testid="consent-token-download" onClick={() => { void openSignedTcle(true); }}>Baixar</Button>
          </div>
        ) : (
          <p className="mt-3 text-sm" data-testid="consent-token-signed-missing">Não há termo assinado em arquivo.</p>
        )}
      </section>

      <section className="card-surface">
        <h3 className="mb-3 text-base font-semibold text-foreground">Estado e permissões</h3>
        {panel === 'closed' && (
          <p data-testid="consent-token-closed">Este termo está encerrado. Não há permissões em vigor.</p>
        )}
        {panel !== 'pending' && consent && (
          <p className="mb-3 text-sm text-muted-foreground">Estado: {stateLabel(consent.currentStateDerived)}</p>
        )}

        {panel === 'pending' && template && template.permissions.length > 0 && (
          <table className="table" data-testid="consent-token-permissions">
            <thead>
              <tr><th>Finalidade</th><th>Aceite</th></tr>
            </thead>
            <tbody>
              {template.permissions.map(permission => (
                <tr key={permission.key}>
                  <td>
                    <label>
                      <input
                        type="checkbox"
                        data-testid={`consent-token-permission-${permission.key}`}
                        checked={responses[permission.key] === true}
                        onChange={event =>
                          setResponses(prev => ({ ...prev, [permission.key]: event.target.checked }))
                        }
                      />{' '}
                      {permission.label}
                      {permission.required ? ' (obrigatória)' : ' (opcional)'}
                    </label>
                  </td>
                  <td>{responses[permission.key] === true ? 'sim' : 'não'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {panel === 'pending' && template && missingRequired.length > 0 && (
          <p data-testid="consent-token-required-hint" className="mt-3 text-sm text-muted-foreground">
            Para aceitar o termo, marque as finalidades obrigatórias: {missingRequired.join(', ')}.
          </p>
        )}
        {panel === 'pending' && template && (
          <div className="form-actions">
            {govbrEnabled && (
              <Button
                type="button"
                variant="secondary"
                data-testid="consent-token-govbr"
                onClick={() => { void startGovbr(); }}
                disabled={submitting}
              >
                {identityProof?.provider === 'govbr' ? 'gov.br verificado' : 'Identificar com gov.br'}
              </Button>
            )}
            <Button
              type="button"
              data-testid="consent-token-accept"
              onClick={acceptConsent}
              disabled={submitting || missingRequired.length > 0}
            >
              {submitting ? 'Enviando...' : 'Aceitar o termo'}
            </Button>
          </div>
        )}

        {panel === 'manage' && template && (
          <div data-testid="consent-token-manage">
            <table className="table">
              <thead>
                <tr><th>Permissão</th><th>Em vigor</th></tr>
              </thead>
              <tbody>
                {grantedPermissions.map(permission => (
                  <tr key={permission.key}>
                    <td>
                      <label>
                        <input
                          type="checkbox"
                          data-testid={`consent-token-revoke-${permission.key}`}
                          checked={selected.includes(permission.key)}
                          onChange={() => setSelected(current => (
                            current.includes(permission.key)
                              ? current.filter(key => key !== permission.key)
                              : [...current, permission.key]
                          ))}
                        />{' '}
                        {permission.label}
                      </label>
                    </td>
                    <td>sim</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="form-actions">
              <Button
                type="button"
                variant="danger"
                data-testid="consent-token-revoke-selected"
                disabled={submitting || selected.length === 0}
                onClick={() => { void revoke(selected); }}
              >
                Revogar permissões marcadas
              </Button>
              <Button
                type="button"
                variant="danger"
                data-testid="consent-token-revoke-all"
                disabled={submitting}
                onClick={() => { void revoke(); }}
              >
                Revogar termo inteiro
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
