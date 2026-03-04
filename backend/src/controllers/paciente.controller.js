const patientService = require('../services/patient.service');
const logService = require('../services/log.service');
const logger = require('../utils/logger');

/**
 * Controller para operações relacionadas a pacientes
 */
class PacienteController {
  async cadastrar(req, res) {
    try {
      const db = req.app.locals.db;

      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível',
          message: 'O servidor está temporariamente indisponível'
        });
      }

      const pacienteData = req.body;

      // Validação básica
      if (!pacienteData || Object.keys(pacienteData).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Dados inválidos',
          message: 'Os dados do paciente são obrigatórios'
        });
      }

      const paciente = await patientService.createPatient(db, pacienteData);

      // Registra log de auditoria (sanitizado - sem dados sensíveis)
      if (req.user) {
        const { sanitizePatientForLogs } = require('../utils/patientAnonymization');
        const sanitizedPatient = sanitizePatientForLogs(paciente);
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'CREATE',
          entity: 'Patient',
          entityID: sanitizedPatient.patientID, // Apenas ID, sem dados sensíveis
          result: 'success',
          severity: 'info',
          message: `Paciente cadastrado - ID: ${sanitizedPatient.patientID}`, // Log sem dados sensíveis
          payload: sanitizedPatient, // Apenas ID sanitizado
          req: req,
          module: 'Cadastro'
        });
      }

      // Retorna apenas o ID gerado (LGPD - não expõe dados sensíveis após cadastro)
      return res.status(201).json({
        success: true,
        message: req.t('users.registerPatientSuccess'),
        data: {
          patientID: paciente.patientID // Apenas o ID, sem dados sensíveis
        }
      });
    } catch (error) {
      logger.error('Erro no controller de cadastro:', error.message);
      logger.error('Rastreamento:', error.stack);

      // Log de erro (sanitizado)
      if (req.user) {
        try {
          const db = req.app.locals.db;
          if (db) {
            const auditLogger = require('../utils/auditLogger');
            auditLogger.init(db);
            await auditLogger.logError(req, 'Patient', error, {
              action: 'CREATE',
              errorMessage: error.message
            });
          }
        } catch (logError) {
          logger.error('Erro ao registrar log de auditoria:', logError);
        }
      }

      let statusCode = error.statusCode || error.status || 500;
      if (statusCode === 500) {
        const errorMessage = String(error.message || '').toLowerCase();
        if (errorMessage.includes('já cadastrado') || errorMessage.includes('duplicado')) {
          statusCode = 409;
        } else if (errorMessage.includes('obrigatório') || errorMessage.includes('inválido')) {
          statusCode = 400;
        }
      }

      return res.status(statusCode).json({
        success: false,
        error: req.t('errors.serverError'),
        message: error.message || req.t('errors.generic')
      });
    }
  }

  async listar(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      // MÓDULO OPERACIONAL vs MÓDULO DE CADASTRO (LGPD)
      // Verifica se usuário tem permissão de createPatient
      const { permissions } = require('../infrastructure/middleware/rbac');
      const userRole = req.user?.accessType || 1;
      const hasCreatePatientPermission = permissions.createPatient?.includes(userRole) || false;
      
      if (!hasCreatePatientPermission) {
        // MÓDULO OPERACIONAL: retorna apenas IDs + status de consentimento, sem dados sensíveis
        const filters = {
          limit: parseInt(req.query.limit) || 50,
          skip: parseInt(req.query.skip) || 0
        };

        const patientsCollection = db.collection('pacientes');
        const patients = await patientsCollection
          .find({}, { projection: { patientID: 1, status: 1, consentNotifiedAt: 1, consentTokenExpiresAt: 1, _id: 0 } })
          .limit(filters.limit)
          .skip(filters.skip)
          .toArray();

        const total = await patientsCollection.countDocuments({});

        // Registra log de consulta (módulo operacional - apenas IDs + status)
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'QUERY',
          entity: 'Patient',
          result: 'success',
          severity: 'info',
          message: `Consulta de pacientes (módulo operacional) - ${total} registros`,
          payload: { total, limit: filters.limit, skip: filters.skip },
          req: req,
          module: 'Cadastro'
        });

        return res.status(200).json({
          success: true,
          data: {
            patients: patients.map(p => ({ patientID: p.patientID, status: p.status || 'PENDING_CONSENT', consentNotifiedAt: p.consentNotifiedAt || null, consentTokenExpiresAt: p.consentTokenExpiresAt || null })),
            total,
            limit: filters.limit,
            skip: filters.skip
          }
        });
      } else {
        // MÓDULO DE CADASTRO: retorna dados completos (apenas para usuários com permissão)
        const filters = {
          patientName: req.query.patientName,
          clinicalUnit: req.query.clinicalUnit,
          limit: parseInt(req.query.limit) || 50,
          skip: parseInt(req.query.skip) || 0
        };

        const result = await patientService.listPatients(db, filters);

        // Registra log de consulta (módulo de cadastro - dados completos)
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'QUERY',
          entity: 'Patient',
          result: 'success',
          severity: 'info',
          message: `Consulta de pacientes (módulo cadastro) - ${result.total || 0} registros`,
          payload: { total: result.total || 0, filters: { patientName: filters.patientName, clinicalUnit: filters.clinicalUnit } },
          req: req,
          module: 'Cadastro'
        });

        return res.status(200).json({
          success: true,
          data: result
        });
      }
    } catch (error) {
      logger.error('Erro ao listar pacientes:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro interno do servidor',
        message: error.message
      });
    }
  }

  async buscar(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { id } = req.params;
      const { sanitizePatientForLogs } = require('../utils/patientAnonymization');
      
      // Verifica se é patientID (8 dígitos) ou ObjectId
      const patient = await patientService.getPatient(db, id);

      if (!patient) {
        // Registra tentativa de busca de paciente inexistente (sanitizado)
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        const sanitizedID = id.length === 8 && /^\d{8}$/.test(id) ? id : 'N/A';
        await auditLogger.log({
          action: 'QUERY',
          entity: 'Patient',
          entityID: sanitizedID,
          result: 'error',
          severity: 'warning',
          message: `Tentativa de buscar paciente inexistente: ID ${sanitizedID}`,
          req: req,
          module: 'Cadastro'
        });
        
        return res.status(404).json({
          success: false,
          error: 'Paciente não encontrado'
        });
      }

      // Verifica permissões LGPD - módulo operacional vs cadastro
      const { permissions } = require('../infrastructure/middleware/rbac');
      const userRole = req.user?.accessType || 1;
      const hasCreatePatientPermission = permissions.createPatient?.includes(userRole) || false;
      
      // Se não tem permissão de cadastro, retorna apenas ID (LGPD)
      if (!hasCreatePatientPermission) {
        const sanitizedPatient = sanitizePatientForLogs(patient);
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'QUERY',
          entity: 'Patient',
          entityID: sanitizedPatient.patientID,
          result: 'success',
          severity: 'info',
          message: 'Consulta de paciente (módulo operacional) - apenas ID retornado',
          req: req,
          module: 'Cadastro'
        });
        
        return res.status(200).json({
          success: true,
          data: {
            patientID: patient.patientID,
            status: patient.status || 'PENDING_CONSENT',
            consentNotifiedAt: patient.consentNotifiedAt || null,
            consentTokenExpiresAt: patient.consentTokenExpiresAt || null
          }
        });
      }

      // Registra log de busca de paciente (módulo cadastro - dados completos)
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      const sanitizedPatient = sanitizePatientForLogs(patient);
      await auditLogger.log({
        action: 'QUERY',
        entity: 'Patient',
        entityID: sanitizedPatient.patientID,
        result: 'success',
        severity: 'info',
        message: 'Paciente consultado (módulo cadastro)',
        req: req,
        module: 'Cadastro'
      });

      return res.status(200).json({
        success: true,
        data: patient
      });
    } catch (error) {
      logger.error('Erro ao buscar paciente:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro interno do servidor',
        message: error.message
      });
    }
  }

  async resendConsentNotification(req, res) {
    try {
      const db = req.app.locals.db;

      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const patientID = String(req.params.id || req.body.patientID || req.body.patientId || '').trim();
      if (!patientID) {
        return res.status(400).json({
          success: false,
          error: 'patientId é obrigatório'
        });
      }

      const result = await patientService.resendConsentNotification(db, patientID);

      return res.status(200).json({
        success: true,
        message: 'Notificações de consentimento reenviadas com sucesso',
        data: result
      });
    } catch (error) {
      logger.error('Erro ao reenviar notificações de consentimento:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Erro ao reenviar notificações de consentimento',
        message: error.message
      });
    }
  }

  async atualizar(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { id } = req.params;
      const { sanitizePatientForLogs } = require('../utils/patientAnonymization');
      
      // Valida que não está tentando alterar o patientID (imutável por LGPD)
      if (req.body.patientID && req.body.patientID !== id) {
        return res.status(400).json({
          success: false,
          error: 'Não é permitido alterar o patientID',
          message: 'O ID do paciente é imutável por questões de LGPD'
        });
      }
      
      const result = await patientService.updatePatient(db, id, req.body);

      // Registra log (sanitizado)
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        const sanitizedID = id.length === 8 && /^\d{8}$/.test(id) ? id : 'N/A';
        await auditLogger.log({
          action: 'UPDATE',
          entity: 'Patient',
          entityID: sanitizedID,
          result: 'success',
          severity: 'info',
          message: 'Paciente atualizado',
          payload: sanitizePatientForLogs({ patientID: sanitizedID }),
          req: req,
          module: 'Cadastro'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Paciente atualizado com sucesso',
        data: result
      });
    } catch (error) {
      logger.error('Erro ao atualizar paciente:', error.message);
      
      // Log de erro
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.logError(req, 'Patient', error, {
          patientID: req.params.id,
          action: 'UPDATE'
        });
      }
      
      return res.status(500).json({
        success: false,
        error: 'Erro interno do servidor',
        message: error.message
      });
    }
  }

  async deletar(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { id } = req.params;
      const { sanitizePatientForLogs } = require('../utils/patientAnonymization');
      const result = await patientService.deletePatient(db, id);

      if (!result) {
        // Registra tentativa de deletar paciente inexistente
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        const sanitizedID = id.length === 8 && /^\d{8}$/.test(id) ? id : 'N/A';
        await auditLogger.log({
          action: 'DELETE',
          entity: 'Patient',
          entityID: sanitizedID,
          result: 'error',
          severity: 'warning',
          message: `Tentativa de deletar paciente inexistente: ID ${sanitizedID}`,
          req: req,
          module: 'Cadastro'
        });
        
        return res.status(404).json({
          success: false,
          error: 'Paciente não encontrado'
        });
      }

      // Registra log (sanitizado)
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        const sanitizedID = id.length === 8 && /^\d{8}$/.test(id) ? id : 'N/A';
        await auditLogger.log({
          action: 'DELETE',
          entity: 'Patient',
          entityID: sanitizedID,
          result: 'success',
          severity: 'warning',
          message: 'Paciente deletado',
          payload: sanitizePatientForLogs({ patientID: sanitizedID }),
          req: req,
          module: 'Cadastro'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Paciente deletado com sucesso'
      });
    } catch (error) {
      logger.error('Erro ao deletar paciente:', error.message);
      
      // Log de erro
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.logError(req, 'Patient', error, {
          patientID: req.params.id,
          action: 'DELETE'
        });
      }
      
      return res.status(500).json({
        success: false,
        error: 'Erro interno do servidor',
        message: error.message
      });
    }
  }

  async validateID(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const patientID = String(req.body?.patientID || '').trim();
      if (!patientID) {
        return res.status(400).json({
          success: false,
          error: 'patientID é obrigatório'
        });
      }

      // Valida formato do ID (8 dígitos numéricos)
      if (typeof patientID !== 'string' || patientID.length !== 8 || !/^\d{8}$/.test(patientID)) {
        return res.status(400).json({
          success: false,
          error: 'ID inválido',
          message: 'O ID deve ter exatamente 8 dígitos numéricos'
        });
      }

      // Valida se o ID existe (sem expor dados sensíveis)
      const { validatePatientID: validatePatientIDUtil } = require('../utils/patientAnonymization');
      const exists = await validatePatientIDUtil(db, patientID, 'pacientes');
      
      // Registra log de validação de ID
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'VALIDATE',
        entity: 'Patient',
        result: exists ? 'success' : 'error',
        severity: exists ? 'info' : 'warning',
        message: `Validação de ID de paciente: ${patientID} - ${exists ? 'válido' : 'inválido'}`,
        payload: { patientID, exists },
        req: req,
        module: 'Cadastro'
      });

      return res.status(200).json({
        success: true,
        data: {
          valid: exists, // true se existe, false se não existe
          patientID
        }
      });
    } catch (error) {
      logger.error('Erro ao validar ID:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro interno do servidor',
        message: error.message
      });
    }
  }

  async findForEdit(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { patientID } = req.body;
      if (!patientID) {
        return res.status(400).json({
          success: false,
          error: 'patientID é obrigatório'
        });
      }

      const { getCollection } = require('../utils/collectionResolver');
      const patientsCollection = await getCollection(db, 'patients');
      const patient = await patientsCollection.findOne({ patientID });

      if (!patient) {
        // Registra tentativa de busca para edição de paciente inexistente (sanitizado)
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        const { sanitizePatientForLogs } = require('../utils/patientAnonymization');
        const sanitizedID = patientID.length === 8 && /^\d{8}$/.test(patientID) ? patientID : 'N/A';
        await auditLogger.log({
          action: 'QUERY',
          entity: 'Patient',
          entityID: sanitizedID,
          result: 'error',
          severity: 'warning',
          message: `Tentativa de buscar paciente para edição: ID ${sanitizedID} não encontrado`,
          payload: sanitizePatientForLogs({ patientID: sanitizedID }),
          req: req,
          module: 'Cadastro'
        });
        
        return res.status(404).json({
          success: false,
          error: 'Paciente não encontrado'
        });
      }

      // Registra log de busca para edição (sanitizado)
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      const { sanitizePatientForLogs } = require('../utils/patientAnonymization');
      const sanitizedPatient = sanitizePatientForLogs(patient);
      await auditLogger.log({
        action: 'QUERY',
        entity: 'Patient',
        entityID: sanitizedPatient.patientID,
        result: 'success',
        severity: 'info',
        message: `Paciente buscado para edição: ID ${sanitizedPatient.patientID}`,
        payload: sanitizedPatient, // Apenas ID sanitizado
        req: req,
        module: 'Cadastro'
      });

      return res.status(200).json({
        success: true,
        data: patient
      });
    } catch (error) {
      logger.error('Erro ao buscar paciente para edição:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro interno do servidor',
        message: error.message
      });
    }
  }

  async search(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { q: searchTerm } = req.query;
      
      if (!searchTerm || typeof searchTerm !== 'string' || searchTerm.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Termo de busca é obrigatório'
        });
      }

      const result = await patientService.searchPatients(db, searchTerm);

      // Registra log de busca (sanitizado)
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'SEARCH',
        entity: 'Patient',
        result: 'success',
        severity: 'info',
        message: `Busca de pacientes: "${searchTerm}" - ${result.total} resultado(s) encontrado(s)`,
        payload: { searchTerm, total: result.total },
        req: req,
        module: 'Cadastro'
      });

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Erro ao buscar pacientes:', error.message);
      
      // Log de erro
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.logError(req, 'Patient', error, {
          action: 'SEARCH',
          searchTerm: req.query.q
        });
      }
      
      return res.status(500).json({
        success: false,
        error: 'Erro interno do servidor',
        message: error.message
      });
    }
  }
}

module.exports = new PacienteController();

