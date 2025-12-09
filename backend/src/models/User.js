/**
 * Modelo de validação e estrutura para User
 * Inclui suporte a MFA (RF001) e RBAC (RNF008)
 */
class UserModel {
  static validate(data) {
    const errors = [];

    // Campos obrigatórios (exceto telefone e instituição)
    if (!data.name || typeof data.name !== 'string') {
      errors.push('name é obrigatório e deve ser string');
    }

    if (!data.email || typeof data.email !== 'string' || !this.isValidEmail(data.email)) {
      errors.push('email é obrigatório e deve ser um email válido');
    }

    if (!data.username || typeof data.username !== 'string') {
      errors.push('username é obrigatório e deve ser string');
    }

    // Telefone e instituição são opcionais (não validados)
    // Normaliza strings vazias para null
    if (data.phone !== undefined && data.phone !== null && typeof data.phone === 'string') {
      const trimmedPhone = data.phone.trim();
      if (trimmedPhone === '') {
        data.phone = null;
      }
    }
    if (data.institution !== undefined && data.institution !== null && typeof data.institution === 'string') {
      const trimmedInstitution = data.institution.trim();
      if (trimmedInstitution === '') {
        data.institution = null;
      }
    }

    // Senha é obrigatória apenas no cadastro (quando não há _id)
    if (!data._id && !data.password) {
      errors.push('password é obrigatório');
    }
    
    // Se senha for fornecida, valida complexidade
    if (data.password) {
      const PasswordValidator = require('../utils/passwordValidator');
      const passwordValidation = PasswordValidator.validate(data.password);
      if (!passwordValidation.isValid) {
        errors.push(...passwordValidation.errors.map(err => `password: ${err}`));
      }
    }

    if (data.accessType && !this.isValidAccessType(data.accessType)) {
      errors.push('accessType inválido');
    }

    // Valida status - aceita tanto formato inglês quanto português
    const validStatuses = ['active', 'inactive', 'blocked', 'suspended', 'Ativo', 'Inativo', 'Bloqueado', 'Suspenso'];
    if (data.status && !validStatuses.includes(data.status)) {
      errors.push('status deve ser: active/Ativo, inactive/Inativo, blocked/Bloqueado ou suspended/Suspenso');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    return {
      name: data.name,
      email: data.email,
      phone: data.phone || null,
      institution: data.institution || null,
      username: data.username,
      password: data.password, // Será hashado no service
      accessType: data.accessType || 2, // 1=Usuário Externo, 2=Técnico, 3=Coordenador, 4=Administrador
      status: this.normalizeStatus(data.status || 'active'), // Normaliza status para formato inglês
      mfaEnabled: data.mfaEnabled || false,
      mfaSecret: data.mfaSecret || null,
      mfaActivationDate: data.mfaActivationDate || null,
      mfaFailedAttempts: data.mfaFailedAttempts || 0,
      mfaLocked: data.mfaLocked || false,
      anonId: data.anonId || null, // Identificador anonimizado para LGPD (gerado após inserção)
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLogin: null
    };
  }

  static isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  static isValidAccessType(accessType) {
    return [1, 2, 3, 4].includes(accessType);
  }

  /**
   * Retorna o nome do role baseado no accessType
   */
  static getRoleName(accessType) {
    const roles = {
      1: 'UsuarioExterno',
      2: 'Tecnico',
      3: 'Coordenador',
      4: 'Administrador'
    };
    return roles[accessType] || 'UsuarioExterno';
  }

  /**
   * Normaliza status de português para inglês
   */
  static normalizeStatus(status) {
    if (!status) return 'active';
    
    const statusMap = {
      'Ativo': 'active',
      'Inativo': 'inactive',
      'Suspenso': 'suspended',
      'Bloqueado': 'blocked',
      'active': 'active',
      'inactive': 'inactive',
      'suspended': 'suspended',
      'blocked': 'blocked'
    };
    
    return statusMap[status] || 'active';
  }

  /**
   * Converte status de inglês para português (para frontend)
   */
  static translateStatus(status) {
    if (!status) return 'Ativo';
    
    const statusMap = {
      'active': 'Ativo',
      'inactive': 'Inativo',
      'suspended': 'Suspenso',
      'blocked': 'Bloqueado',
      'Ativo': 'Ativo',
      'Inativo': 'Inativo',
      'Suspenso': 'Suspenso',
      'Bloqueado': 'Bloqueado'
    };
    
    return statusMap[status] || 'Ativo';
  }
}

module.exports = UserModel;

