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
      const { password, ...userWithoutPassword } = user;
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

    const { password, ...userWithoutPassword } = user;
    const UserModel = require('../../models/User');
    
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
    if (requestedAccessType && requestedAccessType !== targetUser.accessType) {
      changes.accessType = { from: targetUser.accessType, to: requestedAccessType };

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
    
    const { password: __unusedPassword2, ...userWithoutPassword } = updatedUser;

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

router.post('/register-sensor', authenticate, requirePermission('viewTemperature'), async (req, res) => {
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

    // Não permite resetar MFA de administrador
    if (await isAdministrator(db, targetUser._id.toString())) {
      return res.status(400).json({
        success: false,
        error: req.t('users.resetMFANotAllowed'),
        message: req.t('users.resetMFANotAllowedMessage')
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
    await sessionService.invalidateUserSessions(db, targetUser._id.toString());

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
router.post('/:id/disable-mfa', authenticate, async (req, res) => {
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

