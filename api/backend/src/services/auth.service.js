const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const env = require('../config/env');
const UserModel = require('../models/User');
const LogModel = require('../models/Log');
const logger = require('../utils/logger');
const sessionService = require('./session.service');
const passwordService = require('./password.service');
const { grantRoleForAccessType, isAdministrator, resolveRoleDisplayName, resolveUserHierarchyLevel, ROLE_CODE_BY_ACCESS_TYPE } = require('./rbac-assignment.service');
const notificationDispatchService = require('./notificationDispatch.service');

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
        name: user.name,
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
      sessionID: session.sessionID
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
   */
  async registerUser(db, userData, grantedBy = 'system') {
    try {
      const validation = UserModel.validate(userData);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
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
      
      // Cria usuário
      const user = UserModel.create({
        ...userData,
        password: hashedPassword
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

      // Para Administrador, MFA é opcional e pode ser setado manualmente
      // Se não foi fornecido explicitamente, desabilita por padrão
      if (resolvedAccessType === 4 || userData.roleName === 'Administrador') {
        if (userData.mfaEnabled === undefined || userData.mfaEnabled === false) {
          user.mfaEnabled = false;
          user.mfaSecret = null;
          user.mfaActivationDate = null;
        }
        // Se mfaEnabled foi setado como true, mantém (será configurado no primeiro login se necessário)
      }

      const result = await usersCollection.insertOne(user);

      // #421: grants the UserRoleAssignment matching accessType atomically
      // with user creation — no dual-write window where a user exists
      // without a corresponding assignment.
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

      return {
        _id: result.insertedId,
        ...user,
        anonId,
        roleName,
        password: undefined, // Remove senha do retorno
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

      // Remove espaços do termo de busca
      const searchTerm = email.trim();
      logger.info(`Tentativa de login com: "${searchTerm}"`);

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
        logger.warn(`Usuário não encontrado para: "${searchTerm}"`);
        // Log de debug: lista alguns usuários para verificar estrutura
        const sampleUsers = await usersCollection.find({}, { projection: { email: 1, username: 1, _id: 0 } }).limit(3).toArray();
        logger.info(`Usuários de exemplo no banco: ${JSON.stringify(sampleUsers)}`);
        throw new Error('Credenciais inválidas');
      }
      
      logger.info(`Usuário encontrado: username="${user.username}", email="${user.email}"`);
      
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
        throw new Error('Credenciais inválidas');
      }

      // Validação extra: senha precisa existir e ser string
      if (!user.password || typeof user.password !== 'string' || user.password.length < 20) {
        logger.error(`Usuário encontrado, mas campo de senha ausente ou inválido. user.email: ${user.email}, user.username: ${user.username}`);
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
        passwordMatch = await bcrypt.compare(password, user.password);
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

        throw new Error('Credenciais inválidas');
      }

      // Verifica status do usuário - impede login se não estiver ativo
      const normalizedStatus = UserModel.normalizeStatus(user.status);
      if (normalizedStatus !== 'active') {
        const statusMessages = {
          'inactive': 'Usuário inativo',
          'suspended': 'Usuário suspenso',
          'blocked': 'Usuário bloqueado'
        };
        throw new Error(statusMessages[normalizedStatus] || 'Usuário não pode fazer login');
      }

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
      const isFirstLogin = user.lastLogin === null || user.lastLogin === undefined;
      const mfaNotConfigured = !user.mfaEnabled || !user.mfaSecret;

      // MFA obrigatório apenas para não-admin no primeiro login
      // Admin com MFA habilitado também precisa configurar no primeiro login se não estiver configurado
      if (!isAdmin && isFirstLogin && mfaNotConfigured) {
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
            name: user.name,
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
            name: user.name,
            email: user.email,
            username: user.username,
            // #434: resolved from the live RBAC assignment, not the stale
            // unpopulated user.accessType field (#427) — same pattern as
            // #433's tempToken fix, applied to the response body.
            accessType: await resolveUserHierarchyLevel(db, user._id.toString()),
            // #427: resolved from the RBAC assignment — roleName is no
            // longer persisted on the User document for new/edited users.
            roleName: await resolveRoleDisplayName(db, user._id.toString())
          }
        };
      }

      // Verifica MFA se estiver habilitado
      // Para admin, MFA é opcional; se estiver habilitado, verifica
      // Para não-admin, MFA é obrigatório se habilitado
      if (user.mfaEnabled) {
        if (!mfaCode) {
          return {
            requiresMFA: true,
            message: 'Código MFA necessário'
          };
        }

        const verified = speakeasy.totp.verify({
          secret: user.mfaSecret,
          encoding: 'base32',
          token: mfaCode,
          window: 2
        });

        if (!verified) {
          // Incrementa tentativas falhas
          const failedAttempts = (user.mfaFailedAttempts || 0) + 1;
          await usersCollection.updateOne(
            { _id: user._id },
            { $set: { mfaFailedAttempts: failedAttempts } }
          );

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
      if (user.forceReset) {
        if (!newPassword) {
          return {
            requiresPasswordChange: true,
            message: 'Alteração de senha obrigatória antes de continuar'
          };
        }

        passwordService.validateStrength(newPassword);
        await passwordService.validateReuse(newPassword, user);

        const newHash = await bcrypt.hash(newPassword, 10);
        const history = Array.isArray(user.passwordHistory) ? user.passwordHistory : [];
        const updatedHistory = [user.password, ...history].slice(0, 3);

        await usersCollection.updateOne(
          { _id: user._id },
          {
            $set: {
              password: newHash,
              passwordHistory: updatedHistory,
              lastPasswordChange: new Date(),
              forceReset: false,
              updatedAt: new Date()
            }
          }
        );

        user.password = newHash;

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
        { $set: { lastLogin: new Date(), ...clearedLockoutFields() } }
      );

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
          name: user.name,
          email: user.email,
          username: user.username,
          // #434: resolved from the live RBAC assignment, not the stale
          // unpopulated user.accessType field (#427) — same pattern as
          // #433's tempToken fix, applied to the response body.
          accessType: await resolveUserHierarchyLevel(db, user._id.toString()),
          // #427: resolved from the RBAC assignment — roleName is no
          // longer persisted on the User document for new/edited users.
          roleName: await resolveRoleDisplayName(db, user._id.toString()),
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
  async setupMFAFirstLogin(db, credentials) {
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

      const usersCollection = db.collection('users');
      const user = await usersCollection.findOne({
        $or: [
          { email: usernameTerm },
          { username: usernameTerm }
        ]
      });

      if (!user) {
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
      // load-bearing: setupMFAFirstLogin writes mfaSecret WITHOUT setting
      // lastLogin, so a legitimate enrolment arrives back here with a secret
      // present and lastLogin still null. A guard keyed on !isFirstLogin
      // alone, or on mfaSecret alone, would break that live flow.
      const isFirstLogin = user.lastLogin === null || user.lastLogin === undefined;
      if (!isFirstLogin && user.mfaEnabled && user.mfaSecret) {
        throw new Error('MFA já configurado para este usuário. Use o endpoint de login normal.');
      }

      // #986: the same lockout gate processLogin applies, before the compare
      // for the same reason -- after it, a lock denies only the eventual
      // correct guess while every wrong one still burns a bcrypt round.
      if (isAccountLocked(user)) {
        throw new Error('Credenciais inválidas');
      }

      // Verifica senha
      const passwordMatch = await bcrypt.compare(password, user.password);
      if (!passwordMatch) {
        // #986: count it, exactly as processLogin does. Without this an
        // attacker who knows a username could guess passwords here forever
        // without ever incrementing failedLoginAttempts.
        await recordFailedPasswordAttempt(db, usersCollection, user);
        throw new Error('Credenciais inválidas');
      }

      const mfaNotConfigured = !user.mfaEnabled || !user.mfaSecret;

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

      // Salva secret temporariamente (usuário precisa confirmar)
      await usersCollection.updateOne(
        { _id: user._id },
        { $set: { mfaSecret: secret.base32, mfaActivationDate: null } }
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
        throw new Error('Credenciais inválidas');
      }

      // #986: this endpoint had NO enrollment guard at all -- only the
      // `!user.mfaSecret` check below, which an already-enrolled user passes.
      // So a correct password plus a valid current TOTP reached updateOne and
      // issueSessionTokens: a complete alternate authentication path through
      // an UNAUTHENTICATED endpoint, bypassing the lockout by construction
      // rather than merely failing to count. Same mfaEnabled-bearing form as
      // setupMFAFirstLogin, for the same reason -- an enrolment in progress
      // has mfaSecret set and lastLogin still null, and must still get here.
      const isFirstLogin = user.lastLogin === null || user.lastLogin === undefined;
      if (!isFirstLogin && user.mfaEnabled && user.mfaSecret) {
        throw new Error('MFA já configurado para este usuário. Use o endpoint de login normal.');
      }

      // #986: same gate, same placement, same generic message as the other two.
      if (isAccountLocked(user)) {
        throw new Error('Credenciais inválidas');
      }

      // Verifica senha
      const passwordMatch = await bcrypt.compare(password, user.password);
      if (!passwordMatch) {
        await recordFailedPasswordAttempt(db, usersCollection, user);
        throw new Error('Credenciais inválidas');
      }

      if (!user.mfaSecret) {
        throw new Error('MFA não configurado. Gere o QR code primeiro.');
      }

      const verified = speakeasy.totp.verify({
        secret: user.mfaSecret,
        encoding: 'base32',
        token: mfaCode,
        window: 2
      });

      if (!verified) {
        throw new Error('Código MFA inválido');
      }

      // Ativa MFA e atualiza último login
      await usersCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            mfaEnabled: true,
            mfaActivationDate: new Date(),
            lastLogin: new Date(),
            // #986: this is a token-issuing success -- a completed login -- so
            // it must clear the counter AND the lock, exactly as processLogin's
            // own success path does. Without it the path counts up and never
            // down, and a user who enrols through here stays locked.
            ...clearedLockoutFields(),
            updatedAt: new Date()
          }
        }
      );

      const tokenBundle = await this.issueSessionTokens(db, user, req);

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

      return {
        success: true,
        token: tokenBundle.token,
        refreshToken: tokenBundle.refreshToken,
        sessionID: tokenBundle.sessionID,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          username: user.username,
          // #434: resolved from the live RBAC assignment, not the stale
          // unpopulated user.accessType field (#427) — same pattern as
          // #433's tempToken fix, applied to the response body.
          accessType: await resolveUserHierarchyLevel(db, user._id.toString()),
          // #427: resolved from the RBAC assignment — roleName is no
          // longer persisted on the User document for new/edited users.
          roleName: await resolveRoleDisplayName(db, user._id.toString()),
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

      // Salva secret temporariamente (usuário precisa confirmar)
      await usersCollection.updateOne(
        { _id: new ObjectId(userID) },
        { $set: { mfaSecret: secret.base32, mfaActivationDate: null } }
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

      if (!user || !user.mfaSecret) {
        throw new Error('MFA não configurado');
      }

      const verified = speakeasy.totp.verify({
        secret: user.mfaSecret,
        encoding: 'base32',
        token: mfaCode,
        window: 2
      });

      if (!verified) {
        throw new Error('Código MFA inválido');
      }

      // Ativa MFA e atualiza último login (primeiro acesso completo)
      const updateData = {
        mfaEnabled: true,
        mfaActivationDate: new Date(),
        updatedAt: new Date()
      };

      // Se for primeiro login, atualiza também
      if (user.lastLogin === null) {
        updateData.lastLogin = new Date();
      }

      await usersCollection.updateOne(
        { _id: new ObjectId(userID) },
        { $set: updateData }
      );

        // Se for primeiro login, gera tokens de sessão completos
      if (user.lastLogin === null) {
        const tokenBundle = await this.issueSessionTokens(db, user, null);

        return { 
          success: true,
          token: tokenBundle.token,
          refreshToken: tokenBundle.refreshToken,
          sessionID: tokenBundle.sessionID,
          user: {
            _id: user._id,
            name: user.name,
            email: user.email,
            username: user.username,
            // #434: resolved from the live RBAC assignment, not the stale
            // unpopulated user.accessType field (#427) — same pattern as
            // #433's tempToken fix, applied to the response body.
            accessType: await resolveUserHierarchyLevel(db, user._id.toString()),
            // #427: resolved from the RBAC assignment — roleName is no
            // longer persisted on the User document for new/edited users.
            roleName: await resolveRoleDisplayName(db, user._id.toString()),
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
      if (user.status !== 'active') {
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
        {
          $set: {
            passwordResetToken: resetToken,
            passwordResetExpires: new Date(Date.now() + 3600000), // 1 hora
            updatedAt: new Date()
          }
        }
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

      // Em produção, aqui você enviaria um email com o link
      // Por enquanto, retornamos o token para desenvolvimento
      const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}`;

      logger.info('Token de recuperação gerado para:', email);

      return {
        success: true,
        message: 'Se o email estiver cadastrado, você receberá um link de recuperação',
        // Em desenvolvimento, retorna o link (remover em produção)
        resetLink: process.env.NODE_ENV === 'development' ? resetLink : undefined,
        token: process.env.NODE_ENV === 'development' ? resetToken : undefined
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

      // Valida complexidade da senha
      const PasswordValidator = require('../utils/passwordValidator');
      PasswordValidator.validateOrThrow(newPassword);

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

      // Verifica se o token salvo no banco corresponde (opcional, mas aumenta segurança)
      if (user.passwordResetToken && user.passwordResetToken !== token) {
        throw new Error('Token inválido ou já utilizado');
      }

      // Verifica se token não expirou no banco
      if (user.passwordResetExpires && new Date(user.passwordResetExpires) < new Date()) {
        throw new Error('Token de recuperação expirado. Solicite um novo link.');
      }

      // Hash da nova senha
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Atualiza senha e remove token de recuperação
      await usersCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            password: hashedPassword,
            updatedAt: new Date()
          },
          $unset: {
            passwordResetToken: '',
            passwordResetExpires: ''
          }
        }
      );

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

