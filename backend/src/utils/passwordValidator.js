/**
 * Utilitário para validação de senha
 * Requisitos:
 * - Mínimo de 12 caracteres
 * - Pelo menos uma letra maiúscula
 * - Pelo menos uma letra minúscula
 * - Pelo menos um caractere especial
 */
class PasswordValidator {
  /**
   * Valida se a senha atende aos requisitos
   * @param {string} password - Senha a ser validada
   * @returns {Object} - { isValid: boolean, errors: string[] }
   */
  static validate(password) {
    const errors = [];

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
   * @param {string} password - Senha a ser validada
   * @returns {string|null} - Mensagem de erro ou null se válida
   */
  static validateAndGetError(password) {
    const validation = this.validate(password);
    if (!validation.isValid) {
      return validation.errors.join('. ');
    }
    return null;
  }

  /**
   * Valida senha e lança erro se inválida
   * @param {string} password - Senha a ser validada
   * @throws {Error} - Se a senha não atender aos requisitos
   */
  static validateOrThrow(password) {
    const validation = this.validate(password);
    if (!validation.isValid) {
      throw new Error(validation.errors.join('. '));
    }
  }
}

module.exports = PasswordValidator;

