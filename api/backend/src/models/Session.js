/**
 * Modelo de Sessão para controle de atividade do usuário
 *
 * Stored `sessions` documents use the dict-02 Session names (P1X-0251..0267).
 * LEGACY_FIELDS are the names documents carried before them: sessionID,
 * userID, tokenHash, lastActivity, createdAt and inactiveTimeout. New
 * documents are written under the canonical names only. A reader goes through
 * the accessors and filters below, which fall back to the legacy name, and a
 * rewrite of an existing document removes the legacy names (canonicalIdentity).
 */
const LEGACY_FIELDS = ['sessionID', 'userID', 'tokenHash', 'lastActivity', 'createdAt', 'inactiveTimeout'];

// Each canonical name mapped to the legacy name documents carried before it.
const RENAMED = Object.freeze({
  sessionId: 'sessionID',
  userAccountId: 'userID',
  accessTokenHash: 'tokenHash',
  lastActivityAt: 'lastActivity',
  sessionStartedAt: 'createdAt',
  inactivityTimeoutMs: 'inactiveTimeout'
});

class SessionModel {
  // The stored session document's shape, pure: timestamps come from `data`
  // or stay null, and create() fills them. The catalog conformance guard
  // reads this to compare the document with dict-02 Session (P1X-0251..0267).
  static fieldsOf(data = {}) {
    return {
      sessionId: data.sessionId || null,
      userAccountId: String(data.userAccountId),
      accessTokenHash: data.accessTokenHash,
      refreshTokenHash: data.refreshTokenHash,
      userAgent: data.userAgent || null,
      ipAddress: data.ipAddress || null,
      deviceInfo: data.deviceInfo || null,
      lastActivityAt: null,
      sessionStartedAt: null,
      expiresAt: data.expiresAt || null,
      refreshExpiresAt: data.refreshExpiresAt || null,
      inactivityTimeoutMs: data.inactivityTimeoutMs || 30 * 60 * 1000, // 30 minutos em ms
      isActive: true,
      isRevoked: false,
      revokedAt: null,
      revokedBy: null,
      revocationReason: null,
      updatedAt: null
    };
  }

  static create(data) {
    const fields = this.fieldsOf(data);
    return {
      ...fields,
      lastActivityAt: new Date(),
      sessionStartedAt: new Date(),
      expiresAt: fields.expiresAt || new Date(Date.now() + 12 * 60 * 60 * 1000), // 12 horas
      refreshExpiresAt: fields.refreshExpiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      updatedAt: new Date()
    };
  }

  static validate(data) {
    const errors = [];

    if (!data.userAccountId) {
      errors.push('userAccountId é obrigatório');
    }

    if (!data.accessTokenHash) {
      errors.push('accessTokenHash é obrigatório');
    }

    if (!data.refreshTokenHash) {
      errors.push('refreshTokenHash é obrigatório');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Readers of a stored or cached session, canonical name first, then the
  // legacy one. Each returns undefined when the document carries neither.
  static sessionIdOf(session) {
    return session?.sessionId ?? session?.sessionID;
  }

  static ownerOf(session) {
    return session?.userAccountId ?? session?.userID;
  }

  static accessTokenHashOf(session) {
    return session?.accessTokenHash ?? session?.tokenHash;
  }

  static lastActivityOf(session) {
    return session?.lastActivityAt ?? session?.lastActivity;
  }

  static startedAtOf(session) {
    return session?.sessionStartedAt ?? session?.createdAt;
  }

  static inactivityTimeoutOf(session) {
    return session?.inactivityTimeoutMs ?? session?.inactiveTimeout;
  }

  // Filters that find a session under either name.
  static idFilter(sessionId) {
    return { $or: [{ sessionId }, { sessionID: sessionId }] };
  }

  static ownerFilter(userAccountId) {
    return { $or: [{ userAccountId }, { userID: userAccountId }] };
  }

  static accessTokenHashFilter(accessTokenHash) {
    return { $or: [{ accessTokenHash }, { tokenHash: accessTokenHash }] };
  }

  // Clauses that exclude the session holding `accessTokenHash` under either
  // name; a document lacking a name satisfies that name's $ne.
  static notAccessTokenHash(accessTokenHash) {
    return [{ accessTokenHash: { $ne: accessTokenHash } }, { tokenHash: { $ne: accessTokenHash } }];
  }

  /**
   * The $set/$unset pair that moves a session's identity fields to their
   * canonical names: sessionId, userAccountId, sessionStartedAt and
   * inactivityTimeoutMs. These never change after a session is created, so a
   * rewrite may carry them from any copy of the document, cached or read. A
   * value the document never had is not written, so a document without
   * inactiveTimeout does not gain a null one.
   *
   * lastActivity and tokenHash change while a session lives. The writer that
   * sets lastActivityAt or accessTokenHash removes the legacy name itself,
   * from the value it has just computed, never from a cached copy.
   */
  static canonicalIdentity(session) {
    const set = {};
    const carry = {
      sessionId: SessionModel.sessionIdOf(session),
      userAccountId: SessionModel.ownerOf(session),
      sessionStartedAt: SessionModel.startedAtOf(session),
      inactivityTimeoutMs: SessionModel.inactivityTimeoutOf(session)
    };
    for (const [field, value] of Object.entries(carry)) {
      if (value !== undefined) set[field] = value;
    }
    const unset = { sessionID: '', userID: '', createdAt: '', inactiveTimeout: '' };
    return { set, unset };
  }

  /**
   * Moves the legacy names a session document still carries to the canonical
   * names, as a { filter, update } pair, or null when it carries none.
   *
   * The readers use `??`, so a canonical name that is null or absent falls
   * back to the legacy value: that value is moved, and the filter requires
   * the canonical name to be still null or absent and the legacy one present.
   * Every live writer sets the canonical name and removes the legacy one, so
   * a document written since `session` was read fails the filter and the
   * whole move is skipped. A legacy name whose canonical value is already set
   * is never read, and is only removed.
   */
  static canonicalMoveOf(session) {
    if (!session || session._id === undefined) return null;
    const filter = { _id: session._id };
    const $set = {};
    const $unset = {};
    for (const [canonical, legacy] of Object.entries(RENAMED)) {
      if (session[legacy] === undefined) continue;
      if (session[canonical] == null) {
        $set[canonical] = session[legacy];
        filter[canonical] = null;
        filter[legacy] = { $exists: true };
      }
      $unset[legacy] = '';
    }
    if (Object.keys($unset).length === 0) return null;
    const update = { $unset };
    if (Object.keys($set).length > 0) update.$set = $set;
    return { filter, update };
  }

  // Drops the legacy names from an in-memory copy, after its canonical
  // values were assigned.
  static withoutLegacyNames(session) {
    for (const field of LEGACY_FIELDS) delete session[field];
    return session;
  }

  /**
   * Verifica se a sessão está ativa (não expirou e não está inativa)
   */
  static isSessionActive(session) {
    if (!session || !session.isActive || session.isRevoked) {
      return false;
    }

    const now = new Date();

    // Verifica expiração por tempo total
    if (session.expiresAt && new Date(session.expiresAt) < now) {
      return false;
    }

    if (session.refreshExpiresAt && new Date(session.refreshExpiresAt) < now) {
      return false;
    }

    // Verifica expiração por inatividade
    const inactiveTime = now.getTime() - new Date(SessionModel.lastActivityOf(session)).getTime();
    if (inactiveTime > SessionModel.inactivityTimeoutOf(session)) {
      return false;
    }

    return true;
  }
}

module.exports = SessionModel;
module.exports.LEGACY_FIELDS = LEGACY_FIELDS;
module.exports.RENAMED = RENAMED;
