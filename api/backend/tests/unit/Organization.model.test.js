import { describe, it, expect } from 'vitest';
const OrganizationModel = require('../../src/models/Organization');

describe('OrganizationModel.validate', () => {
  it('rejects missing officialName', () => {
    const result = OrganizationModel.validate({ countryCode: 'BR' });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('officialName é obrigatório');
  });

  it('rejects missing countryCode', () => {
    const result = OrganizationModel.validate({ officialName: 'Universidade São Francisco' });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('countryCode é obrigatório');
  });

  it('rejects a countryCode that is not ISO 3166-1 alpha-2', () => {
    const result = OrganizationModel.validate({ officialName: 'USF', countryCode: 'BRA' });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('countryCode deve seguir ISO 3166-1 alpha-2');
  });

  it('rejects an invalid organizationType', () => {
    const result = OrganizationModel.validate({
      officialName: 'USF',
      countryCode: 'BR',
      organizationType: 'clinic'
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('organizationType'))).toBe(true);
  });

  it('rejects a malformed website URI', () => {
    const result = OrganizationModel.validate({
      officialName: 'USF',
      countryCode: 'BR',
      website: 'not-a-url'
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('website deve ser uma URI válida');
  });

  it('rejects qualityStandards that is not a list', () => {
    const result = OrganizationModel.validate({
      officialName: 'USF',
      countryCode: 'BR',
      qualityStandards: 'ISO 20387'
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('qualityStandards deve ser uma lista');
  });

  it('accepts a fully valid payload', () => {
    const result = OrganizationModel.validate({
      officialName: 'Universidade São Francisco',
      acronym: 'USF',
      organizationType: 'university',
      countryCode: 'BR',
      website: 'https://www.usf.edu.br',
      contact: { email: 'contato@usf.edu.br' },
      qualityStandards: ['ISO 20387']
    });
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('OrganizationModel.create', () => {
  it('generates a unique organizationId and normalizedName, defaults optional fields', () => {
    const doc = OrganizationModel.create({
      officialName: '  Universidade  São Francisco  ',
      countryCode: 'br'
    });

    expect(doc.organizationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(doc.officialName).toBe('Universidade São Francisco');
    expect(doc.normalizedName).toBe('UNIVERSIDADE SAO FRANCISCO');
    expect(doc.countryCode).toBe('BR');
    expect(doc.acronym).toBeNull();
    expect(doc.organizationType).toBeNull();
    expect(doc.website).toBeNull();
    expect(doc.contact).toBeNull();
    expect(doc.qualityStandards).toEqual([]);
    expect(doc.createdAt).toBeInstanceOf(Date);
    expect(doc.updatedAt).toBeInstanceOf(Date);
  });

  it('preserves acronym, organizationType, website, contact and qualityStandards when provided', () => {
    const doc = OrganizationModel.create({
      officialName: 'USF Biobank',
      acronym: 'USF-BB',
      organizationType: 'biobank',
      countryCode: 'BR',
      website: 'https://biobank.usf.edu.br',
      contact: { email: 'bio@usf.edu.br' },
      qualityStandards: ['ISO 20387']
    });

    expect(doc.acronym).toBe('USF-BB');
    expect(doc.organizationType).toBe('biobank');
    expect(doc.website).toBe('https://biobank.usf.edu.br');
    expect(doc.contact).toEqual({ email: 'bio@usf.edu.br' });
    expect(doc.qualityStandards).toEqual(['ISO 20387']);
  });

  it('generates distinct organizationId per call', () => {
    const a = OrganizationModel.create({ officialName: 'Org A', countryCode: 'BR' });
    const b = OrganizationModel.create({ officialName: 'Org B', countryCode: 'BR' });
    expect(a.organizationId).not.toBe(b.organizationId);
  });
});
