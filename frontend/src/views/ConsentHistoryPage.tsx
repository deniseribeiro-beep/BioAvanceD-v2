import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import { consentService } from '../services/api';
import type { ConsentHistory, PatientConsent } from '../types/models';

/**
 * RF010 AC5/AC6 (#1375): the staff portal's view of a participant's consent.
 * It shows the derived state, what each permission still allows, the
 * decision events and the revocations, and records a revocation of the whole
 * consent or of chosen permissions. The rules stay on the backend; this page
 * only sends what the operator chose and shows what came back.
 */

const SCOPE_ALL = 'all';
const CONSENT_REFRESH_MS = 15_000;

const CHANNEL_LABELS: Record<string, string> = {
  paper: 'Presencial',
  electronic_link: 'Link do participante',
  staff_portal: 'Portal',
  fhir_import: 'Importação',
  term_expiry: 'Vencimento do termo',
};

const COMMUNICATION_LABELS: Record<string, string> = {
  'consent.panel_link.v1': 'Envio do link',
  'consent.revocation_confirmation.v1': 'Confirmação de revogação',
  'consent.term_expiry.v1': 'Aviso de encerramento',
  'consent.policy_change_notice.v1': 'Atualização do termo',
};

const STATE_LABELS: Record<string, string> = {
  active: 'Ativo',
  partially_revoked: 'Parcialmente revogado',
  revoked: 'Revogado',
  superseded: 'Substituído',
};

function errorMessages(err: any, fallback: string): string[] {
  const data = err?.response?.data;
  const message = data?.message || data?.error || err?.message || fallback;
  const details = Array.isArray(data?.details)
    ? data.details.map((item: any) => (typeof item === 'string' ? item : item?.message)).filter(Boolean)
    : [];
  return [message, ...details];
}

function formatDate(value: Date | string | null | undefined): string {
  return value ? new Date(value).toLocaleString('pt-BR') : '-';
}

function channelLabel(channel: string | null | undefined): string {
  if (!channel) return '-';
  return CHANNEL_LABELS[channel] || channel;
}

function locationLabel(location: { status?: string; latitude?: number; longitude?: number } | null | undefined): string {
  if (location?.status === 'captured' && location.latitude != null && location.longitude != null) {
    return `${location.latitude}, ${location.longitude}`;
  }
  return 'Localização não obtida';
}

export default function ConsentHistoryPage() {
  const [searchParams] = useSearchParams();
  const initialParticipantId = searchParams.get('participantId') || '';
  const [participantId, setParticipantId] = useState(initialParticipantId);
  const [consent, setConsent] = useState<PatientConsent | null>(null);
  const [history, setHistory] = useState<ConsentHistory | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [reason, setReason] = useState('');

  const applyLoaded = (loadedConsent: PatientConsent, loadedHistory: ConsentHistory) => {
    setConsent(loadedConsent);
    setHistory(loadedHistory);
    setNotFound(false);
  };

  const load = async (targetParticipantId: string) => {
    const trimmed = targetParticipantId.trim();
    if (!trimmed) return;
    setLoading(true);
    setNotFound(false);
    setErrors([]);
    try {
      const consentResponse = await consentService.getPatientConsent(trimmed);
      const loadedConsent = consentResponse.data.data;
      const historyResponse = await consentService.getConsentHistory(String(loadedConsent._id));
      applyLoaded(loadedConsent, historyResponse.data.data);
      setSelectedCodes([]);
    } catch (err: any) {
      setConsent(null);
      setHistory(null);
      if (err?.response?.status === 404) setNotFound(true);
      else setErrors(errorMessages(err, 'Erro ao carregar o consentimento'));
    } finally {
      setLoading(false);
    }
  };

  const refreshSilent = async (targetParticipantId: string) => {
    const trimmed = targetParticipantId.trim();
    if (!trimmed) return;
    try {
      const consentResponse = await consentService.getPatientConsent(trimmed);
      const loadedConsent = consentResponse.data.data;
      const historyResponse = await consentService.getConsentHistory(String(loadedConsent._id));
      applyLoaded(loadedConsent, historyResponse.data.data);
    } catch {
      // A missed refresh keeps the trace already on screen.
    }
  };

  useEffect(() => {
    if (initialParticipantId) load(initialParticipantId);
    // Loads once, from the URL the page was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const tracked = (consent?.participantId || (initialParticipantId && consent ? initialParticipantId : '')).trim();
    if (!tracked) return undefined;
    let intervalId = 0;
    const stop = () => window.clearInterval(intervalId);
    const start = () => {
      stop();
      intervalId = window.setInterval(() => {
        if (!document.hidden) void refreshSilent(tracked);
      }, CONSENT_REFRESH_MS);
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
        return;
      }
      void refreshSilent(tracked);
      start();
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // The interval follows the consent on screen, not each keystroke in the search box.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consent?.participantId]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    load(participantId);
  };

  const permissions = history?.permissions || [];
  const labelOf = (code: string): string => {
    if (code === SCOPE_ALL) return 'Todos os usos';
    const row = permissions.find((permission) => permission.permissionCode === code);
    return row?.purpose?.display || code;
  };
  const isPermitted = (code: string): boolean => {
    if (consent?.effectivePermissions && code in consent.effectivePermissions) {
      return consent.effectivePermissions[code] === true;
    }
    return consent?.responses?.[code] === true;
  };
  const permittedCodes = permissions.map((row) => row.permissionCode).filter(isPermitted);
  const state = history?.currentStateDerived || consent?.currentStateDerived;
  const canRevoke = state === 'active' || state === 'partially_revoked';

  const toggleCode = (code: string) => {
    setSelectedCodes((current) => (current.includes(code)
      ? current.filter((item) => item !== code)
      : [...current, code]));
  };

  // No scope revokes the whole consent: the backend reads it as `all`.
  const revoke = async (selection: { scope?: string[] }) => {
    if (!consent?._id) return;
    if (!window.confirm('A revogação é irreversível. Deseja continuar?')) return;
    const request: { scope?: string[]; reason?: string } = { ...selection };
    if (reason.trim()) request.reason = reason.trim();
    setSubmitting(true);
    setErrors([]);
    setNotice(null);
    try {
      await consentService.revokeConsent(consent._id, request);
      // The checkboxes come from the consent's effectivePermissions, which the
      // history does not carry: reload both.
      await load(consent.participantId || participantId);
      setReason('');
      setNotice('Revogação registrada.');
    } catch (err: any) {
      setErrors(errorMessages(err, 'Erro ao revogar o consentimento'));
    } finally {
      setSubmitting(false);
    }
  };

  const openSignedTcle = async (download: boolean) => {
    if (!consent?._id) return;
    setErrors([]);
    try {
      const response = await consentService.getSignedTcle(consent._id);
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
    } catch (err: any) {
      setErrors(errorMessages(err, 'Erro ao abrir o termo assinado'));
    }
  };

  return (
    <div className="page-shell consent-history-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Consentimentos (TCLE)</h1>
          <p className="page-subtitle">Estado, histórico e termo assinado do participante</p>
          {consent?.participantId && (
            <p className="page-subtitle" data-testid="consent-participant-id">Participante {consent.participantId}</p>
          )}
        </div>
      </div>

      <section className="card-surface">
        <form onSubmit={search} className="form" data-testid="consent-search-form">
          <Input label="ID do participante" data-testid="consent-participant-input" value={participantId}
            onChange={(e) => setParticipantId(e.target.value)} required />
          <div className="form-actions">
            <Button type="submit" data-testid="consent-search-button" disabled={loading}>Buscar</Button>
          </div>
        </form>
      </section>

      {errors.length > 0 && (
        <div role="alert" data-testid="consent-error" style={{ color: 'var(--danger)' }}>
          <p>{errors[0]}</p>
          {errors.length > 1 && (
            <ul>
              {errors.slice(1).map((message, index) => <li key={index}>{message}</li>)}
            </ul>
          )}
        </div>
      )}
      {notice && <p role="status" data-testid="consent-notice">{notice}</p>}
      {notFound && <p data-testid="consent-not-found">Nenhum consentimento encontrado para este participante.</p>}

      {consent && history && (
        <>
          <section className="card-surface" data-testid="signed-tcle-card">
            <h3 className="text-base font-semibold text-foreground">Termo assinado</h3>
            <p className="mt-2 text-sm text-muted-foreground">Assinado em {formatDate(consent.signedAt)}</p>
            {consent.signedTcleDocumentUri ? (
              <div className="form-actions">
                <Button type="button" data-testid="view-signed-tcle" onClick={() => { void openSignedTcle(false); }}>Ver</Button>
                <Button type="button" variant="secondary" data-testid="download-signed-tcle" onClick={() => { void openSignedTcle(true); }}>Baixar</Button>
              </div>
            ) : (
              <p className="mt-3 text-sm" data-testid="signed-tcle-missing">Não há termo assinado em arquivo.</p>
            )}
          </section>

          <section className="card-surface">
            <h3 className="mb-3 text-base font-semibold text-foreground">Estado do consentimento</h3>
            <p>Estado: <strong data-testid="consent-state">{STATE_LABELS[state || ''] || state}</strong></p>
            <table className="table" data-testid="consent-permissions">
              <thead>
                <tr><th>Permissão</th><th>Permitida</th></tr>
              </thead>
              <tbody>
                {permissions.map((row) => (
                  <tr key={row.permissionCode} data-testid={`consent-permission-${row.permissionCode}`}>
                    <td>{labelOf(row.permissionCode)}</td>
                    <td>{isPermitted(row.permissionCode) ? 'sim' : 'não'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card-surface">
            <h3 className="mb-3 text-base font-semibold text-foreground">Histórico de decisões</h3>
            <table className="table" data-testid="consent-decision-events">
              <thead>
                <tr><th>Data</th><th>Decisão</th><th>Canal</th><th>Papel do signatário</th></tr>
              </thead>
              <tbody>
                {history.decisionEvents.map((event) => (
                  <tr key={event.consentDecisionEventId}>
                    <td>{formatDate(event.occurredAt)}</td>
                    <td>{event.decision}</td>
                    <td>{event.channel}</td>
                    <td>{event.signerRole}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card-surface">
            <h3 className="mb-3 text-base font-semibold text-foreground">Revogações</h3>
            <table className="table" data-testid="consent-revocations">
              <thead>
                <tr><th>Vigência</th><th>Canal</th><th>Escopo</th><th>Motivo</th><th>Localização</th><th>Uso anterior</th></tr>
              </thead>
              <tbody>
                {history.revocations.length === 0 && (
                  <tr><td colSpan={6}>Nenhuma revogação registrada.</td></tr>
                )}
                {history.revocations.map((revocation) => (
                  <tr key={revocation.consentRevocationId} data-testid={`consent-revocation-${revocation.consentRevocationId}`}>
                    <td>{formatDate(revocation.effectiveAt)}</td>
                    <td>{channelLabel(revocation.channel)}</td>
                    <td>{(revocation.scope || []).map(labelOf).join(', ')}</td>
                    <td>{revocation.reason || '-'}</td>
                    <td>{locationLabel(revocation.location)}</td>
                    <td>{revocation.priorUseDisposition || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card-surface">
            <h3 className="mb-3 text-base font-semibold text-foreground">Comunicações</h3>
            <table className="table" data-testid="consent-communications">
              <thead>
                <tr><th>Data</th><th>Comunicação</th><th>Situação</th></tr>
              </thead>
              <tbody>
                {(history.communications || []).length === 0 && (
                  <tr><td colSpan={3}>Nenhuma comunicação registrada.</td></tr>
                )}
                {(history.communications || []).map((event) => (
                  <tr key={event.consentCommunicationEventId} data-testid={`consent-communication-${event.contentTemplateId}`}>
                    <td>{formatDate(event.sentAt)}</td>
                    <td>{COMMUNICATION_LABELS[event.contentTemplateId] || event.communicationType}</td>
                    <td>{event.deliveryStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {canRevoke && (
            <section className="card-surface" data-testid="consent-revoke-form">
              <h3 className="mb-3 text-base font-semibold text-foreground">Revogar consentimento</h3>
              {permittedCodes.map((code) => (
                <label key={code} style={{ display: 'block' }}>
                  <input
                    type="checkbox"
                    data-testid={`revoke-scope-${code}`}
                    checked={selectedCodes.includes(code)}
                    onChange={() => toggleCode(code)}
                  />{' '}
                  {labelOf(code)}
                </label>
              ))}
              <label className="input-label" htmlFor="consentRevokeReason">Motivo</label>
              <textarea id="consentRevokeReason" className="input" data-testid="revoke-reason-input"
                value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="form-actions">
                <Button type="button" variant="danger" data-testid="revoke-selected-button"
                  disabled={submitting || selectedCodes.length === 0}
                  onClick={() => revoke({ scope: selectedCodes })}>
                  Revogar permissões selecionadas
                </Button>
                <Button type="button" variant="danger" data-testid="revoke-all-button"
                  disabled={submitting}
                  onClick={() => revoke({})}>
                  Revogar consentimento inteiro
                </Button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
