import { describe, it, expect } from 'vitest';
const ImportPredictor = require('../../../src/services/ImportPredictor');

describe('ImportPredictor - normalizeHeader', () => {
  it('strips diacritics, trims and lowercases accented Portuguese headers', () => {
    expect(ImportPredictor.normalizeHeader('Data de Nascimento')).toBe('data de nascimento');
    expect(ImportPredictor.normalizeHeader('  Óbito  ')).toBe('obito');
    expect(ImportPredictor.normalizeHeader('Responsável')).toBe('responsavel');
  });

  it('handles null/undefined/empty header gracefully', () => {
    expect(ImportPredictor.normalizeHeader(null)).toBe('');
    expect(ImportPredictor.normalizeHeader(undefined)).toBe('');
    expect(ImportPredictor.normalizeHeader('')).toBe('');
  });
});

describe('ImportPredictor - normalizeValue', () => {
  it('stringifies and trims values, treating null/undefined as empty string', () => {
    expect(ImportPredictor.normalizeValue('  hello  ')).toBe('hello');
    expect(ImportPredictor.normalizeValue(null)).toBe('');
    expect(ImportPredictor.normalizeValue(undefined)).toBe('');
    expect(ImportPredictor.normalizeValue(123)).toBe('123');
  });
});

describe('ImportPredictor - isCpfCandidate boundary cases', () => {
  it('rejects 10-digit strings', () => {
    expect(ImportPredictor.isCpfCandidate('1234567890')).toBe(false);
  });

  it('accepts 11-digit strings (CPF)', () => {
    expect(ImportPredictor.isCpfCandidate('12345678901')).toBe(true);
  });

  it('accepts 11 digits with formatting punctuation stripped', () => {
    expect(ImportPredictor.isCpfCandidate('123.456.789-01')).toBe(true);
  });

  it('accepts 14-digit strings (CNPJ)', () => {
    expect(ImportPredictor.isCpfCandidate('12345678901234')).toBe(true);
  });

  it('rejects 15-digit strings', () => {
    expect(ImportPredictor.isCpfCandidate('123456789012345')).toBe(false);
  });

  it('rejects non-numeric or empty values', () => {
    expect(ImportPredictor.isCpfCandidate('abc')).toBe(false);
    expect(ImportPredictor.isCpfCandidate('')).toBe(false);
    expect(ImportPredictor.isCpfCandidate(null)).toBe(false);
  });
});

describe('ImportPredictor - isDateCandidate', () => {
  it('accepts ISO format YYYY-MM-DD', () => {
    expect(ImportPredictor.isDateCandidate('2024-01-31')).toBe(true);
  });

  it('accepts BR format DD/MM/YYYY', () => {
    expect(ImportPredictor.isDateCandidate('31/01/2024')).toBe(true);
  });

  it('accepts BR format DD-MM-YYYY', () => {
    expect(ImportPredictor.isDateCandidate('31-01-2024')).toBe(true);
  });

  it('rejects garbage/non-date strings', () => {
    expect(ImportPredictor.isDateCandidate('not a date')).toBe(false);
    expect(ImportPredictor.isDateCandidate('12345')).toBe(false);
    expect(ImportPredictor.isDateCandidate('')).toBe(false);
    expect(ImportPredictor.isDateCandidate(null)).toBe(false);
  });

  it('rejects malformed near-matches (wrong digit grouping)', () => {
    expect(ImportPredictor.isDateCandidate('2024/01/31')).toBe(false);
    expect(ImportPredictor.isDateCandidate('1/1/2024')).toBe(false);
  });
});

describe('ImportPredictor - header heuristic detectors', () => {
  it('headerSuggestsDeceased matches status/vivo/obito/falecido keywords', () => {
    expect(ImportPredictor.headerSuggestsDeceased('Status Vital')).toBe(true);
    expect(ImportPredictor.headerSuggestsDeceased('Óbito')).toBe(true);
    expect(ImportPredictor.headerSuggestsDeceased('Falecido?')).toBe(true);
    expect(ImportPredictor.headerSuggestsDeceased('Nome do Paciente')).toBe(false);
  });

  it('headerSuggestsRepresentative matches responsavel/representante', () => {
    expect(ImportPredictor.headerSuggestsRepresentative('E-mail do Responsável')).toBe(true);
    expect(ImportPredictor.headerSuggestsRepresentative('Representante Legal')).toBe(true);
    expect(ImportPredictor.headerSuggestsRepresentative('Email')).toBe(false);
  });
});

describe('ImportPredictor - inferField priority ordering', () => {
  it('gives canonicalHeaderMap direct hits top priority (0.99) even when heuristics would also match', () => {
    // "email" is a direct canonical key; ensure the direct match wins with reason text
    const result = ImportPredictor.inferField('Email', 'not-an-email-value');
    expect(result).toEqual({
      targetField: 'email',
      confidence: 0.99,
      reason: 'Mapeamento direto por nome de coluna'
    });
  });

  it('direct canonical match wins over a value that would otherwise suggest CPF', () => {
    // "cpf" header is canonical -> should short-circuit rather than fall into CPF heuristic branch
    const result = ImportPredictor.inferField('CPF', '12345678901');
    expect(result.targetField).toBe('cpf');
    expect(result.confidence).toBe(0.99);
  });

  it('routes an email value under a representative-flavored header to representativeEmail', () => {
    const result = ImportPredictor.inferField('Email do Responsável', 'joao@example.com');
    expect(result.targetField).toBe('representativeEmail');
    expect(result.confidence).toBe(0.94);
  });

  it('routes a plain email value (no representative wording) to email', () => {
    const result = ImportPredictor.inferField('Contato', 'joao@example.com');
    expect(result.targetField).toBe('email');
    expect(result.confidence).toBe(0.92);
  });

  it('routes deceased-suggesting headers to isDeceased ahead of other heuristics', () => {
    const result = ImportPredictor.inferField('Status Vital', 'Vivo');
    expect(result.targetField).toBe('isDeceased');
    expect(result.confidence).toBe(0.95);
  });

  it('routes CPF-shaped values under a representative header to representativeCpf', () => {
    const result = ImportPredictor.inferField('CPF do Responsável', '12345678901');
    expect(result.targetField).toBe('representativeCpf');
    expect(result.confidence).toBe(0.9);
  });

  it('routes representative+name header (no matching value heuristic) to representativeName', () => {
    const result = ImportPredictor.inferField('Nome do Responsável', 'Maria Souza');
    expect(result.targetField).toBe('representativeName');
    expect(result.confidence).toBe(0.88);
  });

  it('routes unit-suggesting header to clinicalUnit', () => {
    const result = ImportPredictor.inferField('Unidade Hospitalar', 'Hemocentro');
    expect(result.targetField).toBe('clinicalUnit');
    expect(result.confidence).toBe(0.85);
  });

  it('routes plain name header to patientName', () => {
    const result = ImportPredictor.inferField('Nome Completo', 'João da Silva');
    expect(result.targetField).toBe('patientName');
    expect(result.confidence).toBe(0.82);
  });

  it('returns no inference for an unrecognized header/value pair', () => {
    const result = ImportPredictor.inferField('Observações Diversas XYZ', 'algo qualquer');
    expect(result).toEqual({
      targetField: null,
      confidence: 0,
      reason: 'Sem inferência suficiente'
    });
  });
});

describe('ImportPredictor - predict end-to-end', () => {
  it('builds userColumns, bioFields, suggestions and suggestedMapping for a mixed header set', () => {
    const headers = ['Nome Completo', 'Email', 'CPF', 'Coluna Desconhecida XYZ'];
    const firstRow = {
      'Nome Completo': 'Maria Silva',
      Email: 'maria@example.com',
      CPF: '12345678901',
      'Coluna Desconhecida XYZ': 'valor aleatorio'
    };

    const result = ImportPredictor.predict(headers, firstRow);

    expect(result.userColumns).toEqual(headers);
    expect(result.bioFields).toEqual(ImportPredictor.bioFields);
    expect(result.suggestions).toHaveLength(4);

    // Every header appears in suggestions, including the unmapped one
    const bySource = Object.fromEntries(result.suggestions.map((s) => [s.sourceColumn, s]));
    expect(bySource['Nome Completo'].targetField).toBe('patientName');
    expect(bySource.Email.targetField).toBe('email');
    expect(bySource.CPF.targetField).toBe('cpf');
    expect(bySource['Coluna Desconhecida XYZ'].targetField).toBeNull();
    expect(bySource['Coluna Desconhecida XYZ'].confidence).toBe(0);

    // suggestedMapping only contains confidently-mapped columns
    expect(result.suggestedMapping).toEqual({
      'Nome Completo': 'patientName',
      Email: 'email',
      CPF: 'cpf'
    });
    expect(result.suggestedMapping).not.toHaveProperty('Coluna Desconhecida XYZ');
  });

  it('carries the sampleValue through into each suggestion, defaulting missing values to null', () => {
    const headers = ['Email', 'Sem Valor'];
    const firstRow = { Email: 'a@b.com' };

    const result = ImportPredictor.predict(headers, firstRow);
    const bySource = Object.fromEntries(result.suggestions.map((s) => [s.sourceColumn, s]));

    expect(bySource.Email.sampleValue).toBe('a@b.com');
    expect(bySource['Sem Valor'].sampleValue).toBeNull();
  });

  it('defaults to empty headers/firstRow when called with no arguments', () => {
    const result = ImportPredictor.predict();
    expect(result.userColumns).toEqual([]);
    expect(result.suggestions).toEqual([]);
    expect(result.suggestedMapping).toEqual({});
  });
});
