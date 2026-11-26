import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

describe('buildDecisionPayload, open-ended', () => {
  it('an approval with a start and no end carries a period with its start only', () => {
    const payload = buildDecisionPayload({ status: 'conditioned', justification: 'ok', start: '2026-10-01', end: '' });
    expect(payload.approvalPeriod).toEqual({ start: new Date('2026-10-01T00:00:00').toISOString() });
  });
});

function decidedRequest(overrides: Partial<AccessRequest> = {}): AccessRequest {
  return pendingRequest({
    committeeDecision: {
      decisionId: 'dec-1', status: 'approved', justification: 'conforme o protocolo', decidedBy: 'comite',
      decidedAt: '2026-10-10T12:00:00.000Z', policyVersion: 'v3', policyEffect: 'permit', configurationReleaseId: null,
    },
    ...overrides,
  });
}

describe('AccessRequestsPage, further paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(consentService.getPurposeCodes).mockResolvedValue({ data: { success: true, data: [{ code: 'DUO:0000006', display: 'health research' }] } } as any);
    vi.mocked(accessRequestService.accessCheck).mockResolvedValue({ data: { success: true, data: { allowed: true, reason: 'approved' } } } as any);
  });

  it.each([
    ['the backend error field', { response: { data: { error: 'Banco indisponível' } } }, 'Banco indisponível'],
    ['the thrown message', new Error('Network Error'), 'Network Error'],
    ['the page fallback', {}, 'Erro ao carregar as solicitações de acesso'],
  ])('a failed list load shows %s', async (_name, rejection, shown) => {
    vi.mocked(accessRequestService.getAll).mockRejectedValue(rejection);
    render(<AccessRequestsPage />);
    expect((await screen.findByTestId('access-requests-error')).textContent).toBe(shown);
  });

  it('reads a list or purpose-code body that is not an array as empty', async () => {
    vi.mocked(accessRequestService.getAll).mockResolvedValue({ data: { success: true } } as any);
    vi.mocked(consentService.getPurposeCodes).mockResolvedValue({ data: { success: true, data: { code: 'DUO:0000006' } } } as any);
    render(<AccessRequestsPage />);
    await waitFor(() => expect(consentService.getPurposeCodes).toHaveBeenCalled());
    expect(await screen.findByText('Nenhuma solicitação registrada.')).toBeTruthy();
    await waitFor(() => expect(within(screen.getByTestId('access-request-duo-select')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Nenhuma']));
    expect(screen.queryByTestId('access-requests-error')).toBeNull();
  });

  it('offers no DUO purpose when the purpose codes fail to load, and shows no error for it', async () => {
    vi.mocked(accessRequestService.getAll).mockResolvedValue({ data: { success: true, data: [] } } as any);
    vi.mocked(consentService.getPurposeCodes).mockRejectedValue(new Error('offline'));
    render(<AccessRequestsPage />);
    expect(await screen.findByText('Nenhuma solicitação registrada.')).toBeTruthy();
    await waitFor(() => expect(consentService.getPurposeCodes).toHaveBeenCalled());
    expect(within(screen.getByTestId('access-request-duo-select')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Nenhuma']);
    expect(screen.queryByTestId('access-requests-error')).toBeNull();
  });

  it('sends every added item with its own type, and opens nothing when the backend returns no request', async () => {
    vi.mocked(accessRequestService.getAll)
      .mockResolvedValueOnce({ data: { success: true, data: [] } } as any)
      .mockResolvedValueOnce({ data: { success: true, data: [pendingRequest()] } } as any);
    vi.mocked(accessRequestService.create).mockResolvedValue({ data: { success: true } } as any);
    const user = userEvent.setup({ delay: null });
    render(<AccessRequestsPage />);

    await fill(user, screen.getByTestId('access-request-requester-input'), 'researcher-1');
    await user.selectOptions(screen.getByTestId('access-request-organization-select'), 'org-1');
    await fill(user, screen.getByTestId('access-request-study-input'), 'study-1');
    await fill(user, screen.getByTestId('access-request-protocol-input'), 'protocol-1');
    await fill(user, screen.getByTestId('access-request-purpose-input'), 'Pesquisa');
    await user.selectOptions(screen.getByTestId('access-request-item-type-1'), 'dataset');
    await fill(user, screen.getByTestId('access-request-item-id-1'), 'DS-1');
    await user.click(screen.getByTestId('access-request-add-item'));
    await user.selectOptions(screen.getByTestId('access-request-item-type-2'), 'file');
    await fill(user, screen.getByTestId('access-request-item-id-2'), 'F-2');
    await user.click(screen.getByTestId('access-request-submit'));

    await waitFor(() => expect(accessRequestService.create).toHaveBeenCalledWith(expect.objectContaining({
      requestedItems: [{ itemType: 'dataset', itemId: 'DS-1' }, { itemType: 'file', itemId: 'F-2' }],
    })));
    expect(await screen.findByTestId('access-request-row-ar-1')).toBeTruthy();
    expect(screen.queryByTestId('access-requests-error')).toBeNull();
    expect(screen.queryByTestId('access-request-detail')).toBeNull();
    expect(screen.queryByTestId('access-request-item-id-2')).toBeNull();
  });

  it('shows the backend message when a registration is refused, and a failed access check as -', async () => {
    vi.mocked(accessRequestService.getAll).mockResolvedValue({ data: { success: true, data: [pendingRequest()] } } as any);
    vi.mocked(accessRequestService.accessCheck).mockRejectedValue(new Error('offline'));
    vi.mocked(accessRequestService.create).mockRejectedValue({ response: { data: { message: 'Estudo inexistente' } } });
    const user = userEvent.setup({ delay: null });
    render(<AccessRequestsPage />);
    await user.click(await screen.findByTestId('access-request-open-ar-1'));
    await waitFor(() => expect(accessRequestService.accessCheck).toHaveBeenCalledWith('ar-1'));
    expect(screen.getByTestId('access-request-access-check').textContent).toBe('Acesso: -');

    fireEvent.submit(screen.getByTestId('access-request-form'));
    expect((await screen.findByTestId('access-requests-error')).textContent).toBe('Estudo inexistente');
    expect(screen.getByTestId('access-request-detail')).toBeTruthy();
  });

  it('shows a decided, released request: its decision, the evaluation\'s n/a and empty cells, and no distribute button', async () => {
    const released = decidedRequest({
      protocolVersion: null,
      duoCode: null,
      compatibilityEvaluatedAt: '2026-10-09T10:05:00.000Z',
      overallCompatible: true,
      consentCompatibility: [{
        itemId: 'SP-1', itemType: 'specimen', participantId: null, consentValid: null,
        consentAuthorizationDecisionId: null, consentAuthorizationResult: null,
        consentAuthorizationReasons: [], duoCompatible: true, studyActive: false, compatible: true,
      } as any],
      policyDecision: { effect: 'permit', reasons: [] },
      distributionStatus: 'released',
      distributedAt: null,
      distributionDecisionId: 'dec-1',
    });
    vi.mocked(accessRequestService.getAll).mockResolvedValue({ data: { success: true, data: [released] } } as any);
    vi.mocked(accessRequestService.accessCheck).mockResolvedValue({ data: { success: true } } as any);
    const user = userEvent.setup({ delay: null });
    render(<AccessRequestsPage />);
    await user.click(await screen.findByTestId('access-request-open-ar-1'));

    const detail = await screen.findByTestId('access-request-detail');
    expect(within(detail).getByText('Protocolo').nextElementSibling?.textContent?.trim()).toBe('protocol-1');
    expect(screen.getByTestId('access-request-duo').textContent).toBe('-');
    expect(screen.getByTestId('access-request-overall').textContent).toMatch(/: compatível$/);
    const cells = Array.from(screen.getByTestId('access-request-item-SP-1').querySelectorAll('td')).map((td) => td.textContent);
    expect(cells).toEqual(['specimen: SP-1', '-', 'n/a', '-', 'sim', 'não', 'sim']);
    expect(screen.getByTestId('access-request-policy').textContent).toBe('Política de acesso: permit');
    expect(screen.getByTestId('access-request-decision-status').textContent).toBe(
      `approved em ${new Date('2026-10-10T12:00:00.000Z').toLocaleString('pt-BR')}: conforme o protocolo (política v3)`,
    );
    expect(screen.queryByTestId('access-decision-form')).toBeNull();
    expect(screen.getByTestId('access-request-distribution-status').textContent).toBe('Disponibilizada em - pela decisão dec-1');
    expect(screen.queryByTestId('access-request-distribute')).toBeNull();
    expect(screen.getByTestId('access-revoke-form')).toBeTruthy();
    expect(screen.getByTestId('access-request-access-check').textContent).toBe('Acesso: -');
  });

  it('distributes an approved request and updates only that row', async () => {
    const approved = decidedRequest();
    const other = pendingRequest({ accessRequestId: 'ar-2', requesterId: 'researcher-2' });
    vi.mocked(accessRequestService.getAll).mockResolvedValue({ data: { success: true, data: [approved, other] } } as any);
    vi.mocked(accessRequestService.distribute).mockResolvedValue({ data: { success: true, data: decidedRequest({
      distributionStatus: 'released', distributedAt: '2026-10-11T09:00:00.000Z', distributionDecisionId: 'dec-1',
    }) } } as any);
    const user = userEvent.setup({ delay: null });
    render(<AccessRequestsPage />);
    await user.click(await screen.findByTestId('access-request-open-ar-1'));
    expect(screen.getByTestId('access-request-distribution-status').textContent).toBe('Não disponibilizada');

    await user.click(screen.getByTestId('access-request-distribute'));

    expect(accessRequestService.distribute).toHaveBeenCalledWith('ar-1');
    await waitFor(() => expect(screen.getByTestId('access-request-distribution-status').textContent).toBe(
      `Disponibilizada em ${new Date('2026-10-11T09:00:00.000Z').toLocaleString('pt-BR')} pela decisão dec-1`,
    ));
    expect(screen.queryByTestId('access-request-distribute')).toBeNull();
    expect(screen.getByTestId('access-request-row-ar-1').textContent).toContain('released');
    expect(screen.getByTestId('access-request-row-ar-2').textContent).toContain('researcher-2');
    expect(screen.getByTestId('access-request-row-ar-2').textContent).toContain('pending');
  });

  it('revokes with the trimmed justification: a refusal keeps the text, a success clears it', async () => {
    vi.mocked(accessRequestService.getAll).mockResolvedValue({ data: { success: true, data: [decidedRequest()] } } as any);
    vi.mocked(accessRequestService.revoke)
      .mockRejectedValueOnce(new Error('Revogação indisponível'))
      .mockResolvedValueOnce({ data: { success: true } } as any);
    const user = userEvent.setup({ delay: null });
    render(<AccessRequestsPage />);
    await user.click(await screen.findByTestId('access-request-open-ar-1'));

    const input = screen.getByTestId('access-revoke-justification-input') as HTMLInputElement;
    await fill(user, input, ' consentimento retirado ');
    await user.click(screen.getByTestId('access-request-revoke'));
    expect((await screen.findByTestId('access-request-detail-error')).textContent).toBe('Revogação indisponível');
    expect(input.value).toBe(' consentimento retirado ');

    await user.click(screen.getByTestId('access-request-revoke'));
    await waitFor(() => expect(input.value).toBe(''));
    expect(accessRequestService.revoke).toHaveBeenLastCalledWith('ar-1', { justification: 'consentimento retirado' });
    expect(screen.queryByTestId('access-request-detail-error')).toBeNull();
  });

  it('sends a conditioned decision with its validity, clears the form after, and hides the dates for a rejection', async () => {
    vi.mocked(accessRequestService.getAll).mockResolvedValue({ data: { success: true, data: [pendingRequest()] } } as any);
    vi.mocked(accessRequestService.decide).mockResolvedValue({ data: { success: true } } as any);
    const user = userEvent.setup({ delay: null });
    render(<AccessRequestsPage />);
    await user.click(await screen.findByTestId('access-request-open-ar-1'));

    await user.selectOptions(screen.getByTestId('access-decision-status-select'), 'conditioned');
    fireEvent.change(screen.getByTestId('access-decision-start-input'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByTestId('access-decision-end-input'), { target: { value: '2026-12-31' } });
    await fill(user, screen.getByTestId('access-decision-justification-input'), 'com ressalvas');
    await user.click(screen.getByTestId('access-decision-submit'));

    await waitFor(() => expect(accessRequestService.decide).toHaveBeenCalledWith('ar-1', {
      status: 'conditioned',
      justification: 'com ressalvas',
      approvalPeriod: {
        start: new Date('2026-10-01T00:00:00').toISOString(),
        end: new Date('2026-12-31T23:59:59').toISOString(),
      },
    }));
    await waitFor(() => expect((screen.getByTestId('access-decision-justification-input') as HTMLInputElement).value).toBe(''));
    expect((screen.getByTestId('access-decision-start-input') as HTMLInputElement).value).toBe('');

    await user.selectOptions(screen.getByTestId('access-decision-status-select'), 'rejected');
    expect(screen.queryByTestId('access-decision-start-input')).toBeNull();
    expect(screen.queryByTestId('access-decision-end-input')).toBeNull();
  });
});
