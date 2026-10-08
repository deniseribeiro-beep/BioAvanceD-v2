import { describe, expect, it } from 'vitest';
import {
  resolveOrganizationLabel,
  buildOrganizationSubmissionPayload,
  parseSemicolonTags,
  formatSemicolonTags,
  buildCollectionFormState,
  buildCollectionSubmissionPayload,
} from './SystemManagementPage';
import type { Organization, Collection } from '../types/models';

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

describe('parseSemicolonTags', () => {
  it('#607: splits on ";", trims whitespace, and drops empty entries', () => {
    expect(parseSemicolonTags('plasma; serum ;  tissue')).toEqual(['plasma', 'serum', 'tissue']);
  });

  it('#607: returns an empty array for an empty or whitespace-only string', () => {
    expect(parseSemicolonTags('')).toEqual([]);
    expect(parseSemicolonTags('   ')).toEqual([]);
    expect(parseSemicolonTags(';;')).toEqual([]);
  });
});

describe('formatSemicolonTags', () => {
  it('#607: joins the given key from each item with "; "', () => {
    expect(formatSemicolonTags([{ text: 'plasma' }, { text: 'serum' }], 'text')).toBe('plasma; serum');
  });

  it('#607: returns an empty string for undefined/non-array input', () => {
    expect(formatSemicolonTags(undefined, 'text')).toBe('');
    expect(formatSemicolonTags([], 'text')).toBe('');
  });
});

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    collectionId: 'col-1',
    collectionName: 'Biobanco Central',
    ...overrides,
  };
}

describe('buildCollectionFormState', () => {
  it('#607: defaults a new (null) collection to empty fields and active status', () => {
    const state = buildCollectionFormState(null);
    expect(state.collectionId).toBe('');
    expect(state.collectionStatus).toBe('active');
    expect(state.sampleTypesText).toBe('');
  });

  it('#607: formats an existing collection\'s CodeableConcept[]/Identifier[] fields back into semicolon text for editing', () => {
    const collection = makeCollection({
      sampleTypes: [{ text: 'plasma' }, { text: 'serum' }],
      relatedPublications: [{ value: 'doi:10.1/xyz' }],
      participantCount: 250,
    });

    const state = buildCollectionFormState(collection);

    expect(state.sampleTypesText).toBe('plasma; serum');
    expect(state.relatedPublicationsText).toBe('doi:10.1/xyz');
    expect(state.participantCount).toBe('250');
  });
});

describe('buildCollectionSubmissionPayload', () => {
  it('#607: parses semicolon-separated text fields into ELM-0043..0049 CodeableConcept[] objects ({ text }) per dict-02_DICIONARIO.md', () => {
    const state = buildCollectionFormState(null);
    state.collectionId = 'col-2';
    state.collectionName = 'Biobanco Regional';
    state.sampleTypesText = 'plasma; serum; tissue';

    const payload = buildCollectionSubmissionPayload(state);

    expect(payload.sampleTypes).toEqual([{ text: 'plasma' }, { text: 'serum' }, { text: 'tissue' }]);
  });

  it('#607: parses relatedPublications into Identifier[] objects ({ value }), not { text } (ELM-0052 is Identifier[], not CodeableConcept[])', () => {
    const state = buildCollectionFormState(null);
    state.collectionId = 'col-2';
    state.collectionName = 'Biobanco Regional';
    state.relatedPublicationsText = 'doi:10.1/xyz; pmid:12345';

    const payload = buildCollectionSubmissionPayload(state);

    expect(payload.relatedPublications).toEqual([{ value: 'doi:10.1/xyz' }, { value: 'pmid:12345' }]);
  });

  it('#607: normalizes empty participantCount/sampleCount to null and non-empty to a number', () => {
    const state = buildCollectionFormState(null);
    state.collectionId = 'col-2';
    state.collectionName = 'Biobanco Regional';
    state.participantCount = '';
    state.sampleCount = '1200';

    const payload = buildCollectionSubmissionPayload(state);

    expect(payload.participantCount).toBeNull();
    expect(payload.sampleCount).toBe(1200);
  });

  // RF004 AC2, V2E-0427: the regime chosen in the form reaches the payload;
  // none chosen sends null, which the backend refuses.
  it('carries the chosen governanceRegime, and null when none was chosen', () => {
    const state = buildCollectionFormState(null);
    expect(state.governanceRegime).toBe('');
    state.collectionId = 'col-2';
    state.collectionName = 'Biobanco Regional';

    expect(buildCollectionSubmissionPayload(state).governanceRegime).toBeNull();

    state.governanceRegime = 'biobank';
    expect(buildCollectionSubmissionPayload(state).governanceRegime).toBe('biobank');
  });

  it('keeps an existing collection\'s governanceRegime in the edit state', () => {
    const state = buildCollectionFormState(makeCollection({ governanceRegime: 'biorepository' }));
    expect(state.governanceRegime).toBe('biorepository');
  });

  it('#607: normalizes empty exclusionCriteria to null', () => {
    const state = buildCollectionFormState(null);
    state.collectionId = 'col-2';
    state.collectionName = 'Biobanco Regional';
    state.exclusionCriteria = '';

    const payload = buildCollectionSubmissionPayload(state);

    expect(payload.exclusionCriteria).toBeNull();
  });

  it('#607: round-trips an existing collection through buildCollectionFormState then back through buildCollectionSubmissionPayload unchanged', () => {
    const collection = makeCollection({
      collectionStatus: 'active',
      sampleTypes: [{ text: 'plasma' }],
      datasetTypes: [{ text: 'genomic' }],
      participantCount: 10,
      sampleCount: 20,
      relatedPublications: [{ value: 'doi:10.1/xyz' }],
    });

    const payload = buildCollectionSubmissionPayload(buildCollectionFormState(collection));

    expect(payload.collectionId).toBe('col-1');
    expect(payload.sampleTypes).toEqual([{ text: 'plasma' }]);
    expect(payload.datasetTypes).toEqual([{ text: 'genomic' }]);
    expect(payload.participantCount).toBe(10);
    expect(payload.sampleCount).toBe(20);
    expect(payload.relatedPublications).toEqual([{ value: 'doi:10.1/xyz' }]);
  });
});
