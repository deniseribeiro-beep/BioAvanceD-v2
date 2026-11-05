import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { consentTokenService } from '../../services/api';
import {
  ConsentTokenTemplate,
  initialConsentResponses,
  mapConsentTokenRequestError,
  missingRequiredPermissions,
  normalizeConsentTemplate,
  resolveConsentTokenParams,
} from '../../views/consentTokenView';

// #809: the participant-facing page for the bulk consent-token system.
//
// This is NOT the same flow as EConsentPage (`/patient/e-consent/:token`),
// which serves the manual JWT link from POST /api/e-consent/generate-link
// (2h TTL, one participant at a time). This page serves the opaque 64-char
// hex token minted by NotificationService.buildConsentMetadata (7-day TTL),
// which is what every bulk invitation actually carries: template publication,
// both LGPD import paths, the CSV/FHIR import, patient creation and
// resendConsentNotification. Its backend
// (POST /api/e-consent/consent-tokens/{validate,accept}) existed with no
// caller until this page.
//
// The two systems are deliberately left separate -- whether they should
// converge is Denise's call, recorded on #809.
//
// #821: acceptance is a granular manifestation (RF010). The participant
// answers each purpose; required ones must be accepted before the button
// enables. The accept call carries the term id shown here and those answers,
// and the backend records them as a Consent (consentId, exact term version,
// evidence, outbox event) before activating the participant.
export default function ConsentTokenPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const tokenParam = searchParams.get('token');

  const params = useMemo(() => resolveConsentTokenParams(id, tokenParam), [id, tokenParam]);

  const [template, setTemplate] = useState<ConsentTokenTemplate | null>(null);
  const [responses, setResponses] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (!params.ok) {
      setError(params.message);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const { participantId, token } = params;

    async function validate() {
      try {
        const resp = await consentTokenService.validate(participantId, token);
        if (cancelled) return;
        const normalized = normalizeConsentTemplate(resp.data?.data?.template);
        setTemplate(normalized);
        setResponses(normalized ? initialConsentResponses(normalized.permissions) : {});
      } catch (err: any) {
        if (cancelled) return;
        setError(mapConsentTokenRequestError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    validate();
    return () => {
      cancelled = true;
    };
  }, [params]);

  async function acceptConsent() {
    // The accept button renders only with a loaded template and no error, and an
    // invalid link always sets an error; this guard only narrows params and
    // template for the type checker (#1445).
    if (!params.ok || !template) return;
    setSubmitting(true);
    setError('');
    try {
      await consentTokenService.accept(params.participantId, params.token, {
        consentTemplateId: template.id,
        responses,
      });
      setAccepted(true);
    } catch (err: any) {
      setError(mapConsentTokenRequestError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div style={{ padding: 24 }}>Carregando...</div>;

  if (accepted) {
    return (
      <div style={{ maxWidth: 640, margin: 'auto', padding: 24 }}>
        <h2>Consentimento confirmado</h2>
        <p data-testid="consent-token-success">
          Obrigado. Seu aceite foi confirmado e este link não pode mais ser utilizado.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: 640, margin: 'auto', padding: 24 }}>
        <h2>Consentimento Eletrônico</h2>
        <p data-testid="consent-token-error" style={{ color: '#b00020' }}>{error}</p>
      </div>
    );
  }

  if (!template) {
    return (
      <div style={{ maxWidth: 640, margin: 'auto', padding: 24 }}>
        <h2>Consentimento Eletrônico</h2>
        <p data-testid="consent-token-no-template">
          Nenhum termo de consentimento está ativo no momento. Tente novamente mais tarde ou
          entre em contato com a equipe do biobanco.
        </p>
      </div>
    );
  }

  const missingRequired = missingRequiredPermissions(template.permissions, responses);

  return (
    <div style={{ maxWidth: 640, margin: 'auto', padding: 24 }}>
      <h2>Consentimento Eletrônico</h2>
      <h3 data-testid="consent-token-title">{template.title}</h3>
      {template.version && (
        <p style={{ color: '#555', fontSize: 14 }}>Versão {template.version}</p>
      )}

      <div
        data-testid="consent-token-content"
        style={{
          background: '#f7f7f7',
          padding: 16,
          borderRadius: 8,
          margin: '16px 0',
          whiteSpace: 'pre-wrap',
        }}
      >
        {template.content}
      </div>

      {template.permissions.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h4>Finalidades cobertas por este termo</h4>
          <ul data-testid="consent-token-permissions" style={{ listStyle: 'none', paddingLeft: 0 }}>
            {template.permissions.map(permission => (
              <li key={permission.key}>
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
              </li>
            ))}
          </ul>
        </div>
      )}

      {missingRequired.length > 0 && (
        <p data-testid="consent-token-required-hint" style={{ color: '#555', fontSize: 14 }}>
          Para aceitar o termo, marque as finalidades obrigatórias: {missingRequired.join(', ')}.
        </p>
      )}

      <button
        type="button"
        data-testid="consent-token-accept"
        onClick={acceptConsent}
        disabled={submitting || missingRequired.length > 0}
      >
        {submitting ? 'Enviando...' : 'Aceitar o termo'}
      </button>
    </div>
  );
}
