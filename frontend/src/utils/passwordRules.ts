// #1246: the rules are the server's passwordRules policy, served by
// GET /api/auth/password-policy (usePasswordPolicy). DEFAULT_PASSWORD_RULES is
// the backend's own default (security.service getDefaultConfig), used until the
// policy arrives or when it cannot be read, so a form never shows looser rules
// than the server's default. The symbol class is password.service's.
//
// #1257: minLength is the floor for an account that signs in without MFA, and
// minLengthWithMFA the floor for one enrolled in MFA (NIST SP 800-63B-4
// §3.1.1.2). rulesForAccount picks the one that applies.
export interface PasswordStrengthRules {
  minLength: number;
  minLengthWithMFA?: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
}

export const DEFAULT_PASSWORD_RULES: PasswordStrengthRules = Object.freeze({
  minLength: 15,
  minLengthWithMFA: 8,
  requireUppercase: false,
  requireLowercase: false,
  requireNumbers: false,
  requireSpecialChars: false,
});

// #1257: the rules for one account. Without MFA, or with no MFA floor served,
// minLength; never above minLength either way, as the server caps it.
export function rulesForAccount(rules: PasswordStrengthRules, signsInWithMfa: boolean): PasswordStrengthRules {
  if (!signsInWithMfa || !Number.isInteger(rules.minLengthWithMFA)) return rules;
  return { ...rules, minLength: Math.min(rules.minLengthWithMFA as number, rules.minLength) };
}

const SPECIAL_CHARACTER = /[!@#$%^&*()_\-+=[\]{};':"\\|,.<>/?]/;

export type PasswordIssue =
  | 'minLength'
  | 'upper'
  | 'lower'
  | 'number'
  | 'symbol';

export function getPasswordIssues(password: string, rules: PasswordStrengthRules = DEFAULT_PASSWORD_RULES): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  const value = password || '';
  if (value.length < rules.minLength) issues.push('minLength');
  if (rules.requireUppercase && !/[A-Z]/.test(value)) issues.push('upper');
  if (rules.requireLowercase && !/[a-z]/.test(value)) issues.push('lower');
  if (rules.requireNumbers && !/\d/.test(value)) issues.push('number');
  if (rules.requireSpecialChars && !SPECIAL_CHARACTER.test(value)) issues.push('symbol');
  return issues;
}

export function meetsAllPasswordRules(password: string, rules: PasswordStrengthRules = DEFAULT_PASSWORD_RULES): boolean {
  return getPasswordIssues(password, rules).length === 0;
}

// The checklist the password forms render: only the rules the policy turns on,
// with the policy's own minimum length in the first label.
export function passwordRequirementItems(
  rules: PasswordStrengthRules,
  t: (key: string, fallback?: string) => string
): { key: PasswordIssue; label: string }[] {
  const items: { key: PasswordIssue; label: string; on: boolean }[] = [
    {
      key: 'minLength',
      label: t('password.requirements.minLengthN', 'Mínimo de {{n}} caracteres').replace('{{n}}', String(rules.minLength)),
      on: true,
    },
    { key: 'upper', label: t('password.requirements.upper'), on: rules.requireUppercase },
    { key: 'lower', label: t('password.requirements.lower'), on: rules.requireLowercase },
    { key: 'number', label: t('password.requirements.number'), on: rules.requireNumbers },
    { key: 'symbol', label: t('password.requirements.symbol'), on: rules.requireSpecialChars },
  ];
  return items.filter((item) => item.on).map(({ key, label }) => ({ key, label }));
}
