import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PASSWORD_RULES,
  getPasswordIssues,
  meetsAllPasswordRules,
  passwordRequirementItems,
  rulesForAccount,
} from './passwordRules';
import { validatePasswordAndGetError } from './passwordValidator';

// #1257: the composition flags default off now, so the tests of those flags
// turn them on.
const STRICT = {
  ...DEFAULT_PASSWORD_RULES, minLength: 8, requireUppercase: true, requireLowercase: true, requireNumbers: true, requireSpecialChars: true,
};

// #1246: the forms check the server's passwordRules policy, not a fixed copy.
describe('passwordRules (#1246)', () => {
  // #1257: the backend default after NIST SP 800-63B-4: length only.
  it('defaults to the backend default: 15 characters (8 with MFA) and no composition rule', () => {
    expect(DEFAULT_PASSWORD_RULES).toEqual({
      minLength: 15, minLengthWithMFA: 8, requireUppercase: false, requireLowercase: false, requireNumbers: false, requireSpecialChars: false,
    });
    expect(getPasswordIssues('correcthorsebat')).toEqual([]);
    expect(getPasswordIssues('secure')).toEqual(['minLength']);
  });

  it('#1257: rulesForAccount gives an MFA account the MFA floor, never above minLength', () => {
    expect(rulesForAccount(DEFAULT_PASSWORD_RULES, true).minLength).toBe(8);
    expect(rulesForAccount(DEFAULT_PASSWORD_RULES, false).minLength).toBe(15);
    expect(rulesForAccount({ ...DEFAULT_PASSWORD_RULES, minLength: 10, minLengthWithMFA: 20 }, true).minLength).toBe(10);
    const { minLengthWithMFA: _omitted, ...noMfaFloor } = DEFAULT_PASSWORD_RULES;
    expect(rulesForAccount(noMfaFloor, true).minLength).toBe(15);
  });

  it('applies a policy minimum length and skips a class the policy turns off', () => {
    const rules = { ...DEFAULT_PASSWORD_RULES, minLength: 12, requireNumbers: false };
    expect(getPasswordIssues('Secure!abc', rules)).toEqual(['minLength']);
    expect(meetsAllPasswordRules('Secure!abcdef', rules)).toBe(true);
  });

  it("accepts the backend's whole symbol class, quote and backslash included", () => {
    expect(getPasswordIssues("Secure1'x", STRICT)).toEqual([]);
    expect(getPasswordIssues('Secure1\\x', STRICT)).toEqual([]);
  });

  it('names the policy length in the validator message', () => {
    expect(validatePasswordAndGetError('Secure1!', { ...DEFAULT_PASSWORD_RULES, minLength: 10 }))
      .toBe('A senha deve ter no mínimo 10 caracteres');
  });

  it('lists only the requirements the policy turns on, with its length', () => {
    const t = (key: string, fallback?: string) => (key === 'password.requirements.minLengthN' ? 'Min {{n}}' : fallback || key);
    const items = passwordRequirementItems({ ...STRICT, minLength: 14, requireSpecialChars: false }, t);
    expect(items.map((item) => item.key)).toEqual(['minLength', 'upper', 'lower', 'number']);
    expect(items[0].label).toBe('Min 14');
  });
});
