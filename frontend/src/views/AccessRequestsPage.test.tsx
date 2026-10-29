import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccessRequestsPage, {
  EMPTY_DECISION_FORM,
  EMPTY_REQUEST_FORM,
  buildAccessRequestPayload,
  buildDecisionPayload,
  describeAccessCheck,
} from './AccessRequestsPage';
import { accessRequestService, consentService } from '../services/api';
import type { AccessRequest } from '../types/models';

vi.mock('../services/api', () => ({
  accessRequestService: {
    getAll: vi.fn(),
    create: vi.fn(),
    evaluate: vi.fn(),
    decide: vi.fn(),
    distribute: vi.fn(),
    revoke: vi.fn(),
    accessCheck: vi.fn(),
  },
  consentService: { getPurposeCodes: vi.fn() },
}));

vi.mock('../hooks/useOrganizations', () => ({
  useOrganizations: () => ({ organizations: [{ organizationId: 'org-1', officialName: 'Hospital Um' }], loading: false, error: null }),
}));

describe('buildAccessRequestPayload', () => {
  it('sends AC1 fields trimmed, with the chosen DUO purpose and the filled items', () => {
    expect(buildAccessRequestPayload({
      requesterId: ' researcher-1 ',
      organizationId: 'org-1',
      studyId: ' study-1 ',
      protocolId: ' protocol-1 ',
      requestedPurpose: ' Pesquisa em biomarcadores ',
      duoCode: 'DUO:0000006',
      items: [{ itemType: 'specimen', itemId: ' SP-1 ' }, { itemType: 'dataset', itemId: '  ' }],
    })).toEqual({
      requesterId: 'researcher-1',
      organizationId: 'org-1',
      studyId: 'study-1',
      protocolId: 'protocol-1',
      requestedPurpose: 'Pesquisa em biomarcadores',
      duoCode: 'DUO:0000006',
      requestedItems: [{ itemType: 'specimen', itemId: 'SP-1' }],
    });
  });

  it('leaves the DUO code out when none is chosen, rather than sending an empty string', () => {
    expect(buildAccessRequestPayload(EMPTY_REQUEST_FORM)).not.toHaveProperty('duoCode');
  });
});

describe('buildDecisionPayload', () => {
  it('an approval carries a period from the start of its first day to the end of its last', () => {
    const payload = buildDecisionPayload({ status: 'approved', justification: ' ok ', start: '2026-10-01', end: '2026-12-31' });
    const period = payload.approvalPeriod as { start: string; end: string };
    expect(payload).toMatchObject({ status: 'approved', justification: 'ok' });
    expect(new Date(period.start).getTime()).toBe(new Date('2026-10-01T00:00:00').getTime());
    expect(new Date(period.end).getTime()).toBe(new Date('2026-12-31T23:59:59').getTime());
  });

  it('a rejection carries no validity, whatever the dates hold', () => {
    expect(buildDecisionPayload({ ...EMPTY_DECISION_FORM, status: 'rejected', justification: 'não', start: '2026-10-01' }))
      .toEqual({ status: 'rejected', justification: 'não' });
  });
});

describe('describeAccessCheck', () => {
  it('words each access-check reason the backend returns', () => {
    expect(describeAccessCheck({ allowed: false, reason: 'pending' })).toBe('Bloqueado: Aguardando decisão do comitê');
    expect(describeAccessCheck({ allowed: true, reason: 'approved' })).toBe('Liberado: Aprovado');
    expect(describeAccessCheck({ allowed: false, reason: 'something_new' })).toBe('Bloqueado: something_new');
    expect(describeAccessCheck(null)).toBe('-');
  });
});

function pendingRequest(overrides: Partial<AccessRequest> = {}): AccessRequest {
  return {
    accessRequestId: 'ar-1',
    requesterId: 'researcher-1',
    organizationId: 'org-1',
    studyId: 'study-1',
    protocolId: 'protocol-1',
    protocolVersion: '1.2',
    requestedPurpose: 'Pesquisa',
    duoCode: 'DUO:0000006',
    requestedItems: [{ itemType: 'specimen', itemId: 'SP-1' }],
    consentCompatibility: [],
    compatibilityEvaluatedAt: null,
    overallCompatible: null,
    policyDecision: null,
    committeeDecision: {
      decisionId: null, status: 'pending', justification: null, decidedBy: null, decidedAt: null,
      policyVersion: null, policyEffect: null, configurationReleaseId: null,
    },
    approvalPeriod: null,
    distributionStatus: 'pending',
    distributedAt: null,
    distributionDecisionId: null,
    createdAt: '2026-10-09T10:00:00.000Z',
    ...overrides,
  };
}

type User = ReturnType<typeof userEvent.setup>;

// One input event per field: a user.type per keystroke re-renders the whole form
// each key, which ran past the 5 s test timeout under a loaded parallel run (#1414).
async function fill(user: User, field: HTMLElement, text: string) {
  await user.click(field);
  await user.paste(text);
}

describe('AccessRequestsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(consentService.getPurposeCodes).mockResolvedValue({ data: { success: true, data: [{ code: 'DUO:0000006', display: 'health research' }] } } as any);
    vi.mocked(accessRequestService.accessCheck).mockResolvedValue({ data: { success: true, data: { allowed: false, reason: 'pending' } } } as any);
  });

  it('registers a request from the form and opens it', async () => {
    const created = pendingRequest();
    vi.mocked(accessRequestService.getAll)
      .mockResolvedValueOnce({ data: { success: true, data: [] } } as any)
      .mockResolvedValueOnce({ data: { success: true, data: [created] } } as any);
    vi.mocked(accessRequestService.create).mockResolvedValue({ data: { success: true, data: created } } as any);
    const user = userEvent.setup({ delay: null });
    render(<AccessRequestsPage />);

    await fill(user, screen.getByTestId('access-request-requester-input'), 'researcher-1');
    await user.selectOptions(screen.getByTestId('access-request-organization-select'), 'org-1');
    await fill(user, screen.getByTestId('access-request-study-input'), 'study-1');
    await fill(user, screen.getByTestId('access-request-protocol-input'), 'protocol-1');
    await fill(user, screen.getByTestId('access-request-purpose-input'), 'Pesquisa');
    await waitFor(() => expect(screen.getByRole('option', { name: /DUO:0000006/ })).toBeTruthy());
    await user.selectOptions(screen.getByTestId('access-request-duo-select'), 'DUO:0000006');
    await fill(user, screen.getByTestId('access-request-item-id-1'), 'SP-1');
    await user.click(screen.getByTestId('access-request-submit'));

    await waitFor(() => expect(accessRequestService.create).toHaveBeenCalledWith({
      requesterId: 'researcher-1',
      organizationId: 'org-1',
      studyId: 'study-1',
      protocolId: 'protocol-1',
      requestedPurpose: 'Pesquisa',
      duoCode: 'DUO:0000006',
      requestedItems: [{ itemType: 'specimen', itemId: 'SP-1' }],
    }));
    expect(await screen.findByTestId('access-request-detail')).toBeTruthy();
    expect((await screen.findByTestId('access-request-access-check')).textContent).toContain('Aguardando decisão do comitê');
  });

  it('shows each item\'s consent authorization and the policy effect after an evaluation, and refuses with the backend\'s message', async () => {
    const evaluated = pendingRequest({
      compatibilityEvaluatedAt: '2026-10-09T10:05:00.000Z',
      overallCompatible: false,
      consentCompatibility: [{
        itemId: 'SP-1', itemType: 'specimen', participantId: 'P-1', consentValid: false,
        consentAuthorizationDecisionId: 'cad-1', consentAuthorizationResult: 'deny',
        consentAuthorizationReasons: ['permissão revogada'], duoCompatible: true, studyActive: true, compatible: false,
      }],
      policyDecision: { effect: 'deny', reasons: ['incompatível com consentimento, DUO ou estudo'] },
    });
    vi.mocked(accessRequestService.getAll).mockResolvedValue({ data: { success: true, data: [pendingRequest()] } } as any);
    vi.mocked(accessRequestService.evaluate).mockResolvedValue({ data: { success: true, data: evaluated } } as any);
    vi.mocked(accessRequestService.decide).mockRejectedValue({ response: { data: { message: 'Uma solicitação incompatível não pode ser aprovada' } } });
    const user = userEvent.setup({ delay: null });
    render(<AccessRequestsPage />);

    await user.click(await screen.findByTestId('access-request-open-ar-1'));
    await user.click(screen.getByTestId('access-request-evaluate'));

    expect((await screen.findByTestId('access-request-item-result-SP-1')).textContent).toBe('deny');
    expect(screen.getByTestId('access-request-item-SP-1').textContent).toContain('permissão revogada');
    expect(screen.getByTestId('access-request-policy-effect').textContent).toBe('deny');

    await fill(user, screen.getByTestId('access-decision-justification-input'), 'tentativa');
    await user.click(screen.getByTestId('access-decision-submit'));
    expect((await screen.findByTestId('access-request-detail-error')).textContent).toContain('incompatível');
  });
});
