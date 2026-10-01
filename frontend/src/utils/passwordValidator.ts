/**
 * Utilitário para validação de senha no frontend.
 * #1246: os requisitos são a política passwordRules do servidor
 * (usePasswordPolicy); sem ela, o padrão do backend.
 */
import {
  getPasswordIssues,
  PasswordIssue,
  PasswordStrengthRules,
  DEFAULT_PASSWORD_RULES,
} from './passwordRules';

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Valida se a senha atende aos requisitos
 */
export function validatePassword(password: string, rules: PasswordStrengthRules = DEFAULT_PASSWORD_RULES): PasswordValidationResult {
  const errors: string[] = [];

  if (!password || typeof password !== 'string') {
    errors.push('Senha é obrigatória');
    return { isValid: false, errors };
  }

  const issues = getPasswordIssues(password, rules);

  const issueMessages: Record<PasswordIssue, string> = {
    minLength: `A senha deve ter no mínimo ${rules.minLength} caracteres`,
    upper: 'A senha deve conter pelo menos uma letra maiúscula',
    lower: 'A senha deve conter pelo menos uma letra minúscula',
    number: 'A senha deve conter pelo menos um número',
    symbol: 'A senha deve conter pelo menos um caractere especial (!@#$%^&*()_-+=[]{}|;:,.<>?/)' 
  };

  issues.forEach((issue) => {
    errors.push(issueMessages[issue]);
  });

  return {
    isValid: issues.length === 0,
    errors
  };
}

/**
 * Valida senha e retorna mensagem de erro formatada
 */
export function validatePasswordAndGetError(password: string, rules: PasswordStrengthRules = DEFAULT_PASSWORD_RULES): string | null {
  const validation = validatePassword(password, rules);
  if (!validation.isValid) {
    return validation.errors.join('. ');
  }
  return null;
}

