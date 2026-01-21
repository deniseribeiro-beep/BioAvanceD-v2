/**
 * Utilitário para validação de senha no frontend
 * Requisitos:
 * - Mínimo de 8 caracteres
 * - Pelo menos uma letra maiúscula
 * - Pelo menos uma letra minúscula
 * - Pelo menos um número
 * - Pelo menos um caractere especial
 */
import { getPasswordIssues, PasswordIssue, meetsAllPasswordRules } from './passwordRules';

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Valida se a senha atende aos requisitos
 */
export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (!password || typeof password !== 'string') {
    errors.push('Senha é obrigatória');
    return { isValid: false, errors };
  }

  const issues = getPasswordIssues(password);

  const issueMessages: Record<PasswordIssue, string> = {
    minLength: 'A senha deve ter no mínimo 8 caracteres',
    upper: 'A senha deve conter pelo menos uma letra maiúscula',
    lower: 'A senha deve conter pelo menos uma letra minúscula',
    number: 'A senha deve conter pelo menos um número',
    symbol: 'A senha deve conter pelo menos um caractere especial (!@#$%^&*()_-+=[]{}|;:,.<>?/)' 
  };

  issues.forEach((issue) => {
    errors.push(issueMessages[issue]);
  });

  return {
    isValid: meetsAllPasswordRules(password),
    errors
  };
}

/**
 * Valida senha e retorna mensagem de erro formatada
 */
export function validatePasswordAndGetError(password: string): string | null {
  const validation = validatePassword(password);
  if (!validation.isValid) {
    return validation.errors.join('. ');
  }
  return null;
}

