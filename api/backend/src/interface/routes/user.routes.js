const express = require('express');
const router = express.Router();
const authService = require('../../services/auth.service');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const logger = require('../../utils/logger');
const consentValidator = require('../../services/consent.validator');
const RegisterSampleUseCase = require('../../core/use-cases/RegisterSampleUseCase');
const LineageRepository = require('../../infrastructure/database/neo4j/LineageRepository');
const { getCollection } = require('../../utils/collectionResolver');
const { ObjectId } = require('mongodb');
// #933: extraída para src/utils/userFilter.js para que os scripts de
// manutenção em src/scripts/ usem exatamente esta regra em vez de uma cópia.
const { buildUserFilterById } = require('../../utils/userFilter');

// #1031: POST /:id/reset-mfa faz duas coisas materialmente diferentes desde
// f24b853e (#933) -- uma redefinição completa, que destrói o segundo fator e
// revoga todas as sessões, e um desbloqueio, que zera dois contadores -- e
// ambas respondem 200 no MESMO path.
//
// A linha genérica do audit.middleware não consegue separá-las: ela deriva a
// ação do PATH ('/reset-mfa' -> 'MFA') e seu payload é apenas
// {method, path, statusCode, duration, query}, sem corpo de resposta. Logo as
// duas linhas ficam idênticas a menos do id do alvo -- e o id não ajuda, já que
// a trilha também não registra qual papel o alvo tinha no momento. Antes de
// #933 o ramo de administrador respondia 400, então o status separava as duas;
// fazer a operação ter sucesso foi o que as colapsou.
//
// Uma função única e não dois blocos copiados: o par SÓ tem valor se os dois
// lados usarem o mesmo formato, e duas cópias divergem em silêncio.
async function writeMfaResetAudit(db, req, targetUser, { operation, enrolmentPreserved, secondFactorActive, fieldsCleared, sessionsRevoked, message }) {
  // #1042: `undefined` e falsy, entao OMITIR a flag nao falha -- a operacao
  // inteira e regravada como 'critical' em silencio. Dois dos tres call sites
  // sao behaviour-preserving por construcao (unlock e reset produzem a mesma
  // severidade antes e depois de #1033), entao nada os prendia: apagar
  // `secondFactorActive: true` do ramo unlock -- plausivel num refactor, ja
  // que parece redundante ao lado de `enrolmentPreserved: true` -- passava a
  // gravar todo desbloqueio de MFA como 'critical', ao lado de destruicao
  // real de segundo fator, num campo que LogsPage.tsx oferece como filtro.
  //
  // Falha alto em vez de regravar errado. O guard so e alcancavel por uma
  // EDICAO de codigo (os tres call sites passam literais booleanos), que e
  // exatamente quando se quer saber -- e recusar a escrita seria pior: perder
  // a linha de auditoria de uma operacao de seguranca e um dano maior que
  // grava-la com a severidade errada.
  if (typeof secondFactorActive !== 'boolean') {
    throw new Error(
      'writeMfaResetAudit: secondFactorActive e obrigatorio e deve ser boolean '
      + `(recebido: ${typeof secondFactorActive}). Sem ele a severidade cai `
      + 'silenciosamente para "critical" -- ver #1042.'
    );
  }

  const auditLogger = require('../../utils/auditLogger');
  auditLogger.init(db);
  await auditLogger.log({
    action: 'MFA',
    resourceType: 'User',
    resourceId: targetUser._id.toString(),
    status: 'success',
    // #1033: a severidade acompanha se a conta CONTINUA com um segundo fator
    // ATIVO -- não se o segredo do cadastro sobreviveu. Nos dois ramos
    // originais de reset-mfa as duas coisas coincidiam (o desbloqueio
    // preserva ambos, a redefinição destrói ambos), então derivar uma da
    // outra funcionava. disable-mfa é onde elas se separam: mantém o
    // mfaSecret e ainda assim zera mfaEnabled, e [ran it] auth.service.js:507
    // condiciona TODO o desafio de MFA a `if (user.mfaEnabled)` -- ou seja, a
    // conta fica com um único fator, exatamente como após uma redefinição.
    // O segredo preservado é inerte até alguém religar a flag.
    severity: secondFactorActive ? 'info' : 'critical',
    message,
    payload: { operation, enrolmentPreserved, secondFactorActive, fieldsCleared, sessionsRevoked },
    req,
    module: 'Usuários'
  });
}

// RF003 - Cadastro de usuário
router.post('/register',
  authenticate,
  requirePermission('createUser'),
  async (req, res) => {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: req.t('errors.databaseUnavailable')
        });
      }

      // Normaliza status se fornecido em português
      if (req.body.status) {
        const UserModel = require('../../models/User');
        req.body.status = UserModel.normalizeStatus(req.body.status);
      }

      // Normaliza telefone: remove formatação e converte para null se vazio
      if (req.body.phone !== undefined) {
        if (req.body.phone && typeof req.body.phone === 'string') {
          // Remove formatação (mantém apenas números)
          const phoneNumbers = req.body.phone.replace(/\D/g, '');
          req.body.phone = phoneNumbers.length > 0 ? phoneNumbers : null;
        } else if (req.body.phone === '' || req.body.phone === null) {
          req.body.phone = null;
        }
      }
      
      // Normaliza organizationId: strings vazias viram null (opcional)
      if (req.body.organizationId !== undefined) {
        if (req.body.organizationId && typeof req.body.organizationId === 'string') {
          req.body.organizationId = req.body.organizationId.trim() || null;
        } else if (req.body.organizationId === '') {
          req.body.organizationId = null;
        }
      }

      // #617: quando informado, organizationId deve resolver a uma
      // Organization real já cadastrada — mesma checagem que
      // sample.service.js já faz para collectionSite (ELM-0128).
      if (req.body.organizationId) {
        const organization = await db.collection('organizations').findOne({ organizationId: String(req.body.organizationId) });
        if (!organization) {
          throw new Error(`organizationId ${req.body.organizationId} não encontrado`);
        }
      }

      // #998 (RF003, RNF008 AC#1): a caller may not create a user at a level
      // above their own. requirePermission('createUser') is the only gate on
      // this route, and rbac-catalog-seed grants 'createUser' to the seeded
      // Coordenador -- so without this, every Coordenador in a default
      // deployment could POST a working Administrador account, with a password
      // of their choosing, in one request. That needs no existing target and
      // no role change, which makes it strictly cheaper to exploit than the
      // PUT leg #998 was written around.
      //
      // A floor rather than an Administrador-only check, deliberately: it
      // closes the escalation without deciding whether Coordenador should hold
      // 'createUser' at all. RF003 names Administrador as the actor for role
      // assignment, which points at a distinct assignRole permission -- that is
      // #998 direction 2 and a larger change than a security fix should carry.
      const requestedLevel = req.body.accessType
        || (req.body.roleName ? authService.getAccessTypeForRole(req.body.roleName) : null);
      if (requestedLevel) {
        const { resolveUserHierarchyLevel } = require('../../services/rbac-assignment.service');
        const callerLevel = await resolveUserHierarchyLevel(db, req.user?.userID);
        if (Number(requestedLevel) > Number(callerLevel || 0)) {
          return res.status(403).json({
            success: false,
            error: req.t('errors.forbidden'),
            message: 'Não é possível criar um usuário com nível de acesso superior ao seu.'
          });
        }
      }

      const user = await authService.registerUser(db, req.body, req.user?.userID);

      // Registra log de criação de usuário
      if (req.user) {
        const auditLogger = require('../../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'CREATE',
          resourceType: 'User',
          resourceId: user._id?.toString() || user.id,
          status: 'success',
          severity: 'info',
          message: 'Usuário registrado com sucesso',
          req: req,
          module: 'Usuários'
        });
      }

      return res.status(201).json({
        success: true,
        message: req.t('users.registerSuccess'),
        data: user
      });
    } catch (error) {
      logger.error('Erro ao registrar usuário:', error.message);
      return res.status(400).json({
        success: false,
        error: req.t('users.registerError'),
        message: error.message
      });
    }
  }
);

// RF002 - Somente Coordenador/Administrador podem listar usuários (o backend
// deve validar a permissão independentemente da ocultação da função no
// frontend) — mesma permissão já aplicada a PUT/DELETE deste recurso.
router.get('/', authenticate, requirePermission('createUser'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: req.t('errors.databaseUnavailable')
      });
    }

    const usersCollection = db.collection('users');
    const users = await usersCollection.find({}).toArray();
    const UserModel = require('../../models/User');
    const { resolveRoleDisplayName } = require('../../services/rbac-assignment.service');

    // Remove senhas dos resultados e traduz status para português
    const sanitizedUsers = await Promise.all(users.map(async (user) => {
      // #1068: strips mfaSecret and passwordResetToken too -- see
      // UserModel.stripSecrets for the dictionary entries that require it.
      const userWithoutPassword = UserModel.stripSecrets(user);
      // Traduz status para português para o frontend
      if (userWithoutPassword.status) {
        userWithoutPassword.status = UserModel.translateStatus(userWithoutPassword.status);
      }
      // #427: roleName resolved from the active RBAC assignment — no
      // longer persisted on the User document for new/edited users.
      if (!userWithoutPassword.roleName) {
        userWithoutPassword.roleName = await resolveRoleDisplayName(db, String(userWithoutPassword._id));
      }
      // Garante que o ID esteja disponível como _id e id
      if (userWithoutPassword._id && !userWithoutPassword.id) {
        userWithoutPassword.id = userWithoutPassword._id.toString();
      }
      return userWithoutPassword;
    }));

    return res.status(200).json({
      success: true,
      data: sanitizedUsers
    });
  } catch (error) {
    logger.error('Erro ao listar usuários:', error.message);
    return res.status(500).json({
      success: false,
      error: req.t('users.listError'),
      message: error.message
    });
  }
});

// #926: MUST stay above GET /:id below. Express matches router
// registrations in file order with no static-over-parameter priority, so
// while this sat at the bottom of the file /api/users/logs was answered by
// the /:id handler as a 404 users.notFound and logService.getLogs was
// never reached.
router.get('/logs', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const logService = require('../../services/log.service');
    const result = await logService.getLogs(db, req.query);

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Erro ao buscar logs:', error.message);
    return res.status(500).json({
      success: false,
      error: req.t('users.getLogsError'),
      message: error.message
    });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const usersCollection = db.collection('users');
    const userFilter = buildUserFilterById(req.params.id);
    const user = await usersCollection.findOne(userFilter);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: req.t('users.notFound')
      });
    }

    const UserModel = require('../../models/User');
    // #1068: strips mfaSecret and passwordResetToken too -- see
    // UserModel.stripSecrets for the dictionary entries that require it.
    const userWithoutPassword = UserModel.stripSecrets(user);
    
    // Traduz status para português para o frontend
    if (userWithoutPassword.status) {
      userWithoutPassword.status = UserModel.translateStatus(userWithoutPassword.status);
    }

    return res.status(200).json({
      success: true,
      data: userWithoutPassword
    });
  } catch (error) {
    logger.error('Erro ao buscar usuário:', error.message);
      return res.status(500).json({
        success: false,
        error: req.t('users.fetchError'),
        message: error.message
      });
  }
});

router.put('/:id', authenticate, requirePermission('createUser'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const UserModel = require('../../models/User');
    const usersCollection = db.collection('users');
    const userFilter = buildUserFilterById(req.params.id);
    
    // Busca usuário atual para validação
    const targetUser = await usersCollection.findOne(userFilter);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: req.t('users.notFound')
      });
    }

    // Remove campos que não devem ser atualizados
    delete req.body._id;
    delete req.body.id;
    delete req.body.createdAt;
    delete req.body.lastLogin;
    delete req.body.accessIDs; // Campo não é mais usado

    // #429: `auditorRole` grants/revokes the additive `auditor` RBAC role —
    // not a User document field, resolved below via
    // grantAdditionalRole/revokeAdditionalRole, same pattern as accessType.
    const requestedAuditorRole = req.body.auditorRole;
    delete req.body.auditorRole;
    
    // Prepara dados para validação (mescla dados existentes com novos)
    // Remove campos que não devem ser validados na atualização
    const { password: __unusedPassword, ...targetUserWithoutPassword } = targetUser;
    const dataToValidate = {
      ...targetUserWithoutPassword,
      ...req.body,
      _id: targetUser._id, // Mantém _id para indicar que é atualização
      // Se senha não foi fornecida, não inclui no validate (será removida depois)
      password: req.body.password || undefined
    };

    // Valida dados antes de atualizar
    const validation = UserModel.validate(dataToValidate);
    if (!validation.isValid) {
      return res.status(422).json({
        success: false,
        error: req.t('errors.invalidInput'),
        message: validation.errors.join(', ')
      });
    }

    req.body.updatedAt = new Date();

    // Normaliza status se fornecido em português
    if (req.body.status) {
      req.body.status = UserModel.normalizeStatus(req.body.status);
    }

    // Normaliza telefone: remove formatação e converte para null se vazio
    if (req.body.phone !== undefined) {
      if (req.body.phone && typeof req.body.phone === 'string') {
        // Remove formatação (mantém apenas números)
        const phoneNumbers = req.body.phone.replace(/\D/g, '');
        req.body.phone = phoneNumbers.length > 0 ? phoneNumbers : null;
      } else if (req.body.phone === '' || req.body.phone === null) {
        req.body.phone = null;
      }
    }
    
    // Normaliza organizationId: strings vazias viram null (opcional)
    if (req.body.organizationId !== undefined) {
      if (req.body.organizationId && typeof req.body.organizationId === 'string') {
        req.body.organizationId = req.body.organizationId.trim() || null;
      } else if (req.body.organizationId === '') {
        req.body.organizationId = null;
      }
    }

    // #617: quando informado, organizationId deve resolver a uma
    // Organization real já cadastrada — mesma checagem que
    // sample.service.js já faz para collectionSite (ELM-0128).
    if (req.body.organizationId) {
      const organization = await db.collection('organizations').findOne({ organizationId: String(req.body.organizationId) });
      if (!organization) {
        throw new Error(`organizationId ${req.body.organizationId} não encontrado`);
      }
    }

    // Remove senha se não for fornecida
    // #982: capturado ANTES do delete abaixo -- depois dele não há como
    // distinguir "senha não enviada" de "senha enviada", e é essa distinção
    // que decide a revogação de sessões após o updateOne.
    const passwordWasSet = Boolean(req.body.password);
    if (!req.body.password) {
      delete req.body.password;
    } else {
      const bcrypt = require('bcryptjs');
      req.body.password = await bcrypt.hash(req.body.password, 10);
    }

    // Verifica se é admin (já buscamos targetUser acima)
    // #426: resolve via UserRoleAssignment -> Role, não accessType/roleName
    // direto no documento.
    const { isAdministrator } = require('../../services/rbac-assignment.service');
    const isAdmin = targetUser && (await isAdministrator(db, targetUser._id.toString()));

    // Mapeia roleName para accessType se necessário — resolvido aqui, antes
    // de remover os campos do payload, para uso abaixo (grant da
    // UserRoleAssignment) e no isBecomingAdmin.
    let requestedAccessType = req.body.accessType;
    if (req.body.roleName && !requestedAccessType) {
      requestedAccessType = authService.getAccessTypeForRole(req.body.roleName);
    }
    const isBecomingAdmin = requestedAccessType === 4 || req.body.roleName === 'Administrador';

    // #998 (RF003, RNF008 AC#1): a caller may not raise anyone -- including
    // themselves -- above their own level. requirePermission('createUser') was
    // the only gate here, requirePermission has no administrator bypass and no
    // hierarchy floor, and changeUserRole reads `changedBy` for attribution
    // only, never for authorization. rbac-catalog-seed grants 'createUser' to
    // the seeded Coordenador, so every Coordenador in a default deployment
    // could PUT { roleName: 'Administrador' } at any user, themselves included.
    //
    // Compared against the target's RESOLVED level, not targetUser.accessType:
    // that field was dropped from the User document by #427/#432 and is
    // undefined on every real user, so a presence check would 403 the frontend's
    // ordinary edits -- NewUserPage seeds its form with {...editingUser} and
    // carries roleName back on every save, including a plain rename.
    // Only an actual level CHANGE is gated.
    // #1009: hoisted out of the block below. The promotion condition further
    // down must compare against the SAME resolved level this floor uses --
    // the two comparisons in this handler disagreed until now.
    let targetLevel = null;
    if (requestedAccessType) {
      const { resolveUserHierarchyLevel } = require('../../services/rbac-assignment.service');
      targetLevel = await resolveUserHierarchyLevel(db, targetUser._id.toString());
      const isRoleChange = Number(requestedAccessType) !== Number(targetLevel);
      if (isRoleChange) {
        const callerLevel = await resolveUserHierarchyLevel(db, req.user?.userID);
        if (Number(requestedAccessType) > Number(callerLevel || 0)) {
          return res.status(403).json({
            success: false,
            error: req.t('errors.forbidden'),
            message: 'Não é possível atribuir um nível de acesso superior ao seu.'
          });
        }
      }
    }

    // #993: mfaSecret e mfaActivationDate NUNCA são graváveis pelo chamador.
    // Removidos do body ANTES de qualquer branch abaixo -- a única escrita
    // legítima destes dois campos nesta rota é o CLEAR (null) do branch de
    // admin logo abaixo, que é server-set. Sem este delete, um PUT com
    // mfaEnabled:true contra um alvo Administrador mantinha o valor enviado
    // pelo chamador e gravava o segredo TOTP dele no alvo: junto com
    // 'password', que também está no allowlist, isso é tomada de conta
    // silenciosa, e o dono legítimo falha no próximo login contra um segredo
    // que não possui mais. Mesmo raciocínio -- e mesma forma -- da exclusão
    // de mfaFailedAttempts/mfaLocked abaixo e da de failedLoginAttempts
    // (#952): estado de MFA e de bloqueio não passa por update genérico.
    //
    // Os dois campos permanecem em ALLOWED_USER_UPDATE_FIELDS de propósito:
    // é por ali que o null do clear chega ao $set. Depois deste delete, o
    // único valor que eles podem carregar é o que esta rota mesma escreveu.
    delete req.body.mfaSecret;
    delete req.body.mfaActivationDate;

    // Para Administrador, MFA é opcional e pode ser setado manualmente
    if (isAdmin || isBecomingAdmin) {
      // Se mfaEnabled foi fornecido explicitamente, mantém (admin pode setar MFA manualmente)
      if (req.body.mfaEnabled === undefined || req.body.mfaEnabled === false) {
        // Se não foi fornecido ou é false, desabilita
        req.body.mfaEnabled = false;
        req.body.mfaSecret = null;
        req.body.mfaActivationDate = null;
      }
      // Se mfaEnabled é true, mantém (será configurado no próximo login se necessário)
    } else {
      // Para não-admin, remove campos MFA (não podem ser editados manualmente)
      delete req.body.mfaEnabled;
      delete req.body.mfaSecret;
      delete req.body.mfaActivationDate;
    }
    
    // Sempre remove campos de controle MFA (não podem ser editados manualmente)
    delete req.body.mfaFailedAttempts;
    delete req.body.mfaLocked;

    // Normaliza vigência do papel (RF003 AC#3): strings ISO viram Date
    if (req.body.roleValidFrom !== undefined) {
      req.body.roleValidFrom = req.body.roleValidFrom ? new Date(req.body.roleValidFrom) : null;
    }
    if (req.body.roleValidUntil !== undefined) {
      req.body.roleValidUntil = req.body.roleValidUntil ? new Date(req.body.roleValidUntil) : null;
    }

    // #427: accessType/roleName only resolved (above, into
    // requestedAccessType) to grant the matching UserRoleAssignment below —
    // no longer persisted on the User document.
    delete req.body.accessType;
    delete req.body.roleName;

    // #875: $set used to be built straight from req.body, letting a caller
    // inject arbitrary keys (e.g. userID, or anything else) that reach the
    // driver untouched. Allowlist to UserModel.create()'s own fields, plus
    // the route-managed fields the preprocessing above legitimately writes
    // (password/mfaEnabled/mfaSecret/mfaActivationDate/roleValidFrom/
    // roleValidUntil/organizationId — already covered by create()'s field
    // set) and updatedAt (server-set above, never caller-supplied).
    // Excluded: _id/id (identity, already deleted above), userID (business
    // key equivalent — not a User document field; resolved from _id),
    // createdAt (immutable), lastLogin (already deleted above — not
    // user-editable), and accessType/roleName/mfaFailedAttempts/mfaLocked,
    // which the preprocessing above already deletes from req.body — the
    // mfaFailedAttempts/mfaLocked exclusion is load-bearing (a caller must
    // never be able to clear their own MFA lockout/attempt counter via this
    // route).
    const ALLOWED_USER_UPDATE_FIELDS = [
      'name', 'email', 'phone', 'organizationId', 'organizationIds', 'username',
      'password', 'status',
      'mfaEnabled', 'mfaSecret', 'mfaActivationDate',
      'anonId',
      // #952: 'failedLoginAttempts' was HERE and is deliberately gone. It is now
      // load-bearing (RF001 AC#2), so leaving it client-writable would let any
      // createUser holder clear a target's brute-force counter through a generic
      // update -- exactly the hazard the comment below states for the MFA pair.
      // accountLockedUntil is deliberately absent for the same reason.
      'roleValidFrom', 'roleValidUntil',
      'updatedAt'
    ];
    const updateFields = {};
    for (const field of ALLOWED_USER_UPDATE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updateFields[field] = req.body[field];
      }
    }

    const result = await usersCollection.updateOne(
      userFilter,
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado'
      });
    }

    // Busca o usuário atualizado para retornar
    const updatedUser = await usersCollection.findOne(userFilter);
    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        error: req.t('users.updateNotFound')
      });
    }
    
    // #982 (RF003 AC#5, "Revogar sessões"): trocar a senha de um usuário por
    // esta rota é uma escrita ADMINISTRATIVA -- #958 cobriu os quatro caminhos
    // em que o próprio dono troca a senha, e este quinto ficou de fora. Sem
    // isto, toda sessão que o alvo já tinha continua viva, autenticada por uma
    // senha que não existe mais: middleware/auth.js só relê roleValidUntil, e
    // rotateSessionTokens renova indefinidamente.
    //
    // targetUser._id.toString(), não req.params.id: buildUserFilterById aceita
    // _id/id/userID em forma string E numérica, então o parâmetro da rota não é
    // necessariamente igual ao userID gravado na sessão. Mesmo motivo do
    // reset-mfa abaixo.
    if (passwordWasSet) {
      const sessionService = require('../../services/session.service');
      await sessionService.invalidateUserSessions(db, targetUser._id.toString(), 'admin_action', req.user?.userID);
    }

    // #615: organizationId used for RBAC scoping below — already normalized
    // above (lines 280-287). Falls back to the user's current org when not
    // provided on this request, so accessType/auditorRole changes below keep
    // the assignment scoped to whatever org the user already had.
    const organizationIdProvided = req.body.organizationId !== undefined;
    const effectiveOrganizationId = organizationIdProvided
      ? req.body.organizationId
      : (targetUser.organizationId ?? null);

    // Detecta mudanças críticas
    const changes = {};
    // #1009: compared against the RESOLVED level, not targetUser.accessType.
    // That field was dropped from the User document by #427/#432, so it is
    // `undefined` on every real user and this condition degenerated to
    // Boolean(requestedAccessType) -- firing changeUserRole, i.e. a revoke +
    // re-grant pair attributed to the editing admin, on every edit that
    // merely carried roleName back unchanged. NewUserPage does exactly that
    // on every save (it seeds its form with {...editingUser}), so a plain
    // rename wrote a spurious permission-change audit row reading
    // `from: undefined`.
    //
    // targetLevel === null (a user with no active assignment) still counts as
    // a change -- Number(null) is 0 and no valid level is 0 -- so the
    // incidental repair of a missing assignment on the next edit survives.
    // Org-only re-scoping is unaffected: it runs through
    // updateAssignmentScope below, which never consulted this guard.
    if (requestedAccessType && Number(requestedAccessType) !== Number(targetLevel)) {
      changes.accessType = { from: targetLevel ?? null, to: Number(requestedAccessType) };

      // #421: enforcement reads UserRoleAssignment exclusively — a
      // changed accessType must revoke the old assignment and grant the
      // new one in the same request, or the user keeps the old role's
      // permissions until this happens.
      const { changeUserRole } = require('../../services/rbac-assignment.service');
      await changeUserRole(db, {
        userAccountId: targetUser._id.toString(),
        accessType: requestedAccessType,
        changedBy: req.user?.userID,
        organizationId: effectiveOrganizationId,
      });
    }
    if (requestedAuditorRole !== undefined) {
      const { grantAdditionalRole, revokeAdditionalRole } = require('../../services/rbac-assignment.service');
      if (requestedAuditorRole) {
        await grantAdditionalRole(db, {
          userAccountId: targetUser._id.toString(),
          roleCode: 'auditor',
          grantedBy: req.user?.userID,
          organizationId: effectiveOrganizationId,
        });
      } else {
        await revokeAdditionalRole(db, {
          userAccountId: targetUser._id.toString(),
          roleCode: 'auditor',
          revokedBy: req.user?.userID,
        });
      }
      changes.auditorRole = Boolean(requestedAuditorRole);
    }
    // #615: org-only edit (no accessType/auditorRole change this request)
    // still needs to resync the existing assignment's scopeId — otherwise a
    // user whose organization changes keeps stale scope until their role is
    // separately touched. Idempotent against the branches above (redundant
    // $set to the same scopeId is harmless), so this runs unconditionally on
    // any real organizationId change rather than tracking what the branches
    // above already handled.
    if (organizationIdProvided && req.body.organizationId !== (targetUser.organizationId ?? null)) {
      const { updateAssignmentScope } = require('../../services/rbac-assignment.service');
      await updateAssignmentScope(db, {
        userAccountId: targetUser._id.toString(),
        organizationId: req.body.organizationId,
        updatedBy: req.user?.userID,
      });
      changes.organizationId = { from: targetUser.organizationId ?? null, to: req.body.organizationId ?? null };
    }
    if (req.body.status && req.body.status !== targetUser.status) {
      changes.status = { from: targetUser.status, to: req.body.status };
    }
    
    // Registra log de atualização
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    if (Object.keys(changes).length > 0) {
      // Mudança de permissões ou status
      await auditLogger.logPermissionChange(req, req.params.id, changes);
    } else {
      // Atualização geral
      await auditLogger.logUpdate(req, 'User', req.params.id);
    }
    
    // #1068: strips mfaSecret and passwordResetToken too -- see
    // UserModel.stripSecrets for the dictionary entries that require it.
    // (UserModel is already required earlier in this handler -- #566.)
    const userWithoutPassword = UserModel.stripSecrets(updatedUser);

    // #427: roleName resolved from the active RBAC assignment for display —
    // no longer persisted on the User document.
    const { resolveRoleDisplayName } = require('../../services/rbac-assignment.service');
    userWithoutPassword.roleName = await resolveRoleDisplayName(db, targetUser._id.toString());

    // Traduz status para português
    if (userWithoutPassword.status) {
      userWithoutPassword.status = UserModel.translateStatus(userWithoutPassword.status);
    }
    
    // Garante que o ID esteja disponível
    if (userWithoutPassword._id && !userWithoutPassword.id) {
      userWithoutPassword.id = userWithoutPassword._id.toString();
    }

    return res.status(200).json({
      success: true,
      message: req.t('users.updateSuccess'),
      data: userWithoutPassword
    });
  } catch (error) {
    logger.error('Erro ao atualizar usuário:', error.message);
    return res.status(400).json({
      success: false,
      error: req.t('users.updateError'),
      message: error.message
    });
  }
});

router.delete('/:id', authenticate, requirePermission('createUser'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const usersCollection = db.collection('users');
    const userFilter = buildUserFilterById(req.params.id);
    const result = await usersCollection.deleteOne(userFilter);

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado'
      });
    }

    // Registra log de exclusão de usuário
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.logDelete(req, 'User', req.params.id);

    return res.status(200).json({
      success: true,
      message: req.t('users.deleteSuccess')
    });
  } catch (error) {
    logger.error('Erro ao deletar usuário:', error.message);
    return res.status(400).json({
      success: false,
      error: req.t('users.deleteError'),
      message: error.message
    });
  }
});

router.get('/:id/validate-status', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const usersCollection = db.collection('users');
    const userFilter = buildUserFilterById(req.params.id);
    const user = await usersCollection.findOne(userFilter);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: req.t('users.notFound')
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        status: user.status || 'inactive'
      }
    });
  } catch (error) {
    logger.error('Erro ao validar status:', error.message);
    return res.status(500).json({
      success: false,
      error: req.t('users.validateStatusError'),
      message: error.message
    });
  }
});

// Endpoints adicionais do User (conforme diagrama UML)
router.post('/register-patient', authenticate, requirePermission('createPatient'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const patientService = require('../../services/patient.service');
    const patient = await patientService.createPatient(db, req.body);

    return res.status(201).json({
      success: true,
      message: req.t('users.registerPatientSuccess'),
      data: patient
    });
  } catch (error) {
    logger.error('Erro ao registrar paciente:', error.message);
    return res.status(400).json({
      success: false,
      error: req.t('users.registerPatientError'),
      message: error.message
    });
  }
});

router.post('/register-sample', authenticate, requirePermission('createSample'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const sampleService = require('../../services/sample.service');

    const sampleRepository = {
      create: async (sampleData) => {
        const savedSample = await sampleService.createSample(db, { ...sampleData });

        return savedSample;
      },
      deleteById: async (sampleId) => {
        const samplesCollection = await getCollection(db, 'samples');
        const filter = ObjectId.isValid(sampleId)
          ? { _id: new ObjectId(sampleId) }
          : { _id: sampleId };
        await samplesCollection.deleteOne(filter);
      }
    };

    const registerSampleUseCase = new RegisterSampleUseCase({
      sampleRepository,
      lineageRepository: new LineageRepository(req.app.locals.neo4jDriver || null),
      quarantineService: req.app.locals.neo4jQuarantineService || req.app.locals.topologicalQuarantine || null
    });

    const result = await registerSampleUseCase.execute({
      sampleData: req.body,
      actor: {
        userId: req.user?.id || req.user?._id?.toString() || req.user?.userID || null,
        userName: req.user?.name || req.user?.username || null,
        userRole: req.user?.roleName || req.user?.role || null,
        ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || null,
        userAgent: req.headers['user-agent'] || null
      }
    });
    const sample = result.sample;
    const operationMode = result.strictMode ? 'STRICT' : 'PERMISSIVE';
    const hasPartialSuccess = Boolean(result?.topology && !result.topology.synced && result.topology.fallbackQueued);

    return res.status(hasPartialSuccess ? 202 : 201).json({
      success: true,
      partialSuccess: hasPartialSuccess,
      message: hasPartialSuccess
        ? (req.t('users.registerSampleSuccess') || 'Amostra registrada com sucesso') + ' (integração topológica em quarentena)'
        : req.t('users.registerSampleSuccess') || 'Amostra registrada com sucesso',
      data: {
        ...sample,
        sampleID: sample._id?.toString ? sample._id.toString() : String(sample._id || sample.id || ''),
        operationMode,
        topology: {
          synced: Boolean(result?.topology?.synced),
          fallbackQueued: Boolean(result?.topology?.fallbackQueued)
        }
      }
    });
  } catch (error) {
    logger.error('Erro ao registrar amostra:', error.message);

    if (error?.statusCode === 403 || error?.code === 'STRICT_MODE_BLOCKED' || String(error?.message || '').includes('STRICT_MODE_BLOCKED')) {
      return res.status(403).json({
        success: false,
        error: 'STRICT_MODE_BLOCKED',
        message: error.message
      });
    }

    return res.status(400).json({
      success: false,
      error: req.t('users.registerSampleError'),
      message: error.message
    });
  }
});

router.post('/record-withdrawal', authenticate, requirePermission('withdrawSample', 'UPDATE'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    consentValidator.init(db);
    await consentValidator.validateAccess(
      req.body?.sampleID,
      req.body?.requiredScope || req.body?.consentScope || null
    );

    const { sampleID, ...withdrawalData } = req.body;
    if (!sampleID) {
      return res.status(400).json({
        success: false,
        error: req.t('users.sampleIDRequired')
      });
    }

    const { ObjectId } = require('mongodb');
    const sampleService = require('../../services/sample.service');
    const result = await sampleService.withdrawSample(db, new ObjectId(sampleID), withdrawalData);

    return res.status(200).json({
      success: true,
      message: req.t('users.recordWithdrawalSuccess'),
      data: result
    });
  } catch (error) {
    logger.error('Erro ao registrar retirada:', error.message);
    return res.status(400).json({
      success: false,
      error: req.t('users.recordWithdrawalError'),
      message: error.message
    });
  }
});

router.post('/generate-report', authenticate, requirePermission('viewReports'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { reportType, filters } = req.body;
    const reportsCollection = db.collection('reports');
    const ReportsModel = require('../../models/Reports');

    const report = ReportsModel.create({
      reportType,
      filters: filters || {},
      generatedBy: req.user?.userID || null,
      status: 'pending'
    });

    const result = await reportsCollection.insertOne(report);

    return res.status(201).json({
      success: true,
      message: req.t('users.generateReportSuccess'),
      data: { _id: result.insertedId, ...report }
    });
  } catch (error) {
    logger.error('Erro ao gerar relatório:', error.message);
    return res.status(400).json({
      success: false,
      error: req.t('users.generateReportError'),
      message: error.message
    });
  }
});

// #1073: registering a sensor is a device-lifecycle CREATE, and it was
// gated on 'viewTemperature' -- the same read permission the sensor router's
// own writes carried. Moved to 'manageSensor' with them.
router.post('/register-sensor', authenticate, requirePermission('manageSensor'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const sensorService = require('../../services/sensor.service');
    const sensor = await sensorService.createSensor(db, req.body);

    return res.status(201).json({
      success: true,
      message: req.t('users.registerSensorSuccess'),
      data: sensor
    });
  } catch (error) {
    logger.error('Erro ao registrar sensor:', error.message);
    return res.status(400).json({
      success: false,
      error: req.t('users.registerSensorError'),
      message: error.message
    });
  }
});

// Reset MFA - apenas usuários com a permissão resetMFA
router.post('/:id/reset-mfa', authenticate, requirePermission('resetMFA', 'UPDATE'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    // #426/#632: alvo resolvido via UserRoleAssignment -> Role, não
    // accessType/roleName direto no documento.
    const { isAdministrator } = require('../../services/rbac-assignment.service');
    const usersCollection = db.collection('users');

    // Busca o usuário alvo
    const userFilter = buildUserFilterById(req.params.id);
    const targetUser = await usersCollection.findOne(userFilter);

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado'
      });
    }

    // #933: um alvo Administrador tem o CADASTRO do segundo fator preservado,
    // mas o BLOQUEIO liberado -- antes disto a rota recusava a operação
    // inteira (400, sem escrita nenhuma).
    //
    // A recusa em bloco era o último elo do impasse desta issue. As duas
    // rotas de MFA são complementares por alvo: reset-mfa recusa
    // administradores, disable-mfa (:1091) recusa NÃO-administradores. Então
    // o único caminho in-app para um administrador bloqueado era disable-mfa,
    // que só limpa mfaLocked ao custo de desligar o segundo fator
    // (mfaEnabled:false). Nada na aplicação limpava mfaLocked mantendo o
    // cadastro intacto -- para nenhum alvo.
    //
    // A metade sensível é o segredo (dict-02 P1X-0197, "Nunca retornar na API
    // de consulta"), não os contadores de bloqueio (P1X-0199 mfaFailedAttempts
    // / P1X-0200 mfaLocked). RF003 AC#5 pede "permitir redefinição CONTROLADA
    // do MFA" (docs/docs-7-27-2026/extracted/requisitos-index.md:49) e a
    // própria RF003 (:39) põe o ciclo de vida de MFA de contas de usuário sob
    // o Administrador sem ressalva que exclua alvos administradores. Logo a
    // recusa é estreitada ao segredo, não aplicada à operação toda.
    if (await isAdministrator(db, targetUser._id.toString())) {
      await usersCollection.updateOne(
        userFilter,
        {
          $set: {
            mfaFailedAttempts: 0,
            mfaLocked: false,
            updatedAt: new Date()
          }
        }
      );

      // Sem revogação de sessões aqui, deliberadamente. A revogação abaixo
      // (#963) existe porque "um admin reseta MFA justamente porque acredita
      // que o segundo fator foi comprometido" -- premissa que não vale para um
      // desbloqueio: o alvo apenas errou o TOTP além do limite. Derrubar as
      // sessões dele seria punir a recuperação.

      // #1031: linha de auditoria EXPLÍCITA. A linha genérica do
      // audit.middleware não serve aqui: ela deriva a ação do PATH
      // (`/reset-mfa` -> 'MFA') e seu payload é apenas
      // {method, path, statusCode, duration, query} -- sem corpo de resposta.
      // Como este path agora faz duas coisas materialmente diferentes e ambas
      // respondem 200, as duas linhas genéricas ficam idênticas a menos do id
      // do alvo. Uma destrói um segundo fator e derruba todas as sessões; a
      // outra zera dois contadores. A trilha precisa distinguir as duas.
      await writeMfaResetAudit(db, req, targetUser, {
        operation: 'unlock',
        enrolmentPreserved: true,
        secondFactorActive: true,
        fieldsCleared: ['mfaFailedAttempts', 'mfaLocked'],
        sessionsRevoked: false,
        message: 'MFA desbloqueado (cadastro do segundo fator preservado)'
      });

      return res.status(200).json({
        success: true,
        unlockedOnly: true,
        message: req.t('users.resetMFAUnlockedSuccess')
      });
    }

    // Reseta MFA
    await usersCollection.updateOne(
      userFilter,
      {
        $set: {
          mfaEnabled: false,
          mfaSecret: null,
          mfaActivationDate: null,
          mfaFailedAttempts: 0,
          mfaLocked: false,
          lastLogin: null, // Força novo setup de MFA no próximo login
          updatedAt: new Date()
        }
      }
    );

    // #963 (RF003 AC#5, "Revogar sessões"): o reset acima só afeta logins
    // FUTUROS. Nada no caminho da requisição relê mfaEnabled -- o JWT ainda
    // carrega mfaVerified:true, e a única releitura do banco em
    // middleware/auth.js lê roleValidUntil e mais nada -- então sem isto a
    // sessão que o reset pretendia matar sobrevive, renovável indefinidamente
    // via rotateSessionTokens. Um admin reseta MFA justamente porque acredita
    // que o segundo fator foi comprometido.
    //
    // targetUser._id.toString(), não req.params.id: buildUserFilterById
    // aceita _id/id/userID em forma string E numérica, então o parâmetro da
    // rota não é necessariamente igual ao userID gravado na sessão.
    const sessionService = require('../../services/session.service');
    await sessionService.invalidateUserSessions(db, targetUser._id.toString(), 'admin_action', req.user?.userID);

    // #1031: par explícito da linha do desbloqueio acima. Sem as duas, a
    // trilha registra as duas operações de forma indistinguível.
    await writeMfaResetAudit(db, req, targetUser, {
      operation: 'reset',
      enrolmentPreserved: false,
      secondFactorActive: false,
      fieldsCleared: ['mfaEnabled', 'mfaSecret', 'mfaActivationDate', 'mfaFailedAttempts', 'mfaLocked', 'lastLogin'],
      sessionsRevoked: true,
      message: 'MFA redefinido (cadastro do segundo fator removido, sessões revogadas)'
    });

    return res.status(200).json({
      success: true,
      message: req.t('users.resetMFASuccess')
    });
  } catch (error) {
    logger.error('Erro ao resetar MFA:', error.message);
    return res.status(500).json({
      success: false,
      error: req.t('users.resetMFAError'),
      message: error.message
    });
  }
});

// Forçar redefinição de senha - RF014 AC#4 (#648): flags the target user's
// account so their next login requires setting a new password before
// proceeding (auth.service.js#processLogin gates on this flag).
router.post('/:id/force-password-reset', authenticate, requirePermission('forcePasswordReset', 'UPDATE'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const usersCollection = db.collection('users');

    const userFilter = buildUserFilterById(req.params.id);
    const targetUser = await usersCollection.findOne(userFilter);

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado'
      });
    }

    await usersCollection.updateOne(
      userFilter,
      {
        $set: {
          forceReset: true,
          updatedAt: new Date()
        }
      }
    );

    // #1033: linha de auditoria EXPLÍCITA. A linha genérica do
    // audit.middleware não serve aqui: ela deriva a ação do PATH, e este path
    // não contém 'mfa'/'reset-mfa'/nenhum outro caso especial de
    // normalizeHttpMethodToAction -- então cai no fallback por verbo HTTP
    // (POST -> 'CREATE'), o que é enganoso para uma escrita em conta
    // existente. Chamada direta (mesmo formato que /register usa acima),
    // não via writeMfaResetAudit: esta não é uma operação de MFA -- o
    // helper fixa action:'MFA' e este é um único ponto de chamada, então
    // não há par cuja divergência silenciosa a extração evitaria.
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'UPDATE',
      resourceType: 'User',
      resourceId: targetUser._id.toString(),
      status: 'success',
      severity: 'info',
      message: 'Redefinição de senha forçada no próximo login',
      payload: { operation: 'forcePasswordReset', fieldsSet: ['forceReset'] },
      req,
      module: 'Usuários'
    });

    return res.status(200).json({
      success: true,
      message: req.t('users.forcePasswordResetSuccess')
    });
  } catch (error) {
    logger.error('Erro ao forçar redefinição de senha:', error.message);
    return res.status(500).json({
      success: false,
      error: req.t('users.forcePasswordResetError'),
      message: error.message
    });
  }
});

// Desativar MFA - apenas para administradores (permite desativar MFA de outros admins também)
// #1010: gated with requirePermission like its two siblings. The in-handler
// isAdministrator check below stays as defence in depth -- it is a real gate,
// but it is invisible to the RBAC catalogue, so before this the operation
// could neither be granted to another role nor denied to an Administrador,
// and #630-style allowedActions audits saw nothing here.
// The explicit 'UPDATE' is required, not decorative: METHOD_TO_ACTION derives
// CREATE from POST (#631), so omitting it would 403 every administrator --
// the trap #959 item 1 hit.
router.post('/:id/disable-mfa', authenticate, requirePermission('disableMFA', 'UPDATE'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    // Verifica se o usuário atual é administrador
    // #426: resolve via UserRoleAssignment -> Role, não accessType/roleName
    // direto no documento.
    const { isAdministrator } = require('../../services/rbac-assignment.service');
    const usersCollection = db.collection('users');

    const isCurrentUserAdmin = await isAdministrator(db, req.user.userID);
    if (!isCurrentUserAdmin) {
      return res.status(403).json({
        success: false,
        error: req.t('users.disableMFAAccessDenied'),
        message: req.t('users.disableMFAAccessDeniedMessage')
      });
    }

    // Busca o usuário alvo
    const userFilter = buildUserFilterById(req.params.id);
    const targetUser = await usersCollection.findOne(userFilter);

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado'
      });
    }

    // Verifica se o usuário alvo é administrador
    // Este endpoint permite desativar MFA apenas de outros administradores
    const isTargetAdmin = await isAdministrator(db, targetUser._id.toString());
    
    if (!isTargetAdmin) {
      return res.status(403).json({
        success: false,
        error: req.t('users.disableMFANotAllowed'),
        message: req.t('users.disableMFANotAllowedMessage')
      });
    }

    // Desativa MFA (mantém o secret para permitir reativação fácil)
    await usersCollection.updateOne(
      userFilter,
      {
        $set: {
          mfaEnabled: false,
          mfaFailedAttempts: 0,
          mfaLocked: false,
          updatedAt: new Date()
        }
      }
    );

    // #1033: linha de auditoria EXPLÍCITA, par de writeMfaResetAudit. A linha
    // genérica do audit.middleware classifica este path como 'MFA' pelo
    // mesmo casamento de substring que usa para /reset-mfa ('/mfa' está
    // contido em ambos) -- então sem isto esta rota fica indistinguível de
    // qualquer um dos dois ramos de reset-mfa na trilha, apesar de ser uma
    // terceira operação com forma própria: desliga mfaEnabled mas
    // deliberadamente MANTÉM o mfaSecret (comentário acima), diferente dos
    // dois ramos de reset-mfa. `operation: 'disable'` é o discriminador --
    // não o papel do alvo, que não fica registrado em outro lugar da linha.
    await writeMfaResetAudit(db, req, targetUser, {
      operation: 'disable',
      enrolmentPreserved: true,
      secondFactorActive: false,
      fieldsCleared: ['mfaEnabled', 'mfaFailedAttempts', 'mfaLocked'],
      sessionsRevoked: false,
      message: 'MFA desativado (cadastro do segundo fator preservado para reativação)'
    });

    return res.status(200).json({
      success: true,
      message: req.t('users.disableMFASuccess')
    });
  } catch (error) {
    logger.error('Erro ao desativar MFA:', error.message);
    return res.status(500).json({
      success: false,
      error: req.t('users.disableMFAError'),
      message: error.message
    });
  }
});

module.exports = router;
// #1042: exposto para teste. `module.exports` E o router, entao isto apenas
// pendura uma propriedade nele -- `app.js:412` continua recebendo o router e
// `app.use` ignora propriedades extras. O guard de tipo acima so e alcancavel
// chamando a funcao diretamente, ja que todos os call sites internos passam
// literais.
module.exports.writeMfaResetAudit = writeMfaResetAudit;

