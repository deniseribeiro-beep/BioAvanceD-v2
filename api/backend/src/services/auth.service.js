const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const env = require('../config/env');
const UserModel = require('../models/User');
const RecoveryCodeSetModel = require('../models/RecoveryCodeSet');
const LogModel = require('../models/Log');
const logger = require('../utils/logger');
const sessionService = require('./session.service');
const { hashToken } = require('../utils/tokenHash');
const { encryptValue, decryptValue, assertFieldEncryptionConfigured } = require('../utils/fieldEncryption');
const passwordService = require('./password.service');
const { grantRoleForAccessType, assertGrantPreconditions, isAdministrator, isAuditReader, resolveRoleDisplayName, resolveUserHierarchyLevel, ROLE_CODE_BY_ACCESS_TYPE } = require('./rbac-assignment.service');
const notificationDispatchService = require('./notificationDispatch.service');
const ipAttemptService = require('./ipAttempt.service');

/**
 * #1072: the ONE place that turns a stored MFA envelope back into a TOTP seed.
 *
 * dict-02 P1X-0197 names the field mfaSecretCiphertext, type secret/encrypted,
 * and RNF020 AC#3 requires "segredos MFA sao cifrados". The seed is written
 * encrypted at the two enrolment sites and read back only here, immediately
 * before speakeasy.totp.verify.
 *
 * THE INVARIANT, and it is the whole security argument of #1072: every
 * ENROLMENT PRESENCE GUARD in this file tests user.mfaSecretCiphertext
 * -- the stored field -- and NEVER this function's result. decryptValue
 * returns null on every failure (unknown keyId, rotated key, bad auth tag),
 * so a guard keyed on a decrypted value would read "not enrolled" for a user
 * who IS enrolled. setupMFAFirstLogin's write at the end of that guard is
 * unconditional, so it would then replace the victim's secret with a fresh
 * one and hand it to an UNAUTHENTICATED caller -- #986/#1032 reopened by a
 * key rotation instead of by a missing check. #1086's previous-key slot makes
 * that rotation survivable; this invariant is what makes it non-catastrophic
 * if it is ever misconfigured anyway.
 *
 * Returning null on failure is deliberate and safe HERE, and only here:
 * [ran it] speakeasy.totp.verify({ secret: null }) returns false rather than
 * throwing, so an undecryptable enrolment refuses the code with this file's
 * ordinary generic message. A distinct "your secret is unreadable" error
 * would be an enumeration oracle on the unauthenticated endpoints, which is
 * exactly what #1032 removed.
 */
function readMfaSecret(user) {
  return decryptValue(user && user.mfaSecretCiphertext);
}

// #1331: the MFA step of sign-in also takes a recovery code. The login form
// sends it in the same field as a TOTP code, and its shape tells them apart:
// a recovery code is eight characters of generateRecoveryCode's alphabet
// (user-security.service.js), a TOTP code six digits. Spaces, hyphens and
// case are forgiven, since the code is typed from a printed sheet.
const RECOVERY_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

function asRecoveryCode(code) {
  if (typeof code !== 'string') return null;
  const normalized = code.replace(/[\s-]/g, '').toUpperCase();
  return RECOVERY_CODE_PATTERN.test(normalized) ? normalized : null;
}

// Finds the user's set and the unspent hash this code matches, or null.
// Matching does not spend it: processLogin spends the code only once the
// sign-in will complete, so a code that also carries a required password
// change (#1252) is spent by the submission that makes the change.
async function matchRecoveryCode(db, user, code) {
  const set = await db.collection('recovery_codes').findOne(RecoveryCodeSetModel.ownerFilter(user._id));
  for (const hash of RecoveryCodeSetModel.unspentHashesOf(set)) {
    if (await bcrypt.compare(code, hash)) return { set, hash };
  }
  return null;
}

// Spends a matched code in one conditional update and audits it. When
// another sign-in spent it between the match and here, the update modifies
// nothing, and this attempt is refused and counted like a wrong code.
async function redeemRecoveryCode(db, usersCollection, user, match, req) {
  const { filter, update } = RecoveryCodeSetModel.spendOf(match.set, match.hash, crypto.randomUUID());
  const result = await db.collection('recovery_codes').updateOne(filter, update);
  if (result.modifiedCount !== 1) {
    await usersCollection.updateOne({ _id: user._id }, { $inc: { mfaFailedAttempts: 1 } });
    throw new Error('Código MFA inválido');
  }
  const auditLogger = require('../utils/auditLogger');
  auditLogger.init(db);
  await auditLogger.log({
    action: 'MFA',
    resourceType: 'User',
    resourceId: user._id.toString(),
    status: 'success',
    severity: 'warning',
    message: 'Código de recuperação MFA utilizado no login',
    payload: {
      operation: 'recovery_code_redeemed',
      remainingCount: RecoveryCodeSetModel.unspentHashesOf(match.set).length - 1
    },
    req,
    module: 'Autenticação'
  });
}

// #952 / RF001 AC#2: "Bloquear temporariamente a conta apos o limite configurado
// de tentativas malsucedidas." dict-02 P1X-0206 says the counter "deve seguir
// SecurityConfiguration", and P1X-0281/0282 are both 1..1 Core -- so the
// threshold and the duration are read, not hardcoded.
//
// authentication.* rather than the duplicate loginAttempts.* group: the
// authentication group sits among the identity-policy keys (MFA, password
// reset, password strength) and is the only one validateConfig range-checks,
// while loginAttempts.* is the IP/tracker group -- its other two members are
// trackIP and blockIPAfterAttempts. Neither dict-02 nor the code states this
// outright; it is the reading both point at.
//
// Fails OPEN to getDefaultConfig()'s own 5 / 30, for the same reason #914 does:
// an unreadable policy must not lock every account out.
// #1036: TIMING EQUALIZER for the unauthenticated password endpoints.
//
// #986 moved the enrolment guard ABOVE bcrypt.compare (closing a password
// oracle) and #1032 collapsed its message into the generic one (closing the
// cheaper enumeration oracle those two left). Both were right, and together
// they left a residual in a different channel: only ONE of the three outcomes
// still does the expensive work, so latency separates it.
//
// [ran it] bcryptjs at this repo's cost factor 10: median 60.9ms, p10 58.9,
// p90 65.6, against ~0.0001ms for a guard-only return. The distributions do
// not overlap at all -- this is not a subtle side channel needing thousands of
// samples, it is a ~61ms step that survives ordinary network jitter.
//
// What leaks without this is narrow but real: "this username exists AND is not
// yet enrolled" -- the one state that reaches a real compare.
//
// NOT applied to the account-LOCKOUT guard, deliberately. #952's comment on
// that gate is explicit that it sits before the compare so that guessing
// actually stops rather than burning a round per attempt; adding a dummy round
// there would undo exactly that and hand back the DoS amplification it closed.
// The lockout path therefore stays fast and stays distinguishable, which is a
// deliberate trade rather than an oversight.
let timingDummyHash = null;

async function burnPasswordComparison(password) {
  try {
    if (timingDummyHash === null) {
      // Lazily built so module load costs nothing; the same cost factor as
      // every real hash in this codebase, or the work would not match.
      timingDummyHash = await bcrypt.hash('bioavanced-timing-equalizer', 10);
    }
    await bcrypt.compare(typeof password === 'string' ? password : '', timingDummyHash);
  } catch (error) {
    // Timing only -- never let the equalizer change an outcome.
    logger.warn(`#1036: equalizador de tempo falhou (ignorado): ${error.message}`);
  }
}

const DEFAULT_MAX_LOGIN_ATTEMPTS = 5;
const DEFAULT_LOCKOUT_MINUTES = 30;

async function resolveLockoutPolicy(db) {
  try {
    const config = await db.collection('security_config').findOne({ _id: 'main' });
    const auth = (config && config.authentication) || {};
    const maxAttempts = Number(auth.maxLoginAttempts);
    const minutes = Number(auth.lockoutDurationMinutes);
    return {
      maxAttempts: Number.isFinite(maxAttempts) && maxAttempts > 0 ? maxAttempts : DEFAULT_MAX_LOGIN_ATTEMPTS,
      lockoutMs: (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_LOCKOUT_MINUTES) * 60 * 1000,
    };
  } catch (error) {
    logger.warn('#952: política de bloqueio ilegível, usando 5/30:', error.message);
    return { maxAttempts: DEFAULT_MAX_LOGIN_ATTEMPTS, lockoutMs: DEFAULT_LOCKOUT_MINUTES * 60 * 1000 };
  }
}

// #986 (RF001 AC#2): processLogin is not the only path that verifies a
// user-supplied password. setupMFAFirstLogin and enableMFAFirstLogin -- both
// registered UNAUTHENTICATED -- run their own bcrypt.compare, and until now
// neither counted an attempt nor consulted the lock, so the per-account
// lockout 3029dc83 added had two bypasses. RF001 AC#2 says "bloquear
// temporariamente a conta após o limite configurado de tentativas
// malsucedidas"; it does not say "on one route".
//
// These three exist so the three call sites cannot drift, which is the defect
// #952 was about in the first place -- doing it by copy-paste is how the
// counting ends up in one place and the clearing in another.

/**
 * #986: the lockout gate, as a pure predicate. Deliberately returns a boolean
 * rather than throwing, so each call site keeps ownership of its message --
 * and every one of them must use the SAME generic 'Credenciais inválidas'.
 * A distinct "account locked" response is an account-enumeration oracle.
 */
function isAccountLocked(user) {
  const lockedUntil = user && user.accountLockedUntil ? new Date(user.accountLockedUntil) : null;
  return Boolean(lockedUntil && lockedUntil.getTime() > Date.now());
}

/**
 * #986: the count-and-lock block, lifted verbatim from processLogin.
 * Never throws -- every failure is downgraded to a warn, exactly as before,
 * so it cannot change any caller's control flow. The caller still throws its
 * own 'Credenciais inválidas' afterwards.
 */
async function recordFailedPasswordAttempt(db, usersCollection, user) {
  try {
    const { maxAttempts, lockoutMs } = await resolveLockoutPolicy(db);
    const attemptsAfterThis = Number(user.failedLoginAttempts || 0) + 1;
    const update = { $inc: { failedLoginAttempts: 1 }, $set: { updatedAt: new Date() } };
    if (attemptsAfterThis >= maxAttempts) {
      update.$set.accountLockedUntil = new Date(Date.now() + lockoutMs);
    }
    await usersCollection.updateOne({ _id: user._id }, update);
  } catch (counterError) {
    logger.warn('#952: falha ao contabilizar tentativa inválida:', counterError.message);
  }
}

/**
 * #986: the success side. A helper that only counts UP leaves the clearing to
 * hand-written literals at each site, which is how they drift apart -- and one
 * already had: enableMFAFirstLogin issued real session tokens while clearing
 * neither field.
 */
function clearedLockoutFields() {
  return { failedLoginAttempts: 0, accountLockedUntil: null };
}

// #1330: the canonical fields every password write sets, so a caller can
// leave them out of the name move that follows it.
const PASSWORD_WRITE_FIELDS = Object.freeze(['passwordHash', 'passwordHistoryHashes', 'forcePasswordReset']);

/**
 * #1330: after a sign-in or a password change, moves the legacy names the
 * user's document still carries to the canonical names (UserModel
 * .canonicalMoveOf). `written` lists the canonical fields this request has
 * already set or cleared. A document already canonical costs no write. Never
 * throws: a failed move leaves the document readable under its old names,
 * and must not change the outcome of the request that triggered it.
 */
async function moveToCanonicalNames(usersCollection, user, written = []) {
  const move = UserModel.canonicalMoveOf(user, { except: written });
  if (!move) return;
  try {
    await usersCollection.updateOne(move.filter, move.update);
  } catch (error) {
    logger.warn('#1330: falha ao mover o usuário para os nomes canônicos:', error.message);
  }
}

/**
 * #1258 item 5: the account-status gate, lifted from processLogin so the two
 * unauthenticated first-login endpoints apply the same one. They had none:
 * an inactive, suspended or blocked account that had not enrolled MFA got a
 * full session from enable-first-login, and neither authenticate nor
 * issueSessionTokens reads the status. #1247's requireMFAForAll sends every
 * returning unenrolled account down that path, which is how the review
 * found it.
 *
 * Called after the password check at every site, as processLogin always
 * did: whoever does not know the password must not learn the status.
 */
function assertAccountActive(user) {
  const normalizedStatus = UserModel.normalizeStatus(UserModel.accountStatusOf(user));
  if (normalizedStatus !== 'active') {
    const statusMessages = {
      'inactive': 'Usuário inativo',
      'suspended': 'Usuário suspenso',
      'blocked': 'Usuário bloqueado'
    };
    throw new Error(statusMessages[normalizedStatus] || 'Usuário não pode fazer login');
  }
}

/**
 * #914 / RF001 ("aplicar autenticação multifator conforme a política de
 * segurança"), RF014 AC#3. authentication.requireMFA (dict-02 P1X-0278,
 * "Exige MFA segundo a política global") was one of the SecurityConfiguration
 * keys nothing read: the mandatory first-login enrolment below ran for every
 * non-admin whatever the Administrador had configured.
 *
 * Reads the collection directly, not through securityService.getConfig, which
 * INSERTS a default document when none exists -- the same reason
 * session.service.js gives for its own policy read.
 *
 * Fails CLOSED, to the canonical default `true`: an unreadable policy keeps MFA
 * mandatory, which is also exactly the behaviour before this read existed.
 * Only an explicit boolean `false` relaxes it.
 *
 * #1247: enhancedSecurity.requireMFAForAll (dict-02 P1X-0311) is read only
 * while enhancedSecurity.enabled (P1X-0310, default false) is true. #1011's
 * decision keeps Administrador MFA optional and says to revisit it "via
 * config (not a silent code flip)": the mode is that config. Under it, every
 * user without MFA configured is sent to enrolment at login, Administrador
 * included and not only on a first login, so an account that predates the
 * mode is enrolled too. Fails to `false`: an unreadable mode is the default
 * (off), and requireMFA's own fail-closed read still applies.
 */
async function resolveMfaEnrolmentPolicy(db) {
  try {
    const config = await db.collection('security_config').findOne({ _id: 'main' });
    const enhanced = (config && config.enhancedSecurity) || {};
    return {
      requireMFA: !(config && config.authentication && config.authentication.requireMFA === false),
      requireMFAForAll: enhanced.enabled === true && enhanced.requireMFAForAll !== false,
    };
  } catch (error) {
    logger.warn('#914: política de MFA ilegível, mantendo MFA obrigatório:', error.message);
    return { requireMFA: true, requireMFAForAll: false };
  }
}

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

/**
 * Service de Autenticação
 * RF001 - Login com MFA
 */
class AuthService {
  // #431: accessType is no longer persisted on the User document (#427) —
  // resolve the live value from the RBAC assignment instead of trusting the
  // stale field, same pattern #427/#428 used for display reads. Keeps the
  // `accessType` claim key name; only its source changed.
  async issueAccessToken(db, user) {
    const accessType = await resolveUserHierarchyLevel(db, user._id.toString());
    return jwt.sign(
      {
        userID: user._id.toString(),
        email: user.email,
        username: user.username,
        accessType,
        name: UserModel.displayNameOf(user),
        mfaVerified: true,
        jti: crypto.randomUUID()
      },
      env.JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_TTL }
    );
  }

  issueRefreshToken(user, sessionID = null) {
    const payload = {
      userID: user._id.toString(),
      type: 'refresh',
      jti: crypto.randomUUID()
    };

    if (sessionID) {
      payload.sessionID = sessionID;
    }

    return jwt.sign(
      payload,
      env.JWT_REFRESH_SECRET || env.JWT_SECRET,
      { expiresIn: REFRESH_TOKEN_TTL }
    );
  }

  async issueSessionTokens(db, user, req) {
    const refreshToken = this.issueRefreshToken(user);
    const accessToken = await this.issueAccessToken(db, user);

    const session = await sessionService.createSession(
      db,
      user._id.toString(),
      accessToken,
      refreshToken,
      req
    );

    return {
      token: accessToken,
      refreshToken,
      // The bundle's key stays sessionID; the stored name is sessionId.
      sessionID: session.sessionId
    };
  }

  /**
   * Mapeia accessType para roleName
   */
  getRoleName(accessType) {
    const roleNameMap = {
      1: 'Usuário Externo',
      2: 'Técnico',
      3: 'Coordenador',
      4: 'Administrador'
    };
    return roleNameMap[accessType] || 'Técnico';
  }

  /**
   * Mapeia roleName para accessType
   */
  getAccessTypeForRole(roleName) {
    const roleMap = {
      'Usuário Externo': 1,
      'Técnico': 2,
      'Coordenador': 3,
      'Administrador': 4
    };
    return roleMap[roleName] || 2; // Default para Técnico
  }
  /**
   * Registra um novo usuário
   *
   * #1057: `grantedBy` is REQUIRED, and it is who the hierarchy floor below
   * is measured against. Pass the calling user's userID from an HTTP route,
   * or the literal 'system' from a trusted internal caller with no human
   * actor. It used to default to 'system', and a default parameter also
   * fires on `undefined`: a route passing `req.user?.userID` without a user
   * would then have skipped the floor silently. A missing value now throws
   * before any read or write.
   */
  async registerUser(db, userData, grantedBy) {
    try {
      if (!grantedBy) {
        throw new Error("registerUser requires grantedBy: the caller's userID, or 'system' for a trusted internal caller");
      }

      // #1249: registration checks strength against the stored passwordRules
      // policy, as every other password write has since #1246.
      const passwordPolicy = await passwordService.resolvePasswordPolicy(db);
      const validation = UserModel.validate(userData, { passwordPolicy });
      if (!validation.isValid) {
        // RNF018 (#1300): a validation failure answers 422; the caller's catch
        // keeps every other error on its own status.
        const validationError = new Error(validation.errors.join(', '));
        validationError.statusCode = 422;

        validationError.details = validation.errors;
        throw validationError;
      }

      const usersCollection = db.collection('users');

      // Verifica se usuário já existe
      const existingUser = await usersCollection.findOne({
        $or: [
          { email: userData.email },
          { username: userData.username }
        ]
      });

      if (existingUser) {
        throw new Error('Email ou username já cadastrado');
      }

      // Hash da senha
      const hashedPassword = await bcrypt.hash(userData.password, 10);

      // Mapeia roleName para accessType se necessário
      if (userData.roleName && !userData.accessType) {
        userData.accessType = this.getAccessTypeForRole(userData.roleName);
      }
      
      // Cria usuário, under the stored names (#1330): the body's name,
      // status, ... are renamed, and its plaintext password is dropped.
      const user = UserModel.create({
        ...UserModel.storedNamesOf(userData),
        passwordHash: hashedPassword
      });

      // #427/#432: accessType/roleName resolved only to grant the matching
      // UserRoleAssignment (#421) below — never persisted on the User
      // document itself, and no longer a UserModel.create() output field
      // as of #432's schema drop.
      const resolvedAccessType = userData.accessType || 2;

      // #435: reject an unrecognized accessType before any write — without
      // this, only grantRoleForAccessType's lookup would catch it, and by
      // then insertOne has already run, orphaning a User document with no
      // role assignment.
      if (!ROLE_CODE_BY_ACCESS_TYPE[Number(resolvedAccessType)]) {
        throw new Error(`accessType inválido: ${resolvedAccessType}`);
      }

      // #998's hierarchy floor, moved here from user.routes.js (#1057,
      // Denise 2026-09-25): a caller may not create a user at a level above
      // their own. It lived in one of two routes reaching this method, and
      // the sibling POST /api/auth/register inherited nothing, which is how
      // #1037 happened. Enforcing it in the service means no route can drift
      // from it again.
      //
      // Measured against the RESOLVED level, default included, so a request
      // with no accessType/roleName is held to the same floor as one naming
      // a level. A caller with no active role resolves to null, which is
      // refused. 'system' is the one exemption: a trusted internal caller
      // with no hierarchy of its own to compare against.
      if (grantedBy !== 'system') {
        const callerLevel = await resolveUserHierarchyLevel(db, grantedBy);
        if (Number(resolvedAccessType) > Number(callerLevel || 0)) {
          const error = new Error('Não é possível criar um usuário com nível de acesso superior ao seu.');
          error.statusCode = 403;
          throw error;
        }
      }

      // Para Administrador, MFA é opcional e pode ser setado manualmente
      // Se não foi fornecido explicitamente, desabilita por padrão
      if (resolvedAccessType === 4 || userData.roleName === 'Administrador') {
        if (userData.mfaEnabled === undefined || userData.mfaEnabled === false) {
          user.mfaEnabled = false;
          user.mfaSecretCiphertext = null;
          user.mfaSetupAt = null;
        }
        // Se mfaEnabled foi setado como true, mantém (será configurado no primeiro login se necessário)
      }

      // #1028: widens #435's pre-write guard to the OTHER two throw sites
      // reachable from grantRoleForAccessType below. #435 closed the
      // accessType trigger; an unseeded RBAC catalogue and an unknown
      // organizationId were still reachable AFTER the insert. (When #1028
      // landed, the organizationId one was reachable anonymously through
      // POST /api/auth/register. #1037 gated that route and #1057 deleted it.)
      //
      // Fail-fast, not atomic: only compose.test.yml runs a replica set, so a
      // transaction here would break user creation on dev and prod while the
      // gate stayed green (#923).
      await assertGrantPreconditions(db, {
        accessType: resolvedAccessType,
        organizationId: user.organizationId ?? null,
      });

      const result = await usersCollection.insertOne(user);

      // #421/#1028: grants the UserRoleAssignment matching accessType. This
      // is NOT atomic with the insert above and never was -- the previous
      // wording here claimed it was, which is exactly the kind of comment a
      // later change gets made in reliance on. There is no transaction and no
      // rollback; what closes the window is the pre-write guard above, which
      // rejects every trigger this grant can throw on BEFORE the insert runs.
      // Note the anonId updateOne below is a third unsessioned write, so a
      // method-wide compensating delete would be wrong here even if one were
      // added.
      await grantRoleForAccessType(db, {
        userAccountId: result.insertedId.toString(),
        accessType: resolvedAccessType,
        grantedBy,
        organizationId: user.organizationId ?? null,
      });

      // Gera e salva identificador anonimizado para LGPD
      const { generateAnonId } = require('../utils/userAnonymization');
      const anonId = generateAnonId(result.insertedId.toString());
      
      // Atualiza usuário com anonId
      await usersCollection.updateOne(
        { _id: result.insertedId },
        { $set: { anonId } }
      );

      logger.info('Usuário registrado:', { userID: result.insertedId, anonId });

      // #427: roleName resolved from the granted RBAC assignment for the
      // response, since it's no longer a field on the User document.
      const roleName = await resolveRoleDisplayName(db, result.insertedId.toString());

      // #1330: under the API's names, and through the same secret strip as
      // every user response, so neither the hash nor the history leaves under
      // either name.
      return {
        _id: result.insertedId,
        ...UserModel.stripSecrets(user),
        anonId,
        roleName,
        id: result.insertedId.toString() // Adiciona id para compatibilidade com frontend
      };
    } catch (error) {
      logger.error('Erro ao registrar usuário:', error.message);
      throw error;
    }
  }

  /**
   * Faz login do usuário
   */
  async login(db, credentials, req) {
    try {
      const { email, password, mfaCode, newPassword } = credentials;

      if (!email || !password) {
        const { translate } = require('../i18n');
        const lang = req?.language || 'pt-BR';
        throw new Error(translate('auth.emailAndPasswordRequired', lang));
      }

      // #1255: the source-address gate, before the lookup so it covers an
      // unknown identifier too, and before any compare for #952's reason.
      // The generic message, like the account lockout's: a distinct "address
      // blocked" answer would say the block exists, and every caller from the
      // address gets the same one, so it names no account.
      //
      // #1268: and fast, with no equalizing compare, for the account lockout's
      // reason (#952, and #1036's note above burnPasswordComparison): a dummy
      // round here would hand back the work the block exists to refuse. The
      // speed says only "this address is blocked", the same for every name it
      // tries, so it tells the caller nothing about any account.
      // auth.ipBlock.parity.1268.test.js pins the parity on all three endpoints.
      if (await ipAttemptService.isSourceBlocked(db, req)) {
        throw new Error('Credenciais inválidas');
      }

      // Remove espaços do termo de busca
      const searchTerm = email.trim();
      // #1052: the raw caller-supplied identifier is NOT echoed here. The
      // shim in src/utils/logger.js does no escaping, so a newline in the
      // identifier forges a log line -- and this path is unauthenticated, so
      // the identifier is attacker-controlled. The signal that an attempt
      // happened is what an operator needs; the payload is not.
      logger.info('Tentativa de login recebida');

      const usersCollection = db.collection('users');
      
      // Busca por email ou username
      // Tenta busca exata primeiro (mais rápida)
      let user = await usersCollection.findOne({
        $or: [
          { email: searchTerm },
          { username: searchTerm }
        ]
      });
      
      // Se não encontrou com busca exata, tenta case insensitive
      if (!user) {
        const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        user = await usersCollection.findOne({
          $or: [
            { email: { $regex: `^${escapedTerm}$`, $options: 'i' } },
            { username: { $regex: `^${escapedTerm}$`, $options: 'i' } }
          ]
        });
      }
      
      if (!user) {
        // #1052: no identifier and no raw caller input on this line. It used
        // to echo searchTerm and then dump three REAL users' emails and
        // usernames at info level -- a debug aid added by c68aea04 ("fix:
        // forcing build command 2", whose message never mentions it),
        // triggerable by anyone who types a wrong username, on a system
        // holding participant and operator identities.
        //
        // Removing that query also drops an unbounded extra round trip an
        // anonymous caller could force, which sat INSIDE the window #1036's
        // equalizer below exists to keep constant.
        logger.warn('Tentativa de login falhou: identificador não encontrado');
        // #1255: an unknown name counts against the source. It is what a
        // credential-stuffing list is full of, and #1256's detector counts
        // the distinct names one source tries.
        await ipAttemptService.recordFailedSourceAttempt(db, req, `name:${searchTerm}`);
        // #1036: the same residual on the highest-traffic endpoint. A user
        // that exists reaches processLogin's real compare; one that does not
        // returned from here without one.
        await burnPasswordComparison(password);
        throw new Error('Credenciais inválidas');
      }
      
      // #1052: this line logged the resolved user's username AND email on
      // EVERY successful lookup -- not named by that issue, and higher
      // frequency than the not-found dump it was filed for. auditLogger
      // .logLogin already records the login against a pseudonymized actor,
      // so the identifiers added nothing an operator needs here.
      
      return await this.processLogin(db, user, password, mfaCode, usersCollection, req, newPassword);
    } catch (error) {
      logger.error('Erro no login:', error.message);
      throw error;
    }
  }

  /**
   * Processa o login após encontrar o usuário
   */
  async processLogin(db, user, password, mfaCode, usersCollection, req, newPassword) {
    try {


      if (!user) {
        // #1036: equalize with the enrolled/not-enrolled branches below.
        await burnPasswordComparison(password);
        throw new Error('Credenciais inválidas');
      }

      // Validação extra: senha precisa existir e ser string
      const storedHash = UserModel.passwordHashOf(user);
      if (!storedHash || typeof storedHash !== 'string' || storedHash.length < 20) {
        // #1052: same class -- this carried the user's email and username
        // too. The audit row this path writes already identifies the account.
        logger.error('Usuário encontrado, mas campo de senha ausente ou inválido');
        // #1036: a malformed stored hash must not be faster than a real one.
        await burnPasswordComparison(password);
        throw new Error('Credenciais inválidas');
      }

      // #952: the lockout gate sits BEFORE bcrypt.compare, deliberately. After it,
      // a lockout would deny only the eventual CORRECT guess while every wrong one
      // still burns a bcrypt round -- protection against nothing. Before it,
      // guessing actually stops.
      //
      // The message stays the generic one. A distinct "account locked" response is
      // an account-enumeration oracle, which is exactly what the mfaLocked gate
      // further down refuses to be ("quem nao sabe a senha nao deve conseguir
      // distinguir uma conta bloqueada de qualquer outra"). Cost: a locked user
      // with the right password gets no explanation. That is the trade RF001 AC#1
      // and AC#2 have to share, and enumeration is the worse leak.
      //
      // TEMPORARIAMENTE: the lock is an expiry timestamp, not a boolean. It clears
      // itself. mfaLocked is the boolean shape and #933 documents where that ends
      // -- five bad codes over an account lifetime, no decay, permanent.
      // #986: extracted to isAccountLocked() so the two first-login endpoints
      // apply the identical gate. Behaviour here is unchanged.
      if (isAccountLocked(user)) {
        throw new Error('Credenciais inválidas');
      }

      let passwordMatch = false;
      try {
        passwordMatch = await bcrypt.compare(password, storedHash);
      } catch (bcryptErr) {
        logger.error(`Erro ao comparar senha com bcrypt: ${bcryptErr.message}`);
        throw new Error('Credenciais inválidas');
      }
      if (!passwordMatch) {
        // Registra tentativa de login falha (usando auditLogger que já anonimiza)
        const auditLogger = require('../utils/auditLogger');
        await auditLogger.log({
          action: 'LOGIN',
          resourceType: 'Authentication',
          status: 'error',
          severity: 'warning',
          message: 'Tentativa de login com senha incorreta',
          req: req,
          module: 'Autenticação'
        });
        // #952: count it. This was the whole defect -- failedLoginAttempts was
        // initialised, validated, reset and in the dictionary, and incremented by
        // nothing, so there was no per-account brute-force protection at all.
        // $inc rather than the MFA path's read-modify-write $set: same cost,
        // race-free, and concurrent guesses are the case that matters here.
        // #986: extracted to recordFailedPasswordAttempt() so the two
        // first-login endpoints count identically. Behaviour here is unchanged.
        await recordFailedPasswordAttempt(db, usersCollection, user);
        // #1255: and against the source address.
        await ipAttemptService.recordFailedSourceAttempt(db, req, `id:${user._id}`);

        throw new Error('Credenciais inválidas');
      }

      // Verifica status do usuário - impede login se não estiver ativo
      // #1258: shared with the first-login endpoints (assertAccountActive).
      assertAccountActive(user);

      // #683 (RF003): bloqueio de MFA por força bruta. O contador acima grava
      // mfaLocked após 5 códigos errados, mas nada lia a flag: a tentativa
      // seguinte era processada normalmente, mfaFailedAttempts continuava
      // subindo além de 5, e um código correto ainda autenticava. Só um
      // Administrador libera, pelo reset-mfa (user.routes.js), que já zera a
      // flag.
      //
      // Fica depois da verificação de senha, no mesmo ponto da checagem de
      // status acima: quem não sabe a senha não deve conseguir distinguir uma
      // conta bloqueada de qualquer outra.
      //
      // dict-02 P1X-0201 (mfaLockedUntil) é 0..1 Condicional, 'quando a
      // política usar duração' -- não há política de duração aqui, então o
      // bloqueio não expira sozinho.
      if (user.mfaLocked) {
        const error = new Error('MFA bloqueado devido a muitas tentativas falhas');
        error.code = 'MFA_LOCKED';
        throw error;
      }

      // Verifica se é admin
      // #426: resolve via UserRoleAssignment -> Role, não accessType/roleName
      // direto (a fonte de verdade desde #421).
      const isAdmin = await isAdministrator(db, user._id.toString());
      
      // Para admin, MFA é opcional - se estiver habilitado, verifica; se não, pula
      // Para não-admin, MFA é obrigatório no primeiro login
      const lastLoginAt = UserModel.lastLoginAtOf(user);
      const isFirstLogin = lastLoginAt === null || lastLoginAt === undefined;
      // #1072: ciphertext presence, not a decrypted value -- see readMfaSecret.
      const mfaNotConfigured = !user.mfaEnabled || !user.mfaSecretCiphertext;

      // MFA obrigatório apenas para não-admin no primeiro login
      // Admin com MFA habilitado também precisa configurar no primeiro login se não estiver configurado
      // #914: and only while the policy requires it (authentication.requireMFA).
      // #1247: the enhanced mode's requireMFAForAll widens it to every user.
      const mfaPolicy = mfaNotConfigured ? await resolveMfaEnrolmentPolicy(db) : null;
      const enrolmentDue = mfaNotConfigured
        && (mfaPolicy.requireMFAForAll || (!isAdmin && isFirstLogin && mfaPolicy.requireMFA));
      if (enrolmentDue) {
        // Primeiro login - MFA obrigatório
        // Gera token temporário apenas para setup MFA
        // #433: accessType resolved from the live RBAC assignment, not the
        // stale unpopulated user.accessType field (#427) — same pattern
        // #431 used for issueAccessToken.
        const tempToken = jwt.sign(
          {
            userID: user._id.toString(),
            email: user.email,
            username: user.username,
            accessType: await resolveUserHierarchyLevel(db, user._id.toString()),
            name: UserModel.displayNameOf(user),
            mfaSetupRequired: true // Flag para indicar que MFA é obrigatório
          },
          env.JWT_SECRET,
          { expiresIn: '1h' } // Token temporário com expiração menor
        );

        return {
          requiresMFASetup: true,
          message: 'Configuração de MFA obrigatória no primeiro acesso',
          tempToken: tempToken, // Token temporário apenas para configurar MFA
          user: {
            _id: user._id,
            name: UserModel.displayNameOf(user),
            email: user.email,
            username: user.username,
            // #434: resolved from the live RBAC assignment, not the stale
            // unpopulated user.accessType field (#427) — same pattern as
            // #433's tempToken fix, applied to the response body.
            accessType: await resolveUserHierarchyLevel(db, user._id.toString()),
            // #427: resolved from the RBAC assignment — roleName is no
            // longer persisted on the User document for new/edited users.
            roleName: await resolveRoleDisplayName(db, user._id.toString()),

            // #1239: the audit-trail gate's own rule (admin or the additive

            // auditor role), so the frontend guards the Logs screen with it.

            isAuditReader: await isAuditReader(db, user._id.toString())
          }
        };
      }

      // Verifica MFA se estiver habilitado
      // Para admin, MFA é opcional; se estiver habilitado, verifica
      // Para não-admin, MFA é obrigatório se habilitado
      // #1331: a matched recovery code, spent below once the sign-in completes.
      let recoveryMatch = null;
      if (user.mfaEnabled) {
        if (!mfaCode) {
          return {
            requiresMFA: true,
            message: 'Código MFA necessário'
          };
        }

        // #1331: a recovery code stands in for the TOTP code. A spent or
        // unknown one fails exactly like a wrong TOTP code, counter included.
        const recoveryCode = asRecoveryCode(mfaCode);
        let verified;
        if (recoveryCode) {
          recoveryMatch = await matchRecoveryCode(db, user, recoveryCode);
          verified = recoveryMatch !== null;
        } else {
          verified = speakeasy.totp.verify({
            secret: readMfaSecret(user),
            encoding: 'base32',
            token: mfaCode,
            window: 2
          });
        }

        if (!verified) {
          // Incrementa tentativas falhas
          const failedAttempts = (user.mfaFailedAttempts || 0) + 1;
          await usersCollection.updateOne(
            { _id: user._id },
            { $set: { mfaFailedAttempts: failedAttempts } }
          );
          // #1255: a wrong code counts against the source as well.
          await ipAttemptService.recordFailedSourceAttempt(db, req, `id:${user._id}`);

          if (failedAttempts >= 5) {
            await usersCollection.updateOne(
              { _id: user._id },
              { $set: { mfaLocked: true } }
            );

            // #650 (RF015, segurança domain) - fire-and-forget, same shape
            // as iot.controller.js's environmental_excursion call: a
            // missing/misconfigured NotificationRule must never block or
            // delay the lockout itself. #685: explicit .catch() -- this
            // repo has no global unhandledRejection handler, so a bare
            // `void` here would crash the process on a transient
            // notification-engine failure.
            void notificationDispatchService.dispatchNotification(db, {
              eventType: 'mfa_brute_force_lockout',
              sourceEventType: 'User',
              sourceEventId: user._id,
              payload: {
                userId: user._id.toString(),
                username: user.username,
                failedAttempts
              }
            }).catch((dispatchError) => {
              logger.error('[NOTIFICATION_DISPATCH] Falha ao disparar notificação de bloqueio MFA:', dispatchError.message || dispatchError);
            });

            throw new Error('MFA bloqueado devido a muitas tentativas falhas');
          }

          throw new Error('Código MFA inválido');
        }

        // Reseta tentativas falhas
        await usersCollection.updateOne(
          { _id: user._id },
          { $set: { mfaFailedAttempts: 0 } }
        );
      }

      // RF014 AC#4 (#648): forceReset (admin-forced, or createFirstAdmin's
      // own bootstrap flag) blocks a full session until a new password is
      // set. Mirrors changePassword's validate/hash/history update
      // (auth.controller.js) inlined here, since this path has no prior
      // authenticated session to call that endpoint with.
      //
      // #1251: an expired password (passwordRules.expirationDays) takes the
      // same branch. After MFA, like forceReset, so an expiry never hands a
      // password change to someone holding only the password.
      //
      // #1285: so does a single-factor sign-in whose password is under the
      // single-factor floor, typically one set under the MFA floor before an
      // MFA reset. Only this path holds the plaintext.
      const passwordPolicy = await passwordService.resolvePasswordPolicy(db);
      const passwordExpired = passwordService.isPasswordExpired(user, passwordPolicy);
      const belowFloor = passwordService.belowSingleFactorFloor(password, passwordPolicy, user);
      const forcePasswordReset = UserModel.forcePasswordResetOf(user);
      const passwordChangeDue = forcePasswordReset || passwordExpired || belowFloor;

      // #1331: a recovery code is spent only by the submission that completes
      // the sign-in. With a password change due, that is the one carrying a
      // new password that passes the policy checks, since the form sends the
      // same code back with it (#1252).
      if (recoveryMatch && !passwordChangeDue) {
        await redeemRecoveryCode(db, usersCollection, user, recoveryMatch, req);
      }

      if (passwordChangeDue) {
        if (!newPassword) {
          const reason = forcePasswordReset ? null : (passwordExpired ? 'expired' : 'below_policy');
          return {
            requiresPasswordChange: true,
            ...(reason ? { reason } : {}),
            message: reason === 'expired'
              ? 'Senha expirada: defina uma nova senha para continuar'
              : reason === 'below_policy'
                ? 'Senha abaixo do tamanho mínimo atual: defina uma nova senha para continuar'
                : 'Alteração de senha obrigatória antes de continuar'
          };
        }

        passwordService.validateStrength(newPassword, passwordPolicy, user);
        await passwordService.validateReuse(newPassword, user, passwordPolicy);

        if (recoveryMatch) {
          await redeemRecoveryCode(db, usersCollection, user, recoveryMatch, req);
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        const updatedHistory = passwordService.nextPasswordHistory(user, passwordPolicy);

        await usersCollection.updateOne(
          { _id: user._id },
          UserModel.storedUpdateOf({
            passwordHash: newHash,
            passwordHistoryHashes: updatedHistory,
            passwordChangedAt: new Date(),
            forcePasswordReset: false,
            updatedAt: new Date()
          })
        );

        user.passwordHash = newHash;
        delete user.password;

        // #958 / RNF021 AC#2. Ordering is load-bearing: issueSessionTokens has
        // NOT run yet, so every session this matches is a pre-reset one. Moving
        // this below the token issue would revoke the session the caller is about
        // to be handed. All sessions, for the same reason as the token reset --
        // the caller has no session yet, so there is nothing to preserve.
        await sessionService.invalidateUserSessions(db, user._id.toString(), 'password_change', user._id.toString());
      }

      // Atualiza último login
      await usersCollection.updateOne(
        { _id: user._id },
        // #952: a successful login clears the counter AND the lock. Folded into the
        // existing lastLogin write rather than a second round-trip.
        // #986: the literal became clearedLockoutFields() so the clearing has
        // one definition. Same three keys, same values.
        UserModel.storedUpdateOf({ lastLoginAt: new Date(), ...clearedLockoutFields() })
      );
      await moveToCanonicalNames(usersCollection, user, [
        'lastLoginAt',
        ...(passwordChangeDue ? PASSWORD_WRITE_FIELDS : [])
      ]);

      const tokenBundle = await this.issueSessionTokens(db, user, req);

      // Registra login bem-sucedido (anonimizado via auditLogger)
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.logLogin(req, true);

      return {
        token: tokenBundle.token,
        refreshToken: tokenBundle.refreshToken,
        sessionID: tokenBundle.sessionID,
        user: {
          _id: user._id,
          name: UserModel.displayNameOf(user),
          email: user.email,
          username: user.username,
          // #434: resolved from the live RBAC assignment, not the stale
          // unpopulated user.accessType field (#427) — same pattern as
          // #433's tempToken fix, applied to the response body.
          accessType: await resolveUserHierarchyLevel(db, user._id.toString()),
          // #427: resolved from the RBAC assignment — roleName is no
          // longer persisted on the User document for new/edited users.
          roleName: await resolveRoleDisplayName(db, user._id.toString()),

          // #1239: the audit-trail gate's own rule (admin or the additive

          // auditor role), so the frontend guards the Logs screen with it.

          isAuditReader: await isAuditReader(db, user._id.toString()),
          mfaEnabled: user.mfaEnabled
        }
      };
    } catch (error) {
      logger.error('Erro no login:', error.message);
      throw error;
    }
  }

  /**
   * Configura MFA para primeiro login (sem autenticação)
   */
  async setupMFAFirstLogin(db, credentials, req) {
    try {
      const { username, password } = credentials;

      if (!username || !password) {
        throw new Error('Username e senha são obrigatórios');
      }

      // #887: a truthy check admits an object. `{ $ne: null }` is truthy,
      // so without this it reaches the $or below as a live operator and
      // matches an arbitrary user. login() has coerced the same field with
      // .trim() all along; these two siblings never did.
      if (typeof username !== 'string') {
        throw new Error('Username e senha são obrigatórios');
      }
      const usernameTerm = username.trim();

      // #1255: the source-address gate, as in login().
      if (await ipAttemptService.isSourceBlocked(db, req)) {
        throw new Error('Credenciais inválidas');
      }

      const usersCollection = db.collection('users');
      const user = await usersCollection.findOne({
        $or: [
          { email: usernameTerm },
          { username: usernameTerm }
        ]
      });

      if (!user) {
        // #1255: an unknown name counts against the source, as in login().
        await ipAttemptService.recordFailedSourceAttempt(db, req, `name:${usernameTerm}`);
        // #1036: equalize with the enrolled/not-enrolled branches below.
        await burnPasswordComparison(password);
        throw new Error('Credenciais inválidas');
      }

      // #986: this guard used to sit AFTER bcrypt.compare, which made this
      // endpoint a password oracle against any fully-enrolled account: a wrong
      // password answered 'Credenciais inválidas' and a correct one answered
      // 'MFA já configurado…', both returned verbatim in the 400 body by
      // auth.controller.js. The QR side effect was correctly blocked; the
      // password check was not. Moving it above the compare makes the two
      // outcomes indistinguishable, which is the whole point.
      //
      // The condition itself is unchanged, and the mfaEnabled term is
      // load-bearing: setupMFAFirstLogin writes the secret WITHOUT setting
      // lastLogin, so a legitimate enrolment arrives back here with a secret
      // present and lastLogin still null. A guard keyed on !isFirstLogin
      // alone, or on the secret alone, would break that live flow.
      //
      // #1072: the third conjunct is CIPHERTEXT PRESENCE -- the stored field
      // -- and must never become a decrypted value. readMfaSecret's docblock
      // has the full argument; the short version is that decryptValue returns
      // null on a rotated or missing key, which would make this guard skip
      // and let the unconditional write below replace an enrolled user's
      // secret, from an unauthenticated request.
      const lastLoginAt = UserModel.lastLoginAtOf(user);
      const isFirstLogin = lastLoginAt === null || lastLoginAt === undefined;
      if (!isFirstLogin && user.mfaEnabled && user.mfaSecretCiphertext) {
        // #1032: the generic message, NOT a distinct one. The guard order
        // above is deliberate (#986) and unchanged; what changes here is
        // that reaching this branch no longer TELLS the caller it was
        // reached. Because the guard sits above bcrypt.compare, a distinct
        // message was returned to an UNAUTHENTICATED caller supplying any
        // arbitrary password -- one request per username disclosing both
        // account existence and MFA-enrolment state. processLogin below
        // states the principle this follows: enumeration is the worse leak.
        //
        // #1036: and the residual those two left is closed here. This branch
        // and the !user branch above both skip the real compare, so without
        // this the not-yet-enrolled branch -- the only one that reaches
        // bcrypt -- was ~61ms slower and trivially separable.
        await burnPasswordComparison(password);
        throw new Error('Credenciais inválidas');
      }

      // #986: the same lockout gate processLogin applies, before the compare
      // for the same reason -- after it, a lock denies only the eventual
      // correct guess while every wrong one still burns a bcrypt round.
      if (isAccountLocked(user)) {
        throw new Error('Credenciais inválidas');
      }

      // Verifica senha
      const passwordMatch = await bcrypt.compare(password, UserModel.passwordHashOf(user));
      if (!passwordMatch) {
        // #986: count it, exactly as processLogin does. Without this an
        // attacker who knows a username could guess passwords here forever
        // without ever incrementing failedLoginAttempts.
        await recordFailedPasswordAttempt(db, usersCollection, user);
        await ipAttemptService.recordFailedSourceAttempt(db, req, `id:${user._id}`);
        throw new Error('Credenciais inválidas');
      }

      // #1258 item 5: an account that may not log in may not enrol either.
      assertAccountActive(user);

      // #1072: a `mfaNotConfigured` binding sat here, computed and never
      // read -- dead, and a live trap for anyone editing this function
      // believing it gated something. Removed with the rename rather than
      // carried forward under a new field name.

      // Gera secret
      const secret = speakeasy.generateSecret({
        name: `BioAvanceD (${user.email})`,
        issuer: 'BioAvanceD'
      });

      if (!secret || !secret.base32 || !secret.otpauth_url) {
        throw new Error('Erro ao gerar secret do MFA');
      }

      // Gera QR Code
      let qrCodeUrl;
      try {
        qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
      } catch (qrError) {
        logger.error('Erro ao gerar QR Code:', qrError);
        throw new Error('Erro ao gerar QR Code. Tente novamente.');
      }

      if (!qrCodeUrl) {
        throw new Error('QR Code não foi gerado corretamente');
      }

      // #1072: refuse BEFORE the write rather than degrade. encryptValue
      // returns null when no key is configured, and a bare $set of that null
      // would silently unset the enrolment while still handing the caller a
      // QR code for a secret that was never stored -- worse than the
      // plaintext posture this replaces. #1083 built this assert for exactly
      // that shape; #1085 now also refuses to boot a keyless production
      // stack, so this fires only on a stack that deliberately opted out.
      assertFieldEncryptionConfigured(secret.base32);

      // Salva secret temporariamente (usuário precisa confirmar)
      await usersCollection.updateOne(
        { _id: user._id },
        UserModel.storedUpdateOf({ mfaSecretCiphertext: encryptValue(secret.base32), mfaSetupAt: null })
      );

      logger.info('MFA secret gerado e salvo para primeiro login:', { 
        userID: user._id.toString(),
        email: user.email 
      });

      return {
        secret: secret.base32,
        qrCode: qrCodeUrl,
        manualEntryKey: secret.base32
      };
    } catch (error) {
      logger.error('Erro ao configurar MFA no primeiro login:', error.message);
      throw error;
    }
  }

  /**
   * Ativa MFA no primeiro login (sem autenticação)
   */
  async enableMFAFirstLogin(db, credentials, mfaCode, req) {
    try {
      const { username, password } = credentials;

      if (!username || !password) {
        throw new Error('Username e senha são obrigatórios');
      }

      // #887: a truthy check admits an object. `{ $ne: null }` is truthy,
      // so without this it reaches the $or below as a live operator and
      // matches an arbitrary user. login() has coerced the same field with
      // .trim() all along; these two siblings never did.
      if (typeof username !== 'string') {
        throw new Error('Username e senha são obrigatórios');
      }
      const usernameTerm = username.trim();

      // #1255: the source-address gate, as in login().
      if (await ipAttemptService.isSourceBlocked(db, req)) {
        throw new Error('Credenciais inválidas');
      }

      if (!mfaCode) {
        throw new Error('Código MFA é obrigatório');
      }

      const usersCollection = db.collection('users');
      const { ObjectId } = require('mongodb');
      
      const user = await usersCollection.findOne({
        $or: [
          { email: usernameTerm },
          { username: usernameTerm }
        ]
      });

      if (!user) {
        // #1255: an unknown name counts against the source, as in login().
        await ipAttemptService.recordFailedSourceAttempt(db, req, `name:${usernameTerm}`);
        // #1036: equalize with the enrolled/not-enrolled branches below.
        await burnPasswordComparison(password);
        throw new Error('Credenciais inválidas');
      }

      // #986: this endpoint had NO enrollment guard at all -- only the
      // `!user.mfaSecretCiphertext` check below, which an already-enrolled user passes.
      // So a correct password plus a valid current TOTP reached updateOne and
      // issueSessionTokens: a complete alternate authentication path through
      // an UNAUTHENTICATED endpoint, bypassing the lockout by construction
      // rather than merely failing to count. Same mfaEnabled-bearing form as
      // setupMFAFirstLogin, for the same reason -- an enrolment in progress
      // has the secret set and lastLogin still null, and must still get here.
      //
      // #1072: ciphertext presence, never a decrypted value. Same argument as
      // the sibling guard in setupMFAFirstLogin; readMfaSecret has it in full.
      const lastLoginAt = UserModel.lastLoginAtOf(user);
      const isFirstLogin = lastLoginAt === null || lastLoginAt === undefined;
      if (!isFirstLogin && user.mfaEnabled && user.mfaSecretCiphertext) {
        // #1032: the generic message, NOT a distinct one. The guard order
        // above is deliberate (#986) and unchanged; what changes here is
        // that reaching this branch no longer TELLS the caller it was
        // reached. Because the guard sits above bcrypt.compare, a distinct
        // message was returned to an UNAUTHENTICATED caller supplying any
        // arbitrary password -- one request per username disclosing both
        // account existence and MFA-enrolment state. processLogin below
        // states the principle this follows: enumeration is the worse leak.
        //
        // #1036: and the residual those two left is closed here. This branch
        // and the !user branch above both skip the real compare, so without
        // this the not-yet-enrolled branch -- the only one that reaches
        // bcrypt -- was ~61ms slower and trivially separable.
        await burnPasswordComparison(password);
        throw new Error('Credenciais inválidas');
      }

      // #986: same gate, same placement, same generic message as the other two.
      if (isAccountLocked(user)) {
        throw new Error('Credenciais inválidas');
      }

      // Verifica senha
      const passwordMatch = await bcrypt.compare(password, UserModel.passwordHashOf(user));
      if (!passwordMatch) {
        await recordFailedPasswordAttempt(db, usersCollection, user);
        await ipAttemptService.recordFailedSourceAttempt(db, req, `id:${user._id}`);
        throw new Error('Credenciais inválidas');
      }

      // #1258 item 5: this path issues a full session, so it applies the
      // status gate processLogin applies.
      assertAccountActive(user);

      // #1072: ciphertext presence gates reachability; the decrypt happens
      // only inside the verify call below.
      if (!user.mfaSecretCiphertext) {
        throw new Error('MFA não configurado. Gere o QR code primeiro.');
      }

      const verified = speakeasy.totp.verify({
        secret: readMfaSecret(user),
        encoding: 'base32',
        token: mfaCode,
        window: 2
      });

      if (!verified) {
        // #1255: a wrong enrolment code counts against the source.
        await ipAttemptService.recordFailedSourceAttempt(db, req, `id:${user._id}`);
        throw new Error('Código MFA inválido');
      }

      // Ativa MFA e atualiza último login
      await usersCollection.updateOne(
        { _id: user._id },
        UserModel.storedUpdateOf({
          mfaEnabled: true,
          mfaSetupAt: new Date(),
          lastLoginAt: new Date(),
          // #986: this is a token-issuing success -- a completed login -- so
          // it must clear the counter AND the lock, exactly as processLogin's
          // own success path does. Without it the path counts up and never
          // down, and a user who enrols through here stays locked.
          ...clearedLockoutFields(),
          updatedAt: new Date()
        })
      );
      await moveToCanonicalNames(usersCollection, user, ['mfaSetupAt', 'lastLoginAt']);

      // Registra log (anonimizado via auditLogger)
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'CONFIG',
        resourceType: 'User',
        status: 'success',
        severity: 'info',
        message: 'MFA configurado no primeiro login',
        req: req,
        module: 'Autenticação'
      });

      // #1250 (RF014 AC#4): processLogin sends a first-login non-admin here
      // BEFORE it reaches its forceReset branch, so this path used to issue a
      // full session on a password an administrator had just set or forced.
      // The enrolment stands -- it is the user's own second factor -- but no
      // token is issued: the next login, now with MFA, reaches processLogin's
      // forceReset branch and its password change.
      //
      // #1253 item 3: an administrator who knows the password they set can
      // enrol their own authenticator here first, and the real user then
      // meets an MFA they did not enrol. That grants nothing the role lacks:
      // with or without this enrolment, an administrator who sets a password
      // can log in with it and complete the forced change, which is
      // set-password's own exposure, and the same administrator can reset-mfa
      // for the user. Set-password, reset-mfa and this enrolment (the row
      // above) are all audited.
      //
      // #1258 item 5: an expired password (#1251) withholds the session the
      // same way. Under requireMFAForAll every returning unenrolled account
      // comes through here, and its password may have expired long ago.
      const passwordExpired = passwordService.isPasswordExpired(user, await passwordService.resolvePasswordPolicy(db));
      const forcePasswordReset = UserModel.forcePasswordResetOf(user);
      if (forcePasswordReset || passwordExpired) {
        return {
          requiresPasswordChange: true,
          ...(passwordExpired && !forcePasswordReset ? { reason: 'expired' } : {}),
          message: passwordExpired && !forcePasswordReset
            ? 'Senha expirada: defina uma nova senha para continuar'
            : 'Alteração de senha obrigatória antes de continuar'
        };
      }

      const tokenBundle = await this.issueSessionTokens(db, user, req);

      return {
        success: true,
        token: tokenBundle.token,
        refreshToken: tokenBundle.refreshToken,
        sessionID: tokenBundle.sessionID,
        user: {
          _id: user._id,
          name: UserModel.displayNameOf(user),
          email: user.email,
          username: user.username,
          // #434: resolved from the live RBAC assignment, not the stale
          // unpopulated user.accessType field (#427) — same pattern as
          // #433's tempToken fix, applied to the response body.
          accessType: await resolveUserHierarchyLevel(db, user._id.toString()),
          // #427: resolved from the RBAC assignment — roleName is no
          // longer persisted on the User document for new/edited users.
          roleName: await resolveRoleDisplayName(db, user._id.toString()),

          // #1239: the audit-trail gate's own rule (admin or the additive

          // auditor role), so the frontend guards the Logs screen with it.

          isAuditReader: await isAuditReader(db, user._id.toString()),
          mfaEnabled: true
        }
      };
    } catch (error) {
      logger.error('Erro ao ativar MFA no primeiro login:', error.message);
      throw error;
    }
  }

  /**
   * Configura MFA para um usuário
   */
  async setupMFA(db, userID) {
    try {
      const usersCollection = db.collection('users');
      const { ObjectId } = require('mongodb');
      const user = await usersCollection.findOne({ _id: new ObjectId(userID) });

      if (!user) {
        throw new Error('Usuário não encontrado');
      }

      // Gera secret
      const secret = speakeasy.generateSecret({
        name: `BioAvanceD (${user.email})`,
        issuer: 'BioAvanceD'
      });

      // Gera QR Code
      const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

      // #1072: same fail-closed assert as setupMFAFirstLogin -- see there.
      assertFieldEncryptionConfigured(secret.base32);

      // Salva secret temporariamente (usuário precisa confirmar)
      await usersCollection.updateOne(
        { _id: new ObjectId(userID) },
        UserModel.storedUpdateOf({ mfaSecretCiphertext: encryptValue(secret.base32), mfaSetupAt: null })
      );

      return {
        secret: secret.base32,
        qrCode: qrCodeUrl,
        manualEntryKey: secret.base32
      };
    } catch (error) {
      logger.error('Erro ao configurar MFA:', error.message);
      throw error;
    }
  }

  /**
   * Ativa MFA após verificação
   */
  async enableMFA(db, userID, mfaCode) {
    try {
      const usersCollection = db.collection('users');
      const { ObjectId } = require('mongodb');
      const user = await usersCollection.findOne({ _id: new ObjectId(userID) });

      // #1072: ciphertext presence, not a decrypted value.
      if (!user || !user.mfaSecretCiphertext) {
        throw new Error('MFA não configurado');
      }

      const verified = speakeasy.totp.verify({
        secret: readMfaSecret(user),
        encoding: 'base32',
        token: mfaCode,
        window: 2
      });

      if (!verified) {
        throw new Error('Código MFA inválido');
      }

      // #1270: processLogin hands a first-login account its setup tempToken
      // before its forceReset/expiry branch, and the middleware admits that
      // token here, so this is a second door onto completing a first login.
      // It applies enable-first-login's gates: the status before any write
      // (#1258), and forceReset or an expired password (#1250, #1251) below,
      // where the enrolment stands but no session is issued.
      const isFirstLogin = UserModel.lastLoginAtOf(user) === null;
      if (isFirstLogin) {
        assertAccountActive(user);
      }

      // Ativa MFA e atualiza último login (primeiro acesso completo)
      const updateData = {
        mfaEnabled: true,
        mfaSetupAt: new Date(),
        updatedAt: new Date()
      };

      // Se for primeiro login, atualiza também
      if (isFirstLogin) {
        updateData.lastLoginAt = new Date();
      }

      await usersCollection.updateOne(
        { _id: new ObjectId(userID) },
        UserModel.storedUpdateOf(updateData)
      );
      // The legacy lastLogin is renamed only when this write set lastLoginAt.
      await moveToCanonicalNames(usersCollection, user, isFirstLogin ? ['mfaSetupAt', 'lastLoginAt'] : ['mfaSetupAt']);

        // Se for primeiro login, gera tokens de sessão completos
      if (isFirstLogin) {
        const passwordExpired = passwordService.isPasswordExpired(user, await passwordService.resolvePasswordPolicy(db));
        const forcePasswordReset = UserModel.forcePasswordResetOf(user);
        if (forcePasswordReset || passwordExpired) {
          return {
            requiresPasswordChange: true,
            ...(passwordExpired && !forcePasswordReset ? { reason: 'expired' } : {}),
            message: passwordExpired && !forcePasswordReset
              ? 'Senha expirada: defina uma nova senha para continuar'
              : 'Alteração de senha obrigatória antes de continuar'
          };
        }

        const tokenBundle = await this.issueSessionTokens(db, user, null);

        return { 
          success: true,
          token: tokenBundle.token,
          refreshToken: tokenBundle.refreshToken,
          sessionID: tokenBundle.sessionID,
          user: {
            _id: user._id,
            name: UserModel.displayNameOf(user),
            email: user.email,
            username: user.username,
            // #434: resolved from the live RBAC assignment, not the stale
            // unpopulated user.accessType field (#427) — same pattern as
            // #433's tempToken fix, applied to the response body.
            accessType: await resolveUserHierarchyLevel(db, user._id.toString()),
            // #427: resolved from the RBAC assignment — roleName is no
            // longer persisted on the User document for new/edited users.
            roleName: await resolveRoleDisplayName(db, user._id.toString()),

            // #1239: the audit-trail gate's own rule (admin or the additive

            // auditor role), so the frontend guards the Logs screen with it.

            isAuditReader: await isAuditReader(db, user._id.toString()),
            mfaEnabled: true
          }
        };
      }

      return { success: true };
    } catch (error) {
      logger.error('Erro ao ativar MFA:', error.message);
      throw error;
    }
  }

  /**
   * Solicita recuperação de senha
   */
  async requestPasswordReset(db, email, req) {
    try {
      const usersCollection = db.collection('users');
      const { ObjectId } = require('mongodb');

      // #887: same coercion as login() and the MFA-first-login siblings.
      // This path deliberately answers success whether or not a user is
      // found, so an operator reaching the filter would be invisible from
      // the response -- the reset mail destination would be the only tell.
      if (typeof email !== 'string') {
        throw new Error('Email é obrigatório');
      }
      const emailTerm = email.trim();

      // Busca usuário por email ou username
      const user = await usersCollection.findOne({
        $or: [
          { email: emailTerm },
          { username: emailTerm }
        ]
      });

      // Por segurança, sempre retorna sucesso mesmo se o usuário não existir
      // Isso evita que atacantes descubram quais emails estão cadastrados
      if (!user) {
        logger.warn('Tentativa de recuperação de senha para email não cadastrado:', email);
        // Retorna sucesso genérico para não expor informações
        return {
          success: true,
          message: 'Se o email estiver cadastrado, você receberá um link de recuperação'
        };
      }

      // Verifica se usuário está ativo
      if (UserModel.accountStatusOf(user) !== 'active') {
        logger.warn('Tentativa de recuperação de senha para usuário inativo:', email);
        return {
          success: true,
          message: 'Se o email estiver cadastrado, você receberá um link de recuperação'
        };
      }

      // Gera token de recuperação (JWT com expiração de 1 hora)
      const resetToken = jwt.sign(
        {
          userID: user._id.toString(),
          email: user.email,
          type: 'password-reset'
        },
        env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      // Salva token no banco para controle (opcional, mas útil para invalidar tokens)
      await usersCollection.updateOne(
        { _id: user._id },
        UserModel.storedUpdateOf({
          // #1078: the HASH, never the token. dict-02 P1X-0207 is
          // passwordResetTokenHash (secret/hash) and its description reads
          // "O token bruto não deve ser armazenado"; RNF020 AC#3's first
          // clause says the same. The raw token still goes out in the
          // emailed link -- it just stops being recoverable from the
          // database, so a reset window no longer leaves an
          // account-takeover credential at rest.
          passwordResetTokenHash: hashToken(resetToken),
          passwordResetExpiresAt: new Date(Date.now() + 3600000), // 1 hora
          updatedAt: new Date()
        })
      );

      // Registra log (anonimizado via auditLogger)
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'PASSWORD_RESET_REQUEST',
        resourceType: 'User',
        status: 'success',
        severity: 'info',
        message: 'Solicitação de recuperação de senha',
        req: req,
        module: 'Autenticação'
      });

      // Prefer the public origin the browser used (access proxy / LB) so the
      // emailed and in-response lab link is reachable, not FRONTEND_URL's e2e host.
      const header = (name) => (req && typeof req.get === 'function' ? req.get(name) : undefined);
      const forwardedHost = header('x-forwarded-host') || header('host');
      const forwardedProto = header('x-forwarded-proto') || (req && req.protocol) || 'http';
      const publicOrigin = forwardedHost
        ? `${String(forwardedProto).split(',')[0].trim()}://${String(forwardedHost).split(',')[0].trim()}`
        : (process.env.FRONTEND_URL || 'http://localhost:5173');
      const resetLink = `${publicOrigin}/reset-password?token=${resetToken}`;

      // #1203: the link goes out by email in every environment. Until now it
      // left only in the development response below, so in production this
      // route promised a link it never sent.
      //
      // NOT awaited, deliberately: the unknown-user and inactive-user
      // branches above return without sending, so an awaited SMTP round-trip
      // would make "this address exists" visible through latency -- the
      // channel #1036 closed on the login path. And a delivery failure is
      // logged, never thrown, so the response cannot differ by outcome
      // either. sendEmail records its own compliance row for each attempt.
      const notificationService = require('./NotificationService');
      Promise.resolve()
        .then(() => notificationService.sendPasswordReset(user.email, resetLink, { expiresInMinutes: 60 }))
        .catch((mailError) => {
          logger.error('#1203: falha ao enviar email de recuperação de senha:', mailError && mailError.message);
        });

      logger.info('Token de recuperação gerado para:', email);

      // Lab/e2e stacks run NODE_ENV=test: surface the link in the JSON so the
      // SPA can open it without Mailpit. Production never returns the token.
      const exposeResetSecret = process.env.NODE_ENV !== 'production'
        || process.env.ALLOW_PASSWORD_RESET_LINK_IN_RESPONSE === 'true'
        || process.env.ALLOW_PASSWORD_RESET_LINK_IN_RESPONSE === '1';

      return {
        success: true,
        message: 'Se o email estiver cadastrado, você receberá um link de recuperação',
        resetLink: exposeResetSecret ? resetLink : undefined,
        token: exposeResetSecret ? resetToken : undefined
      };
    } catch (error) {
      logger.error('Erro ao solicitar recuperação de senha:', error.message);
      throw error;
    }
  }

  /**
   * Reseta senha usando token
   */
  async resetPassword(db, token, newPassword, req) {
    try {
      const usersCollection = db.collection('users');
      const { ObjectId } = require('mongodb');

      if (!token) {
        throw new Error('Token de recuperação não fornecido');
      }

      if (!newPassword) {
        throw new Error('Nova senha é obrigatória');
      }

      // #1246: the policy's strength rules, the same check every other
      // password write uses (this path had its own 12-character validator).
      // #1257: checked below, once the token names the account, because its
      // MFA enrolment decides its length floor.
      const passwordPolicy = await passwordService.resolvePasswordPolicy(db);

      // Verifica e decodifica token
      let decoded;
      try {
        decoded = jwt.verify(token, env.JWT_SECRET);
      } catch (error) {
        if (error.name === 'TokenExpiredError') {
          throw new Error('Token de recuperação expirado. Solicite um novo link.');
        }
        throw new Error('Token de recuperação inválido');
      }

      // Verifica se é token de recuperação de senha
      if (decoded.type !== 'password-reset') {
        throw new Error('Token inválido');
      }

      // Busca usuário
      const user = await usersCollection.findOne({
        _id: new ObjectId(decoded.userID)
      });

      if (!user) {
        throw new Error('Usuário não encontrado');
      }

      // #1084: both checks are UNCONDITIONAL, and the '&&' they used to carry
      // is the whole bug. The stored token is not what authenticates this
      // request -- the user is fetched by an id read out of the JWT above --
      // so these two guards are the only thing making a reset token
      // single-use. And a successful reset $unsets both fields (see below),
      // which is exactly the state a '&&' short-circuits on: using the token
      // disabled the check that refuses a used token. Since the JWT stays
      // signature-valid for the rest of its lifetime (1h here, up to 24h via
      // user-security.service's authenticated path), a leaked USED reset link
      // was a full account takeover, needing no password and no second factor.
      //
      // Absent is therefore REFUSED, not waved through: a legitimately issued
      // reset JWT always has a matching stored token, because both writers
      // ($set at requestPasswordReset, and user-security.service's) set the
      // token and its expiry together. So there is no live flow that reaches
      // here with either field missing -- only a replay.
      // #1078: compare digests. Still unconditional -- see #1084; hashing
      // the field does not make the absent case safe, it just renames it.
      if (!user.passwordResetTokenHash || user.passwordResetTokenHash !== hashToken(token)) {
        throw new Error('Token inválido ou já utilizado');
      }

      // Verifica se token não expirou no banco. Also unconditional: a missing
      // expiry alongside a present token is an inconsistent record, and the
      // safe reading of "no expiry" is expired, not "never expires".
      const passwordResetExpiresAt = UserModel.passwordResetExpiresAtOf(user);
      if (!passwordResetExpiresAt || new Date(passwordResetExpiresAt) < new Date()) {
        throw new Error('Token de recuperação expirado. Solicite um novo link.');
      }

      // #1244: the sixth password writer, and the one that neither checked
      // reuse nor kept history -- a forgotten-password link could set the
      // current password again, or any earlier one. After the token checks,
      // so an invalid link never learns whether a password was reused.
      passwordService.validateStrength(newPassword, passwordPolicy, user);
      await passwordService.validateReuse(newPassword, user, passwordPolicy);

      // Hash da nova senha
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Atualiza senha e remove token de recuperação
      //
      // #1002: the reset also ENDS a password lockout. This route never
      // consulted isAccountLocked, which is right -- OWASP's Authentication
      // Cheat Sheet ("Account Lockout") recommends letting the forgotten-
      // password flow work while an account is locked, so a lockout cannot be
      // turned into a denial of service against its owner. But it did not
      // clear the lock either, so a user who proved control of their mailbox
      // and set a new password was still refused at login until
      // accountLockedUntil passed. The counter guarded the OLD password, which
      // no longer exists after this write, so there is nothing left for it to
      // protect.
      await usersCollection.updateOne(
        { _id: user._id },
        UserModel.storedUpdateOf({
          passwordHash: hashedPassword,
          passwordHistoryHashes: passwordService.nextPasswordHistory(user, passwordPolicy),
          passwordChangedAt: new Date(),
          // #1250: the owner just replaced the password through their own
          // mailbox, which is what a forced reset asks for.
          forcePasswordReset: false,
          ...clearedLockoutFields(),
          updatedAt: new Date()
        }, { unset: ['passwordResetTokenHash', 'passwordResetExpiresAt'] })
      );
      await moveToCanonicalNames(usersCollection, user, [...PASSWORD_WRITE_FIELDS, 'passwordResetExpiresAt']);

      // #958 / RNF021 AC#2. No fork here: this route is unauthenticated, so
      // there is no current session to preserve and every live session was
      // authenticated with the password just replaced. revokedBy 'system'
      // mirrors cleanupExpiredSessions -- there is no acting user on this route.
      await sessionService.invalidateUserSessions(db, user._id.toString(), 'password_change', 'system');

      // Registra log (anonimizado via auditLogger)
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'PASSWORD_RESET',
        resourceType: 'User',
        status: 'success',
        severity: 'info',
        message: 'Senha redefinida com sucesso',
        req: req,
        module: 'Autenticação'
      });

      logger.info('Senha redefinida com sucesso para:', user.email);

      return {
        success: true,
        message: 'Senha redefinida com sucesso'
      };
    } catch (error) {
      logger.error('Erro ao resetar senha:', error.message);
      throw error;
    }
  }

}

module.exports = new AuthService();

// #995: the three #986 helpers, exported. They were module-private, which is
// why the two AUTHENTICATED password-change routes could not reach them and
// hand-rolled their own bcrypt.compare instead -- auth.controller's
// changePassword (POST /api/auth/change-password) and user-security.service's
// updatePassword (PUT /api/user-security/password). That is five call sites
// verifying a user-supplied password, not the three #986 counted.
//
// Attached to the singleton rather than re-shaped into a named export object:
// every consumer of this module does a plain `require(...)` and uses it as the
// service instance, so replacing the export shape would touch ~30 files for no
// behavioural gain. AuthService declares no method by any of these names.
module.exports.isAccountLocked = isAccountLocked;
module.exports.recordFailedPasswordAttempt = recordFailedPasswordAttempt;
module.exports.clearedLockoutFields = clearedLockoutFields;
// #1330: the two authenticated password-change routes move the document's
// remaining legacy names the same way the sign-in and the reset do.
module.exports.moveToCanonicalNames = moveToCanonicalNames;
module.exports.PASSWORD_WRITE_FIELDS = PASSWORD_WRITE_FIELDS;

