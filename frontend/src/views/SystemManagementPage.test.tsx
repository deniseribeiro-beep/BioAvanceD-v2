import { describe, expect, it } from 'vitest';
import { resolveOrganizationLabel, buildOrganizationSubmissionPayload } from './SystemManagementPage';
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

describe('buildOrganizationSubmissionPayload', () => {
  it('#606: strips server-managed fields (organizationId, normalizedName, _id) before submission', () => {
    const formData: Partial<Organization> = {
      _id: 'mongo-id',
      organizationId: 'org-1',
      normalizedName: 'hospital das clinicas',
      officialName: 'Hospital das Clínicas',
      countryCode: 'BR',
    };

    const payload = buildOrganizationSubmissionPayload(formData);

    expect((payload as any)._id).toBeUndefined();
    expect((payload as any).organizationId).toBeUndefined();
    expect((payload as any).normalizedName).toBeUndefined();
    expect(payload.officialName).toBe('Hospital das Clínicas');
    expect(payload.countryCode).toBe('BR');
  });

  it('#606: normalizes empty optional fields (acronym, organizationType, website) to null, not empty string', () => {
    const formData: Partial<Organization> = {
      officialName: 'Hospital das Clínicas',
      countryCode: 'BR',
      acronym: '',
      organizationType: '',
      website: '',
    };

    const payload = buildOrganizationSubmissionPayload(formData);

    expect(payload.acronym).toBeNull();
    expect(payload.organizationType).toBeNull();
    expect(payload.website).toBeNull();
  });

  it('#606: keeps a non-empty acronym/organizationType/website as-is', () => {
    const formData: Partial<Organization> = {
      officialName: 'Hospital das Clínicas',
      countryCode: 'BR',
      acronym: 'HC',
      organizationType: 'Hospital',
      website: 'https://hc.example.org',
    };

    const payload = buildOrganizationSubmissionPayload(formData);

    expect(payload.acronym).toBe('HC');
    expect(payload.organizationType).toBe('Hospital');
    expect(payload.website).toBe('https://hc.example.org');
  });
});
