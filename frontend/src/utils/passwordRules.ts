// #1246: the rules are the server's passwordRules policy, served by
// GET /api/auth/password-policy (usePasswordPolicy). DEFAULT_PASSWORD_RULES is
// the backend's own default (security.service getDefaultConfig), used until the
// policy arrives or when it cannot be read, so a form never shows looser rules
// than the server's default. The symbol class is password.service's.
export interface PasswordStrengthRules {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
}

export const DEFAULT_PASSWORD_RULES: PasswordStrengthRules = Object.freeze({
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
});

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
