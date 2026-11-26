import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CollectionGovernancePanel, {
  EMPTY_APPROVAL_FORM,
  buildApprovalPayload,
  buildGovernanceEventFormState,
  buildGovernanceEventPayload,
  nextApprovalStatuses,
} from './CollectionGovernancePanel';
import { LanguageProvider } from '../contexts/LanguageContext';
import { collectionGovernanceService } from '../services/api';
import type { CollectionGovernance } from '../types/models';

vi.mock('../services/api', () => ({
  collectionGovernanceService: {
    get: vi.fn(),
    createApproval: vi.fn(),
    setApprovalStatus: vi.fn(),
    recordEvent: vi.fn(),
  },
}));

describe('buildApprovalPayload', () => {
  it('sends the approval fields trimmed, with its period as a FHIR Period', () => {
    expect(buildApprovalPayload({
      authority: ' CEP HC ',
      caae: ' 12345678.9.0000.0000 ',
      documentUri: ' https://docs.example.org/parecer.pdf ',
      documentChecksum: ` sha256:${'a'.repeat(64)} `,
      effectiveStart: '2026-01-01',
      effectiveEnd: '2030-12-31',
      status: 'active',
      responsibleOrganizationId: 'org-1',
    })).toEqual({
      authority: 'CEP HC',
      caae: '12345678.9.0000.0000',
      documentUri: 'https://docs.example.org/parecer.pdf',
      documentChecksum: `sha256:${'a'.repeat(64)}`,
      effectivePeriod: { start: '2026-01-01', end: '2030-12-31' },
      status: 'active',
      responsibleOrganizationId: 'org-1',
    });
  });

  it('leaves out an empty CAAE and an open period end, which the model refuses as empty strings', () => {
    const payload = buildApprovalPayload({ ...EMPTY_APPROVAL_FORM, authority: 'CEP', effectiveStart: '2026-01-01' });
    expect(payload.caae).toBeUndefined();
    expect(payload.effectivePeriod).toEqual({ start: '2026-01-01' });
    expect(payload.status).toBe('draft');
  });
});

describe('buildGovernanceEventPayload', () => {
  it('a biorepository context carries only BiorepositoryContext fields (RULE-001)', () => {
    const payload = buildGovernanceEventPayload({
      ...buildGovernanceEventFormState('biorepository'),
      justification: ' Contexto inicial ',
      approvalIds: ['ap-1'],
      studyId: 'study-1',
      protocolId: 'protocol-1',
      protocolVersion: '1.0',
      caae: '12345678.9.0000.0000',
      responsibleOrganizationId: 'org-1',
      responsibleInvestigatorId: 'inv-1',
      ethicsApprovalId: 'ap-1',
      validityStart: '2026-01-01',
      validityEnd: '',
      plannedEndDate: '2030-12-31',
      broadPurpose: 'left over from a biobank draft',
    });
    expect(payload).toEqual({
      newRegime: 'biorepository',
      justification: 'Contexto inicial',
      approvalIds: ['ap-1'],
      governanceContext: {
        studyId: 'study-1',
        protocolId: 'protocol-1',
        protocolVersion: '1.0',
        caae: '12345678.9.0000.0000',
        responsibleOrganizationId: 'org-1',
        responsibleInvestigatorId: 'inv-1',
        ethicsApprovalId: 'ap-1',
        validityPeriod: { start: '2026-01-01' },
        plannedEndDate: '2030-12-31',
        closureCondition: undefined,
      },
    });
  });

  it('a biobank context codes its purpose and future-use conditions and carries only its own fields (RULE-002)', () => {
    const payload = buildGovernanceEventPayload({
      ...buildGovernanceEventFormState('biobank'),
      justification: 'Conversão',
      approvalIds: ['ap-2'],
      broadPurpose: 'Pesquisa em doenças raras',
      governancePolicyId: 'policy-1',
      accessCommitteeId: 'committee-1',
      institutionalCustodianId: 'org-2',
      futureUseConditionsText: 'DUO:0000042; nova revisão ética',
      applicableConsentModels: ['broad', 'tiered'],
      newEthicsReviewRule: 'always',
      studyId: 'left over from a biorepository draft',
    });
    expect(payload.governanceContext).toEqual({
      broadPurpose: { text: 'Pesquisa em doenças raras' },
      governancePolicyId: 'policy-1',
      accessCommitteeId: 'committee-1',
      institutionalCustodianId: 'org-2',
      futureUseConditions: [{ text: 'DUO:0000042' }, { text: 'nova revisão ética' }],
      applicableConsentModel: ['broad', 'tiered'],
      newEthicsReviewRule: 'always',
    });
    expect(payload.newRegime).toBe('biobank');
  });

  it('a biorepository validity with an end date is sent as a closed FHIR Period', () => {
    const payload = buildGovernanceEventPayload({
      ...buildGovernanceEventFormState('biorepository'),
      validityStart: ' 2026-01-01 ',
      validityEnd: ' 2030-12-31 ',
    });
    expect((payload.governanceContext as Record<string, unknown>).validityPeriod).toEqual({ start: '2026-01-01', end: '2030-12-31' });
  });

  it('an unchosen regime is left out of the body rather than sent as an empty string', () => {
    const payload = buildGovernanceEventPayload(buildGovernanceEventFormState());
    expect(payload).toHaveProperty('newRegime', undefined);
  });
});

describe('nextApprovalStatuses', () => {
  it('follows the model transitions, and a revoked approval moves nowhere', () => {
    expect(nextApprovalStatuses('draft')).toEqual(['active', 'revoked']);
    expect(nextApprovalStatuses('active')).toEqual(['suspended', 'revoked']);
    expect(nextApprovalStatuses('suspended')).toEqual(['active', 'revoked']);
    expect(nextApprovalStatuses('revoked')).toEqual([]);
    expect(nextApprovalStatuses('unknown')).toEqual([]);
  });
});

const GOVERNANCE: CollectionGovernance = {
  collectionId: 'col-1',
  governanceRegime: 'biorepository',
  governanceContext: { collectionId: 'col-1', studyId: 'study-1', validityPeriod: { start: '2026-01-01', end: null } },
  approvals: [{
    approvalId: 'ap-1',
    collectionId: 'col-1',
    authority: 'CEP HC',
    caae: '12345678.9.0000.0000',
    documentUri: 'https://docs.example.org/parecer.pdf',
    documentChecksum: `sha256:${'a'.repeat(64)}`,
    effectivePeriod: { start: '2026-01-01', end: '2030-12-31' },
    status: 'active',
    responsibleOrganizationId: 'org-1',
  }],
  events: [{
    collectionGovernanceEventId: 'ev-1',
    collectionId: 'col-1',
    previousRegime: null,
    newRegime: 'biorepository',
    decisionType: 'created',
    approvalIds: ['ap-1'],
    justification: 'Contexto inicial',
    occurredAt: '2026-10-08T12:00:00.000Z',
  }],
};

type User = ReturnType<typeof userEvent.setup>;

// One input event per field: a user.type per keystroke re-renders the whole form
// each key, which ran past the 5 s test timeout under a loaded parallel run (#1414).
async function fill(user: User, field: HTMLElement, text: string) {
  await user.click(field);
  await user.paste(text);
}

function renderPanel(governanceRegime: 'biobank' | 'biorepository' | null = 'biorepository') {
  return render(
    <LanguageProvider>
      <CollectionGovernancePanel
        collection={{ collectionId: 'col-1', collectionName: 'Coleção 1', governanceRegime }}
        organizations={[{ organizationId: 'org-1', officialName: 'Hospital das Clínicas', countryCode: 'BR' }]}
      />
    </LanguageProvider>
  );
}

// The <dd> beside a context key's <dt>.
function contextValue(key: string) {
  const term = Array.from(screen.getByTestId('collection-governance-context').querySelectorAll('dt'))
    .find((dt) => dt.textContent === key);
  if (!term) throw new Error(`no context key ${key}`);
  return term.nextElementSibling?.textContent;
}

describe('CollectionGovernancePanel', () => {
  beforeEach(() => {
    vi.mocked(collectionGovernanceService.get).mockReset().mockResolvedValue({ data: { success: true, data: GOVERNANCE } } as any);
    vi.mocked(collectionGovernanceService.createApproval).mockReset().mockResolvedValue({ data: { success: true } } as any);
    vi.mocked(collectionGovernanceService.setApprovalStatus).mockReset().mockResolvedValue({ data: { success: true } } as any);
    vi.mocked(collectionGovernanceService.recordEvent).mockReset().mockResolvedValue({ data: { success: true } } as any);
  });

  it('shows the context, the approvals with their next statuses, and the events', async () => {
    renderPanel();
    expect(await screen.findByTestId('governance-approval-row-ap-1')).toHaveTextContent('Hospital das Clínicas');
    expect(screen.getByTestId('collection-governance-context')).toHaveTextContent('study-1');
    expect(screen.getByTestId('collection-governance-context')).not.toHaveTextContent('col-1');
    expect(screen.getByTestId('governance-approval-suspended-ap-1')).toBeInTheDocument();
    expect(screen.getByTestId('governance-approval-revoked-ap-1')).toBeInTheDocument();
    expect(screen.queryByTestId('governance-approval-active-ap-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('collection-governance-events')).toHaveTextContent('Contexto inicial');
  });

  it('moves an approval through POST .../status and reloads', async () => {
    const user = userEvent.setup({ delay: null });
    renderPanel();
    await user.click(await screen.findByTestId('governance-approval-suspended-ap-1'));
    await waitFor(() => expect(collectionGovernanceService.setApprovalStatus).toHaveBeenCalledWith('col-1', 'ap-1', { status: 'suspended' }));
    await waitFor(() => expect(collectionGovernanceService.get).toHaveBeenCalledTimes(2));
  });

  it('registers an approval from the form', async () => {
    const user = userEvent.setup({ delay: null });
    renderPanel();
    await screen.findByTestId('governance-approval-row-ap-1');
    await fill(user, screen.getByTestId('governance-approval-authority-input'), 'CONEP');
    await fill(user, screen.getByTestId('governance-approval-document-uri-input'), 'https://docs.example.org/conep.pdf');
    await fill(user, screen.getByTestId('governance-approval-checksum-input'), `sha256:${'b'.repeat(64)}`);
    await fill(user, screen.getByTestId('governance-approval-start-input'), '2026-02-01');
    await user.selectOptions(screen.getByTestId('governance-approval-organization-select'), 'org-1');
    await user.click(screen.getByTestId('governance-approval-submit'));
    await waitFor(() => expect(collectionGovernanceService.createApproval).toHaveBeenCalledWith('col-1', expect.objectContaining({
      authority: 'CONEP',
      effectivePeriod: { start: '2026-02-01' },
      status: 'draft',
      responsibleOrganizationId: 'org-1',
    })));
  });

  it('records a regime conversion with the biobank context and shows a refusal', async () => {
    vi.mocked(collectionGovernanceService.recordEvent).mockRejectedValue({
      response: { data: { message: 'governancePolicyId policy-x não encontrado' } },
    });
    const user = userEvent.setup({ delay: null });
    renderPanel();
    await screen.findByTestId('governance-approval-row-ap-1');
    await user.selectOptions(screen.getByTestId('governance-event-regime-select'), 'biobank');
    await fill(user, screen.getByTestId('governance-context-broad-purpose-input'), 'Doenças raras');
    await fill(user, screen.getByTestId('governance-context-policy-input'), 'policy-x');
    await fill(user, screen.getByTestId('governance-context-committee-input'), 'committee-1');
    await user.selectOptions(screen.getByTestId('governance-context-custodian-select'), 'org-1');
    await fill(user, screen.getByTestId('governance-context-future-use-input'), 'DUO:0000042');
    await user.click(screen.getByTestId('governance-context-consent-model-broad'));
    await user.selectOptions(screen.getByTestId('governance-context-ethics-rule-select'), 'always');
    await user.click(screen.getByTestId('governance-event-approval-ap-1'));
    await fill(user, screen.getByTestId('governance-event-justification-input'), 'Conversão para biobanco');
    await user.click(screen.getByTestId('governance-event-submit'));
    await waitFor(() => expect(collectionGovernanceService.recordEvent).toHaveBeenCalledWith('col-1', expect.objectContaining({
      newRegime: 'biobank',
      approvalIds: ['ap-1'],
      justification: 'Conversão para biobanco',
    })));
    expect(await screen.findByTestId('collection-governance-error')).toHaveTextContent('policy-x');
  });

  it('shows a load failure', async () => {
    vi.mocked(collectionGovernanceService.get).mockRejectedValue(new Error('network down'));
    renderPanel();
    expect(await screen.findByTestId('collection-governance-error')).toHaveTextContent('network down');
  });

  it('formats each context value shape the server can return', async () => {
    vi.mocked(collectionGovernanceService.get).mockResolvedValue({ data: { success: true, data: {
      ...GOVERNANCE,
      governanceRegime: 'biobank',
      governanceContext: {
        collectionId: 'col-1',
        broadPurpose: { code: 'health-research' },
        accessCommitteeId: { text: 'Comitê de acesso', code: 'committee-1' },
        futureUseConditions: ['compatible_consent', { text: 'nova revisão ética' }],
        governancePolicyId: '',
        newEthicsReviewRule: null,
        institutionalCustodianId: { reference: 'Organization/org-1' },
        plannedEndYear: 2030,
        validityPeriod: { start: '2026-01-01', end: '2030-12-31' },
        reviewPeriod: { start: '2027-01-01', end: null },
      },
    } } } as any);
    renderPanel('biobank');
    await screen.findByTestId('collection-governance-context');
    expect(screen.getByTestId('collection-governance-regime')).toHaveTextContent('Biobank');
    expect(contextValue('broadPurpose')).toBe('health-research');
    expect(contextValue('accessCommitteeId')).toBe('Comitê de acesso');
    expect(contextValue('futureUseConditions')).toBe('compatible_consent; nova revisão ética');
    expect(contextValue('governancePolicyId')).toBe('-');
    expect(contextValue('newEthicsReviewRule')).toBe('-');
    expect(contextValue('institutionalCustodianId')).toBe('{"reference":"Organization/org-1"}');
    expect(contextValue('plannedEndYear')).toBe('2030');
    expect(contextValue('validityPeriod')).toBe('2026-01-01 - 2030-12-31');
    expect(contextValue('reviewPeriod')).toBe('2027-01-01 - ...');
  });

  it('a collection with no governance yet shows the empty states and offers the first context', async () => {
    vi.mocked(collectionGovernanceService.get).mockResolvedValue({ data: { success: true } } as any);
    renderPanel(null);
    expect(await screen.findByText('No governance context recorded')).toBeInTheDocument();
    expect(collectionGovernanceService.get).toHaveBeenCalledWith('col-1');
    expect(screen.getByText('No approval recorded')).toBeInTheDocument();
    expect(screen.getByText('No decision recorded')).toBeInTheDocument();
    expect(screen.getByTestId('collection-governance-regime')).toHaveTextContent('Governance regime: -');
    expect(screen.getByRole('heading', { name: 'Record the governance context' })).toBeInTheDocument();
    expect(screen.getByTestId('governance-event-regime-select')).toHaveValue('');
    expect(screen.queryByTestId('governance-event-justification-input')).not.toBeInTheDocument();
  });

  it('a load failure with no message of its own shows the default text', async () => {
    vi.mocked(collectionGovernanceService.get).mockRejectedValue({});
    renderPanel();
    expect(await screen.findByTestId('collection-governance-error')).toHaveTextContent('Could not load the governance');
  });

  it('an approval without CAAE or a known organization shows a dash and the raw organization id', async () => {
    vi.mocked(collectionGovernanceService.get).mockResolvedValue({ data: { success: true, data: {
      ...GOVERNANCE,
      approvals: [{ ...GOVERNANCE.approvals[0], approvalId: 'ap-2', authority: 'CONEP', caae: null, responsibleOrganizationId: 'org-9', status: 'revoked' }],
    } } } as any);
    renderPanel();
    const row = await screen.findByTestId('governance-approval-row-ap-2');
    const cells = row.querySelectorAll('td');
    expect(cells[1]).toHaveTextContent(/^-$/);
    expect(cells[3]).toHaveTextContent(/^org-9$/);
    expect(cells[5]).toBeEmptyDOMElement();
    expect(screen.getByRole('option', { name: 'CONEP (ap-2)' })).toBeInTheDocument();
  });

  it('registers an approval with CAAE, an end date and active status, then clears the form', async () => {
    const user = userEvent.setup({ delay: null });
    renderPanel();
    await screen.findByTestId('governance-approval-row-ap-1');
    await fill(user, screen.getByTestId('governance-approval-authority-input'), 'CONEP');
    await fill(user, screen.getByTestId('governance-approval-caae-input'), '87654321.0.0000.0000');
    await fill(user, screen.getByTestId('governance-approval-document-uri-input'), 'https://docs.example.org/conep.pdf');
    await fill(user, screen.getByTestId('governance-approval-checksum-input'), `sha256:${'c'.repeat(64)}`);
    await fill(user, screen.getByTestId('governance-approval-start-input'), '2026-02-01');
    await fill(user, screen.getByTestId('governance-approval-end-input'), '2031-01-31');
    await user.selectOptions(screen.getByTestId('governance-approval-organization-select'), 'org-1');
    await user.selectOptions(screen.getByTestId('governance-approval-status-select'), 'active');
    await user.click(screen.getByTestId('governance-approval-submit'));
    await waitFor(() => expect(collectionGovernanceService.createApproval).toHaveBeenCalledWith('col-1', {
      authority: 'CONEP',
      caae: '87654321.0.0000.0000',
      documentUri: 'https://docs.example.org/conep.pdf',
      documentChecksum: `sha256:${'c'.repeat(64)}`,
      effectivePeriod: { start: '2026-02-01', end: '2031-01-31' },
      status: 'active',
      responsibleOrganizationId: 'org-1',
    }));
    await waitFor(() => expect(screen.getByTestId('governance-approval-authority-input')).toHaveValue(''));
    expect(screen.getByTestId('governance-approval-status-select')).toHaveValue('draft');
  });

  it('keeps the approval form filled when the registration is refused', async () => {
    vi.mocked(collectionGovernanceService.createApproval).mockRejectedValue({ response: { data: { error: 'documentChecksum inválido' } } });
    const user = userEvent.setup({ delay: null });
    renderPanel();
    await screen.findByTestId('governance-approval-row-ap-1');
    await fill(user, screen.getByTestId('governance-approval-authority-input'), 'CONEP');
    await fill(user, screen.getByTestId('governance-approval-document-uri-input'), 'https://docs.example.org/conep.pdf');
    await fill(user, screen.getByTestId('governance-approval-checksum-input'), 'sha256:x');
    await fill(user, screen.getByTestId('governance-approval-start-input'), '2026-02-01');
    await user.selectOptions(screen.getByTestId('governance-approval-organization-select'), 'org-1');
    await user.click(screen.getByTestId('governance-approval-submit'));
    expect(await screen.findByTestId('collection-governance-error')).toHaveTextContent('documentChecksum inválido');
    expect(screen.getByTestId('governance-approval-authority-input')).toHaveValue('CONEP');
    expect(collectionGovernanceService.get).toHaveBeenCalledTimes(1);
  });

  it('records the first biorepository context from every field and resets the decision form', async () => {
    vi.mocked(collectionGovernanceService.get).mockResolvedValue({ data: { success: true, data: {
      ...GOVERNANCE, governanceRegime: null, governanceContext: null, events: [],
    } } } as any);
    const user = userEvent.setup({ delay: null });
    renderPanel();
    await screen.findByTestId('governance-approval-row-ap-1');
    await fill(user, screen.getByTestId('governance-context-study-input'), 'study-1');
    await fill(user, screen.getByTestId('governance-context-protocol-input'), 'protocol-1');
    await fill(user, screen.getByTestId('governance-context-protocol-version-input'), '2.0');
    await fill(user, screen.getByTestId('governance-context-caae-input'), '12345678.9.0000.0000');
    await user.selectOptions(screen.getByTestId('governance-context-organization-select'), 'org-1');
    await fill(user, screen.getByTestId('governance-context-investigator-input'), 'inv-1');
    await user.selectOptions(screen.getByTestId('governance-context-ethics-approval-select'), 'ap-1');
    await fill(user, screen.getByTestId('governance-context-validity-start-input'), '2026-01-01');
    await fill(user, screen.getByTestId('governance-context-validity-end-input'), '2030-12-31');
    await fill(user, screen.getByTestId('governance-context-planned-end-input'), '2030-06-30');
    await fill(user, screen.getByTestId('governance-context-closure-condition-input'), 'Fim do recrutamento');
    await user.click(screen.getByTestId('governance-event-approval-ap-1'));
    await fill(user, screen.getByTestId('governance-event-justification-input'), 'Contexto inicial');
    await user.click(screen.getByTestId('governance-event-submit'));
    await waitFor(() => expect(collectionGovernanceService.recordEvent).toHaveBeenCalledWith('col-1', {
      newRegime: 'biorepository',
      justification: 'Contexto inicial',
      approvalIds: ['ap-1'],
      governanceContext: {
        studyId: 'study-1',
        protocolId: 'protocol-1',
        protocolVersion: '2.0',
        caae: '12345678.9.0000.0000',
        responsibleOrganizationId: 'org-1',
        responsibleInvestigatorId: 'inv-1',
        ethicsApprovalId: 'ap-1',
        validityPeriod: { start: '2026-01-01', end: '2030-12-31' },
        plannedEndDate: '2030-06-30',
        closureCondition: 'Fim do recrutamento',
      },
    }));
    await waitFor(() => expect(screen.getByTestId('governance-event-justification-input')).toHaveValue(''));
    expect(screen.getByTestId('governance-context-study-input')).toHaveValue('');
    expect(screen.getByTestId('governance-event-regime-select')).toHaveValue('biorepository');
  });

  it('unticking a consent model or an approval takes it back out of the decision', async () => {
    const user = userEvent.setup({ delay: null });
    renderPanel();
    await screen.findByTestId('governance-approval-row-ap-1');
    await user.selectOptions(screen.getByTestId('governance-event-regime-select'), 'biobank');
    await user.click(screen.getByTestId('governance-context-consent-model-broad'));
    await user.click(screen.getByTestId('governance-context-consent-model-tiered'));
    await user.click(screen.getByTestId('governance-context-consent-model-broad'));
    await user.click(screen.getByTestId('governance-event-approval-ap-1'));
    await user.click(screen.getByTestId('governance-event-approval-ap-1'));
    expect(screen.getByTestId('governance-context-consent-model-broad')).not.toBeChecked();
    expect(screen.getByTestId('governance-context-consent-model-tiered')).toBeChecked();
    expect(screen.getByTestId('governance-event-approval-ap-1')).not.toBeChecked();
    await fill(user, screen.getByTestId('governance-context-broad-purpose-input'), 'Doenças raras');
    await fill(user, screen.getByTestId('governance-context-policy-input'), 'policy-1');
    await fill(user, screen.getByTestId('governance-context-committee-input'), 'committee-1');
    await user.selectOptions(screen.getByTestId('governance-context-custodian-select'), 'org-1');
    await fill(user, screen.getByTestId('governance-context-future-use-input'), 'DUO:0000042');
    await user.selectOptions(screen.getByTestId('governance-context-ethics-rule-select'), 'when_required_by_policy');
    await fill(user, screen.getByTestId('governance-event-justification-input'), 'Conversão');
    await user.click(screen.getByTestId('governance-event-submit'));
    await waitFor(() => expect(collectionGovernanceService.recordEvent).toHaveBeenCalledWith('col-1', expect.objectContaining({
      approvalIds: [],
      governanceContext: expect.objectContaining({ applicableConsentModel: ['tiered'] }),
    })));
  });
});
