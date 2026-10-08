import { describe, it, expect } from 'vitest';
const crypto = require('crypto');
const ConsentTemplateModel = require('../../../src/models/ConsentTemplate');

// RF010 AC1: a term records its language, jurisdiction, the checksum of its
// exact text and the consent modality it offers.
describe('ConsentTemplateModel document control (RF010 AC1)', () => {
  const base = { title: 'TCLE', htmlContent: '<p>Termo exato</p>' };

  it('computes the checksum from the text and defaults language and jurisdiction', () => {
    const template = ConsentTemplateModel.create(base);
    const expected = crypto.createHash('sha256').update('<p>Termo exato</p>', 'utf8').digest('hex');
    expect(template).toMatchObject({
      language: 'pt-BR',
      jurisdiction: 'BR',
      consentModel: null,
      checksum: `sha256:${expected}`,
    });
  });

  it('never takes the checksum from the caller', () => {
    const template = ConsentTemplateModel.create({ ...base, checksum: 'sha256:forged' });
    expect(template.checksum).not.toBe('sha256:forged');
  });

  it('records a given language, jurisdiction and consent model', () => {
    const template = ConsentTemplateModel.create({ ...base, language: 'en-US', jurisdiction: 'US', consentModel: 'broad' });
    expect(template).toMatchObject({ language: 'en-US', jurisdiction: 'US', consentModel: 'broad' });
  });

  it('refuses a language that is not BCP 47 and a modality outside ENUM-0043..0046', () => {
    const { errors } = ConsentTemplateModel.validate({ ...base, language: 'portuguese!', consentModel: 'implied' });
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('BCP 47'),
      expect.stringContaining('consentModel deve ser um de: specific, broad, tiered, dynamic'),
    ]));
  });
});
