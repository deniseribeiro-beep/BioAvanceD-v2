import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  SAMPLE_ORGANIZATION_FIELD,
  sampleOrganizationOf,
  isSampleInOrganizationScope,
  sampleOrganizationScopeClause,
  applySampleOrganizationScope,
} = require('../../src/services/sampleTenancy.service');

// #1192: a sample's tenancy key is organizationId, falling back to
// collectionSite (ELM-0128) for a document stored before the backfill.

const GLOBAL = { scope: 'global' };
const ORG_A = { scope: 'organization', organizationIds: ['org-a'] };

describe('sampleOrganizationOf', () => {
  it('names organizationId as the field', () => {
    expect(SAMPLE_ORGANIZATION_FIELD).toBe('organizationId');
  });

  it('reads organizationId over collectionSite', () => {
    expect(sampleOrganizationOf({ organizationId: 'org-a', collectionSite: 'site-b' })).toBe('org-a');
  });

  it('falls back to collectionSite when organizationId is null, missing or empty', () => {
    expect(sampleOrganizationOf({ organizationId: null, collectionSite: 'org-a' })).toBe('org-a');
    expect(sampleOrganizationOf({ collectionSite: 'org-a' })).toBe('org-a');
    expect(sampleOrganizationOf({ organizationId: '', collectionSite: 'org-a' })).toBe('org-a');
  });

  it('returns null when neither is set, and a String otherwise', () => {
    expect(sampleOrganizationOf({})).toBeNull();
    expect(sampleOrganizationOf({ organizationId: '', collectionSite: '' })).toBeNull();
    expect(sampleOrganizationOf(null)).toBeNull();
    expect(sampleOrganizationOf({ organizationId: 42 })).toBe('42');
  });
});

describe('isSampleInOrganizationScope', () => {
  it('is true for a global scope, even for a sample with no organization', () => {
    expect(isSampleInOrganizationScope({}, GLOBAL)).toBe(true);
  });

  it('is true in scope by organizationId, false out of it', () => {
    expect(isSampleInOrganizationScope({ organizationId: 'org-a' }, ORG_A)).toBe(true);
    expect(isSampleInOrganizationScope({ organizationId: 'org-b' }, ORG_A)).toBe(false);
  });

  it('reads organizationId first: a partner collection site does not move the sample', () => {
    expect(isSampleInOrganizationScope({ organizationId: 'org-b', collectionSite: 'org-a' }, ORG_A)).toBe(false);
  });

  it('is in scope by collectionSite when organizationId is missing', () => {
    expect(isSampleInOrganizationScope({ collectionSite: 'org-a' }, ORG_A)).toBe(true);
  });

  it('is out of scope for an organization scope when the sample has no organization', () => {
    expect(isSampleInOrganizationScope({ organizationId: null, collectionSite: null }, ORG_A)).toBe(false);
  });
});

describe('sampleOrganizationScopeClause', () => {
  it('is null for a global scope', () => {
    expect(sampleOrganizationScopeClause(GLOBAL)).toBeNull();
  });

  it('matches organizationId, or collectionSite where organizationId is null, missing or empty', () => {
    expect(sampleOrganizationScopeClause(ORG_A)).toEqual({
      $or: [
        { organizationId: { $in: ['org-a'] } },
        { organizationId: { $in: [null, ''] }, collectionSite: { $in: ['org-a'] } },
      ],
    });
  });
});

describe('applySampleOrganizationScope', () => {
  it('leaves the query alone for a global scope', () => {
    const query = { specimenStatus: 'available' };
    expect(applySampleOrganizationScope(query, GLOBAL)).toEqual({ specimenStatus: 'available' });
  });

  it('creates $and when the query has none', () => {
    const query = applySampleOrganizationScope({}, ORG_A);
    expect(query.$and).toEqual([sampleOrganizationScopeClause(ORG_A)]);
  });

  it('keeps a top-level $or and appends to an existing $and', () => {
    const search = [{ specimenId: /x/ }, { barcode: /x/ }];
    const prior = { quantity: { $gt: 0 } };
    const query = { $or: search, $and: [prior] };

    const result = applySampleOrganizationScope(query, ORG_A);

    expect(result).toBe(query);
    expect(result.$or).toBe(search);
    expect(result.$and).toEqual([prior, sampleOrganizationScopeClause(ORG_A)]);
  });
});
