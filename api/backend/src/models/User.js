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
    // #952 / RF001 AC#2: the expiry that makes the lockout TEMPORARY.
    // NOT in dict-02 v1.3.0 -- the MFA side has mfaLockedUntil (P1X-0201) and the
    // password side stops at failedLoginAttempts (P1X-0206) with no expiry sibling.
    // A dictionary amendment is filed; the field ships now because RF001 AC#2 is a
    // Fase-1 requirement and "temporariamente" is unimplementable without it.
    // Type-checked here on the roleValidFrom precedent, which is itself an
    // undeclared RF-driven field (RF003 AC#3, commit 7a1de69f).
    if (data.accountLockedUntil !== undefined && data.accountLockedUntil !== null && isNaN(new Date(data.accountLockedUntil))) {
      errors.push('accountLockedUntil deve ser uma data válida');
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
      // #1072: dict-02 P1X-0197, type secret/encrypted. Holds the
      // encryptValue envelope, never the raw base32 TOTP seed.
      mfaSecretCiphertext: data.mfaSecretCiphertext || null,
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
      accountLockedUntil: data.accountLockedUntil ? new Date(data.accountLockedUntil) : null, // #952
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

/**
 * #1068: removes the credentials from a user document on its way out of the API.
 *
 * Every user read path destructured `password` and nothing else, so everything
 * else on the document rode out. The dictionary is unusually explicit about
 * which of those must not — these are the four fields it marks, read from
 * docs/docs-7-27-2026/extracted/dict-02_DICIONARIO.md directly:
 *
 *   P1X-0190 passwordHash            "Nunca persistir ou retornar senha em
 *                                     texto claro."
 *   P1X-0197 mfaSecretCiphertext     "Nunca retornar na API de consulta."
 *   P1X-0203 passwordHistoryHashes   "Não exibir; retenção limitada."
 *   P1X-0207 passwordResetTokenHash  "Compartimento «secret»"
 *
 * `mfaSecretCiphertext` is the worst of them: it wraps the live TOTP seed, so
 * returning it is a full MFA bypass rather than an information leak — anyone
 * holding it and the key can mint valid second-factor codes indefinitely.
 * Since #1072 it is an AES-GCM envelope rather than the raw base32, which
 * lowers the blast radius of a leak but does not remove the reason to strip
 * it: the envelope is still the credential to anyone who also holds the key. `passwordResetTokenHash` was
 * the same shape for the password until #1078: auth.service.js and
 * user-security.service.js both $set the RAW token onto the user document, so
 * during a reset window a plain user listing carried an account-takeover
 * credential. It is now a sha256 digest (utils/tokenHash), which is what
 * P1X-0207 always required -- but it stays stripped here, because a digest of
 * a live credential is still a "Compartimento «secret»" field and there is no
 * reason for any response to carry it.
 *
 * #993 and #998 closed the WRITE-side siblings of this defect on the same
 * route — a caller-writable MFA secret, and privilege escalation. The read
 * side had never been examined.
 *
 * DELIBERATELY KEPT: mfaEnabled (P1X-0195), mfaActivationDate (P1X-0198),
 * mfaLocked (P1X-0200), mfaFailedAttempts (P1X-0199), passwordChangedAt
 * (P1X-0204) and passwordResetExpires (P1X-0208). None is a credential, none
 * carries a never-return note, and the dictionary's own Draw.io/tela column
 * places several of them on real admin screens ("Usuário > Segurança/MFA",
 * "Administração > Segurança da conta"). Stripping the whole MFA or
 * password block would break the enrolment badge and the lockout display —
 * the same distinction PatientModel.stripConsentSecrets draws when it keeps
 * consentTokenExpiresAt while removing the token itself.
 *
 * Applied at the RESPONSE boundary rather than as a query projection, for the
 * reason stripConsentSecrets documents: the same documents are read internally
 * by paths that legitimately need these values (MFA verification, enrolment,
 * password-reset validation), so a projection would break them.
 */
UserModel.stripSecrets = function stripSecrets(user) {
  if (!user || typeof user !== 'object') return user;
  if (Array.isArray(user)) return user.map(UserModel.stripSecrets);

  // #1072: BOTH names are stripped on purpose. `mfaSecretCiphertext` is the
  // live field; `mfaSecret` is the pre-#1072 plaintext name, kept here as
  // defence in depth so that any document still carrying it -- a fixture, a
  // hand-written row, a stale export -- cannot leak a raw TOTP seed through a
  // response. It costs one destructured key and removes a whole class of
  // regression; the reverse (dropping it and being wrong) re-opens #1068.
  const {
    password,
    mfaSecret,
    mfaSecretCiphertext,
    passwordHistory,
    passwordResetTokenHash,
    ...rest
  } = user;
  return rest;
};

module.exports = UserModel;

