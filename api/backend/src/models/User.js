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

    // Telefone e organização são opcionais (não validados)
    // Normaliza strings vazias para null
    if (data.phone !== undefined && data.phone !== null && typeof data.phone === 'string') {
      const trimmedPhone = data.phone.trim();
      if (trimmedPhone === '') {
        data.phone = null;
      }
    }
    if (data.organizationId !== undefined && data.organizationId !== null && typeof data.organizationId === 'string') {
      const trimmedOrganizationId = data.organizationId.trim();
      if (trimmedOrganizationId === '') {
        data.organizationId = null;
      }
    }

    // Senha é obrigatória apenas no cadastro (quando não há _id)
    if (!data._id && !data.password) {
      errors.push('password é obrigatório');
    }
    
    // Se senha for fornecida, valida complexidade
    if (data.password) {
      const passwordService = require('../services/password.service');
      try {
        passwordService.validateStrength(data.password);
      } catch (err) {
        errors.push(`password: ${err.message}`);
      }
    }

    if (data.passwordHistory && !Array.isArray(data.passwordHistory)) {
      errors.push('passwordHistory deve ser um array');
    }

    if (data.lastPasswordChange && isNaN(new Date(data.lastPasswordChange))) {
      errors.push('lastPasswordChange deve ser uma data válida');
    }

    if (data.forceReset !== undefined && typeof data.forceReset !== 'boolean') {
      errors.push('forceReset deve ser booleano');
    }

    if (data.failedLoginAttempts !== undefined && typeof data.failedLoginAttempts !== 'number') {
      errors.push('failedLoginAttempts deve ser número');
    }

    // Valida status - aceita tanto formato inglês quanto português
    const validStatuses = ['active', 'inactive', 'blocked', 'suspended', 'Ativo', 'Inativo', 'Bloqueado', 'Suspenso'];
    if (data.status && !validStatuses.includes(data.status)) {
      errors.push('status deve ser: active/Ativo, inactive/Inativo, blocked/Bloqueado ou suspended/Suspenso');
    }

    // RF003 AC#3 - vigência (validade) do papel atribuído
    if (data.roleValidFrom !== undefined && data.roleValidFrom !== null && isNaN(new Date(data.roleValidFrom))) {
      errors.push('roleValidFrom deve ser uma data válida');
    }
    if (data.roleValidUntil !== undefined && data.roleValidUntil !== null && isNaN(new Date(data.roleValidUntil))) {
      errors.push('roleValidUntil deve ser uma data válida');
    }
    if (
      data.roleValidFrom && data.roleValidUntil &&
      !isNaN(new Date(data.roleValidFrom)) && !isNaN(new Date(data.roleValidUntil)) &&
      new Date(data.roleValidUntil) <= new Date(data.roleValidFrom)
    ) {
      errors.push('roleValidUntil deve ser posterior a roleValidFrom');
    }

    // RF003 AC#3 - escopo organizacional do papel atribuído (Reference[] -> Organization)
    if (
      data.organizationIds !== undefined && data.organizationIds !== null &&
      (!Array.isArray(data.organizationIds) || data.organizationIds.some((s) => typeof s !== 'string'))
    ) {
      errors.push('organizationIds deve ser um array de strings');
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
      organizationId: data.organizationId || null,
      username: data.username,
      password: data.password, // Será hashado no service
      status: this.normalizeStatus(data.status || 'active'), // Normaliza status para formato inglês
      mfaEnabled: data.mfaEnabled || false,
      mfaSecret: data.mfaSecret || null,
      mfaActivationDate: data.mfaActivationDate || null,
      mfaFailedAttempts: data.mfaFailedAttempts || 0,
      mfaLocked: data.mfaLocked || false,
      anonId: data.anonId || null, // Identificador anonimizado para LGPD (gerado após inserção)
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLogin: null,
      passwordHistory: Array.isArray(data.passwordHistory) ? data.passwordHistory : [],
      lastPasswordChange: data.lastPasswordChange || new Date(),
      forceReset: data.forceReset || false,
      failedLoginAttempts: data.failedLoginAttempts || 0,
      roleValidFrom: data.roleValidFrom ? new Date(data.roleValidFrom) : null,
      roleValidUntil: data.roleValidUntil ? new Date(data.roleValidUntil) : null,
      organizationIds: Array.isArray(data.organizationIds) ? data.organizationIds : []
    };
  }

  static isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
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

