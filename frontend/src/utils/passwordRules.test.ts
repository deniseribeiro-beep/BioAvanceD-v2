import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PASSWORD_RULES,
  getPasswordIssues,
  meetsAllPasswordRules,
  passwordRequirementItems,
} from './passwordRules';
import { validatePasswordAndGetError } from './passwordValidator';

// #1246: the forms check the server's passwordRules policy, not a fixed copy.
describe('passwordRules (#1246)', () => {
  it('defaults to the backend default: 8 characters with upper, lower, digit and symbol', () => {
    expect(DEFAULT_PASSWORD_RULES).toEqual({
      minLength: 8, requireUppercase: true, requireLowercase: true, requireNumbers: true, requireSpecialChars: true,
    });
    expect(getPasswordIssues('Secure1!')).toEqual([]);
    expect(getPasswordIssues('secure')).toEqual(['minLength', 'upper', 'number', 'symbol']);
  });

  it('applies a policy minimum length and skips a class the policy turns off', () => {
    const rules = { ...DEFAULT_PASSWORD_RULES, minLength: 12, requireNumbers: false };
    expect(getPasswordIssues('Secure!abc', rules)).toEqual(['minLength']);
    expect(meetsAllPasswordRules('Secure!abcdef', rules)).toBe(true);
  });

  it("accepts the backend's whole symbol class, quote and backslash included", () => {
    expect(getPasswordIssues("Secure1'x")).toEqual([]);
    expect(getPasswordIssues('Secure1\\x')).toEqual([]);
  });

  it('names the policy length in the validator message', () => {
    expect(validatePasswordAndGetError('Secure1!', { ...DEFAULT_PASSWORD_RULES, minLength: 10 }))
      .toBe('A senha deve ter no mínimo 10 caracteres');
  });

  it('lists only the requirements the policy turns on, with its length', () => {
    const t = (key: string, fallback?: string) => (key === 'password.requirements.minLengthN' ? 'Min {{n}}' : fallback || key);
    const items = passwordRequirementItems({ ...DEFAULT_PASSWORD_RULES, minLength: 14, requireSpecialChars: false }, t);
    expect(items.map((item) => item.key)).toEqual(['minLength', 'upper', 'lower', 'number']);
    expect(items[0].label).toBe('Min 14');
  });
});
