import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { eConsentService } from '../../services/api';
import {
  EConsentTemplate,
  buildConsentUpdatePayload,
  buildRevokeAllAnswers,
  mapEConsentError,
  mapEConsentSubmitError,
  normalizeEConsentSnapshot,
} from '../../views/eConsentView';

// #822: this page used raw axios with a relative `/api/...` URL. A relative URL
// resolves against the page's own origin -- the frontend server -- and nothing
// proxies /api there in dev, test or prod (no `server.proxy` in
// vite.config.js, no `location /api` in nginx.conf). So every request fell
// through the SPA history fallback and came back as index.html: HTML with a
// 200, which axios resolves rather than rejects. The page then read undefined
// fields off an HTML string and rendered "Link inválido ou expirado" -- the
// same message a genuinely bad token produces.
//
// It now uses the shared `api` client, which resolves VITE_API_BASE_URL (see
// getApiBaseUrl). The second half of that fix is TOKEN_OPTIONAL_ROUTES: the
// client's request interceptor cancels any request made with no session and
// redirects to /login, and a participant following an emailed link has no
// session by definition. Both of this page's routes are listed there.
//
// Note the submit path is additionally blocked by #820 -- createPatientConsent
// 422s any manifestation with no signature, which is exactly what this page
// sends -- so the transport fix alone does not make acceptance work end to
// end. mapEConsentSubmitError distinguishes that case rather than hiding it
// behind the generic message.
export default function EConsentPage() {
  const { token } = useParams();
  const [patientName, setPatientName] = useState('Paciente');
  const [template, setTemplate] = useState<EConsentTemplate | null>(null);
  const [consents, setConsents] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      if (!token) {
        setError(mapEConsentError(400));
        setLoading(false);
        return;
      }

      try {
        const resp = await eConsentService.validate(token);
        if (cancelled) return;

        const snapshot = normalizeEConsentSnapshot(resp.data);
        setPatientName(snapshot.patientName);
        setTemplate(snapshot.template);
        setConsents(snapshot.responses);
      } catch (err) {
        if (cancelled) return;
        setError(mapEConsentError((err as { response?: { status?: number } })?.response?.status));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function handleConsentChange(key: string, value: boolean) {
    setConsents((c) => ({ ...c, [key]: value }));
  }

  async function submitConsents(nextConsents: Record<string, boolean>) {
    if (!template || !token) return;
    try {
      await eConsentService.update(token, buildConsentUpdatePayload(template, nextConsents));
      setSuccess(true);
    } catch (err) {
      setError(
        mapEConsentSubmitError((err as { response?: { status?: number } })?.response?.status)
      );
    }
  }

  if (loading) return <div data-testid="e-consent-loading">Carregando...</div>;
  if (error) return <div data-testid="e-consent-error" style={{ color: 'red' }}>{error}</div>;
  if (success) return <div data-testid="e-consent-success">Consentimento atualizado com sucesso!</div>;
  if (!template) return <div data-testid="e-consent-no-template">Nenhum termo de consentimento ativo no momento.</div>;

  return (
    <div style={{ maxWidth: 500, margin: 'auto', padding: 24 }}>
      <h2>Consentimento Eletrônico</h2>
      <p data-testid="e-consent-patient">Bem-vindo, {patientName}!</p>
      <h4>Política de Privacidade e TCLE</h4>
      <p>Leia atentamente a política de privacidade e o Termo de Consentimento Livre e Esclarecido (TCLE) abaixo.</p>
      <div style={{ background: '#f7f7f7', padding: 12, borderRadius: 8, marginBottom: 16 }}>
        {/* Aqui pode-se renderizar o texto do TCLE/política */}
        <p>Seus dados serão tratados conforme a LGPD. Você pode aceitar ou revogar cada camada de consentimento abaixo a qualquer momento.</p>
      </div>
      <form data-testid="e-consent-permissions" onSubmit={e => { e.preventDefault(); submitConsents(consents); }}>
        {template.permissions.map(permission => (
          <div key={permission.key} style={{ marginBottom: 12 }}>
            <label>
              <input
                type="checkbox"
                checked={!!consents[permission.key]}
                onChange={e => handleConsentChange(permission.key, e.target.checked)}
              />
              {permission.label}
            </label>
          </div>
        ))}
        <button data-testid="e-consent-submit" type="submit">Salvar Consentimento</button>
      </form>
      <div style={{ marginTop: 24 }}>
        <button data-testid="e-consent-revoke-all" style={{ color: 'red' }} onClick={() => {
          const revoked = buildRevokeAllAnswers(template);
          setConsents(revoked);
          submitConsents(revoked);
        }}>Revogar Todos</button>
      </div>
    </div>
  );
}
