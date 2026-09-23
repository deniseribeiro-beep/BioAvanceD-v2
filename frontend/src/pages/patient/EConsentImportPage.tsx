import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ImportConsentPayload, eConsentService } from '../../services/api';
import { mapEConsentError, mapEConsentRequestError, mapEConsentSubmitRequestError } from '../../views/eConsentView';

// #822: same defect and same fix as EConsentPage -- this page called raw axios
// with a relative `/api/...` URL, which resolves against the frontend origin
// where nothing proxies /api, so both requests returned the SPA's index.html
// with a 200 and the page rendered its generic "link inválido" message. It now
// uses the shared `api` client, and both of its routes are in
// TOKEN_OPTIONAL_ROUTES so the client's no-session interceptor doesn't bounce
// the participant to /login.
export default function EConsentImportPage() {
  const { token } = useParams();
  const [data, setData] = useState<ImportConsentPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!token) {
        setError(mapEConsentError(400));
        setLoading(false);
        return;
      }

      try {
        const resp = await eConsentService.validateImportConsent(token);
        if (!cancelled) setData(resp.data);
      } catch (err) {
        if (!cancelled) {
          setError(mapEConsentRequestError(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function acceptConsent() {
    if (!token || submitting) return;
    setSubmitting(true);
    try {
      const resp = await eConsentService.acceptImportConsent(token);
      setData(resp.data);
      setSuccess(true);
    } catch (err) {
      setError(
        mapEConsentSubmitRequestError(err)
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div>Carregando...</div>;
  if (error) return <div style={{ color: 'red' }}>{error}</div>;
  if (success) return <div>Consentimento de importação assinado com sucesso!</div>;

  return (
    <div style={{ maxWidth: 560, margin: 'auto', padding: 24 }}>
      <h2>Consentimento de importação FHIR</h2>
      <p>Paciente: {data?.patientName || 'Paciente'}</p>
      <p>E-mail: {data?.patientEmail || 'Não informado'}</p>
      <p>Status atual: {data?.status || 'DESCONHECIDO'}</p>
      <button type="button" onClick={acceptConsent} disabled={submitting}>
        {submitting ? 'Enviando...' : 'Aceitar consentimento'}
      </button>
    </div>
  );
}
