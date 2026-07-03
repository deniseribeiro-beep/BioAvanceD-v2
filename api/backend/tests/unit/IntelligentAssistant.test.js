import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const IntelligentAssistantModel = require('../../src/models/IntelligentAssistant');

describe('IntelligentAssistantModel', () => {
  describe('validate', () => {
    it('returns isValid true with no errors for a valid payload', () => {
      const result = IntelligentAssistantModel.validate({
        modelVersion: 'GPT-4.1',
        contextScope: 'Interface'
      });

      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('reports missing modelVersion individually', () => {
      const result = IntelligentAssistantModel.validate({
        contextScope: 'Interface'
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('modelVersion é obrigatório e deve ser string');
      expect(result.errors.length).toBe(1);
    });

    it('reports non-string modelVersion', () => {
      const result = IntelligentAssistantModel.validate({
        modelVersion: 123,
        contextScope: 'Interface'
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('modelVersion é obrigatório e deve ser string');
    });

    it('compounds two errors when contextScope is missing entirely (both checks run unconditionally)', () => {
      const result = IntelligentAssistantModel.validate({
        modelVersion: 'GPT-4.1'
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBe(2);
      expect(result.errors).toContain('contextScope é obrigatório e deve ser string');
      expect(result.errors.some((e) => e.includes('contextScope deve ser um dos'))).toBe(true);
    });

    it('compounds two errors when contextScope is a string but not in validScopes', () => {
      const result = IntelligentAssistantModel.validate({
        modelVersion: 'GPT-4.1',
        contextScope: 'InvalidScope'
      });

      expect(result.isValid).toBe(false);
      // contextScope IS a string, so the type-check passes (no error from line 14-16),
      // but the validScopes.includes check still fails, producing exactly one error
      // for contextScope (not "compounded" with the type error, since that check
      // is skipped when the string check succeeds).
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain('contextScope deve ser um dos');
    });

    it('produces two contextScope-related errors when contextScope is missing (falsy)', () => {
      // Missing contextScope fails BOTH the truthy/type check (line 14) AND the
      // validScopes.includes check (line 20), since undefined is not in validScopes.
      const result = IntelligentAssistantModel.validate({
        modelVersion: 'GPT-4.1',
        contextScope: ''
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBe(2);
      expect(result.errors).toContain('contextScope é obrigatório e deve ser string');
      expect(result.errors.some((e) => e.includes('contextScope deve ser um dos'))).toBe(true);
    });

    it('rejects a contextScope with wrong casing (exact match only, no normalization)', () => {
      const result = IntelligentAssistantModel.validate({
        modelVersion: 'GPT-4.1',
        contextScope: 'interface'
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('contextScope deve ser um dos'))).toBe(true);
    });

    it('accepts each documented valid contextScope', () => {
      const validScopes = ['Interface', 'Fluxo Tutorial', 'Documentação', 'Perguntas sobre Procedimentos'];
      validScopes.forEach((scope) => {
        const result = IntelligentAssistantModel.validate({
          modelVersion: 'GPT-4.1',
          contextScope: scope
        });
        expect(result.isValid).toBe(true);
      });
    });
  });

  describe('create', () => {
    it('builds an object with assistantID defaulting to null when omitted', () => {
      const result = IntelligentAssistantModel.create({
        modelVersion: 'GPT-4.1',
        contextScope: 'Interface'
      });

      expect(result.assistantID).toBeNull();
      expect(result.modelVersion).toBe('GPT-4.1');
      expect(result.contextScope).toBe('Interface');
    });

    it('preserves an explicit assistantID', () => {
      const result = IntelligentAssistantModel.create({
        assistantID: 42,
        modelVersion: 'GPT-4.1',
        contextScope: 'Interface'
      });

      expect(result.assistantID).toBe(42);
    });

    it('defaults lastInteraction to null when omitted', () => {
      const result = IntelligentAssistantModel.create({
        modelVersion: 'GPT-4.1',
        contextScope: 'Interface'
      });

      expect(result.lastInteraction).toBeNull();
    });

    it('coerces a non-Date lastInteraction (string) into a Date instance', () => {
      const result = IntelligentAssistantModel.create({
        modelVersion: 'GPT-4.1',
        contextScope: 'Interface',
        lastInteraction: '2024-01-15T10:00:00.000Z'
      });

      expect(result.lastInteraction).toBeInstanceOf(Date);
      expect(result.lastInteraction.toISOString()).toBe('2024-01-15T10:00:00.000Z');
    });

    it('keeps an already-Date lastInteraction as the same instance (not re-wrapped)', () => {
      const date = new Date('2024-06-01T00:00:00.000Z');
      const result = IntelligentAssistantModel.create({
        modelVersion: 'GPT-4.1',
        contextScope: 'Interface',
        lastInteraction: date
      });

      expect(result.lastInteraction).toBe(date);
    });

    it('sets createdAt and updatedAt to Date instances', () => {
      const result = IntelligentAssistantModel.create({
        modelVersion: 'GPT-4.1',
        contextScope: 'Interface'
      });

      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('validateAccess', () => {
    it('returns true only for strict boolean true', () => {
      expect(IntelligentAssistantModel.validateAccess(true)).toBe(true);
    });

    it('returns false for false', () => {
      expect(IntelligentAssistantModel.validateAccess(false)).toBe(false);
    });

    it('returns false for a truthy non-boolean value like 1 (strict equality, not truthiness)', () => {
      expect(IntelligentAssistantModel.validateAccess(1)).toBe(false);
    });

    it('returns false for the string "true" (strict equality, not truthiness)', () => {
      expect(IntelligentAssistantModel.validateAccess('true')).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(IntelligentAssistantModel.validateAccess(undefined)).toBe(false);
    });
  });

  describe('isValidContextScope', () => {
    it('returns true for each scope also accepted by validate()', () => {
      const validScopes = ['Interface', 'Fluxo Tutorial', 'Documentação', 'Perguntas sobre Procedimentos'];
      validScopes.forEach((scope) => {
        expect(IntelligentAssistantModel.isValidContextScope(scope)).toBe(true);
      });
    });

    it('returns false for a scope rejected by validate()', () => {
      expect(IntelligentAssistantModel.isValidContextScope('InvalidScope')).toBe(false);
    });

    it('returns false for wrong casing, consistent with validate()', () => {
      expect(IntelligentAssistantModel.isValidContextScope('interface')).toBe(false);
    });

    it('returns false for non-string input', () => {
      expect(IntelligentAssistantModel.isValidContextScope(null)).toBe(false);
      expect(IntelligentAssistantModel.isValidContextScope(undefined)).toBe(false);
    });
  });
});
