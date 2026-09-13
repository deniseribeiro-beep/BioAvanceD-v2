import { describe, it, expect } from 'vitest';

const {
  CONSENT_SCOPES,
  getAllScopes,
  getScopeByKey,
  getScopesByCategory,
  getHighRiskScopes,
  isScopeValid,
  getOperationsRequiringScope,
  validateScopesForOperation
} = require('../../../src/config/consentScopes');

describe('config/consentScopes', () => {
  describe('CONSENT_SCOPES', () => {
    it('contains the expected scope entries with required fields', () => {
      const entries = Object.values(CONSENT_SCOPES);
      expect(entries.length).toBe(11);
      entries.forEach(scope => {
        expect(typeof scope.key).toBe('string');
        expect(scope.key.length).toBeGreaterThan(0);
        expect(typeof scope.label).toBe('string');
        expect(typeof scope.description).toBe('string');
        expect(typeof scope.category).toBe('string');
        expect(['low', 'medium', 'high']).toContain(scope.riskLevel);
        expect(Array.isArray(scope.requiredFor)).toBe(true);
      });
    });

    it('has unique keys across all scopes', () => {
      const keys = Object.values(CONSENT_SCOPES).map(s => s.key);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });

    it('defines ANALISE_GENETICA with null retention (indefinite per LGPD)', () => {
      expect(CONSENT_SCOPES.ANALISE_GENETICA.retention).toBeNull();
      expect(CONSENT_SCOPES.ANALISE_GENETICA.riskLevel).toBe('high');
      expect(CONSENT_SCOPES.ANALISE_GENETICA.category).toBe('genetic');
    });

    it('defines USO_PESQUISA with a numeric retention of 5 years in days', () => {
      expect(CONSENT_SCOPES.USO_PESQUISA.retention).toBe(365 * 5);
    });
  });

  describe('getAllScopes', () => {
    it('returns an array of all 11 scope objects', () => {
      const scopes = getAllScopes();
      expect(Array.isArray(scopes)).toBe(true);
      expect(scopes.length).toBe(11);
      expect(scopes).toEqual(expect.arrayContaining([CONSENT_SCOPES.USO_PESQUISA]));
    });
  });

  describe('getScopeByKey', () => {
    it('returns the matching scope for a known key', () => {
      const scope = getScopeByKey('uso_comercial');
      expect(scope).toEqual(CONSENT_SCOPES.USO_COMERCIAL);
    });

    it('returns null for an unknown key', () => {
      expect(getScopeByKey('does_not_exist')).toBeNull();
    });

    it('returns null for an undefined/empty key', () => {
      expect(getScopeByKey(undefined)).toBeNull();
      expect(getScopeByKey('')).toBeNull();
    });
  });

  describe('getScopesByCategory', () => {
    it('returns all scopes for a category with multiple entries (research)', () => {
      const scopes = getScopesByCategory('research');
      const expectedKeys = ['uso_pesquisa', 'uso_secundario_dados', 'amostra_controle'];
      expect(scopes.map(s => s.key).sort()).toEqual(expectedKeys.sort());
    });

    it('returns all scopes for the genetic category', () => {
      const scopes = getScopesByCategory('genetic');
      expect(scopes.map(s => s.key).sort()).toEqual(
        ['analise_genetica', 'dados_geneticos_familia'].sort()
      );
    });

    it('returns an empty array for an unknown category', () => {
      expect(getScopesByCategory('nonexistent_category')).toEqual([]);
    });
  });

  describe('getHighRiskScopes', () => {
    it('returns only scopes with riskLevel high', () => {
      const highRisk = getHighRiskScopes();
      const expectedKeys = [
        'uso_comercial',
        'compartilhamento_internacional',
        'analise_genetica',
        'dados_geneticos_familia'
      ];
      expect(highRisk.map(s => s.key).sort()).toEqual(expectedKeys.sort());
      highRisk.forEach(s => expect(s.riskLevel).toBe('high'));
    });
  });

  describe('isScopeValid', () => {
    it('returns true for a known scope key', () => {
      expect(isScopeValid('recontato_paciente')).toBe(true);
    });

    it('returns false for an unknown scope key', () => {
      expect(isScopeValid('unknown_scope_key')).toBe(false);
    });

    it('returns false for undefined/empty input', () => {
      expect(isScopeValid(undefined)).toBe(false);
      expect(isScopeValid('')).toBe(false);
    });
  });

  describe('getOperationsRequiringScope', () => {
    it('returns the requiredFor list for a known scope', () => {
      expect(getOperationsRequiringScope('analise_genetica')).toEqual([
        'sequenciamento',
        'genotipagem',
        'analise_cromossomica'
      ]);
    });

    it('returns an empty array for an unknown scope key', () => {
      expect(getOperationsRequiringScope('unknown_scope_key')).toEqual([]);
    });
  });

  describe('validateScopesForOperation', () => {
    it('returns true when a granted scope covers the operation', () => {
      expect(
        validateScopesForOperation(['uso_pesquisa'], 'sequenciamento')
      ).toBe(true);
    });

    it('returns false when granted scopes do not cover the operation', () => {
      expect(
        validateScopesForOperation(['uso_pesquisa'], 'patente')
      ).toBe(false);
    });

    it('returns false when granted scopes list is empty', () => {
      expect(validateScopesForOperation([], 'sequenciamento')).toBe(false);
    });

    it('returns true when any of multiple granted scopes covers the operation', () => {
      expect(
        validateScopesForOperation(
          ['recontato_paciente', 'uso_comercial'],
          'patente'
        )
      ).toBe(true);
    });

    it('returns false for an operation that is not required by any scope', () => {
      expect(
        validateScopesForOperation(['uso_pesquisa', 'uso_comercial'], 'nonexistent_operation')
      ).toBe(false);
    });
  });
});
