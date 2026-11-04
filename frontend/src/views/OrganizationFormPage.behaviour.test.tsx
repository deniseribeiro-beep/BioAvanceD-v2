import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const navigate = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (_k: string, fb?: string) => fb ?? _k, language: 'pt-BR' }),
}));

const orgsHook = vi.hoisted(() => ({
  organizations: [] as any[],
  createOrganization: vi.fn(),
  updateOrganization: vi.fn(),
}));

vi.mock('../hooks/useOrganizations', () => ({
  useOrganizations: () => orgsHook,
}));

import OrganizationFormPage from './OrganizationFormPage';

async function fill(user: ReturnType<typeof userEvent.setup>, input: HTMLElement, value: string) {
  await user.clear(input);
  await user.paste(value);
}

function renderForm(path: string, state?: object) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path="/organizations/new" element={<OrganizationFormPage />} />
        <Route path="/organizations/:id/edit" element={<OrganizationFormPage />} />
      </Routes>
    </MemoryRouter>
  );
}

let alertSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  navigate.mockReset();
  orgsHook.organizations = [];
  orgsHook.createOrganization.mockResolvedValue(undefined);
  orgsHook.updateOrganization.mockResolvedValue(undefined);
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OrganizationFormPage', () => {
  it('creates with empty optionals as null and upper-cases country', async () => {
    const user = userEvent.setup();
    renderForm('/organizations/new');
    await fill(user, screen.getByTestId('organization-official-name-input'), 'Instituto Novo');
    await fill(user, screen.getByTestId('organization-country-code-input'), 'br');
    expect(screen.getByTestId('organization-country-code-input')).toHaveValue('BR');
    await user.click(screen.getByTestId('organization-form-submit'));
    await waitFor(() =>
      expect(orgsHook.createOrganization).toHaveBeenCalledWith({
        officialName: 'Instituto Novo',
        acronym: null,
        organizationType: null,
        countryCode: 'BR',
        website: null,
      })
    );
    expect(navigate).toHaveBeenCalledWith('/system-management?tab=organizations');
  });

  it('updates without organizationId in the payload', async () => {
    const user = userEvent.setup();
    const org = {
      organizationId: 'org-1',
      officialName: 'Hospital Central',
      acronym: 'HC',
      organizationType: 'hospital',
      countryCode: 'BR',
      website: 'https://hc.example.org',
    };
    renderForm('/organizations/org-1/edit', { organization: org });
    await fill(user, screen.getByTestId('organization-official-name-input'), 'Hospital Renomeado');
    await user.click(screen.getByTestId('organization-form-submit'));
    await waitFor(() =>
      expect(orgsHook.updateOrganization).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ officialName: 'Hospital Renomeado', countryCode: 'BR' })
      )
    );
    expect(orgsHook.createOrganization).not.toHaveBeenCalled();
  });

  it('alerts on failed save and Cancel returns to list', async () => {
    const user = userEvent.setup();
    orgsHook.createOrganization.mockRejectedValueOnce(new Error('Nome duplicado'));
    renderForm('/organizations/new');
    await fill(user, screen.getByTestId('organization-official-name-input'), 'X');
    await fill(user, screen.getByTestId('organization-country-code-input'), 'BR');
    await user.click(screen.getByTestId('organization-form-submit'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Nome duplicado'));
    expect(navigate).not.toHaveBeenCalled();
    await user.click(screen.getByText('common.cancel'));
    expect(navigate).toHaveBeenCalledWith('/system-management?tab=organizations');
  });
});
