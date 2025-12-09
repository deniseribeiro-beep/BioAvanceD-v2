/**
 * Utilitário para validação de senha no frontend
 * Requisitos:
 * - Mínimo de 12 caracteres
 * - Pelo menos uma letra maiúscula
 * - Pelo menos uma letra minúscula
 * - Pelo menos um caractere especial
 */

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

  // Verifica comprimento mínimo
  if (password.length < 12) {
    errors.push('A senha deve ter no mínimo 12 caracteres');
  }

  // Verifica letra maiúscula
  if (!/[A-Z]/.test(password)) {
    errors.push('A senha deve conter pelo menos uma letra maiúscula');
  }

  // Verifica letra minúscula
  if (!/[a-z]/.test(password)) {
    errors.push('A senha deve conter pelo menos uma letra minúscula');
  }

  // Verifica caractere especial
  if (!/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) {
    errors.push('A senha deve conter pelo menos um caractere especial (!@#$%^&*()_+-=[]{}|;:,.<>?)');
  }

  return {
    isValid: errors.length === 0,
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

