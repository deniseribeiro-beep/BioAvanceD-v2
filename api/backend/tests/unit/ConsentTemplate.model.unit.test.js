import { describe, it, expect } from 'vitest';

const ConsentTemplateModel = require('../../src/models/ConsentTemplate');

describe('ConsentTemplateModel.validate', () => {
  it('rejeita payload vazio com todos os campos obrigatórios ausentes', () => {
    const result = ConsentTemplateModel.validate({});

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'title é obrigatório e deve ser um texto válido',
      'content é obrigatório e deve ser um texto válido',
    ]));
  });

  it('rejeita title/content em branco (whitespace only)', () => {
    const result = ConsentTemplateModel.validate({ title: '   ', content: '   ' });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('title é obrigatório e deve ser um texto válido');
    expect(result.errors).toContain('content é obrigatório e deve ser um texto válido');
  });

  it('rejeita title/content que não sejam string', () => {
    const result = ConsentTemplateModel.validate({ title: 123, content: true });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('title é obrigatório e deve ser um texto válido');
    expect(result.errors).toContain('content é obrigatório e deve ser um texto válido');
  });

  it('rejeita version que não seja string ou vazia', () => {
    const result = ConsentTemplateModel.validate({
      title: 'TCLE', content: '<p>x</p>', version: '   ',
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('version deve ser um texto válido');
  });

  it('aceita version ausente (campo opcional)', () => {
    const result = ConsentTemplateModel.validate({ title: 'TCLE', content: '<p>x</p>' });

    expect(result.isValid).toBe(true);
  });

  it('rejeita caae que não seja string ou vazia', () => {
    const result = ConsentTemplateModel.validate({
      title: 'TCLE', content: '<p>x</p>', caae: '   ',
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('caae deve ser um texto válido');
  });

  it('rejeita active que não seja booleano', () => {
    const result = ConsentTemplateModel.validate({
      title: 'TCLE', content: '<p>x</p>', active: 'yes',
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('active deve ser booleano');
  });

  it('rejeita permissions que não seja array', () => {
    const result = ConsentTemplateModel.validate({
      title: 'TCLE', content: '<p>x</p>', permissions: 'not-an-array',
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('permissions deve ser um array');
  });

  it('aceita permissions array vazio', () => {
    const result = ConsentTemplateModel.validate({
      title: 'TCLE', content: '<p>x</p>', permissions: [],
    });

    expect(result.isValid).toBe(true);
  });

  it('rejeita permission não-objeto (null) sem quebrar demais validações', () => {
    const result = ConsentTemplateModel.validate({
      title: 'TCLE', content: '<p>x</p>', permissions: [null],
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('permissions[0] deve ser um objeto');
  });

  it('rejeita permission.required que não seja booleano', () => {
    const result = ConsentTemplateModel.validate({
      title: 'TCLE',
      content: '<p>x</p>',
      permissions: [{ key: 'research', label: 'Pesquisa', required: 'yes' }],
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('permissions[0].required deve ser booleano');
  });

  it('acumula múltiplos erros de diferentes campos simultaneamente', () => {
    const result = ConsentTemplateModel.validate({
      version: '',
      caae: '',
      active: 'not-bool',
      permissions: [{}],
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('title é obrigatório e deve ser um texto válido');
    expect(result.errors).toContain('content é obrigatório e deve ser um texto válido');
    expect(result.errors).toContain('version deve ser um texto válido');
    expect(result.errors).toContain('caae deve ser um texto válido');
    expect(result.errors).toContain('active deve ser booleano');
    expect(result.errors).toContain('permissions[0].key é obrigatório e deve ser string');
    expect(result.errors).toContain('permissions[0].label é obrigatório e deve ser string');
  });
});

describe('ConsentTemplateModel.create', () => {
  it('preenche todos os campos opcionais e faz trim quando fornecidos', () => {
    const template = ConsentTemplateModel.create({
      title: '  TCLE Pesquisa  ',
      content: '  <p>Texto</p>  ',
      htmlContent: '  <p>Html</p>  ',
      version: '  v3  ',
      versionGroupId: '  group-1  ',
      previousTemplateId: '  prev-1  ',
      caae: '  12345678.9.0000.0000  ',
      active: false,
      permissions: [{ key: 'research', label: 'Pesquisa', required: true }],
    });

    expect(template.title).toBe('TCLE Pesquisa');
    expect(template.content).toBe('<p>Texto</p>');
    expect(template.htmlContent).toBe('<p>Html</p>');
    expect(template.version).toBe('v3');
    expect(template.versionGroupId).toBe('group-1');
    expect(template.previousTemplateId).toBe('prev-1');
    expect(template.caae).toBe('12345678.9.0000.0000');
    expect(template.active).toBe(false);
    expect(template.permissions).toEqual([
      { key: 'research', label: 'Pesquisa', required: true },
    ]);
    expect(template.createdAt).toBeInstanceOf(Date);
  });

  it('usa htmlContent como fonte de content quando content ausente', () => {
    const template = ConsentTemplateModel.create({
      title: 'TCLE',
      htmlContent: '<p>Somente html</p>',
    });

    expect(template.content).toBe('<p>Somente html</p>');
    expect(template.htmlContent).toBe('<p>Somente html</p>');
  });

  it('deriva htmlContent a partir de content quando htmlContent ausente', () => {
    const template = ConsentTemplateModel.create({
      title: 'TCLE',
      content: '<p>Somente content</p>',
    });

    expect(template.htmlContent).toBe('<p>Somente content</p>');
  });

  it('aplica defaults quando version/versionGroupId/previousTemplateId/caae/permissions ausentes', () => {
    const template = ConsentTemplateModel.create({
      title: 'TCLE',
      content: '<p>x</p>',
    });

    expect(template.version).toBe('v1');
    expect(template.versionGroupId).toBeUndefined();
    expect(template.previousTemplateId).toBeUndefined();
    expect(template.caae).toBe('');
    expect(template.active).toBe(true);
    expect(template.permissions).toEqual([]);
  });

  it('ignora versionGroupId/previousTemplateId em branco (fallback undefined)', () => {
    const template = ConsentTemplateModel.create({
      title: 'TCLE',
      content: '<p>x</p>',
      versionGroupId: '   ',
      previousTemplateId: '   ',
    });

    expect(template.versionGroupId).toBeUndefined();
    expect(template.previousTemplateId).toBeUndefined();
  });

  it('ignora permissions não-array, usando default []', () => {
    const template = ConsentTemplateModel.create({
      title: 'TCLE',
      content: '<p>x</p>',
      permissions: 'not-an-array',
    });

    expect(template.permissions).toEqual([]);
  });
});
