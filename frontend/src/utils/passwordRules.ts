const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=\[\]{}|;:,.<>/?]).{8,}$/;

export type PasswordIssue =
  | 'minLength'
  | 'upper'
  | 'lower'
  | 'number'
  | 'symbol';

export function getPasswordIssues(password: string): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  if (!password || password.length < 8) issues.push('minLength');
  if (!/[A-Z]/.test(password)) issues.push('upper');
  if (!/[a-z]/.test(password)) issues.push('lower');
  if (!/\d/.test(password)) issues.push('number');
  if (!/[!@#$%^&*()_\-+=\[\]{}|;:,.<>/?]/.test(password)) issues.push('symbol');
  return issues;
}

export function meetsAllPasswordRules(password: string): boolean {
  return PASSWORD_REGEX.test(password || '');
}

export { PASSWORD_REGEX };
