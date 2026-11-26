import { useEffect, useState } from 'react';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import ListPagination from '../components/UI/ListPagination';
import { useOrganizations } from '../hooks/useOrganizations';
import { LIST_PAGE_SIZE, useClientPagination } from '../hooks/useClientPagination';
import { accessRequestService, consentService } from '../services/api';
import type {
  AccessCheck,
  AccessRequest,
  AccessRequestItemType,
  PurposeCode,
} from '../types/models';

/**
 * RF024 (#1350): the screens for access and distribution requests. AC1's
 * registration form, and the committee's view of one request: AC2/AC3's
 * evaluation per item with its ConsentAuthorizationDecision and the
 * AccessPolicy effect, the decision with its validity, the distribution
 * (AC5) and the revocation (AC6). The rules stay on the backend; this page
 * only sends what the operator chose and shows what came back.
 */

export const ITEM_TYPES: AccessRequestItemType[] = ['specimen', 'dataset', 'file'];
export const DECISION_INPUTS = ['approved', 'rejected', 'conditioned'] as const;

export interface RequestItemDraft {
  itemType: AccessRequestItemType;
  itemId: string;
}

export interface AccessRequestFormState {
  requesterId: string;
  organizationId: string;
  studyId: string;
  protocolId: string;
  requestedPurpose: string;
  duoCode: string;
  items: RequestItemDraft[];
}

export const EMPTY_REQUEST_FORM: AccessRequestFormState = {
  requesterId: '',
  organizationId: '',
  studyId: '',
  protocolId: '',
  requestedPurpose: '',
  duoCode: '',
  items: [{ itemType: 'specimen', itemId: '' }],
};

/**
 * The body of POST /api/access-requests (AccessRequestModel.validate): an
 * item with no id is dropped, and no DUO code is sent as absent, never as an
 * empty string.
 */
export function buildAccessRequestPayload(form: AccessRequestFormState): Record<string, unknown> {
  const duoCode = form.duoCode.trim();
  return {
    requesterId: form.requesterId.trim(),
    organizationId: form.organizationId,
    studyId: form.studyId.trim(),
    protocolId: form.protocolId.trim(),
    requestedPurpose: form.requestedPurpose.trim(),
    ...(duoCode ? { duoCode } : {}),
    requestedItems: form.items
      .map((item) => ({ itemType: item.itemType, itemId: item.itemId.trim() }))
      .filter((item) => item.itemId !== ''),
  };
}

export interface DecisionFormState {
  status: (typeof DECISION_INPUTS)[number];
  justification: string;
  start: string;
  end: string;
}

export const EMPTY_DECISION_FORM: DecisionFormState = { status: 'approved', justification: '', start: '', end: '' };

/**
 * The body of POST .../decision (AccessRequestModel.validateDecision). A
 * rejection carries no validity; an approval's period runs from the start of
 * its first day to the end of its last, so the end date is still in force.
 */
export function buildDecisionPayload(form: DecisionFormState): Record<string, unknown> {
  const payload: Record<string, unknown> = { status: form.status, justification: form.justification.trim() };
  if (form.status !== 'rejected' && form.start) {
    payload.approvalPeriod = {
      start: new Date(`${form.start}T00:00:00`).toISOString(),
      ...(form.end ? { end: new Date(`${form.end}T23:59:59`).toISOString() } : {}),
    };
  }
  return payload;
}

const ACCESS_REASONS: Record<string, string> = {
  pending: 'Aguardando decisão do comitê',
  denied: 'Negado pelo comitê',
  revoked: 'Acesso revogado',
  incompatible: 'Incompatível com consentimento, DUO ou estudo',
  policy_denied: 'Negado pela política de acesso',
  expired: 'Aprovação expirada',
  not_yet_active: 'Aprovação ainda não vigente',
  approved: 'Aprovado',
  conditioned: 'Aprovado com condições',
};

/** AC6: what the access check answered, in words. */
export function describeAccessCheck(check: AccessCheck | null): string {
  if (!check) return '-';
  const reason = ACCESS_REASONS[check.reason] || check.reason;
  return check.allowed ? `Liberado: ${reason}` : `Bloqueado: ${reason}`;
}

function errorMessage(err: any, fallback: string): string {
  const data = err?.response?.data;
  return data?.message || data?.error || err?.message || fallback;
}

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('pt-BR') : '-';
}

function yesNo(value: boolean | null): string {
  if (value === null || value === undefined) return 'n/a';
  return value ? 'sim' : 'não';
}

function AccessRequestDetail({ accessRequest, onChanged }: { accessRequest: AccessRequest; onChanged: (updated: AccessRequest) => void }) {
  const [check, setCheck] = useState<AccessCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decisionForm, setDecisionForm] = useState<DecisionFormState>(EMPTY_DECISION_FORM);
  const [revokeJustification, setRevokeJustification] = useState('');
  const id = accessRequest.accessRequestId;

  const loadCheck = async () => {
    try {
      const response = await accessRequestService.accessCheck(id);
      setCheck(response.data.data ?? null);
    } catch {
      setCheck(null);
    }
  };

  useEffect(() => {
    loadCheck();
  }, [id, accessRequest.committeeDecision.status, accessRequest.overallCompatible, accessRequest.distributionStatus]);

  const run = async (action: () => Promise<{ data: { data?: AccessRequest } }>) => {
    try {
      const response = await action();
      setError(null);
      if (response.data.data) onChanged(response.data.data);
      return true;
    } catch (err: any) {
      setError(errorMessage(err, 'Erro na solicitação de acesso'));
      return false;
    }
  };

  const submitDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() => accessRequestService.decide(id, buildDecisionPayload(decisionForm)));
    if (ok) setDecisionForm(EMPTY_DECISION_FORM);
  };

  const submitRevoke = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() => accessRequestService.revoke(id, { justification: revokeJustification.trim() }));
    if (ok) setRevokeJustification('');
  };

  const decision = accessRequest.committeeDecision;
  const decided = decision.status === 'approved' || decision.status === 'conditioned';

  return (
    <section className="card" data-testid="access-request-detail">
      <h3>Solicitação {id}</h3>
      {error && <p role="alert" data-testid="access-request-detail-error" style={{ color: 'var(--danger)' }}>{error}</p>}
      <dl>
        <div><dt>Solicitante</dt><dd>{accessRequest.requesterId}</dd></div>
        <div><dt>Estudo</dt><dd>{accessRequest.studyId}</dd></div>
        <div><dt>Protocolo</dt><dd>{accessRequest.protocolId} {accessRequest.protocolVersion ? `(v${accessRequest.protocolVersion})` : ''}</dd></div>
        <div><dt>Finalidade</dt><dd>{accessRequest.requestedPurpose}</dd></div>
        <div><dt>Finalidade (DUO)</dt><dd data-testid="access-request-duo">{accessRequest.duoCode || '-'}</dd></div>
      </dl>
      <p data-testid="access-request-access-check"><strong>Acesso:</strong> {describeAccessCheck(check)}</p>

      <h4>Avaliação (RF024 AC2/AC3)</h4>
      <Button type="button" variant="secondary" data-testid="access-request-evaluate"
        onClick={() => run(() => accessRequestService.evaluate(id))}>
        Avaliar compatibilidade
      </Button>
      {accessRequest.compatibilityEvaluatedAt ? (
        <>
          <p data-testid="access-request-overall">
            Avaliada em {formatDate(accessRequest.compatibilityEvaluatedAt)}: {accessRequest.overallCompatible ? 'compatível' : 'incompatível'}
          </p>
          <table className="table" data-testid="access-request-compatibility">
            <thead>
              <tr>
                <th>Item</th>
                <th>Participante</th>
                <th>Consentimento</th>
                <th>Motivos</th>
                <th>DUO</th>
                <th>Estudo ativo</th>
                <th>Compatível</th>
              </tr>
            </thead>
            <tbody>
              {accessRequest.consentCompatibility.map((entry) => (
                <tr key={entry.itemId} data-testid={`access-request-item-${entry.itemId}`}>
                  <td>{entry.itemType}: {entry.itemId}</td>
                  <td>{entry.participantId || '-'}</td>
                  <td data-testid={`access-request-item-result-${entry.itemId}`}>{entry.consentAuthorizationResult || yesNo(entry.consentValid)}</td>
                  <td>{entry.consentAuthorizationReasons.join('; ') || '-'}</td>
                  <td>{yesNo(entry.duoCompatible)}</td>
                  <td>{yesNo(entry.studyActive)}</td>
                  <td>{yesNo(entry.compatible)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {accessRequest.policyDecision && (
            <p data-testid="access-request-policy">
              <strong>Política de acesso:</strong> <span data-testid="access-request-policy-effect">{accessRequest.policyDecision.effect}</span>
              {accessRequest.policyDecision.reasons.length ? ` (${accessRequest.policyDecision.reasons.join('; ')})` : ''}
            </p>
          )}
        </>
      ) : (
        <p>Ainda não avaliada.</p>
      )}

      <h4>Decisão do comitê (RF024 AC3/AC4)</h4>
      <p data-testid="access-request-decision-status">
        {decision.status}
        {decision.decidedAt ? ` em ${formatDate(decision.decidedAt)}` : ''}
        {decision.justification ? `: ${decision.justification}` : ''}
        {decision.policyVersion ? ` (política ${decision.policyVersion})` : ''}
      </p>
      {decision.status === 'pending' && (
        <form onSubmit={submitDecision} className="form" data-testid="access-decision-form">
          <div className="form-grid">
            <div className="form-grid-full">
              <label className="input-label" htmlFor="accessDecisionStatus">Decisão</label>
              <select id="accessDecisionStatus" className="input" data-testid="access-decision-status-select"
                value={decisionForm.status}
                onChange={(e) => setDecisionForm({ ...decisionForm, status: e.target.value as DecisionFormState['status'] })}>
                <option value="approved">Aprovar</option>
                <option value="conditioned">Aprovar com condições</option>
                <option value="rejected">Rejeitar</option>
              </select>
            </div>
            <Input label="Justificativa" data-testid="access-decision-justification-input" value={decisionForm.justification}
              onChange={(e) => setDecisionForm({ ...decisionForm, justification: e.target.value })} required />
            {decisionForm.status !== 'rejected' && (
              <>
                <Input label="Início da vigência" type="date" data-testid="access-decision-start-input" value={decisionForm.start}
                  onChange={(e) => setDecisionForm({ ...decisionForm, start: e.target.value })} />
                <Input label="Fim da vigência" type="date" data-testid="access-decision-end-input" value={decisionForm.end}
                  onChange={(e) => setDecisionForm({ ...decisionForm, end: e.target.value })} />
              </>
            )}
          </div>
          <div className="form-actions">
            <Button type="submit" data-testid="access-decision-submit">Registrar decisão</Button>
          </div>
        </form>
      )}

      <h4>Disponibilização (RF024 AC5)</h4>
      <p data-testid="access-request-distribution-status">
        {accessRequest.distributionStatus === 'released'
          ? `Disponibilizada em ${formatDate(accessRequest.distributedAt)} pela decisão ${accessRequest.distributionDecisionId}`
          : 'Não disponibilizada'}
      </p>
      {decided && accessRequest.distributionStatus !== 'released' && (
        <Button type="button" data-testid="access-request-distribute" onClick={() => run(() => accessRequestService.distribute(id))}>
          Disponibilizar
        </Button>
      )}

      {decided && (
        <form onSubmit={submitRevoke} className="form" data-testid="access-revoke-form">
          <h4>Revogar acesso (RF024 AC6)</h4>
          <Input label="Justificativa da revogação" data-testid="access-revoke-justification-input" value={revokeJustification}
            onChange={(e) => setRevokeJustification(e.target.value)} required />
          <div className="form-actions">
            <Button type="submit" variant="secondary" data-testid="access-request-revoke">Revogar</Button>
          </div>
        </form>
      )}
    </section>
  );
}

export default function AccessRequestsPage() {
  const { organizations } = useOrganizations();
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [purposeCodes, setPurposeCodes] = useState<PurposeCode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<AccessRequestFormState>(EMPTY_REQUEST_FORM);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const response = await accessRequestService.getAll();
      setRequests(Array.isArray(response.data.data) ? response.data.data : []);
      setError(null);
    } catch (err: any) {
      setError(errorMessage(err, 'Erro ao carregar as solicitações de acesso'));
    }
  };

  useEffect(() => {
    load();
    let active = true;
    // The DUO purposes a request may name, as the TCLE builder lists them.
    consentService.getPurposeCodes()
      .then((response) => { if (active) setPurposeCodes(Array.isArray(response.data?.data) ? response.data.data : []); })
      .catch(() => { if (active) setPurposeCodes([]); });
    return () => { active = false; };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await accessRequestService.create(buildAccessRequestPayload(form));
      const created = response.data.data;
      setForm(EMPTY_REQUEST_FORM);
      setError(null);
      await load();
      if (created) setSelectedId(created.accessRequestId);
    } catch (err: any) {
      setError(errorMessage(err, 'Erro ao registrar a solicitação de acesso'));
    }
  };

  const setItem = (index: number, patch: Partial<RequestItemDraft>) =>
    setForm({ ...form, items: form.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) });

  const replaceRequest = (updated: AccessRequest) =>
    setRequests((current) => current.map((item) => (item.accessRequestId === updated.accessRequestId ? updated : item)));

  const selected = requests.find((item) => item.accessRequestId === selectedId) || null;
  const listPagination = useClientPagination(requests, LIST_PAGE_SIZE);

  return (
    <div className="page-shell access-requests-page">
      <div className="page-header">
        <h1 className="page-title">Solicitações de acesso e distribuição</h1>
        <p className="page-subtitle">
          Registrar pedidos de acesso a espécimes ou conjuntos de dados, avaliar compatibilidade de consentimento e disponibilizar ou revogar o uso.
        </p>
      </div>
      {error && <p role="alert" data-testid="access-requests-error" style={{ color: 'var(--danger)' }}>{error}</p>}

      <section className="card">
        <h3>Nova solicitação</h3>
        <form onSubmit={submit} className="form" data-testid="access-request-form">
          <div className="form-grid">
            <Input label="Solicitante" data-testid="access-request-requester-input" value={form.requesterId}
              onChange={(e) => setForm({ ...form, requesterId: e.target.value })} required />
            <div>
              <label className="input-label" htmlFor="accessRequestOrganization">Organização</label>
              <select id="accessRequestOrganization" className="input" data-testid="access-request-organization-select"
                value={form.organizationId} onChange={(e) => setForm({ ...form, organizationId: e.target.value })} required>
                <option value="">Selecione a organização</option>
                {organizations.map((org) => (
                  <option key={org.organizationId} value={org.organizationId}>{org.officialName}</option>
                ))}
              </select>
            </div>
            <Input label="Estudo" data-testid="access-request-study-input" value={form.studyId}
              onChange={(e) => setForm({ ...form, studyId: e.target.value })} required />
            <Input label="Protocolo" data-testid="access-request-protocol-input" value={form.protocolId}
              onChange={(e) => setForm({ ...form, protocolId: e.target.value })} required />
            <div className="form-grid-full">
              <Input label="Finalidade" data-testid="access-request-purpose-input" value={form.requestedPurpose}
                onChange={(e) => setForm({ ...form, requestedPurpose: e.target.value })} required />
            </div>
            <div className="form-grid-full">
              <label className="input-label" htmlFor="accessRequestDuo">Finalidade (DUO)</label>
              <select id="accessRequestDuo" className="input" data-testid="access-request-duo-select"
                value={form.duoCode} onChange={(e) => setForm({ ...form, duoCode: e.target.value })}>
                <option value="">Nenhuma</option>
                {purposeCodes.map((purpose) => (
                  <option key={purpose.code} value={purpose.code}>{purpose.code} - {purpose.display}</option>
                ))}
              </select>
            </div>
          </div>

          <h4>Itens solicitados</h4>
          {form.items.map((item, index) => (
            <div className="form-grid" key={index}>
              <div>
                <label className="input-label" htmlFor={`accessRequestItemType${index}`}>Tipo</label>
                <select id={`accessRequestItemType${index}`} className="input" data-testid={`access-request-item-type-${index + 1}`}
                  value={item.itemType} onChange={(e) => setItem(index, { itemType: e.target.value as AccessRequestItemType })}>
                  <option value="specimen">Espécime</option>
                  <option value="dataset">Conjunto de dados</option>
                  <option value="file">Arquivo</option>
                </select>
              </div>
              <Input label="Identificador do item" data-testid={`access-request-item-id-${index + 1}`} value={item.itemId}
                onChange={(e) => setItem(index, { itemId: e.target.value })} required={index === 0} />
            </div>
          ))}
          <div className="form-actions">
            <Button type="button" variant="secondary" data-testid="access-request-add-item"
              onClick={() => setForm({ ...form, items: [...form.items, { itemType: 'specimen', itemId: '' }] })}>
              Adicionar item
            </Button>
            <Button type="submit" data-testid="access-request-submit">Registrar solicitação</Button>
          </div>
        </form>
      </section>

      <section className="card">
        <h3>Solicitações</h3>
        {requests.length === 0 ? (
          <p>Nenhuma solicitação registrada.</p>
        ) : (
          <>
            <table className="table" data-testid="access-requests-table">
              <thead>
                <tr>
                  <th>Solicitante</th>
                  <th>Estudo</th>
                  <th>Finalidade</th>
                  <th>Itens</th>
                  <th>Decisão</th>
                  <th>Disponibilização</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {listPagination.pagedItems.map((item) => (
                  <tr key={item.accessRequestId} data-testid={`access-request-row-${item.accessRequestId}`}>
                    <td>{item.requesterId}</td>
                    <td>{item.studyId}</td>
                    <td>{item.requestedPurpose}</td>
                    <td>{item.requestedItems.length}</td>
                    <td>{item.committeeDecision.status}</td>
                    <td>{item.distributionStatus}</td>
                    <td>
                      <Button type="button" variant="secondary" data-testid={`access-request-open-${item.accessRequestId}`}
                        onClick={() => setSelectedId(item.accessRequestId)}>
                        Abrir
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ListPagination
              currentPage={listPagination.currentPage}
              totalPages={listPagination.totalPages}
              pageStart={listPagination.pageStart}
              pageEnd={listPagination.pageEnd}
              total={listPagination.total}
              onPageChange={listPagination.setCurrentPage}
              testIdPrefix="access-requests-pagination"
              emptyLabel="Nenhuma solicitação registrada"
            />
          </>
        )}
      </section>

      {selected && (
        <section className="card" data-testid="access-request-detail-panel">
          <AccessRequestDetail key={selected.accessRequestId} accessRequest={selected} onChanged={replaceRequest} />
        </section>
      )}
    </div>
  );
}
