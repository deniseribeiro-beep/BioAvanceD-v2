import { beforeEach, describe, expect, it, vi } from 'vitest';
import { organizationService } from '../services/api';
import { loadCreateOrganizationChoice } from './useCreateOrganizationChoice';

// #1354: a create form asks for an organization only when the caller has a
// choice, mirroring the backend's resolveOrganizationIdForCreate.
vi.mock('../services/api', () => ({
  organizationService: {
    getMine: vi.fn(),
    getAll: vi.fn(),
  },
}));

function mockMine(scope: string, organizations: Array<{ organizationId: string; officialName: string | null }> = []) {
  vi.mocked(organizationService.getMine).mockResolvedValue({ data: { success: true, data: { scope, organizations } } } as any);
}

describe('loadCreateOrganizationChoice (#1354)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires a pick among a multi-organization caller\'s own organizations', async () => {
    const organizations = [
      { organizationId: 'org-a', officialName: 'A' },
      { organizationId: 'org-b', officialName: 'B' },
    ];
    mockMine('organization', organizations);
    await expect(loadCreateOrganizationChoice()).resolves.toEqual({ show: true, required: true, options: organizations });
    expect(organizationService.getAll).not.toHaveBeenCalled();
  });

  it('offers a global caller every organization, optionally', async () => {
    mockMine('global');
    vi.mocked(organizationService.getAll).mockResolvedValue({
      data: { success: true, data: [{ organizationId: 'org-z', officialName: 'Z' }] },
    } as any);
    await expect(loadCreateOrganizationChoice()).resolves.toEqual({
      show: true,
      required: false,
      options: [{ organizationId: 'org-z', officialName: 'Z' }],
    });
  });

  it('shows nothing to a single-organization or org-less caller', async () => {
    mockMine('organization', [{ organizationId: 'org-a', officialName: 'A' }]);
    await expect(loadCreateOrganizationChoice()).resolves.toMatchObject({ show: false });
    mockMine('none');
    await expect(loadCreateOrganizationChoice()).resolves.toMatchObject({ show: false });
  });
});
