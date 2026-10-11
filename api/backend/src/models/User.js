/**
 * Modelo de validação e estrutura para User
 * Inclui suporte a MFA (RF001) e RBAC (RNF008)
 *
 * Stored `users` documents use the dict-02 UserAccount names (P1X-0182..0208).
 * RENAMED maps each canonical name to the name documents carried before it.
 * New documents and every write use the canonical names only. A reader goes
 * through the accessors below, which fall back to the legacy name; a writer
 * builds its update with storedUpdateOf, which $unsets the legacy name of each
 * field it sets; canonicalMoveOf moves the remaining legacy names of a document
 * in one guarded update.
 *
 * The API keeps the old names: request bodies arrive under them (validate()
 * reads them, storedNamesOf renames them for storage) and responses leave
 * under them (apiViewOf, applied by stripSecrets).
 */
const RENAMED = Object.freeze({
  displayName: 'name',
  passwordHash: 'password',
  accountStatus: 'status',
  mfaSetupAt: 'mfaActivationDate',
  lastLoginAt: 'lastLogin',
  passwordHistoryHashes: 'passwordHistory',
  forcePasswordReset: 'forceReset',
  passwordResetExpiresAt: 'passwordResetExpires'
});

const LEGACY_FIELDS = Object.freeze(Object.values(RENAMED));
const CANONICAL_BY_LEGACY = Object.freeze(
  Object.fromEntries(Object.entries(RENAMED).map(([canonical, legacy]) => [legacy, canonical]))
);

class UserModel {
  // passwordPolicy: the caller's resolvePasswordPolicy(db) result; without
  // one the strength check uses the default policy.
  //
  // `data` is a request body, keyed by the API's names (name, status,
  // password, passwordHistory, forceReset), not a stored document. To
  // validate a stored document, pass apiViewOf(document).
  static validate(data, { passwordPolicy } = {}) {
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
        passwordService.validateStrength(data.password, passwordPolicy);
      } catch (err) {
        errors.push(`password: ${err.message}`);
      }
    }

    if (data.passwordHistory && !Array.isArray(data.passwordHistory)) {
      errors.push('passwordHistory deve ser um array');
    }

    // #1251: dict-02 P1X-0204 passwordChangedAt (was lastPasswordChange).
    if (data.passwordChangedAt && isNaN(new Date(data.passwordChangedAt))) {
      errors.push('passwordChangedAt deve ser uma data válida');
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

  // The stored user document's shape, pure: timestamps come from `data` or
  // stay null, and create() fills them. The catalog conformance guard reads
  // this to compare the document with dict-02 UserAccount (P1X-0182..0208).
  //
  // `data` uses the stored (canonical) names; storedNamesOf renames a request
  // body. passwordHash is the bcrypt hash the service computed, never the
  // plaintext: a plaintext `password` key in `data` is not read.
  static fieldsOf(data = {}) {
    return {
      displayName: data.displayName,
      email: data.email,
      phone: data.phone || null,
      organizationId: data.organizationId || null,
      username: data.username,
      passwordHash: data.passwordHash,
      accountStatus: this.normalizeStatus(data.accountStatus || 'active'), // Normaliza status para formato inglês
      mfaEnabled: data.mfaEnabled || false,
      // #1072: dict-02 P1X-0197, type secret/encrypted. Holds the
      // encryptValue envelope, never the raw base32 TOTP seed.
      mfaSecretCiphertext: data.mfaSecretCiphertext || null,
      mfaSetupAt: data.mfaSetupAt || null,
      mfaFailedAttempts: data.mfaFailedAttempts || 0,
      mfaLocked: data.mfaLocked || false,
      // Identificador anonimizado para LGPD (gerado após inserção). #1275
      // follow-up: never taken from input. Log reads honour a stored anonId
      // (dict-02 P1X-0194), so a chosen one could make this user's rows read
      // as another's.
      anonId: null,
      createdAt: null,
      updatedAt: null,
      lastLoginAt: null,
      passwordHistoryHashes: Array.isArray(data.passwordHistoryHashes) ? data.passwordHistoryHashes : [],
      passwordChangedAt: data.passwordChangedAt || null,
      forcePasswordReset: data.forcePasswordReset || false,
      failedLoginAttempts: data.failedLoginAttempts || 0,
      // dict-02 P1X-0207/0208: set together by the reset request, cleared
      // together by the reset. Never taken from input.
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
      // #952 / #985: a LOCAL EXTENSION of UserAccount, not a dictionary
      // element. The v2.0.0 dictionary (approved 2026-09-12) still declares
      // no password-side lock expiry, while P1X-0282
      // authentication.lockoutDurationMinutes is 1..1 Core and RF001 AC#2
      // (requisitos v4.0.0) locks the account "temporariamente" -- so the
      // duration needs somewhere to end. Shaped after P1X-0201 mfaLockedUntil
      // (dateTime, 0..1), classed like the dictionary's own "Extensão local"
      // rows (P1X-0188, P1X-0191).
      accountLockedUntil: data.accountLockedUntil ? new Date(data.accountLockedUntil) : null,
      roleValidFrom: data.roleValidFrom ? new Date(data.roleValidFrom) : null,
      roleValidUntil: data.roleValidUntil ? new Date(data.roleValidUntil) : null,
      organizationIds: Array.isArray(data.organizationIds) ? data.organizationIds : []
    };
  }

  static create(data) {
    const fields = this.fieldsOf(data);
    return {
      ...fields,
      createdAt: new Date(),
      updatedAt: new Date(),
      passwordChangedAt: fields.passwordChangedAt || new Date()
    };
  }

  // A renamed field of a stored or cached user, canonical name first, then
  // the legacy one. A canonical null is returned as null: only an absent
  // canonical name (undefined) falls back. Undefined when neither is present.
  static storedValueOf(user, field) {
    if (!user) return undefined;
    return user[field] !== undefined ? user[field] : user[RENAMED[field]];
  }

  static displayNameOf(user) {
    return UserModel.storedValueOf(user, 'displayName');
  }

  static passwordHashOf(user) {
    return UserModel.storedValueOf(user, 'passwordHash');
  }

  static accountStatusOf(user) {
    return UserModel.storedValueOf(user, 'accountStatus');
  }

  static mfaSetupAtOf(user) {
    return UserModel.storedValueOf(user, 'mfaSetupAt');
  }

  static lastLoginAtOf(user) {
    return UserModel.storedValueOf(user, 'lastLoginAt');
  }

  static passwordHistoryOf(user) {
    return UserModel.storedValueOf(user, 'passwordHistoryHashes');
  }

  static forcePasswordResetOf(user) {
    return UserModel.storedValueOf(user, 'forcePasswordReset');
  }

  static passwordResetExpiresAtOf(user) {
    return UserModel.storedValueOf(user, 'passwordResetExpiresAt');
  }

  // Matches users whose account status is `value` (a value or an operator
  // object) under either name. The legacy branch applies only to a document
  // without accountStatus, so a stale legacy value can never outvote the
  // canonical one.
  static accountStatusFilter(value) {
    return { $or: [{ accountStatus: value }, { accountStatus: { $exists: false }, status: value }] };
  }

  /**
   * The update that writes `set` (and clears `unset`, a list of field names)
   * under the canonical names and removes the legacy name of every field it
   * touches. Keys may be given under either name; a legacy key is written
   * under its canonical name.
   */
  static storedUpdateOf(set = {}, { unset = [] } = {}) {
    const $set = {};
    const $unset = {};
    for (const [key, value] of Object.entries(set)) {
      const canonical = CANONICAL_BY_LEGACY[key] || key;
      $set[canonical] = value;
      if (RENAMED[canonical]) $unset[RENAMED[canonical]] = '';
    }
    for (const key of unset) {
      const canonical = CANONICAL_BY_LEGACY[key] || key;
      $unset[canonical] = '';
      if (RENAMED[canonical]) $unset[RENAMED[canonical]] = '';
    }
    const update = {};
    if (Object.keys($set).length > 0) update.$set = $set;
    if (Object.keys($unset).length > 0) update.$unset = $unset;
    return update;
  }

  /**
   * Moves the legacy names a user document still carries to the canonical
   * names, as a { filter, update } pair, or null when it carries none.
   * `except` lists canonical fields the caller's own write already set or
   * cleared in this request; they are left alone.
   *
   * The values come from `user`, a copy read earlier, so the filter makes the
   * move conditional: each moved field must still be absent under its
   * canonical name and present under its legacy one. Every writer stores the
   * canonical name and removes the legacy one, so a field written since the
   * read fails the filter, and the whole move is skipped rather than
   * overwriting a newer value (an account blocked meanwhile stays blocked).
   */
  static canonicalMoveOf(user, { except = [] } = {}) {
    if (!user || user._id === undefined) return null;
    const filter = { _id: user._id };
    const $set = {};
    const $unset = {};
    for (const [canonical, legacy] of Object.entries(RENAMED)) {
      if (except.includes(canonical)) continue;
      if (user[canonical] !== undefined || user[legacy] === undefined) continue;
      $set[canonical] = user[legacy];
      $unset[legacy] = '';
      filter[canonical] = { $exists: false };
      filter[legacy] = { $exists: true };
    }
    if (Object.keys($set).length === 0) return null;
    return { filter, update: { $set, $unset } };
  }

  // Renames a request body's API keys (name, status, forceReset,
  // passwordHistory, mfaActivationDate, ...) to the stored names. `password`
  // is dropped, not renamed: on input it is plaintext, and only the hash the
  // service computes is stored, as passwordHash.
  static storedNamesOf(data = {}) {
    const stored = { ...data };
    delete stored.password;
    for (const [canonical, legacy] of Object.entries(RENAMED)) {
      if (legacy === 'password') continue;
      if (stored[legacy] !== undefined && stored[canonical] === undefined) {
        stored[canonical] = stored[legacy];
      }
      delete stored[legacy];
    }
    return stored;
  }

  // A stored user under the API's names: each canonical field is returned
  // under its legacy name (the canonical value wins when a document carries
  // both), and the canonical name is removed. Response shapes and the
  // frontend keep the names they had. Secrets are NOT removed here; a
  // response goes through stripSecrets, which applies this first.
  static apiViewOf(user) {
    if (!user || typeof user !== 'object') return user;
    const view = { ...user };
    for (const [canonical, legacy] of Object.entries(RENAMED)) {
      if (view[canonical] !== undefined) view[legacy] = view[canonical];
      delete view[canonical];
    }
    return view;
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
  //
  // #1330: the document is first put under the API's names (apiViewOf), so a
  // response keeps its keys whichever names the document is stored under, and
  // passwordHash and passwordHistoryHashes arrive here as password and
  // passwordHistory. The canonical names are destructured too, so neither
  // hash name can leave by any route.
  const {
    password,
    passwordHash,
    mfaSecret,
    mfaSecretCiphertext,
    passwordHistory,
    passwordHistoryHashes,
    passwordResetTokenHash,
    ...rest
  } = UserModel.apiViewOf(user);
  return rest;
};

module.exports = UserModel;
module.exports.RENAMED = RENAMED;
module.exports.LEGACY_FIELDS = LEGACY_FIELDS;

