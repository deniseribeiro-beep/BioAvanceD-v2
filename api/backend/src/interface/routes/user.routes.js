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

function buildUserFilterById(id) {
  const rawId = String(id || '').trim();
  const filters = [];

  if (!rawId) {
    return { _id: null };
  }

  if (ObjectId.isValid(rawId)) {
    filters.push({ _id: new ObjectId(rawId) });
  }

  filters.push({ _id: rawId });
  filters.push({ id: rawId });
  filters.push({ userID: rawId });

  const numericId = Number(rawId);
  if (Number.isFinite(numericId)) {
    filters.push({ userID: numericId });
  }

  return { $or: filters };
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
      
      // Normaliza instituição: strings vazias viram null (opcionais)
      if (req.body.institution !== undefined) {
        if (req.body.institution && typeof req.body.institution === 'string') {
          req.body.institution = req.body.institution.trim() || null;
        } else if (req.body.institution === '') {
          req.body.institution = null;
        }
      }

      const user = await authService.registerUser(db, req.body);

      // Registra log de criação de usuário
      if (req.user) {
        const auditLogger = require('../../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'CREATE',
          entity: 'User',
          entityID: user._id?.toString() || user.id,
          result: 'success',
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

    // Remove senhas dos resultados e traduz status para português
    const sanitizedUsers = users.map(user => {
      const { password, ...userWithoutPassword } = user;
      // Traduz status para português para o frontend
      if (userWithoutPassword.status) {
        userWithoutPassword.status = UserModel.translateStatus(userWithoutPassword.status);
      }
      // Adiciona roleName se não existir, baseado no accessType
      if (!userWithoutPassword.roleName && userWithoutPassword.accessType) {
        const authService = require('../../services/auth.service');
        userWithoutPassword.roleName = authService.getRoleName(userWithoutPassword.accessType);
      }
      // Garante que o ID esteja disponível como _id e id
      if (userWithoutPassword._id && !userWithoutPassword.id) {
        userWithoutPassword.id = userWithoutPassword._id.toString();
      }
      return userWithoutPassword;
    });

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
      return res.status(400).json({
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
    
    // Normaliza instituição: strings vazias viram null (opcionais)
    if (req.body.institution !== undefined) {
      if (req.body.institution && typeof req.body.institution === 'string') {
        req.body.institution = req.body.institution.trim() || null;
      } else if (req.body.institution === '') {
        req.body.institution = null;
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
    const isAdmin = targetUser && (targetUser.accessType === 4 || targetUser.roleName === 'Administrador');
    const isBecomingAdmin = req.body.accessType === 4 || req.body.roleName === 'Administrador';
    
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

    // Mapeia roleName para accessType se necessário
    if (req.body.roleName && !req.body.accessType) {
      req.body.accessType = authService.getAccessTypeForRole(req.body.roleName);
    }
    
    // Se accessType foi alterado, atualiza roleName também
    if (req.body.accessType && !req.body.roleName) {
      req.body.roleName = authService.getRoleName(req.body.accessType);
    }

    const result = await usersCollection.updateOne(
      userFilter,
      { $set: req.body }
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
    
    // Detecta mudanças críticas
    const changes = {};
    if (req.body.accessType && req.body.accessType !== targetUser.accessType) {
      changes.accessType = { from: targetUser.accessType, to: req.body.accessType };
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
    
    // Adiciona roleName se não existir
    if (!userWithoutPassword.roleName && userWithoutPassword.accessType) {
      userWithoutPassword.roleName = authService.getRoleName(userWithoutPassword.accessType);
    }
    
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
    const patientsCollection = await getCollection(db, 'patients');

    const sampleRepository = {
      create: async (sampleData) => {
        const savedSample = await sampleService.createSample(db, { ...sampleData });

        const patientID = String(savedSample.patientID || '').trim();
        if (patientID) {
          const patientUpdateResult = await patientsCollection.updateOne(
            { patientID },
            {
              $push: { sampleList: savedSample },
              $set: { updatedAt: new Date() }
            }
          );

          if (patientUpdateResult.matchedCount === 0) {
            throw new Error('Paciente não encontrado para vincular a amostra');
          }
        }

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

router.post('/record-withdrawal', authenticate, requirePermission('withdrawSample'), async (req, res) => {
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

// Reset MFA - apenas para administradores
router.post('/:id/reset-mfa', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    // Verifica se o usuário atual é administrador
    const { ObjectId } = require('mongodb');
    const usersCollection = db.collection('users');
    const currentUser = await usersCollection.findOne({ _id: new ObjectId(req.user.userID) });
    
    if (!currentUser || (currentUser.accessType !== 4 && currentUser.roleName !== 'Administrador')) {
      return res.status(403).json({
        success: false,
        error: req.t('users.resetMFAAccessDenied'),
        message: req.t('users.resetMFAAccessDeniedMessage')
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

    // Não permite resetar MFA de administrador
    if (targetUser.accessType === 4 || targetUser.roleName === 'Administrador') {
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
    const { ObjectId } = require('mongodb');
    const usersCollection = db.collection('users');
    const currentUser = await usersCollection.findOne({ _id: new ObjectId(req.user.userID) });
    
    if (!currentUser || (currentUser.accessType !== 4 && currentUser.roleName !== 'Administrador')) {
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
    const isTargetAdmin = targetUser.accessType === 4 || targetUser.roleName === 'Administrador';
    
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

