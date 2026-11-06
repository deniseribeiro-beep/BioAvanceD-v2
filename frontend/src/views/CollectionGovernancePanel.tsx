import { useEffect, useState } from 'react';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import { useLanguage } from '../contexts/LanguageContext';
import { collectionGovernanceService } from '../services/api';
import type {
  Collection,
  CollectionGovernance,
  CollectionGovernanceApprovalStatus,
  Organization,
} from '../types/models';

type Regime = 'biobank' | 'biorepository';

// CollectionGovernanceApproval.js's STATUS_TRANSITIONS: revoked is final.
const APPROVAL_TRANSITIONS: Record<CollectionGovernanceApprovalStatus, CollectionGovernanceApprovalStatus[]> = {
  draft: ['active', 'revoked'],
  active: ['suspended', 'revoked'],
  suspended: ['active', 'revoked'],
  revoked: [],
};

export function nextApprovalStatuses(status: string): CollectionGovernanceApprovalStatus[] {
  return APPROVAL_TRANSITIONS[status as CollectionGovernanceApprovalStatus] ?? [];
}

function splitList(text: string): string[] {
  return text.split(';').map((item) => item.trim()).filter(Boolean);
}

function trimmedOrUndefined(text: string): string | undefined {
  const value = text.trim();
  return value === '' ? undefined : value;
}

export interface ApprovalFormState {
  authority: string;
  caae: string;
  documentUri: string;
  documentChecksum: string;
  effectiveStart: string;
  effectiveEnd: string;
  status: 'draft' | 'active';
  responsibleOrganizationId: string;
}

export const EMPTY_APPROVAL_FORM: ApprovalFormState = {
  authority: '',
  caae: '',
  documentUri: '',
  documentChecksum: '',
  effectiveStart: '',
  effectiveEnd: '',
  status: 'draft',
  responsibleOrganizationId: '',
};

/**
 * The body of POST .../governance/approvals (V2E-0067..0075): an absent CAAE
 * or end date is left out, since the model refuses an empty string for either.
 */
export function buildApprovalPayload(form: ApprovalFormState): Record<string, unknown> {
  const end = trimmedOrUndefined(form.effectiveEnd);
  return {
    authority: form.authority.trim(),
    caae: trimmedOrUndefined(form.caae),
    documentUri: form.documentUri.trim(),
    documentChecksum: form.documentChecksum.trim(),
    effectivePeriod: end ? { start: form.effectiveStart.trim(), end } : { start: form.effectiveStart.trim() },
    status: form.status,
    responsibleOrganizationId: form.responsibleOrganizationId,
  };
}

export interface GovernanceEventFormState {
  newRegime: Regime | '';
  justification: string;
  approvalIds: string[];
  // BiorepositoryContext (V2E-0076..0087)
  studyId: string;
  protocolId: string;
  protocolVersion: string;
  caae: string;
  responsibleOrganizationId: string;
  responsibleInvestigatorId: string;
  ethicsApprovalId: string;
  validityStart: string;
  validityEnd: string;
  plannedEndDate: string;
  closureCondition: string;
  // BiobankGovernanceContext (V2E-0088..0096)
  broadPurpose: string;
  governancePolicyId: string;
  accessCommitteeId: string;
  institutionalCustodianId: string;
  futureUseConditionsText: string;
  applicableConsentModels: string[];
  newEthicsReviewRule: string;
}

export function buildGovernanceEventFormState(regime: Regime | '' = ''): GovernanceEventFormState {
  return {
    newRegime: regime,
    justification: '',
    approvalIds: [],
    studyId: '',
    protocolId: '',
    protocolVersion: '',
    caae: '',
    responsibleOrganizationId: '',
    responsibleInvestigatorId: '',
    ethicsApprovalId: '',
    validityStart: '',
    validityEnd: '',
    plannedEndDate: '',
    closureCondition: '',
    broadPurpose: '',
    governancePolicyId: '',
    accessCommitteeId: '',
    institutionalCustodianId: '',
    futureUseConditionsText: '',
    applicableConsentModels: [],
    newEthicsReviewRule: '',
  };
}

/**
 * The body of POST .../governance/events (RF020 AC4): the context carries only
 * the new regime's own fields, so RULE-001/002's "the other absent" holds.
 */
export function buildGovernanceEventPayload(form: GovernanceEventFormState): Record<string, unknown> {
  let governanceContext: Record<string, unknown>;
  if (form.newRegime === 'biorepository') {
    const validityEnd = trimmedOrUndefined(form.validityEnd);
    governanceContext = {
      studyId: form.studyId.trim(),
      protocolId: form.protocolId.trim(),
      protocolVersion: form.protocolVersion.trim(),
      caae: form.caae.trim(),
      responsibleOrganizationId: form.responsibleOrganizationId,
      responsibleInvestigatorId: form.responsibleInvestigatorId.trim(),
      ethicsApprovalId: form.ethicsApprovalId,
      validityPeriod: validityEnd ? { start: form.validityStart.trim(), end: validityEnd } : { start: form.validityStart.trim() },
      plannedEndDate: trimmedOrUndefined(form.plannedEndDate),
      closureCondition: trimmedOrUndefined(form.closureCondition),
    };
  } else {
    governanceContext = {
      broadPurpose: { text: form.broadPurpose.trim() },
      governancePolicyId: form.governancePolicyId.trim(),
      accessCommitteeId: form.accessCommitteeId.trim(),
      institutionalCustodianId: form.institutionalCustodianId,
      futureUseConditions: splitList(form.futureUseConditionsText).map((text) => ({ text })),
      applicableConsentModel: form.applicableConsentModels,
      newEthicsReviewRule: form.newEthicsReviewRule,
    };
  }
  return {
    newRegime: form.newRegime || undefined,
    justification: form.justification.trim(),
    approvalIds: form.approvalIds,
    governanceContext,
  };
}

function errorMessage(err: any, fallback: string): string {
  const data = err?.response?.data;
  return data?.message || data?.error || err?.message || fallback;
}

const CONSENT_MODELS = ['specific', 'broad', 'tiered', 'dynamic'];

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (Array.isArray(value)) return value.map(formatValue).join('; ');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('text' in record || 'code' in record) return String(record.text ?? record.code);
    if ('start' in record) return `${record.start} - ${record.end ?? '...'}`;
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * RF004 AC3-AC5, RF020 AC2-AC4, RF021 AC2/AC3: a collection's regime, context,
 * approvals and events, with the forms that register an approval, move its
 * status, and record the first context or a regime conversion.
 */
export default function CollectionGovernancePanel({
  collection,
  organizations,
}: {
  collection: Collection;
  organizations: Organization[];
}) {
  const { t } = useLanguage();
  const [governance, setGovernance] = useState<CollectionGovernance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvalForm, setApprovalForm] = useState<ApprovalFormState>(EMPTY_APPROVAL_FORM);
  const [eventForm, setEventForm] = useState<GovernanceEventFormState>(() =>
    buildGovernanceEventFormState(collection.governanceRegime || ''));
  const collectionId = collection.collectionId;

  const load = async () => {
    try {
      const response = await collectionGovernanceService.get(collectionId);
      setGovernance(response.data.data ?? null);
      setError(null);
    } catch (err: any) {
      setError(errorMessage(err, t('system.collections.governance.loadError', 'Erro ao carregar a governança')));
    }
  };

  useEffect(() => {
    load();
  }, [collectionId]);

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await load();
      return true;
    } catch (err: any) {
      setError(errorMessage(err, t('common.error', 'Erro')));
      return false;
    }
  };

  const submitApproval = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() => collectionGovernanceService.createApproval(collectionId, buildApprovalPayload(approvalForm)));
    if (ok) setApprovalForm(EMPTY_APPROVAL_FORM);
  };

  const submitEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() => collectionGovernanceService.recordEvent(collectionId, buildGovernanceEventPayload(eventForm)));
    if (ok) setEventForm(buildGovernanceEventFormState(eventForm.newRegime));
  };

  const organizationName = (id: string) =>
    organizations.find((org) => org.organizationId === id)?.officialName || id;
  const approvals = governance?.approvals ?? [];
  const events = governance?.events ?? [];
  const context = governance?.governanceContext ?? null;
  const currentRegime = governance?.governanceRegime ?? null;
  const isConversion = Boolean(currentRegime) && eventForm.newRegime !== '' && eventForm.newRegime !== currentRegime;
  const regimeLabel = (regime: string | null) => regime === 'biobank'
    ? t('system.collections.regimeBiobank', 'Biobanco')
    : regime === 'biorepository'
      ? t('system.collections.regimeBiorepository', 'Biorrepositório')
      : '-';
  const set = (patch: Partial<GovernanceEventFormState>) => setEventForm({ ...eventForm, ...patch });
  const organizationOptions = organizations.map((org) => (
    <option key={org.organizationId} value={org.organizationId}>{org.officialName}</option>
  ));

  return (
    <div className="collection-governance" data-testid="collection-governance-panel">
      {error && <p role="alert" data-testid="collection-governance-error" style={{ color: 'var(--danger)' }}>{error}</p>}

      <section>
        <h4>{t('system.collections.governance.regimeAndContext', 'Regime e contexto')}</h4>
        <p data-testid="collection-governance-regime">
          {t('system.collections.governanceRegime', 'Regime de governança')}: <strong>{regimeLabel(currentRegime)}</strong>
        </p>
        {context ? (
          <dl data-testid="collection-governance-context">
            {Object.entries(context)
              .filter(([key]) => key !== 'collectionId')
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{formatValue(value)}</dd>
                </div>
              ))}
          </dl>
        ) : (
          <p>{t('system.collections.governance.noContext', 'Sem contexto de governança registrado')}</p>
        )}
      </section>

      <section>
        <h4>{t('system.collections.governance.approvals', 'Aprovações')}</h4>
        {approvals.length === 0 ? (
          <p>{t('system.collections.governance.noApprovals', 'Nenhuma aprovação registrada')}</p>
        ) : (
          <table className="table" data-testid="collection-governance-approvals">
            <thead>
              <tr>
                <th>{t('system.collections.governance.authority', 'Autoridade')}</th>
                <th>CAAE</th>
                <th>{t('system.collections.governance.effectivePeriod', 'Vigência')}</th>
                <th>{t('system.collections.governance.responsibleOrganization', 'Organização responsável')}</th>
                <th>{t('system.collections.governance.status', 'Status')}</th>
                <th>{t('common.actions', 'Ações')}</th>
              </tr>
            </thead>
            <tbody>
              {approvals.map((approval) => (
                <tr key={approval.approvalId} data-testid={`governance-approval-row-${approval.approvalId}`}>
                  <td><a href={approval.documentUri} target="_blank" rel="noreferrer">{approval.authority}</a></td>
                  <td>{approval.caae || '-'}</td>
                  <td>{formatValue(approval.effectivePeriod)}</td>
                  <td>{organizationName(approval.responsibleOrganizationId)}</td>
                  <td data-testid={`governance-approval-status-${approval.approvalId}`}>
                    {t(`system.collections.governance.status_${approval.status}`, approval.status)}
                  </td>
                  <td>
                    {nextApprovalStatuses(approval.status).map((status) => (
                      <Button
                        key={status}
                        type="button"
                        variant="secondary"
                        data-testid={`governance-approval-${status}-${approval.approvalId}`}
                        onClick={() => run(() => collectionGovernanceService.setApprovalStatus(collectionId, approval.approvalId, { status }))}
                      >
                        {t(`system.collections.governance.to_${status}`, status)}
                      </Button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form onSubmit={submitApproval} className="form" data-testid="governance-approval-form">
          <h5>{t('system.collections.governance.newApproval', 'Registrar aprovação')}</h5>
          <div className="form-grid">
            <Input label={t('system.collections.governance.authority', 'Autoridade')} data-testid="governance-approval-authority-input"
              value={approvalForm.authority} onChange={(e) => setApprovalForm({ ...approvalForm, authority: e.target.value })} required />
            <Input label="CAAE" data-testid="governance-approval-caae-input"
              value={approvalForm.caae} onChange={(e) => setApprovalForm({ ...approvalForm, caae: e.target.value })} />
            <Input label={t('system.collections.governance.documentUri', 'URI do documento')} data-testid="governance-approval-document-uri-input"
              type="url" value={approvalForm.documentUri} onChange={(e) => setApprovalForm({ ...approvalForm, documentUri: e.target.value })} required />
            <Input label={t('system.collections.governance.documentChecksum', 'Checksum SHA-256 do documento')} data-testid="governance-approval-checksum-input"
              value={approvalForm.documentChecksum} onChange={(e) => setApprovalForm({ ...approvalForm, documentChecksum: e.target.value })}
              placeholder="sha256:..." required />
            <Input label={t('system.collections.governance.effectiveStart', 'Início da vigência')} data-testid="governance-approval-start-input"
              type="date" value={approvalForm.effectiveStart} onChange={(e) => setApprovalForm({ ...approvalForm, effectiveStart: e.target.value })} required />
            <Input label={t('system.collections.governance.effectiveEnd', 'Fim da vigência')} data-testid="governance-approval-end-input"
              type="date" value={approvalForm.effectiveEnd} onChange={(e) => setApprovalForm({ ...approvalForm, effectiveEnd: e.target.value })} />
            <div className="form-grid-full">
              <label className="input-label" htmlFor="governanceApprovalOrganization">
                {t('system.collections.governance.responsibleOrganization', 'Organização responsável')}
              </label>
              <select id="governanceApprovalOrganization" className="input" data-testid="governance-approval-organization-select"
                value={approvalForm.responsibleOrganizationId}
                onChange={(e) => setApprovalForm({ ...approvalForm, responsibleOrganizationId: e.target.value })} required>
                <option value="">{t('system.collections.governance.selectOrganization', 'Selecione a organização')}</option>
                {organizationOptions}
              </select>
            </div>
            <div className="form-grid-full">
              <label className="input-label" htmlFor="governanceApprovalStatus">
                {t('system.collections.governance.status', 'Status')}
              </label>
              <select id="governanceApprovalStatus" className="input" data-testid="governance-approval-status-select"
                value={approvalForm.status}
                onChange={(e) => setApprovalForm({ ...approvalForm, status: e.target.value as ApprovalFormState['status'] })}>
                <option value="draft">{t('system.collections.governance.status_draft', 'Rascunho')}</option>
                <option value="active">{t('system.collections.governance.status_active', 'Ativa')}</option>
              </select>
            </div>
          </div>
          <div className="form-actions">
            <Button type="submit" data-testid="governance-approval-submit">
              {t('system.collections.governance.registerApproval', 'Registrar aprovação')}
            </Button>
          </div>
        </form>
      </section>

      <section>
        <h4>
          {currentRegime
            ? t('system.collections.governance.convertRegime', 'Converter regime')
            : t('system.collections.governance.recordContext', 'Registrar contexto de governança')}
        </h4>
        {currentRegime && context && !isConversion ? (
          <p>{t('system.collections.governance.conversionOnly', 'O contexto só muda por uma conversão de regime; escolha o outro regime.')}</p>
        ) : null}
        <form onSubmit={submitEvent} className="form" data-testid="governance-event-form">
          <div className="form-grid">
            <div className="form-grid-full">
              <label className="input-label" htmlFor="governanceEventRegime">
                {t('system.collections.governanceRegime', 'Regime de governança')}
              </label>
              <select id="governanceEventRegime" className="input" data-testid="governance-event-regime-select"
                value={eventForm.newRegime} onChange={(e) => set({ newRegime: e.target.value as Regime | '' })} required>
                <option value="">{t('system.collections.governanceRegimePlaceholder', 'Selecione o regime')}</option>
                <option value="biobank">{t('system.collections.regimeBiobank', 'Biobanco')}</option>
                <option value="biorepository">{t('system.collections.regimeBiorepository', 'Biorrepositório')}</option>
              </select>
            </div>

            {eventForm.newRegime === 'biorepository' && (
              <>
                <Input label="studyId" data-testid="governance-context-study-input" value={eventForm.studyId}
                  onChange={(e) => set({ studyId: e.target.value })} required />
                <Input label="protocolId" data-testid="governance-context-protocol-input" value={eventForm.protocolId}
                  onChange={(e) => set({ protocolId: e.target.value })} required />
                <Input label={t('system.collections.governance.protocolVersion', 'Versão do protocolo')} data-testid="governance-context-protocol-version-input"
                  value={eventForm.protocolVersion} onChange={(e) => set({ protocolVersion: e.target.value })} required />
                <Input label="CAAE" data-testid="governance-context-caae-input" value={eventForm.caae}
                  onChange={(e) => set({ caae: e.target.value })} required />
                <div className="form-grid-full">
                  <label className="input-label" htmlFor="governanceContextOrganization">
                    {t('system.collections.governance.responsibleOrganization', 'Organização responsável')}
                  </label>
                  <select id="governanceContextOrganization" className="input" data-testid="governance-context-organization-select"
                    value={eventForm.responsibleOrganizationId} onChange={(e) => set({ responsibleOrganizationId: e.target.value })} required>
                    <option value="">{t('system.collections.governance.selectOrganization', 'Selecione a organização')}</option>
                    {organizationOptions}
                  </select>
                </div>
                <Input label={t('system.collections.governance.responsibleInvestigator', 'Pesquisador responsável')} data-testid="governance-context-investigator-input"
                  value={eventForm.responsibleInvestigatorId} onChange={(e) => set({ responsibleInvestigatorId: e.target.value })} required />
                <div className="form-grid-full">
                  <label className="input-label" htmlFor="governanceContextEthicsApproval">
                    {t('system.collections.governance.ethicsApproval', 'Aprovação ética')}
                  </label>
                  <select id="governanceContextEthicsApproval" className="input" data-testid="governance-context-ethics-approval-select"
                    value={eventForm.ethicsApprovalId} onChange={(e) => set({ ethicsApprovalId: e.target.value })} required>
                    <option value="">{t('system.collections.governance.selectApproval', 'Selecione a aprovação')}</option>
                    {approvals.map((approval) => (
                      <option key={approval.approvalId} value={approval.approvalId}>{approval.authority} ({approval.caae || approval.approvalId})</option>
                    ))}
                  </select>
                </div>
                <Input label={t('system.collections.governance.validityStart', 'Início da validade')} data-testid="governance-context-validity-start-input"
                  type="date" value={eventForm.validityStart} onChange={(e) => set({ validityStart: e.target.value })} required />
                <Input label={t('system.collections.governance.validityEnd', 'Fim da validade')} data-testid="governance-context-validity-end-input"
                  type="date" value={eventForm.validityEnd} onChange={(e) => set({ validityEnd: e.target.value })} />
                <Input label={t('system.collections.governance.plannedEndDate', 'Encerramento previsto')} data-testid="governance-context-planned-end-input"
                  type="date" value={eventForm.plannedEndDate} onChange={(e) => set({ plannedEndDate: e.target.value })}
                  helperText={t('system.collections.governance.endOrCondition', 'Informe a data de encerramento ou a condição de encerramento')} />
                <Input label={t('system.collections.governance.closureCondition', 'Condição de encerramento')} data-testid="governance-context-closure-condition-input"
                  value={eventForm.closureCondition} onChange={(e) => set({ closureCondition: e.target.value })} />
              </>
            )}

            {eventForm.newRegime === 'biobank' && (
              <>
                <Input label={t('system.collections.governance.broadPurpose', 'Finalidade ampla')} data-testid="governance-context-broad-purpose-input"
                  value={eventForm.broadPurpose} onChange={(e) => set({ broadPurpose: e.target.value })} required />
                <Input label={t('system.collections.governance.governancePolicy', 'Política de acesso (accessPolicyId)')} data-testid="governance-context-policy-input"
                  value={eventForm.governancePolicyId} onChange={(e) => set({ governancePolicyId: e.target.value })} required />
                <Input label={t('system.collections.governance.accessCommittee', 'Comitê de acesso')} data-testid="governance-context-committee-input"
                  value={eventForm.accessCommitteeId} onChange={(e) => set({ accessCommitteeId: e.target.value })} required />
                <div className="form-grid-full">
                  <label className="input-label" htmlFor="governanceContextCustodian">
                    {t('system.collections.governance.institutionalCustodian', 'Custodiante institucional')}
                  </label>
                  <select id="governanceContextCustodian" className="input" data-testid="governance-context-custodian-select"
                    value={eventForm.institutionalCustodianId} onChange={(e) => set({ institutionalCustodianId: e.target.value })} required>
                    <option value="">{t('system.collections.governance.selectOrganization', 'Selecione a organização')}</option>
                    {organizationOptions}
                  </select>
                </div>
                <Input label={t('system.collections.governance.futureUseConditions', 'Condições de uso futuro')} data-testid="governance-context-future-use-input"
                  value={eventForm.futureUseConditionsText} onChange={(e) => set({ futureUseConditionsText: e.target.value })}
                  helperText={t('system.collections.tagFieldHelp', 'Separe múltiplos valores por ";"')} required />
                <fieldset className="form-grid-full" data-testid="governance-context-consent-models">
                  <legend className="input-label">{t('system.collections.governance.applicableConsentModel', 'Modalidades de consentimento admitidas')}</legend>
                  {CONSENT_MODELS.map((model) => (
                    <label key={model} style={{ marginRight: '1rem' }}>
                      <input type="checkbox" data-testid={`governance-context-consent-model-${model}`}
                        checked={eventForm.applicableConsentModels.includes(model)}
                        onChange={(e) => set({
                          applicableConsentModels: e.target.checked
                            ? [...eventForm.applicableConsentModels, model]
                            : eventForm.applicableConsentModels.filter((m) => m !== model),
                        })} />
                      {' '}{t(`system.collections.governance.consentModel_${model}`, model)}
                    </label>
                  ))}
                </fieldset>
                <div className="form-grid-full">
                  <label className="input-label" htmlFor="governanceContextEthicsRule">
                    {t('system.collections.governance.newEthicsReviewRule', 'Nova revisão ética')}
                  </label>
                  <select id="governanceContextEthicsRule" className="input" data-testid="governance-context-ethics-rule-select"
                    value={eventForm.newEthicsReviewRule} onChange={(e) => set({ newEthicsReviewRule: e.target.value })} required>
                    <option value="">{t('system.collections.governance.selectRule', 'Selecione a regra')}</option>
                    <option value="always">{t('system.collections.governance.rule_always', 'Sempre')}</option>
                    <option value="when_required_by_policy">{t('system.collections.governance.rule_when_required_by_policy', 'Quando exigida pela política')}</option>
                  </select>
                </div>
              </>
            )}

            {eventForm.newRegime !== '' && (
              <>
                <fieldset className="form-grid-full" data-testid="governance-event-approvals">
                  <legend className="input-label">{t('system.collections.governance.eventApprovals', 'Aprovações em que a decisão se apoia')}</legend>
                  {approvals.map((approval) => (
                    <label key={approval.approvalId} style={{ display: 'block' }}>
                      <input type="checkbox" data-testid={`governance-event-approval-${approval.approvalId}`}
                        checked={eventForm.approvalIds.includes(approval.approvalId)}
                        onChange={(e) => set({
                          approvalIds: e.target.checked
                            ? [...eventForm.approvalIds, approval.approvalId]
                            : eventForm.approvalIds.filter((id) => id !== approval.approvalId),
                        })} />
                      {' '}{approval.authority} ({t(`system.collections.governance.status_${approval.status}`, approval.status)})
                    </label>
                  ))}
                </fieldset>
                <div className="form-grid-full">
                  <label className="input-label" htmlFor="governanceEventJustification">
                    {t('system.collections.governance.justification', 'Justificativa')}
                  </label>
                  <textarea id="governanceEventJustification" className="input" data-testid="governance-event-justification-input"
                    value={eventForm.justification} onChange={(e) => set({ justification: e.target.value })} required />
                </div>
              </>
            )}
          </div>
          <div className="form-actions">
            <Button type="submit" data-testid="governance-event-submit">
              {t('system.collections.governance.recordDecision', 'Registrar decisão')}
            </Button>
          </div>
        </form>
      </section>

      <section>
        <h4>{t('system.collections.governance.events', 'Histórico de decisões')}</h4>
        {events.length === 0 ? (
          <p>{t('system.collections.governance.noEvents', 'Nenhuma decisão registrada')}</p>
        ) : (
          <ol data-testid="collection-governance-events">
            {events.map((event) => (
              <li key={event.collectionGovernanceEventId}>
                {new Date(event.occurredAt).toLocaleString()} {'- '}
                {t(`system.collections.governance.decision_${event.decisionType}`, event.decisionType)}:{' '}
                {regimeLabel(event.previousRegime)} {'->'} {regimeLabel(event.newRegime)}. {event.justification}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
