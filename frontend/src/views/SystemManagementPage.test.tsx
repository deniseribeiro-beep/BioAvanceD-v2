import { describe, expect, it } from 'vitest';
import { resolveOrganizationLabel } from './SystemManagementPage';
import type { Organization } from '../types/models';

function makeOrganization(overrides: Partial<Organization> = {}): Organization {
  return {
    organizationId: 'org-1',
    officialName: 'Hospital das Clínicas',
    countryCode: 'BR',
    ...overrides,
  };
}

describe('resolveOrganizationLabel', () => {
  it('#349: resolves a User.organizationId to its Organization.officialName for display', () => {
    const organizations = [makeOrganization()];
    expect(resolveOrganizationLabel(organizations, 'org-1')).toBe('Hospital das Clínicas');
  });

  it('#349: falls back to a dash when the user has no organization assigned (was previously "-" for empty institution)', () => {
    expect(resolveOrganizationLabel([], null)).toBe('-');
    expect(resolveOrganizationLabel([], undefined)).toBe('-');
  });

  it('falls back to a dash when the organizationId does not match any known organization', () => {
    const organizations = [makeOrganization({ organizationId: 'org-1' })];
    expect(resolveOrganizationLabel(organizations, 'org-does-not-exist')).toBe('-');
  });
});
