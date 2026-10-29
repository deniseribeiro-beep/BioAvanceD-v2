import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UserOrganizationScopes from './UserOrganizationScopes';
import { LanguageProvider } from '../contexts/LanguageContext';
import { userService } from '../services/api';

vi.mock('../services/api', () => ({
  userService: {
    getOrganizationScopes: vi.fn(),
    addOrganizationScope: vi.fn(),
    removeOrganizationScope: vi.fn(),
  },
}));

const organizations = [
  { organizationId: 'org-a', officialName: 'Hospital A' },
  { organizationId: 'org-b', officialName: 'Hospital B' },
  { organizationId: 'org-c', officialName: 'Hospital C' },
];

const envelope = (data: object) => ({ data: { success: true, data } });

function renderScopes() {
  return render(
    <LanguageProvider>
      <UserOrganizationScopes userId="user-1" organizations={organizations} />
    </LanguageProvider>
  );
}

// #1358: the form adds and removes a user's further organizations through
// their own routes, and shows only the organizations beyond the home one.
describe('UserOrganizationScopes', () => {
  beforeEach(() => {
    vi.mocked(userService.getOrganizationScopes).mockReset();
    vi.mocked(userService.addOrganizationScope).mockReset();
    vi.mocked(userService.removeOrganizationScope).mockReset();
  });

  it('lists the organizations beyond the home one, and offers only those not held', async () => {
    vi.mocked(userService.getOrganizationScopes).mockResolvedValue(envelope({
      homeOrganizationId: 'org-a', global: false, organizationIds: ['org-a', 'org-b'],
    }) as any);

    renderScopes();

    expect(await screen.findByTestId('user-organization-scope-org-b')).toHaveTextContent('Hospital B');
    expect(screen.queryByTestId('user-organization-scope-org-a')).toBeNull();
    const options = Array.from(screen.getByTestId('user-organization-scope-select').querySelectorAll('option')).map((o) => o.value);
    expect(options).toEqual(['', 'org-c']);
  });

  it('adds the selected organization through its route and shows the answer', async () => {
    vi.mocked(userService.getOrganizationScopes).mockResolvedValue(envelope({
      homeOrganizationId: 'org-a', global: false, organizationIds: ['org-a'],
    }) as any);
    vi.mocked(userService.addOrganizationScope).mockResolvedValue(envelope({
      homeOrganizationId: 'org-a', global: false, organizationIds: ['org-a', 'org-c'],
    }) as any);

    renderScopes();
    await userEvent.selectOptions(await screen.findByTestId('user-organization-scope-select'), 'org-c');
    await userEvent.click(screen.getByTestId('user-organization-scope-add'));

    expect(userService.addOrganizationScope).toHaveBeenCalledWith('user-1', 'org-c');
    expect(await screen.findByTestId('user-organization-scope-org-c')).toHaveTextContent('Hospital C');
  });

  it('removes an organization through its route, and shows a refusal', async () => {
    vi.mocked(userService.getOrganizationScopes).mockResolvedValue(envelope({
      homeOrganizationId: 'org-a', global: false, organizationIds: ['org-a', 'org-b'],
    }) as any);
    vi.mocked(userService.removeOrganizationScope).mockRejectedValue({
      response: { data: { message: 'A última organização do usuário não pode ser removida' } },
    });

    renderScopes();
    await userEvent.click(await screen.findByTestId('user-organization-scope-remove-org-b'));

    expect(userService.removeOrganizationScope).toHaveBeenCalledWith('user-1', 'org-b');
    expect(await screen.findByRole('alert')).toHaveTextContent('A última organização');
    expect(screen.getByTestId('user-organization-scope-org-b')).toBeInTheDocument();
  });

  it('offers nothing to an Administrador, whose scope is global', async () => {
    vi.mocked(userService.getOrganizationScopes).mockResolvedValue(envelope({
      homeOrganizationId: null, global: true, organizationIds: [],
    }) as any);

    renderScopes();

    await waitFor(() => expect(screen.getByTestId('user-organization-scopes')).toBeInTheDocument());
    expect(screen.queryByTestId('user-organization-scope-select')).toBeNull();
  });
});
