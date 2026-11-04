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
      setConsent(loadedConsent);
      setHistory(historyResponse.data.data);
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

  useEffect(() => {
    if (initialParticipantId) load(initialParticipantId);
    // Loads once, from the URL the page was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <div className="page-shell consent-history-page">
      <div className="page-header">
        <h1>Consentimentos (TCLE)</h1>
      </div>

      <section className="card">
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
          <section className="card">
            <h3>Estado do consentimento</h3>
            <p>Estado: <strong data-testid="consent-state">{state}</strong></p>
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

          <section className="card">
            <h3>Histórico de decisões</h3>
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

          <section className="card">
            <h3>Revogações</h3>
            <table className="table" data-testid="consent-revocations">
              <thead>
                <tr><th>Vigência</th><th>Escopo</th><th>Motivo</th><th>Uso anterior</th></tr>
              </thead>
              <tbody>
                {history.revocations.length === 0 && (
                  <tr><td colSpan={4}>Nenhuma revogação registrada.</td></tr>
                )}
                {history.revocations.map((revocation) => (
                  <tr key={revocation.consentRevocationId}>
                    <td>{formatDate(revocation.effectiveAt)}</td>
                    <td>{(revocation.scope || []).map(labelOf).join(', ')}</td>
                    <td>{revocation.reason || '-'}</td>
                    <td>{revocation.priorUseDisposition || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {canRevoke && (
            <section className="card" data-testid="consent-revoke-form">
              <h3>Revogar consentimento</h3>
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
