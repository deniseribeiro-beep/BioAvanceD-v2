const patientService = require('../services/patient.service');
const consentHistory = require('../services/consentHistory.service');
const biomarkerObservationService = require('../services/biomarker-observation.service');
const logService = require('../services/log.service');
const logger = require('../utils/logger');
const { revalidateSamplesByPatientID } = require('../services/sampleComplianceSync.service');
const { getCollection } = require('../utils/collectionResolver');
const PatientModel = require('../models/Patient');
const { LEGACY_PATIENT_IDENTITY_FIELDS } = require('../utils/legacyPatientIdentityFields');

/**
 * Controller para operações relacionadas a pacientes
 */
class PacienteController {
  rejectCanonicalAliases(payload = {}) {
    // #345: built off PatientModel's own canonical field list (the
    // Patient-document shape) plus the civil-identity fields the payload
    // still legitimately carries but that never land on the Patient
    // document itself (RF005/RNF007, #575) — they're routed to
    // ParticipantIdentity instead, see patient.service.js#createPatient.
    // A new Patient-document field only needs adding in Patient.js now;
    // this list picks it up automatically.
    const allowed = new Set([...PatientModel.CANONICAL_FIELDS, ...LEGACY_PATIENT_IDENTITY_FIELDS]);
    const fields = Object.keys(payload).filter((field) => !allowed.has(field));
    if (fields.length > 0) {
      const error = new Error('Payload contém campos não canônicos');
      error.statusCode = 422;
      error.code = 'NON_CANONICAL_FIELD';
      error.fields = fields;
      throw error;
    }
  }

  sanitizePatientPayload(payload = {}) {
    const nextPayload = { ...payload };
    this.rejectCanonicalAliases(nextPayload);

    if (nextPayload.clinicalUnit !== undefined && nextPayload.clinicalUnit !== null) {
      nextPayload.clinicalUnit = String(nextPayload.clinicalUnit).trim().toUpperCase();
    }

    if (nextPayload.clinicalUnitId !== undefined && nextPayload.clinicalUnitId !== null) {
      nextPayload.clinicalUnitId = String(nextPayload.clinicalUnitId).trim();
      if (!nextPayload.clinicalUnitId) {
        nextPayload.clinicalUnitId = null;
      }
    }

    if (nextPayload.unitAcronym !== undefined && nextPayload.unitAcronym !== null) {
      nextPayload.unitAcronym = String(nextPayload.unitAcronym).trim().toUpperCase();
    }

    return nextPayload;
  }

  validateDeceasedRepresentative(payload = {}) {
    const isDeceased = payload.isDeceased === true;
    if (!isDeceased) return;

    const representativeName = typeof payload.representativeName === 'string' ? payload.representativeName.trim() : '';
    const representativeEmail = typeof payload.representativeEmail === 'string' ? payload.representativeEmail.trim() : '';
    const representativeIdentityDocument = String(payload.representativeIdentityDocument || '').replace(/\D/g, '').trim();
    const representativePhone = String(payload.representativePhone || '').replace(/\D/g, '').trim();

    if (!representativeName || !representativeEmail || !representativeIdentityDocument || !representativePhone) {
      const error = new Error('Para paciente falecido, nome, e-mail, identityDocument e telefone do representante legal são obrigatórios');
      error.statusCode = 400;
      throw error;
    }
  }

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

      const pacienteData = this.sanitizePatientPayload(req.body);
      this.validateDeceasedRepresentative(pacienteData);

      // #1185: #1071's create rule. An organization-scoped caller registers
      // into its own organization whatever unit the body names -- by id or
      // by clinicalUnit name, since createPatient resolves the id first. A
      // global caller keeps the body's value, name-only lookup included.
      if (req.organizationScope?.scope !== 'global') {
        const { resolveOrganizationIdForCreate } = require('../services/rbac-assignment.service');
        pacienteData.clinicalUnitId = resolveOrganizationIdForCreate(req.organizationScope, pacienteData.clinicalUnitId);
      }

      // Validação básica
      if (!pacienteData || Object.keys(pacienteData).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Dados inválidos',
          message: 'Os dados do paciente são obrigatórios'
        });
      }

      const paciente = await patientService.createPatient(db, pacienteData, {
        neo4jDriver: req.app.locals.neo4jDriver || null
      });

      // Registra log de auditoria (sanitizado - sem dados sensíveis)
      if (req.user) {
        const { sanitizePatientForLogs } = require('../utils/patientAnonymization');
        const sanitizedPatient = sanitizePatientForLogs(paciente);
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'CREATE',
          resourceType: 'Patient',
          resourceId: sanitizedPatient.participantId, // Apenas ID, sem dados sensíveis
          status: 'success',
          severity: 'info',
          message: `Paciente cadastrado - ID: ${sanitizedPatient.participantId}`, // Log sem dados sensíveis
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
          participantId: paciente.participantId // Apenas o ID, sem dados sensíveis
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
        message: error.message || req.t('errors.generic'),
        details: error.details
      });
    }
  }

  /** #1383 (RF010 AC5): each listed patient with its newest consent's derived state. */
  async withConsentStatus(db, result) {
    const patients = (result && result.patients) || [];
    const consentStates = await consentHistory.consentStatesOf(db, patients.map((p) => p.participantId));
    return {
      ...result,
      patients: patients.map((p) => ({ ...p, consentStatus: consentStates.get(String(p.participantId)) || null }))
    };
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
      const { userHasPermission } = require('../services/rbac-assignment.service');
      const hasCreatePatientPermission = await userHasPermission(db, req.user?.userID, 'createPatient');

      if (!hasCreatePatientPermission) {
        // MÓDULO OPERACIONAL: retorna apenas IDs + status de consentimento, sem dados sensíveis
        const filters = {
          limit: parseInt(req.query.limit) || 50,
          skip: parseInt(req.query.skip) || 0
        };

        // #340 (RF003 AC#3): org-scoped caller sees only patients whose
        // clinicalUnitId is one of their scoped organizations. This branch
        // builds its own raw query (doesn't go through patientService), so
        // the filter is applied here rather than inside listPatients.
        const { applyOrganizationScopeFilter } = require('../services/rbac-assignment.service');
        const scopeQuery = {};
        if (req.organizationScope) {
          applyOrganizationScopeFilter(scopeQuery, req.organizationScope, 'clinicalUnitId');
        }

        const patientsCollection = await getCollection(db, 'patients');
        const patients = await patientsCollection
          .find(scopeQuery, { projection: { participantId: 1, status: 1, consentNotifiedAt: 1, consentTokenExpiresAt: 1, _id: 0 } })
          .limit(filters.limit)
          .skip(filters.skip)
          .toArray();

        const total = await patientsCollection.countDocuments(scopeQuery);
        // #1383 (RF010 AC5): the consent state shown is derived from the
        // consent's history; Patient.status is the participant gate's field.
        const consentStates = await consentHistory.consentStatesOf(db, patients.map((p) => p.participantId));

        // Registra log de consulta (módulo operacional - apenas IDs + status)
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'QUERY',
          resourceType: 'Patient',
          status: 'success',
          severity: 'info',
          message: `Consulta de pacientes (módulo operacional) - ${total} registros`,
          payload: { total, limit: filters.limit, skip: filters.skip },
          req: req,
          module: 'Cadastro'
        });

        return res.status(200).json({
          success: true,
          data: {
            patients: patients.map(p => ({ participantId: p.participantId, status: p.status || 'PENDING_CONSENT', consentNotifiedAt: p.consentNotifiedAt || null, consentTokenExpiresAt: p.consentTokenExpiresAt || null, consentStatus: consentStates.get(String(p.participantId)) || null })),
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
          skip: parseInt(req.query.skip) || 0,
          organizationScope: req.organizationScope
        };

        const result = await patientService.listPatients(db, filters);
        const withConsentStatus = await this.withConsentStatus(db, result);

        // Registra log de consulta (módulo de cadastro - dados completos)
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'QUERY',
          resourceType: 'Patient',
          status: 'success',
          severity: 'info',
          message: `Consulta de pacientes (módulo cadastro) - ${result.total || 0} registros`,
          payload: { total: result.total || 0, filters: { patientName: filters.patientName, clinicalUnit: filters.clinicalUnit } },
          req: req,
          module: 'Cadastro'
        });

        return res.status(200).json({
          success: true,
          data: withConsentStatus
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
      
      // Verifica se é participantId (8 dígitos) ou ObjectId
      const patient = await patientService.getPatient(db, id);

      if (!patient) {
        // Registra tentativa de busca de paciente inexistente (sanitizado)
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        const sanitizedID = id.length === 8 && /^\d{8}$/.test(id) ? id : 'N/A';
        await auditLogger.log({
          action: 'QUERY',
          resourceType: 'Patient',
          resourceId: sanitizedID,
          status: 'error',
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

      // #340: an existing patient outside the caller's organization scope
      // 403s rather than 404s (out-of-scope direct access, not a
      // discoverability leak via a different error code), matching
      // sample-file.controller.js's existing precedent and this route's
      // own sibling check in sample.routes.js.
      const { isRecordInOrganizationScope } = require('../services/rbac-assignment.service');
      if (!isRecordInOrganizationScope(patient, req.organizationScope, 'clinicalUnitId')) {
        return res.status(403).json({
          success: false,
          error: 'Acesso negado',
          message: 'Este paciente pertence a outra organização'
        });
      }

      // Verifica permissões LGPD - módulo operacional vs cadastro
      const { userHasPermission } = require('../services/rbac-assignment.service');
      const hasCreatePatientPermission = await userHasPermission(db, req.user?.userID, 'createPatient');

      // Se não tem permissão de cadastro, retorna apenas ID (LGPD)
      if (!hasCreatePatientPermission) {
        const sanitizedPatient = sanitizePatientForLogs(patient);
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'QUERY',
          resourceType: 'Patient',
          resourceId: sanitizedPatient.participantId,
          status: 'success',
          severity: 'info',
          message: 'Consulta de paciente (módulo operacional) - apenas ID retornado',
          req: req,
          module: 'Cadastro'
        });
        
        return res.status(200).json({
          success: true,
          data: {
            participantId: patient.participantId,
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
        resourceType: 'Patient',
        resourceId: sanitizedPatient.participantId,
        status: 'success',
        severity: 'info',
        message: 'Paciente consultado (módulo cadastro)',
        req: req,
        module: 'Cadastro'
      });

      // RF005/RNF007 (#363): patientName/birthDate/identityDocument are civil
      // identity — segregated into ParticipantIdentity, not returned as direct
      // fields on the participant resource even to callers with createPatient
      // permission. Re-identification is a separate authorized/audited flow
      // (not yet built — tracked in the #363 follow-up).
      // #1045: consentToken rode along in this rest-spread. It is the sole
      // credential for the public consent-tokens/accept route, so it comes
      // out here too -- not just on the list/search routes the issue named.
      const { patientName, birthDate, identityDocument, ...rawParticipantResource } = patient;
      const participantResource = PatientModel.stripConsentSecrets(rawParticipantResource);

      return res.status(200).json({
        success: true,
        data: participantResource
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

  /**
   * RF005/RNF007 AC#4/AC#5 (#560): resolve a identidade civil segregada em
   * ParticipantIdentity — único ponto de reidentificação autorizado. Exige
   * `reidentifyParticipant` (RBAC, gate de rota) e `reason` (finalidade
   * legítima vinculada ao acesso), e audita cada chamada.
   */
  async reidentify(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { id } = req.params;
      const { reason } = req.body || {};

      if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Finalidade obrigatória',
          message: 'É necessário informar o motivo (reason) da reidentificação'
        });
      }

      const patient = await patientService.getPatient(db, id);
      if (!patient) {
        return res.status(404).json({
          success: false,
          error: 'Paciente não encontrado'
        });
      }

      // #626: same out-of-scope 403 pattern as buscar — reidentification
      // is a mutation-adjacent, audited flow, so an out-of-scope caller
      // is denied before any identity data is resolved.
      const { isRecordInOrganizationScope } = require('../services/rbac-assignment.service');
      if (!isRecordInOrganizationScope(patient, req.organizationScope, 'clinicalUnitId')) {
        return res.status(403).json({
          success: false,
          error: 'Acesso negado',
          message: 'Este paciente pertence a outra organização'
        });
      }

      const participantIdentityService = require('../services/participantIdentity.service');
      const identity = await participantIdentityService.getIdentityByParticipantId(db, patient.participantId);

      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);

      if (!identity) {
        await auditLogger.log({
          action: 'REIDENTIFY',
          resourceType: 'ParticipantIdentity',
          resourceId: patient.participantId,
          status: 'error',
          severity: 'warning',
          message: `Reidentificação sem registro de identidade: ${reason}`,
          payload: { reason },
          req: req,
          module: 'Cadastro'
        });
        return res.status(404).json({
          success: false,
          error: 'Identidade não encontrada'
        });
      }

      await auditLogger.log({
        action: 'REIDENTIFY',
        resourceType: 'ParticipantIdentity',
        resourceId: patient.participantId,
        status: 'success',
        severity: 'warning',
        message: `Reidentificação autorizada: ${reason}`,
        payload: { reason },
        req: req,
        module: 'Cadastro'
      });

      return res.status(200).json({
        success: true,
        data: {
          participantId: identity.participantId,
          patientName: identity.patientName,
          birthDate: identity.birthDate,
          identityDocument: identity.identityDocument
        }
      });
    } catch (error) {
      logger.error('Erro ao reidentificar participante:', error.message);
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

      const participantId = String(req.params.id || req.body.participantId || '').trim();
      if (!participantId) {
        return res.status(400).json({
          success: false,
          error: 'participantId é obrigatório'
        });
      }

      // #626: same post-fetch out-of-scope 403 pattern as buscar/reidentify
      // — a nonexistent patient falls through to resendConsentNotification's
      // own error handling below, unaffected.
      const existingPatient = await patientService.getPatient(db, participantId);
      const { isRecordInOrganizationScope } = require('../services/rbac-assignment.service');
      if (existingPatient && !isRecordInOrganizationScope(existingPatient, req.organizationScope, 'clinicalUnitId')) {
        return res.status(403).json({
          success: false,
          error: 'Acesso negado',
          message: 'Este paciente pertence a outra organização'
        });
      }

      const result = await patientService.resendConsentNotification(db, participantId);
      await revalidateSamplesByPatientID(db, participantId);

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
    const db = req.app?.locals?.db;
    try {
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { id } = req.params;
      const { sanitizePatientForLogs } = require('../utils/patientAnonymization');
      
      // Valida que não está tentando alterar o participantId (imutável por LGPD)
      if (req.body.participantId && req.body.participantId !== id) {
        return res.status(400).json({
          success: false,
          error: 'Não é permitido alterar o participantId',
          message: 'O ID do paciente é imutável por questões de LGPD'
        });
      }

      // #1281: the consent lifecycle's fields and the timestamps are written
      // by the server only, never through this route.
      const serverManaged = PatientModel.SERVER_MANAGED_FIELDS.filter((field) =>
        Object.prototype.hasOwnProperty.call(req.body || {}, field));
      if (serverManaged.length > 0) {
        return res.status(422).json({
          success: false,
          error: 'Campos gerenciados pelo servidor',
          message: `Não é permitido alterar: ${serverManaged.join(', ')}`,
          code: 'SERVER_MANAGED_FIELD',
          fields: serverManaged,
          details: serverManaged.map((field) => `${field}: campo gerenciado pelo servidor`)
        });
      }

      // #626: mirrors sample.routes.js's PUT /:id out-of-scope 403
      // pattern — the scope check runs before the mutation, not just
      // before a read.
      const existingPatient = await patientService.getPatient(db, id);
      const { isRecordInOrganizationScope } = require('../services/rbac-assignment.service');
      if (existingPatient && !isRecordInOrganizationScope(existingPatient, req.organizationScope, 'clinicalUnitId')) {
        return res.status(403).json({
          success: false,
          error: 'Acesso negado',
          message: 'Este paciente pertence a outra organização'
        });
      }

      const updatePayload = this.sanitizePatientPayload(req.body);
      this.validateDeceasedRepresentative(updatePayload);

      // #1053: the check above proves the patient is CURRENTLY the caller's.
      // clinicalUnitId is the field this module scopes on, and the payload
      // can rewrite it directly or through a clinicalUnit name, so the
      // destination is checked on the value updatePatient would resolve.
      if (existingPatient && (updatePayload.clinicalUnitId !== undefined || updatePayload.clinicalUnit !== undefined)) {
        const { assertOrganizationFieldNotReparented } = require('../services/rbac-assignment.service');
        const destination = await patientService.resolveClinicalUnitSnapshot(db, updatePayload);
        assertOrganizationFieldNotReparented(req.organizationScope, existingPatient.clinicalUnitId, destination?.clinicalUnitId ?? null, 'clinicalUnitId');
      }

      const result = await patientService.updatePatient(db, id, updatePayload, {
        neo4jDriver: req.app.locals.neo4jDriver || null
      });
      await revalidateSamplesByPatientID(db, id);

      // Registra log (sanitizado)
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        const sanitizedID = id.length === 8 && /^\d{8}$/.test(id) ? id : 'N/A';
        await auditLogger.log({
          action: 'UPDATE',
          resourceType: 'Patient',
          resourceId: sanitizedID,
          status: 'success',
          severity: 'info',
          message: 'Paciente atualizado',
          payload: sanitizePatientForLogs({ participantId: sanitizedID }),
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
          participantId: req.params.id,
          action: 'UPDATE'
        });
      }
      
      const statusCode = Number(error?.statusCode || error?.status || 500);
      return res.status(statusCode).json({
        success: false,
        error: 'Erro interno do servidor',
        message: error.message
      });
    }
  }

  async deletar(req, res) {
    const db = req.app?.locals?.db;
    try {
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { id } = req.params;
      const { sanitizePatientForLogs } = require('../utils/patientAnonymization');

      // #626: mirrors sample.routes.js's DELETE /:id out-of-scope 403
      // pattern — the scope check runs before the mutation, not just
      // before a read.
      const existingPatient = await patientService.getPatient(db, id);
      const { isRecordInOrganizationScope } = require('../services/rbac-assignment.service');
      if (existingPatient && !isRecordInOrganizationScope(existingPatient, req.organizationScope, 'clinicalUnitId')) {
        return res.status(403).json({
          success: false,
          error: 'Acesso negado',
          message: 'Este paciente pertence a outra organização'
        });
      }

      // #1262: lgpd.allowDataDeletion switches the elimination off. Checked
      // after the scope check, so a caller outside the scope learns nothing
      // about the setting.
      const securityService = require('../services/security.service');
      if (!(await securityService.isDataDeletionAllowed(db))) {
        return res.status(403).json({
          success: false,
          error: 'Eliminação desabilitada',
          message: 'A eliminação de dados está desabilitada na configuração LGPD'
        });
      }

      const result = await patientService.deletePatient(db, id);

      if (!result) {
        // Registra tentativa de deletar paciente inexistente
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        const sanitizedID = id.length === 8 && /^\d{8}$/.test(id) ? id : 'N/A';
        await auditLogger.log({
          action: 'DELETE',
          resourceType: 'Patient',
          resourceId: sanitizedID,
          status: 'error',
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
          resourceType: 'Patient',
          resourceId: sanitizedID,
          status: 'success',
          severity: 'warning',
          message: 'Paciente deletado',
          payload: sanitizePatientForLogs({ participantId: sanitizedID }),
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
          participantId: req.params.id,
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

      this.rejectCanonicalAliases(req.body || {});

      const participantId = String(req.body?.participantId || '').trim();
      if (!participantId) {
        return res.status(400).json({
          success: false,
          error: 'participantId é obrigatório'
        });
      }

      // Valida formato do ID (8 dígitos numéricos)
      if (typeof participantId !== 'string' || participantId.length !== 8 || !/^\d{8}$/.test(participantId)) {
        return res.status(400).json({
          success: false,
          error: 'ID inválido',
          message: 'O ID deve ter exatamente 8 dígitos numéricos'
        });
      }

      // Valida se o ID existe (sem expor dados sensíveis)
      const { validateParticipantId: validateParticipantIdUtil } = require('../utils/patientAnonymization');
      const exists = await validateParticipantIdUtil(db, participantId, 'pacientes');
      
      // Registra log de validação de ID
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'VALIDATE',
        resourceType: 'Patient',
        status: exists ? 'success' : 'error',
        severity: exists ? 'info' : 'warning',
        message: `Validação de ID de paciente: ${participantId} - ${exists ? 'válido' : 'inválido'}`,
        payload: { participantId, exists },
        req: req,
        module: 'Cadastro'
      });

      return res.status(200).json({
        success: true,
        data: {
          valid: exists, // true se existe, false se não existe
          participantId
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

      this.rejectCanonicalAliases(req.body || {});

      const { participantId } = req.body;
      // #887: a truthy check admits an object -- `{ $ne: null }` is truthy
      // and would reach findOne below as a live operator, returning the
      // first patient in natural order for editing. Coerced the way
      // auth.service.js#login has always coerced its own lookup field.
      if (!participantId || typeof participantId !== 'string' || !participantId.trim()) {
        return res.status(400).json({
          success: false,
          error: 'participantId é obrigatório'
        });
      }
      const participantIdTerm = participantId.trim();

      const { getCollection } = require('../utils/collectionResolver');
      const patientsCollection = await getCollection(db, 'patients');
      const patient = await patientsCollection.findOne({ participantId: participantIdTerm });

      if (!patient) {
        // Registra tentativa de busca para edição de paciente inexistente (sanitizado)
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        const { sanitizePatientForLogs } = require('../utils/patientAnonymization');
        const sanitizedID = participantId.length === 8 && /^\d{8}$/.test(participantId) ? participantId : 'N/A';
        await auditLogger.log({
          action: 'QUERY',
          resourceType: 'Patient',
          resourceId: sanitizedID,
          status: 'error',
          severity: 'warning',
          message: `Tentativa de buscar paciente para edição: ID ${sanitizedID} não encontrado`,
          payload: sanitizePatientForLogs({ participantId: sanitizedID }),
          req: req,
          module: 'Cadastro'
        });
        
        return res.status(404).json({
          success: false,
          error: 'Paciente não encontrado'
        });
      }

      // #1185: buscar's #340 check. This handler returns the full patient
      // for editing and had no scope test at all.
      const { isRecordInOrganizationScope } = require('../services/rbac-assignment.service');
      if (!isRecordInOrganizationScope(patient, req.organizationScope, 'clinicalUnitId')) {
        return res.status(403).json({
          success: false,
          error: 'Acesso negado',
          message: 'Este paciente pertence a outra organização'
        });
      }

      // Registra log de busca para edição (sanitizado)
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      const { sanitizePatientForLogs } = require('../utils/patientAnonymization');
      const sanitizedPatient = sanitizePatientForLogs(patient);
      await auditLogger.log({
        action: 'QUERY',
        resourceType: 'Patient',
        resourceId: sanitizedPatient.participantId,
        status: 'success',
        severity: 'info',
        message: `Paciente buscado para edição: ID ${sanitizedPatient.participantId}`,
        payload: sanitizedPatient, // Apenas ID sanitizado
        req: req,
        module: 'Cadastro'
      });

      return res.status(200).json({
        success: true,
        // #1045: this handler returned the RAW Mongo document with no shaping
        // at all, consentToken included.
        data: PatientModel.stripConsentSecrets(patient)
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

      let searched = await patientService.searchPatients(db, searchTerm, req.organizationScope);
      if (Array.isArray(searched.patients) && searched.patients.length > 0) {
        const { userHasPermission } = require('../services/rbac-assignment.service');
        const hasCreatePatientPermission = await userHasPermission(db, req.user?.userID, 'createPatient');
        if (hasCreatePatientPermission) {
          searched = {
            ...searched,
            patients: await patientService.attachDirectoryIdentity(db, searched.patients)
          };
        }
      }
      const result = await this.withConsentStatus(db, searched);

      // Registra log de busca (sanitizado)
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'SEARCH',
        resourceType: 'Patient',
        status: 'success',
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
        auditLogger.init(req.app.locals.db);
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

  async listBiomarkerObservations(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const participantId = String(req.params.id || '').trim();
      if (!/^\d{8}$/.test(participantId)) {
        return res.status(400).json({
          success: false,
          error: 'participantId inválido. Deve ter 8 dígitos numéricos'
        });
      }

      // #626: mirrors buscar's out-of-scope 403 pattern. A nonexistent
      // patient (getPatient resolves null) is left to whatever downstream
      // 404/empty-result behavior listPatientObservations already has.
      const existingPatient = await patientService.getPatient(db, participantId);
      const { isRecordInOrganizationScope } = require('../services/rbac-assignment.service');
      if (existingPatient && !isRecordInOrganizationScope(existingPatient, req.organizationScope, 'clinicalUnitId')) {
        return res.status(403).json({
          success: false,
          error: 'Acesso negado',
          message: 'Este paciente pertence a outra organização'
        });
      }

      const filters = {
        biomarkerType: req.query.biomarkerType,
        status: req.query.status,
        from: req.query.from,
        to: req.query.to,
        limit: req.query.limit,
        skip: req.query.skip
      };

      const result = await biomarkerObservationService.listPatientObservations(db, participantId, filters);

      const { userHasPermission } = require('../services/rbac-assignment.service');
      const hasCreatePatientPermission = await userHasPermission(db, req.user?.userID, 'createPatient');

      const observations = hasCreatePatientPermission
        ? result.observations
        : result.observations.map((item) => ({
          _id: item._id,
          participantId: item.participantId,
          biomarkerType: item.biomarkerType,
          collectedAt: item.collectedAt,
          status: item.status,
          unit: item.unit
        }));

      return res.status(200).json({
        success: true,
        data: {
          observations,
          total: result.total,
          limit: result.limit,
          skip: result.skip
        }
      });
    } catch (error) {
      logger.error('Erro ao listar observações biomarcadoras:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro interno do servidor',
        message: error.message
      });
    }
  }

  async createBiomarkerObservation(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const participantId = String(req.params.id || '').trim();
      if (!/^\d{8}$/.test(participantId)) {
        return res.status(400).json({
          success: false,
          error: 'participantId inválido. Deve ter 8 dígitos numéricos'
        });
      }

      // #626: same out-of-scope 403 pattern as listBiomarkerObservations
      // — a mutation, so checked before the write.
      const existingPatient = await patientService.getPatient(db, participantId);
      const { isRecordInOrganizationScope } = require('../services/rbac-assignment.service');
      if (existingPatient && !isRecordInOrganizationScope(existingPatient, req.organizationScope, 'clinicalUnitId')) {
        return res.status(403).json({
          success: false,
          error: 'Acesso negado',
          message: 'Este paciente pertence a outra organização'
        });
      }

      const payload = {
        participantId,
        biomarkerType: req.body?.biomarkerType,
        value: req.body?.value,
        unit: req.body?.unit,
        collectedAt: req.body?.collectedAt,
        status: req.body?.status,
        source: req.body?.source || 'manual',
        eventType: req.body?.eventType || 'manual',
        notes: req.body?.notes,
        specimenId: req.body?.specimenId || null,
        resourceType: req.body?.resourceType || 'Observation',
        subject: req.body?.subject || { reference: `Patient/${participantId}` },
        specimen: req.body?.specimen || (req.body?.specimenId ? { reference: `Specimen/${String(req.body?.specimenId).trim()}` } : null),
        effectiveDateTime: req.body?.effectiveDateTime || req.body?.collectedAt,
        linkedResourceType: 'Patient',
        linkedResourceId: participantId
      };

      const created = await biomarkerObservationService.createObservation(db, payload);

      return res.status(201).json({
        success: true,
        message: 'Observação biomarcadora registrada com sucesso',
        data: created
      });
    } catch (error) {
      logger.error('Erro ao criar observação biomarcadora:', error.message);
      const statusCode = Number(error?.statusCode || error?.status || 400);
      return res.status(statusCode).json({
        success: false,
        error: 'Falha ao criar observação biomarcadora',
        message: error.message
      });
    }
  }
}

module.exports = new PacienteController();


