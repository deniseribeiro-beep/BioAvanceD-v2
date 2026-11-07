const express = require('express');
const router = express.Router();
const authService = require('../../services/auth.service');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission, requireOrganizationScope } = require('../../infrastructure/middleware/rbac');
const { resolveUserOrganizationScope, resolveOrganizationIdForCreate } = require('../../services/rbac-assignment.service');
const { isSampleInOrganizationScope } = require('../../services/sampleTenancy.service');
const logger = require('../../utils/logger');
const consentValidator = require('../../services/consent.validator');
const RegisterSampleUseCase = require('../../core/use-cases/RegisterSampleUseCase');
const LineageRepository = require('../../infrastructure/database/neo4j/LineageRepository');
const { getCollection } = require('../../utils/collectionResolver');
const { ObjectId } = require('mongodb');
const { findRcsDerivedFields, rcsDerivedWriteDetails } = require('../../models/Sample');
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
    // mfaSecretCiphertext e ainda assim zera mfaEnabled, e [ran it] auth.service.js:507
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

// #1384: an organization-scoped caller manages the users of its own
// organizations only; the Administrador (global) manages every user. A
// user's organizations are its active UserRoleAssignment scope ids, the
// tenancy key (User.organizationId is profile data). A target is in reach
// when it shares one organization with the caller, the overlap
// isRecordInOrganizationScope applies to an array field. A global or
// org-less target is out of reach of every non-global caller. See
// docs/decisions/2026-10-17-org-scoped-user-management.md.
//
// Defined above the first registration: the org-scope sweep reads the text
// from one registration to the next, so a helper between two would count
// as the gate of the one above it.
async function isUserInCallerScope(db, organizationScope, userAccountId) {
  // Fail closed, as resolveOrganizationIdForCreate does: no scope means
  // requireOrganizationScope is not on the route.
  if (!organizationScope) return false;
  if (organizationScope.scope === 'global') return true;
  const targetScope = await resolveUserOrganizationScope(db, String(userAccountId));
  if (targetScope.scope !== 'organization') return false;
  const callerIds = organizationScope.organizationIds || [];
  return targetScope.organizationIds.some((id) => callerIds.includes(id));
}

// An out-of-scope existing record answers 403, not 404 (the precedent
// isRecordInOrganizationScope's comment states).
function refuseOutOfScopeUser(res) {
  return res.status(403).json({
    success: false,
    error: 'Acesso negado',
    message: 'Este usuário pertence a outra organização'
  });
}

// #1384: a non-global caller grants, revokes or moves a user only into one
// of its own organizations.
function isOrganizationInCallerScope(organizationScope, organizationId) {
  if (organizationScope?.scope === 'global') return true;
  return Boolean(organizationId) && (organizationScope?.organizationIds || []).includes(organizationId);
}

// RF003 - Cadastro de usuário
//
// #1008: every registration grants a role (registerUser falls back to
// Técnico when none is named), so creating an account is also a role
// assignment, and the route requires assignRole as well as createUser.
router.post('/register',
  authenticate,
  requirePermission('createUser'),
  requirePermission('assignRole'),
  requireOrganizationScope,
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

      // #1384: #1071's create rule, as the patient controller applies it. An
      // organization-scoped caller registers into its own organization; its
      // 403/400 throws reach the catch below.
      if (req.organizationScope.scope !== 'global') {
        req.body.organizationId = resolveOrganizationIdForCreate(req.organizationScope, req.body.organizationId);
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

      // #998's hierarchy floor now lives in registerUser itself (#1057), so
      // this route and any future caller of the service get the same check.
      // It throws a statusCode-403 error, mapped in the catch below.
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
      if (error.statusCode === 403) {
        return res.status(403).json({
          success: false,
          error: req.t('errors.forbidden'),
          message: error.message
        });
      }
      return res.status(error.statusCode === 422 ? 422 : 400).json({
        success: false,
        error: req.t('users.registerError'),
        message: error.message,
        details: error.details
      });
    }
  }
);

// RF002 - Somente Coordenador/Administrador podem listar usuários (o backend
// deve validar a permissão independentemente da ocultação da função no
// frontend) — mesma permissão já aplicada a PUT/DELETE deste recurso.
router.get('/', authenticate, requirePermission('readUser'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: req.t('errors.databaseUnavailable')
      });
    }

    const usersCollection = db.collection('users');
    let users = await usersCollection.find({}).toArray();
    // #1384: an organization-scoped caller lists the users of its own
    // organizations only.
    if (req.organizationScope.scope !== 'global') {
      const inScope = await Promise.all(users.map((user) => isUserInCallerScope(db, req.organizationScope, user._id)));
      users = users.filter((_user, index) => inScope[index]);
    }
    const UserModel = require('../../models/User');
    const { resolveRoleDisplayName, getActiveRoleCodes } = require('../../services/rbac-assignment.service');

    // Remove senhas dos resultados e traduz status para português
    const sanitizedUsers = await Promise.all(users.map(async (user) => {
      // #1068: strips mfaSecretCiphertext and passwordResetTokenHash too -- see
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
      // #1240: the additive `auditor` role, read back under the same name PUT
      // takes it by. The user form seeds itself from this row.
      userWithoutPassword.auditorRole = (await getActiveRoleCodes(db, String(userWithoutPassword._id))).includes('auditor');
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

    // #1241: this serves the `logs` collection, the RNF009 audit trail, which
    // /api/logs gates on isAuditReader (#1056). Once #926 made this route
    // reachable it had authenticate alone, so every account could read the
    // trail here. Same rule and same refusal as logs.routes.js.
    const { isAuditReader } = require('../../services/rbac-assignment.service');
    if (!(await isAuditReader(db, req.user?.userID))) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Apenas perfis Admin ou Auditor podem acessar trilhas de auditoria.'
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

// #1241: gated like GET / above. With authenticate alone any account could
// read any other user's record (email, phone, organization, status, roles).
router.get('/:id', authenticate, requirePermission('readUser'), requireOrganizationScope, async (req, res) => {
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
    if (!(await isUserInCallerScope(db, req.organizationScope, user._id))) return refuseOutOfScopeUser(res);

    const UserModel = require('../../models/User');
    // #1068: strips mfaSecretCiphertext and passwordResetTokenHash too -- see
    // UserModel.stripSecrets for the dictionary entries that require it.
    const userWithoutPassword = UserModel.stripSecrets(user);
    
    // Traduz status para português para o frontend
    if (userWithoutPassword.status) {
      userWithoutPassword.status = UserModel.translateStatus(userWithoutPassword.status);
    }

    // #1240: same field as the list.
    const { getActiveRoleCodes } = require('../../services/rbac-assignment.service');
    userWithoutPassword.auditorRole = (await getActiveRoleCodes(db, user._id.toString())).includes('auditor');

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

router.put('/:id', authenticate, requirePermission('updateUser'), requireOrganizationScope, async (req, res) => {
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
    if (!(await isUserInCallerScope(db, req.organizationScope, targetUser._id))) return refuseOutOfScopeUser(res);

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

    // #1013: an administrator sets a password through POST /:id/set-password.
    // A non-empty one here is refused rather than dropped, so a stale client
    // cannot believe it changed a password. A blank one is the form's
    // "unchanged" and is dropped.
    if (req.body.password) {
      return res.status(422).json({
        success: false,
        error: req.t('errors.invalidInput'),
        message: 'A senha não é alterada por esta rota; use POST /api/users/:id/set-password.',
        details: ['A senha não é alterada por esta rota; use POST /api/users/:id/set-password.']
      });
    }
    delete req.body.password;

    // Prepara dados para validação (mescla dados existentes com novos)
    // Remove campos que não devem ser validados na atualização
    // #1330: the stored document under the API's names, so it validates
    // against the same keys the body uses whichever names it is stored under.
    const { password: __unusedPassword, ...targetUserWithoutPassword } = UserModel.apiViewOf(targetUser);
    const dataToValidate = {
      ...targetUserWithoutPassword,
      ...req.body,
      _id: targetUser._id, // Mantém _id para indicar que é atualização
      // #1013: this route never sets a password (refused above), so the
      // stored hash is kept out of validation.
      password: undefined
    };

    // Valida dados antes de atualizar
    const validation = UserModel.validate(dataToValidate);
    if (!validation.isValid) {
      return res.status(422).json({
        success: false,
        error: req.t('errors.invalidInput'),
        message: validation.errors.join(', '),
        details: validation.errors
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

    // #1384: a change of home organization moves the assignment scope
    // (updateAssignmentScope below), so a non-global caller may move a user
    // only into one of its own organizations, and never out of all of them.
    // The old home must be one of the caller's too: updateAssignmentScope
    // revokes the old home's assignment, so moving a user that also holds
    // the caller's organization would take away one the caller does not hold.
    if (req.organizationScope.scope !== 'global'
      && req.body.organizationId !== undefined
      && req.body.organizationId !== (targetUser.organizationId ?? null)
      && (!isOrganizationInCallerScope(req.organizationScope, req.body.organizationId)
        || !isOrganizationInCallerScope(req.organizationScope, targetUser.organizationId ?? null))) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Não é permitido mover o usuário para outra organização'
      });
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
    // #1243: a promotion is a change of level (#1009's rule). NewUserPage
    // echoes roleName on every save, so without `!isAdmin` a plain edit of an
    // existing Administrador counted as one and the clear below destroyed
    // their MFA enrolment -- #1021's defect through a second field.
    // #1245: Number(), as the level floor and changeUserRole read it. A JSON
    // string '4' promotes, and `=== 4` let that promotion skip the clear.
    const isBecomingAdmin = !isAdmin && (Number(requestedAccessType) === 4 || req.body.roleName === 'Administrador');

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

    // #1240: hoisted out of the #1008 block below, which computes it against
    // the pre-edit state; the audit row further down records the auditor flag
    // only when this is true.
    let auditorChange = false;

    // #1008 (RF003 AC#3, Denise 2026-09-25): assigning a role is the
    // Administrador's, through the assignRole permission, not createUser.
    // Three things in this body are role assignment: a level change, a
    // change to the additive auditor role, and a change to the role's
    // validity window (middleware/auth.js enforces roleValidUntil, so moving
    // it can lock a user out or keep an expired role alive). Each counts only
    // when it actually CHANGES. NewUserPage echoes the whole user back on
    // every save, so a presence check would refuse a Coordenador's plain
    // rename. The #998 floor above stays as defence in depth.
    {
      const {
        resolveUserHierarchyLevel,
        getActiveRoleCodes,
        userHasPermission,
      } = require('../../services/rbac-assignment.service');

      let levelChange = false;
      if (requestedAccessType) {
        const currentLevel = targetLevel !== null
          ? targetLevel
          : await resolveUserHierarchyLevel(db, targetUser._id.toString());
        levelChange = Number(requestedAccessType) !== Number(currentLevel);
      }

      if (requestedAuditorRole !== undefined) {
        const currentRoleCodes = await getActiveRoleCodes(db, targetUser._id.toString());
        auditorChange = Boolean(requestedAuditorRole) !== currentRoleCodes.includes('auditor');
      }

      const asTime = (value) => (value ? new Date(value).getTime() : null);
      const validityChange = ['roleValidFrom', 'roleValidUntil'].some((field) =>
        req.body[field] !== undefined && asTime(req.body[field]) !== asTime(targetUser[field]));

      if (levelChange || auditorChange || validityChange) {
        const mayAssignRole = await userHasPermission(db, req.user?.userID, 'assignRole');
        if (!mayAssignRole) {
          return res.status(403).json({
            success: false,
            error: req.t('errors.forbidden'),
            message: 'Atribuir ou alterar papel é uma ação do Administrador.'
          });
        }
      }
    }

    // #993: mfaSecretCiphertext e mfaActivationDate NUNCA são graváveis pelo chamador.
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
    // #1072: BOTH names. The live field is mfaSecretCiphertext; the old
    // plaintext name stays deleted so a caller cannot smuggle it onto the
    // document under a name some other reader might still honour.
    delete req.body.mfaSecret;
    delete req.body.mfaSecretCiphertext;
    delete req.body.mfaActivationDate;

    // #1021: mfaEnabled agora também sai do body ANTES de qualquer branch.
    // O guard aqui era `undefined || false`, então QUALQUER PUT parcial
    // contra um alvo Administrador -- um `{name:'x'}` vindo de um script --
    // gravava mfaEnabled:false e zerava segredo e data de ativação, sem que
    // nada na resposta ou na trilha dissesse que o segundo fator tinha sido
    // destruído. Não era um caso latente: `createUser` é concedido também ao
    // Coordenador, e o piso de hierarquia de #998/#1009 está dentro de
    // `if (requestedAccessType)`, ou seja, só dispara quando o body carrega
    // accessType/roleName -- um `{name:'x'}` passava direto por ele.
    //
    // Forma decidida em #999: apagar o campo do body (a forma de #993) e
    // estreitar o gatilho do clear para a PROMOÇÃO de fato. Desabilitar MFA
    // passa a ter um caminho só -- POST /:id/disable-mfa -- que exige
    // requirePermission('disableMFA'), verifica isAdministrator do chamador,
    // PRESERVA o mfaSecretCiphertext para reativação e escreve a própria linha de
    // auditoria. A UI já chama exatamente esse endpoint num botão dedicado
    // (SystemManagementPage.tsx), então nada no produto perde capacidade.
    delete req.body.mfaEnabled;

    // Promoção a Administrador: a matrícula anterior não vale para o novo
    // papel, então é zerada aqui. Server-set -- é por isso que os três campos
    // continuam em ALLOWED_USER_UPDATE_FIELDS. Note que o gatilho é
    // isBecomingAdmin sozinho: um alvo que JÁ é admin não está sendo
    // promovido, e um PUT nele não é uma decisão sobre o MFA dele.
    if (isBecomingAdmin) {
      req.body.mfaEnabled = false;
      req.body.mfaSecretCiphertext = null;
      req.body.mfaActivationDate = null;
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
    // (mfaEnabled/mfaSecretCiphertext/mfaActivationDate/roleValidFrom/
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
      // #1013: 'password' is gone -- POST /:id/set-password owns it.
      'status',
      'mfaEnabled', 'mfaSecretCiphertext', 'mfaActivationDate',
      // #1275 follow-up: 'anonId' is gone. Log reads now honour the stored
      // pseudonym, so setting it would relabel this user's audit rows as
      // another user's. Only generateAnonId writes it.
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

    // #1330: the allowlist is in the API's names; the write stores each field
    // under its canonical name and removes the legacy one.
    const result = await usersCollection.updateOne(
      userFilter,
      UserModel.storedUpdateOf(updateFields)
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
    
    // #982's revocation moved to POST /:id/set-password with the password
    // set itself (#1013).

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
      // #1240: read the held state HERE, after changeUserRole, which revokes
      // every active assignment -- auditor included. A level change that
      // echoes auditorRole=true must re-grant it, while the audit row reports
      // the flag only when it differs from the pre-edit state (auditorChange),
      // so a form echoing the unchanged flag is not logged as a permission
      // change (the #1009 trap, for this field).
      const { grantAdditionalRole, revokeAdditionalRole, getActiveRoleCodes } = require('../../services/rbac-assignment.service');
      const heldNow = (await getActiveRoleCodes(db, targetUser._id.toString())).includes('auditor');
      if (requestedAuditorRole && !heldNow) {
        await grantAdditionalRole(db, {
          userAccountId: targetUser._id.toString(),
          roleCode: 'auditor',
          grantedBy: req.user?.userID,
          organizationId: effectiveOrganizationId,
        });
      } else if (!requestedAuditorRole && heldNow) {
        await revokeAdditionalRole(db, {
          userAccountId: targetUser._id.toString(),
          roleCode: 'auditor',
          revokedBy: req.user?.userID,
        });
      }
      if (auditorChange) {
        changes.auditorRole = Boolean(requestedAuditorRole);
      }
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
        // #1358: only the home organization's assignment follows it.
        previousOrganizationId: targetUser.organizationId ?? null,
        updatedBy: req.user?.userID,
      });
      changes.organizationId = { from: targetUser.organizationId ?? null, to: req.body.organizationId ?? null };
    }
    const previousStatus = UserModel.accountStatusOf(targetUser);
    if (req.body.status && req.body.status !== previousStatus) {
      changes.status = { from: previousStatus, to: req.body.status };
    }

    // #1306 (RF001 AC4, RNF021 C2, RNF008 C7): inactivation and a role change
    // revoke the user's live sessions. A role change counts whichever way it
    // goes, since the access token carries the old level until it is renewed.
    const leftActive = Boolean(changes.status) && req.body.status !== 'active';
    const roleChanged = Boolean(changes.accessType) || changes.auditorRole !== undefined;
    if (leftActive || roleChanged) {
      const sessionService = require('../../services/session.service');
      await sessionService.invalidateUserSessions(db, targetUser._id.toString(), 'admin_action', req.user?.userID, { req });
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

    // #914, carrying #1011's decision (2026-09-25): the promotion clear above
    // destroys an enrolled second factor, and until now the trail recorded it
    // only as a generic User update. Same helper, and so the same 'MFA' action
    // and row shape, as reset-mfa and disable-mfa -- `operation` is the
    // discriminator. Written only when there WAS an enrolment to clear: a
    // promotion of a user with no second factor changes nothing about MFA.
    if (isBecomingAdmin && (targetUser.mfaEnabled || targetUser.mfaSecretCiphertext)) {
      await writeMfaResetAudit(db, req, targetUser, {
        operation: 'promotion_clear',
        enrolmentPreserved: false,
        secondFactorActive: false,
        fieldsCleared: ['mfaEnabled', 'mfaSecretCiphertext', 'mfaActivationDate'],
        sessionsRevoked: false,
        message: 'MFA removido na promoção a Administrador (cadastro do segundo fator apagado)'
      });
    }

    // #1068: strips mfaSecretCiphertext and passwordResetTokenHash too -- see
    // UserModel.stripSecrets for the dictionary entries that require it.
    // (UserModel is already required earlier in this handler -- #566.)
    const userWithoutPassword = UserModel.stripSecrets(updatedUser);

    // #427: roleName resolved from the active RBAC assignment for display —
    // no longer persisted on the User document.
    const { resolveRoleDisplayName, getActiveRoleCodes: readRoleCodes } = require('../../services/rbac-assignment.service');
    userWithoutPassword.roleName = await resolveRoleDisplayName(db, targetUser._id.toString());
    // #1240: same field as the list, so the form's next save echoes the truth.
    userWithoutPassword.auditorRole = (await readRoleCodes(db, targetUser._id.toString())).includes('auditor');

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

// #1358: a user's organization scopes. The account keeps one home
// organization (UserAccount.organizationId, dict-02 P1X-0187, 0..1), changed
// through PUT /:id; each further organization is its own UserRoleAssignment
// of the user's role (P1X-0225..0237), granted and revoked here. Scope is
// resolved on every request, so a change applies at once.
async function findUserForScopeRoute(req, res) {
  const db = req.app.locals.db;
  if (!db) {
    res.status(503).json({ success: false, error: req.t('errors.databaseUnavailable') });
    return null;
  }
  const userFilter = buildUserFilterById(req.params.id);
  const user = await db.collection('users').findOne(userFilter);
  if (!user) {
    res.status(404).json({ success: false, error: req.t('users.notFound') });
    return null;
  }
  if (!(await isUserInCallerScope(db, req.organizationScope, user._id))) {
    refuseOutOfScopeUser(res);
    return null;
  }
  return { db, user };
}

async function sendOrganizationScopes(res, db, user, status = 200) {
  const { listOrganizationScopes } = require('../../services/rbac-assignment.service');
  const scopes = await listOrganizationScopes(db, user._id.toString());
  return res.status(status).json({
    success: true,
    data: {
      homeOrganizationId: user.organizationId ?? null,
      global: scopes.global,
      organizationIds: scopes.organizationIds,
    }
  });
}

router.get('/:id/organizations', authenticate, requirePermission('readUser'), requireOrganizationScope, async (req, res) => {
  try {
    const found = await findUserForScopeRoute(req, res);
    if (!found) return undefined;
    return sendOrganizationScopes(res, found.db, found.user);
  } catch (error) {
    logger.error('Erro ao listar organizações do usuário:', error.message);
    return res.status(500).json({ success: false, error: req.t('errors.serverError'), message: error.message });
  }
});

// Granting a scope is a role assignment (#1008), so assignRole gates it too.
// #1229: it changes an existing account, so updateUser is passed 'UPDATE'
// rather than deriving CREATE from the POST.
router.post('/:id/organizations', authenticate, requirePermission('updateUser', 'UPDATE'), requirePermission('assignRole'), requireOrganizationScope, async (req, res) => {
  try {
    const found = await findUserForScopeRoute(req, res);
    if (!found) return undefined;
    const { db, user } = found;
    // #1384: a non-global caller grants only one of its own organizations.
    const requestedOrganizationId = typeof req.body?.organizationId === 'string' ? req.body.organizationId.trim() : req.body?.organizationId;
    if (!isOrganizationInCallerScope(req.organizationScope, requestedOrganizationId)) {
      return res.status(403).json({ success: false, error: 'Acesso negado', message: 'Este usuário pertence a outra organização' });
    }
    const { grantOrganizationScope } = require('../../services/rbac-assignment.service');
    const { created } = await grantOrganizationScope(db, {
      userAccountId: user._id.toString(),
      organizationId: req.body?.organizationId,
      grantedBy: req.user?.userID,
    });
    if (created) {
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.logPermissionChange(req, req.params.id, {
        organizationScope: { added: String(req.body.organizationId).trim() }
      });
    }
    return sendOrganizationScopes(res, db, user, created ? 201 : 200);
  } catch (error) {
    const status = error.statusCode || (/não encontrado/.test(error.message) ? 404 : 500);
    if (status === 500) logger.error('Erro ao conceder organização ao usuário:', error.message);
    return res.status(status).json({ success: false, error: error.message, message: error.message });
  }
});

// assignRole allows CREATE and UPDATE; a removal revokes an assignment, an
// UPDATE of it, as the revoke-sessions route passes its own action. The same
// holds for updateUser (#1229).
router.delete('/:id/organizations/:organizationId', authenticate, requirePermission('updateUser', 'UPDATE'), requirePermission('assignRole', 'UPDATE'), requireOrganizationScope, async (req, res) => {
  try {
    const found = await findUserForScopeRoute(req, res);
    if (!found) return undefined;
    const { db, user } = found;
    const organizationId = String(req.params.organizationId);
    // #1384: a non-global caller revokes only one of its own organizations.
    if (!isOrganizationInCallerScope(req.organizationScope, organizationId)) {
      return res.status(403).json({ success: false, error: 'Acesso negado', message: 'Este usuário pertence a outra organização' });
    }
    if (organizationId === (user.organizationId ?? null)) {
      return res.status(409).json({
        success: false,
        error: 'A organização principal do usuário é alterada por PUT /api/users/:id.',
        message: 'A organização principal do usuário é alterada por PUT /api/users/:id.'
      });
    }
    const { revokeOrganizationScope } = require('../../services/rbac-assignment.service');
    const revoked = await revokeOrganizationScope(db, {
      userAccountId: user._id.toString(),
      organizationId,
      revokedBy: req.user?.userID,
    });
    if (revoked.length > 0) {
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.logPermissionChange(req, req.params.id, {
        organizationScope: { removed: organizationId }
      });
    }
    return sendOrganizationScopes(res, db, user);
  } catch (error) {
    const status = error.statusCode || 500;
    if (status === 500) logger.error('Erro ao remover organização do usuário:', error.message);
    return res.status(status).json({ success: false, error: error.message, message: error.message });
  }
});

router.delete('/:id', authenticate, requirePermission('deleteUser'), requireOrganizationScope, async (req, res) => {
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

    // #1008: the #998 floor covered granting a level above your own but not
    // DELETING a user above your own, so a Coordenador could delete an
    // Administrador. Same root cause as the role-assignment gate: createUser
    // gates every verb on this resource.
    const targetUser = await usersCollection.findOne(userFilter);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado'
      });
    }
    if (!(await isUserInCallerScope(db, req.organizationScope, targetUser._id))) return refuseOutOfScopeUser(res);
    const { resolveUserHierarchyLevel } = require('../../services/rbac-assignment.service');
    const [targetLevel, callerLevel] = await Promise.all([
      resolveUserHierarchyLevel(db, targetUser._id.toString()),
      resolveUserHierarchyLevel(db, req.user?.userID),
    ]);
    if (Number(targetLevel || 0) > Number(callerLevel || 0)) {
      return res.status(403).json({
        success: false,
        error: req.t('errors.forbidden'),
        message: 'Não é possível excluir um usuário com nível de acesso superior ao seu.'
      });
    }

    // #1306 (RF003 AC4, RNF022 C5): deletion is logical. The account is
    // inactivated and its sessions revoked; the document, its audit trail and
    // its role history stay. A hard deleteOne left audit rows naming an
    // account that no longer existed.
    const UserModel = require('../../models/User');
    await usersCollection.updateOne(
      { _id: targetUser._id },
      UserModel.storedUpdateOf({ accountStatus: 'inactive', updatedAt: new Date() })
    );
    const sessionService = require('../../services/session.service');
    await sessionService.invalidateUserSessions(db, targetUser._id.toString(), 'admin_action', req.user?.userID, { req });

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

// #1241: gated like GET /:id. With authenticate alone it told any account
// whether an id existed and whether it was active.
router.get('/:id/validate-status', authenticate, requirePermission('readUser'), requireOrganizationScope, async (req, res) => {
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
    if (!(await isUserInCallerScope(db, req.organizationScope, user._id))) return refuseOutOfScopeUser(res);

    const UserModel = require('../../models/User');
    return res.status(200).json({
      success: true,
      data: {
        status: UserModel.accountStatusOf(user) || 'inactive'
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
router.post('/register-patient', authenticate, requirePermission('createPatient'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    // #1384: #1071's create rule, as paciente.controller.js applies it.
    if (req.organizationScope.scope !== 'global') {
      req.body.clinicalUnitId = resolveOrganizationIdForCreate(req.organizationScope, req.body?.clinicalUnitId);
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
    if (error.statusCode === 403) {
      return res.status(403).json({ success: false, error: req.t('errors.forbidden'), message: error.message });
    }
    return res.status(error.statusCode === 422 ? 422 : 400).json({
      success: false,
      error: req.t('users.registerPatientError'),
      message: error.message,
      details: error.details
    });
  }
});

router.post('/register-sample', authenticate, requirePermission('createSample'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const sampleService = require('../../services/sample.service');
    const { resolveCallerCreateOrganization } = require('../../services/callerCreateOrganization.service');
    const { qualificationContextErrors } = require('../../services/quality-domain.service');

    // RF018 AC2 (#1320): this route skips validateCreateSamplePayload, so it
    // applies the same use-context rule before createSample can store one.
    const contextErrors = qualificationContextErrors(req.body?.qualificationContext);
    if (contextErrors.length > 0) {
      return res.status(422).json({
        success: false,
        error: 'Payload inválido',
        message: contextErrors.join(', '),
        details: contextErrors
      });
    }
    // RNF018 AC4 (#1489): nor does it let a caller write the RCS result.
    const rcsDerivedFields = findRcsDerivedFields(req.body);
    if (rcsDerivedFields.length > 0) {
      return res.status(422).json({
        success: false,
        error: 'RCS_DERIVED_WRITE_REFUSED',
        fields: rcsDerivedFields,
        details: rcsDerivedWriteDetails(rcsDerivedFields)
      });
    }

    // #1376: this route resolves no scope of its own, so the caller's scope
    // decides the organization here, by #1071's create rule POST /api/samples
    // uses -- a single-organization caller's own, a multi-organization
    // caller's pick among its own, a global caller's pick of any existing
    // organization, or none -- named in the body's own organizationId field,
    // and createSample stamps it as Sample.organizationId. The body's
    // organizationId is never passed on. The collection site the body names
    // (ELM-0128) is data and is kept; a body naming none gets the stamped
    // organization.
    const requestedOrganizationId = typeof req.body?.organizationId === 'string' && req.body.organizationId.trim() !== ''
      ? req.body.organizationId.trim()
      : undefined;
    let organizationId;
    try {
      // #1384: the gate's scope, as import.routes.js's creates pass it.
      ({ organizationId } = await resolveCallerCreateOrganization(db, {
        userId: req.user?.userID,
        organizationScope: req.organizationScope,
        requested: requestedOrganizationId
      }));
    } catch (error) {
      return res.status(error.statusCode || 403).json({ success: false, error: error.message });
    }
    const { organizationId: _bodyOrganizationId, ...body } = req.body || {};
    const namesCollectionSite = body.collectionSite !== undefined
      && body.collectionSite !== null
      && body.collectionSite !== '';
    const sampleData = namesCollectionSite || !organizationId
      ? body
      : { ...body, collectionSite: organizationId };

    const sampleRepository = {
      // Same contract as POST /api/samples: the use case's options (audit
      // actor, the in-transaction register custody append) reach the create.
      create: async (sampleData, options = {}) => sampleService.createSample(db, { ...sampleData }, options),
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
      lineageRepository: new LineageRepository(db),
      quarantineService: req.app.locals.neo4jQuarantineService || req.app.locals.topologicalQuarantine || null
    });

    const result = await registerSampleUseCase.execute({
      sampleData,
      options: { organizationId },
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

    return res.status(error.statusCode === 422 ? 422 : 400).json({
      success: false,
      error: req.t('users.registerSampleError'),
      message: error.message,
      details: error.details
    });
  }
});

router.post('/record-withdrawal', authenticate, requirePermission('withdrawSample', 'UPDATE'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    // #1384: the scope check of sample.routes.js's POST /:id/withdraw, before
    // the consent check and the mutation.
    if (req.body?.sampleID) {
      const sampleService = require('../../services/sample.service');
      const sampleForScope = await sampleService.getSample(db, req.body.sampleID);
      if (sampleForScope && !isSampleInOrganizationScope(sampleForScope, req.organizationScope)) {
        return res.status(403).json({
          success: false,
          error: 'Acesso negado',
          message: 'Esta amostra pertence a outra organização'
        });
      }
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

router.post('/generate-report', authenticate, requirePermission('viewReports'), requireOrganizationScope, async (req, res) => {
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
      status: 'pending',
      // #1384: the organizationIds stamp reports.routes.js's generate writes.
      organizationIds: req.organizationScope.scope === 'organization' ? req.organizationScope.organizationIds : []
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
router.post('/register-sensor', authenticate, requirePermission('manageSensor'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    // #1384: #1071's create rule, as sensor.controller.js's create applies it.
    const organizationId = resolveOrganizationIdForCreate(req.organizationScope, req.body?.organizationId);
    const sensorService = require('../../services/sensor.service');
    const sensor = await sensorService.createSensor(db, { ...req.body, organizationId });

    return res.status(201).json({
      success: true,
      message: req.t('users.registerSensorSuccess'),
      data: sensor
    });
  } catch (error) {
    logger.error('Erro ao registrar sensor:', error.message);
    if (error.statusCode === 403) {
      return res.status(403).json({ success: false, error: req.t('errors.forbidden'), message: error.message });
    }
    return res.status(error.statusCode === 422 ? 422 : 400).json({
      success: false,
      error: req.t('users.registerSensorError'),
      message: error.message,
      details: error.details
    });
  }
});

// Reset MFA - apenas usuários com a permissão resetMFA
router.post('/:id/reset-mfa', authenticate, requirePermission('resetMFA', 'UPDATE'), requireOrganizationScope, async (req, res) => {
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
    if (!(await isUserInCallerScope(db, req.organizationScope, targetUser._id))) return refuseOutOfScopeUser(res);

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
    const UserModel = require('../../models/User');
    await usersCollection.updateOne(
      userFilter,
      UserModel.storedUpdateOf({
        mfaEnabled: false,
        mfaSecretCiphertext: null,
        mfaSetupAt: null,
        mfaFailedAttempts: 0,
        mfaLocked: false,
        lastLoginAt: null, // Força novo setup de MFA no próximo login
        updatedAt: new Date()
      })
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
    await sessionService.invalidateUserSessions(db, targetUser._id.toString(), 'admin_action', req.user?.userID, { req });

    // #1031: par explícito da linha do desbloqueio acima. Sem as duas, a
    // trilha registra as duas operações de forma indistinguível.
    await writeMfaResetAudit(db, req, targetUser, {
      operation: 'reset',
      enrolmentPreserved: false,
      secondFactorActive: false,
      fieldsCleared: ['mfaEnabled', 'mfaSecretCiphertext', 'mfaActivationDate', 'mfaFailedAttempts', 'mfaLocked', 'lastLogin'],
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

// #1020 / RF003 AC#5 ("Revogar sessões"): an administrator revokes every
// active session of an account. `reason` is 'admin_action' (default) or
// 'risk', the P1X-0267 member that had no writer: the administrator records
// that they judge the account at risk, which is what an auditor filtering the
// session view by motivo needs to see. The other three members are not the
// administrator's to claim (a user's own request, a password change, an
// expiry), so they are refused here. No automatic 'risk' writer exists on
// purpose: revoking on a login lockout would let anyone log the real owner
// out by failing passwords against the account.
//
// #1241, kept deliberately: no hierarchy floor, so an administrator may
// revoke another administrator's sessions, and their own. Revocation grants
// nothing and the target signs in again. A compromised administrator account
// is the case reason 'risk' exists for, and a floor would leave no other
// administrator able to cut it off.
router.post('/:id/revoke-sessions', authenticate, requirePermission('revokeSessions', 'UPDATE'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const reason = req.body?.reason === undefined ? 'admin_action' : req.body.reason;
    if (!['admin_action', 'risk'].includes(reason)) {
      return res.status(422).json({
        success: false,
        error: 'Dados inválidos',
        message: "reason deve ser 'admin_action' ou 'risk'",
        details: ["reason deve ser 'admin_action' ou 'risk'"]
      });
    }

    const userFilter = buildUserFilterById(req.params.id);
    const targetUser = await db.collection('users').findOne(userFilter);
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }
    if (!(await isUserInCallerScope(db, req.organizationScope, targetUser._id))) return refuseOutOfScopeUser(res);

    const sessionService = require('../../services/session.service');
    const revoked = await sessionService.invalidateUserSessions(
      db, targetUser._id.toString(), reason, req.user?.userID, { req }
    );

    return res.status(200).json({ success: true, data: { revoked, reason } });
  } catch (error) {
    logger.error('Erro ao revogar sessões do usuário:', error.message);
    return res.status(500).json({ success: false, error: 'Erro ao revogar sessões' });
  }
});

// Forçar redefinição de senha - RF014 AC#4 (#648): flags the target user's
// account so their next login requires setting a new password before
// proceeding (auth.service.js#processLogin gates on this flag).
router.post('/:id/force-password-reset', authenticate, requirePermission('forcePasswordReset', 'UPDATE'), requireOrganizationScope, async (req, res) => {
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
    if (!(await isUserInCallerScope(db, req.organizationScope, targetUser._id))) return refuseOutOfScopeUser(res);

    const UserModel = require('../../models/User');
    await usersCollection.updateOne(
      userFilter,
      UserModel.storedUpdateOf({
        forcePasswordReset: true,
        updatedAt: new Date()
      })
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

// #1013: an administrator sets another user's password. This rode on PUT /:id
// under createUser, which hashed and $set the field and nothing else: no
// strength or reuse check, no passwordHistory, and a generic update row in the
// trail. It now has its own permission and its own audit row, and it keeps
// the bookkeeping the owner's own change keeps (auth.service's forceReset
// branch). It also sets forceReset, because the administrator now knows the
// password, so the owner must replace it at next login (RF014 AC#4's
// mechanism). #982's revocation moved here from the PUT.
//
// #1245 item 1: an Administrador target is allowed, with no hierarchy floor,
// deliberately. Denise's Axis E log (#686, CONFIRM) settles the sibling:
// force-password-reset "may target Administrador", the asymmetry with the old
// reset-mfa refusal being intentional. What this route adds is that the caller
// knows the new password, and forceReset makes that knowledge unusable on its
// own: processLogin's forceReset branch issues no token until a NEW password is
// set, so the caller can only get in by replacing the password again. That
// locks the real owner out, visibly, and leaves this route's warning row, the
// admin_action revocation and a password_change revocation on the trail.
router.post('/:id/set-password', authenticate, requirePermission('setUserPassword', 'UPDATE'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const usersCollection = db.collection('users');
    const userFilter = buildUserFilterById(req.params.id);
    const targetUser = await usersCollection.findOne(userFilter);
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }
    if (!(await isUserInCallerScope(db, req.organizationScope, targetUser._id))) return refuseOutOfScopeUser(res);

    const newPassword = req.body?.password;
    const passwordService = require('../../services/password.service');
    const passwordPolicy = await passwordService.resolvePasswordPolicy(db);
    try {
      passwordService.validateStrength(newPassword, passwordPolicy, targetUser);
      await passwordService.validateReuse(newPassword, targetUser, passwordPolicy);
    } catch (validationError) {
      return res.status(422).json({ success: false, error: 'Dados inválidos', message: validationError.message, details: validationError.details || [validationError.message] });
    }

    const bcrypt = require('bcryptjs');
    const UserModel = require('../../models/User');
    const now = new Date();
    await usersCollection.updateOne(userFilter, UserModel.storedUpdateOf({
      passwordHash: await bcrypt.hash(newPassword, 10),
      // #1244: the same policy depth validateReuse checks.
      passwordHistoryHashes: passwordService.nextPasswordHistory(targetUser, passwordPolicy),
      passwordChangedAt: now,
      forcePasswordReset: true,
      updatedAt: now,
    }));

    // targetUser._id.toString(), not req.params.id: sessions key their owner
    // as the stored id string (see PUT /:id's #982 note).
    const sessionService = require('../../services/session.service');
    await sessionService.invalidateUserSessions(db, targetUser._id.toString(), 'admin_action', req.user?.userID, { req });

    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'UPDATE',
      resourceType: 'User',
      resourceId: targetUser._id.toString(),
      status: 'success',
      severity: 'warning',
      // audit-v2 keeps `message` and drops `payload` (#1005), so the
      // operation is named here.
      message: 'Senha definida por administrador; troca obrigatória no próximo login',
      payload: { operation: 'setUserPassword', fieldsSet: ['password', 'passwordHistory', 'passwordChangedAt', 'forceReset'] },
      req,
      module: 'Usuários',
    });

    return res.status(200).json({ success: true, data: { forceReset: true } });
  } catch (error) {
    logger.error('Erro ao definir senha:', error.message);
    return res.status(500).json({ success: false, error: 'Erro ao definir senha', message: error.message });
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
router.post('/:id/disable-mfa', authenticate, requirePermission('disableMFA', 'UPDATE'), requireOrganizationScope, async (req, res) => {
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
    if (!(await isUserInCallerScope(db, req.organizationScope, targetUser._id))) return refuseOutOfScopeUser(res);

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
    // deliberadamente MANTÉM o mfaSecretCiphertext (comentário acima), diferente dos
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

