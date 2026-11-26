const consentService = require('../services/consent.service');
const consentEvidence = require('../services/consentEvidence.service');
const patientService = require('../services/patient.service');
const participantIdentityService = require('../services/participantIdentity.service');
const logger = require('../utils/logger');

class ConsentController {
    // List all patients with PENDING_CONSENT for a given TCLE (policy/template ID)
    async getPendingPatientsForPolicy(req, res) {
      try {
        const db = req.app.locals.db;
        if (!db) {
          return res.status(503).json({
            success: false,
            error: 'Banco de dados não disponível'
          });
        }
        const policyId = String(req.params.id || req.query.policyId || '').trim();
        if (!policyId) {
          return res.status(400).json({
            success: false,
            error: 'policyId é obrigatório'
          });
        }
        const patientsCollection = db.collection('patients');
        const pendingPatients = await patientsCollection.find({
          status: 'PENDING_CONSENT',
          consentTemplateId: policyId
        }).project({ participantId: 1, clinicalUnit: 1, consentNotifiedAt: 1 }).toArray();

        // RF005/RNF007 (#562/#574): patientName is civil identity — resolved via
        // ParticipantIdentity, not read directly off Patient. Decrypted via
        // decryptIdentity so this keeps working once the plaintext field is
        // dropped in favor of the ciphertext-only sibling (#566).
        // #1166: the email is identity data too, taken from the same
        // decrypted record. `patients` no longer carries it (slice 4).
        const identitiesCollection = db.collection('participantIdentities');
        const participantIds = pendingPatients.map((patient) => patient.participantId).filter(Boolean);
        const identities = participantIds.length > 0
          ? await identitiesCollection.find({ participantId: { $in: participantIds } })
            .project({
              participantId: 1,
              patientName: 1,
              patientNameCiphertext: 1,
              email: 1,
              emailCiphertext: 1,
            }).toArray()
          : [];
        const identityByParticipantId = new Map(
          identities.map((identity) => {
            const decrypted = participantIdentityService.decryptIdentity(identity);
            return [decrypted.participantId, decrypted];
          })
        );
        const patientsWithNames = pendingPatients.map((patient) => {
          const identity = identityByParticipantId.get(patient.participantId);
          return {
            ...participantIdentityService.withIdentityContact(patient, identity),
            patientName: identity?.patientName || null,
          };
        });

        return res.status(200).json({
          success: true,
          data: patientsWithNames
        });
      } catch (error) {
        logger.error('Erro ao listar pacientes aguardando aprovação do TCLE:', error.message);
        return res.status(500).json({
          success: false,
          error: 'Erro ao listar pacientes aguardando aprovação do TCLE',
          message: error.message
        });
      }
    }
  async createPolicy(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const policy = await consentService.createPolicy(db, req.body);

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'CREATE',
          resourceType: 'ConsentPolicy',
          resourceId: policy._id.toString(),
          status: 'success',
          severity: 'info',
          message: `Política de consentimento criada (${policy.version})`,
          payload: {
            title: policy.title,
            version: policy.version,
            active: policy.active,
            permissions: policy.granularPermissions?.map(p => p.key) || []
          },
          req: req,
          module: 'Consentimento'
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Política de consentimento criada com sucesso',
        data: policy
      });
    } catch (error) {
      logger.error('Erro ao criar política de consentimento:', error.message);
      return res.status(error.statusCode === 422 ? 422 : 400).json({
        success: false,
        error: 'Erro ao criar política de consentimento',
        message: error.message,
        details: error.details
      });
    }
  }

  async getActivePolicy(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const policy = await consentService.getActivePolicy(db);
      if (!policy) {
        return res.status(404).json({
          success: false,
          error: 'Nenhuma política ativa encontrada'
        });
      }

      return res.status(200).json({
        success: true,
        data: policy
      });
    } catch (error) {
      logger.error('Erro ao buscar política ativa:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar política ativa',
        message: error.message
      });
    }
  }

  async getAllPolicies(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const policies = await consentService.getAllPolicies(db);
      return res.status(200).json({
        success: true,
        data: policies
      });
    } catch (error) {
      logger.error('Erro ao listar políticas:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao listar políticas',
        message: error.message
      });
    }
  }

  async getPoliciesHistory(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const search = String(req.query.search || '');
      const groupId = String(req.query.groupId || req.query.versionGroupId || '');
      const result = await consentService.getPoliciesHistory(db, { page, limit, search, groupId });

      return res.status(200).json({
        success: true,
        data: result.items,
        pagination: result.pagination
      });
    } catch (error) {
      logger.error('Erro ao listar histórico paginado de políticas:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao listar histórico de políticas',
        message: error.message
      });
    }
  }

  async updatePolicy(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const policy = await consentService.updatePolicy(db, req.params.id, req.body || {});

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'UPDATE',
          resourceType: 'ConsentPolicy',
          resourceId: policy._id.toString(),
          status: 'success',
          severity: 'info',
          message: `Política de consentimento atualizada (${policy.version})`,
          payload: {
            title: policy.title,
            version: policy.version,
            active: policy.active,
            previousPolicyId: policy.previousPolicyId || null
          },
          req: req,
          module: 'Consentimento'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'TCLE atualizado com nova versão automática',
        data: policy
      });
    } catch (error) {
      logger.error('Erro ao atualizar política de consentimento:', error.message);
      return res.status(error.statusCode === 422 ? 422 : 400).json({
        success: false,
        error: 'Erro ao atualizar política de consentimento',
        message: error.message,
        details: error.details
      });
    }
  }

  async getActivePoliciesWithCaae(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const policies = await consentService.getActivePoliciesWithCaae(db);
      return res.status(200).json({
        success: true,
        data: policies
      });
    } catch (error) {
      logger.error('Erro ao listar políticas ativas com CAAE:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao listar políticas ativas com CAAE',
        message: error.message
      });
    }
  }

  async createTemplate(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const template = await consentService.createTemplate(db, req.body);

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'CREATE',
          resourceType: 'ConsentTemplate',
          resourceId: template._id.toString(),
          status: 'success',
          severity: 'info',
          message: `Template de consentimento criado (${template.version})`,
          payload: {
            title: template.title,
            version: template.version,
            active: template.active,
            permissions: template.permissions?.map(p => p.key) || []
          },
          req: req,
          module: 'Consentimento'
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Template de consentimento criado com sucesso',
        data: template
      });
    } catch (error) {
      logger.error('Erro ao criar template de consentimento:', error.message);
      return res.status(error.statusCode === 422 ? 422 : 400).json({
        success: false,
        error: 'Erro ao criar template de consentimento',
        message: error.message,
        details: error.details
      });
    }
  }

  async getTemplateById(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const template = await consentService.getTemplateById(db, req.params.id);
      if (!template) {
        return res.status(404).json({
          success: false,
          error: 'Template de consentimento não encontrado'
        });
      }

      return res.status(200).json({
        success: true,
        data: template
      });
    } catch (error) {
      logger.error('Erro ao buscar template de consentimento:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Erro ao buscar template de consentimento',
        message: error.message
      });
    }
  }

  async updateTemplate(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const template = await consentService.updateTemplate(db, req.params.id, req.body || {});

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'UPDATE',
          resourceType: 'ConsentTemplate',
          resourceId: template._id.toString(),
          status: 'success',
          severity: 'info',
          message: `Template de consentimento atualizado (${template.version})`,
          payload: {
            title: template.title,
            version: template.version,
            active: template.active
          },
          req: req,
          module: 'Consentimento'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Template de consentimento atualizado com sucesso',
        data: template
      });
    } catch (error) {
      logger.error('Erro ao atualizar template de consentimento:', error.message);
      return res.status(error.statusCode === 422 ? 422 : 400).json({
        success: false,
        error: 'Erro ao atualizar template de consentimento',
        message: error.message,
        details: error.details
      });
    }
  }

  async getActiveTemplate(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const template = await consentService.getActiveTemplate(db);
      if (!template) {
        return res.status(200).json({
          success: true,
          data: null,
          message: 'Nenhum template ativo encontrado'
        });
      }

      return res.status(200).json({
        success: true,
        data: template
      });
    } catch (error) {
      logger.error('Erro ao buscar template ativo:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar template ativo',
        message: error.message
      });
    }
  }

  // #1349: the active DUO purposes a term's permission may name.
  async listPurposeCodes(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }
      const purposeCodes = await consentService.listPurposeCodes(db);
      return res.status(200).json({ success: true, data: purposeCodes });
    } catch (error) {
      logger.error('Erro ao listar finalidades DUO:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao listar finalidades'
      });
    }
  }

  async getAllTemplates(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const templates = await consentService.getAllTemplates(db);
      return res.status(200).json({
        success: true,
        data: templates
      });
    } catch (error) {
      logger.error('Erro ao listar templates de consentimento:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao listar templates de consentimento',
        message: error.message
      });
    }
  }

  async getCurrentTemplate(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const activeTemplate = await consentService.getActiveTemplate(db);
      if (activeTemplate) {
        return res.status(200).json({
          success: true,
          data: activeTemplate,
          source: 'active'
        });
      }

      const latestTemplate = await consentService.getLatestTemplate(db);
      return res.status(200).json({
        success: true,
        data: latestTemplate || null,
        source: latestTemplate ? 'latest' : 'empty',
        message: latestTemplate
          ? 'Nenhum template ativo encontrado, retornando o template mais recente.'
          : 'Nenhum template de consentimento encontrado.'
      });
    } catch (error) {
      logger.error('Erro ao buscar template corrente:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar template corrente',
        message: error.message
      });
    }
  }

  async createPatientConsent(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const payload = {
        ...req.body,
        patientId: req.body.patientId || req.body.patientID,
        ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
        userAgent: req.headers['user-agent']
      };

      // A participant signing at the staff portal, under the staff session.
      const consent = await consentService.createPatientConsent(db, payload, {
        channel: 'staff_portal',
        signerRole: 'participant',
        authenticationLevel: 'session'
      });

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'SIGN',
          resourceType: 'PatientConsent',
          resourceId: consent._id.toString(),
          status: 'success',
          severity: 'info',
          message: `Consentimento assinado para paciente ${consent.participantId}`,
          payload: {
            participantId: consent.participantId,
            consentTemplateId: consent.consentTemplateId,
            status: consent.status
          },
          req: req,
          module: 'Consentimento'
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Consentimento registrado com sucesso',
        data: consent
      });
    } catch (error) {
      logger.error('Erro ao registrar consentimento:', error.message);
      return res.status(error.statusCode || 400).json({
        success: false,
        error: 'Erro ao registrar consentimento',
        message: error.message
      });
    }
  }

  async revokeConsent(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      // RF010 AC6: staff record the revocation on the participant's behalf;
      // the body may narrow it to some permissions and give a reason.
      const body = req.body || {};
      const consent = await consentService.revokeConsent(db, req.params.id, {
        scope: body.scope,
        reason: body.reason,
        priorUseDisposition: body.priorUseDisposition,
        retentionObligationIds: body.retentionObligationIds
      }, {
        channel: 'staff_portal',
        signerRole: 'staff_on_behalf',
        signerId: req.user?.userID || req.user?.id || req.user?._id || null,
        authenticationLevel: 'session'
      });
      if (!consent) {
        return res.status(404).json({
          success: false,
          error: 'Consentimento não encontrado'
        });
      }

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'REVOKE',
          resourceType: 'PatientConsent',
          resourceId: req.params.id,
          status: 'success',
          severity: 'warning',
          message: `Consentimento revogado para paciente ${consent.participantId}`,
          payload: {
            participantId: consent.participantId,
            consentTemplateId: consent.consentTemplateId,
            status: consent.status,
            currentStateDerived: consent.currentStateDerived || null,
            withdrawalScope: consent.withdrawalScope || null
          },
          req: req,
          module: 'Consentimento'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Consentimento revogado com sucesso',
        data: consent
      });
    } catch (error) {
      logger.error('Erro ao revogar consentimento:', error.message);
      return res.status(error.statusCode === 422 ? 422 : 400).json({
        success: false,
        error: 'Erro ao revogar consentimento',
        message: error.message,
        details: error.details
      });
    }
  }

  async getConsentHistory(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const history = await consentService.getConsentHistory(db, req.params.id);
      if (!history) {
        return res.status(404).json({
          success: false,
          error: 'Consentimento não encontrado'
        });
      }

      return res.status(200).json({ success: true, data: history });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({
          success: false,
          error: 'ID de consentimento inválido',
          message: error.message
        });
      }
      logger.error('Erro ao buscar histórico do consentimento:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Erro ao buscar histórico do consentimento',
        message: error.message
      });
    }
  }

  async getPatientConsent(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      // #1188: a Consent carries no organization field, so the scope check
      // runs on its patient (#626), and the consent is read by the id of the
      // patient that passed it.
      const patient = await patientService.getPatient(db, req.params.participantId);
      if (!patient) {
        return res.status(404).json({
          success: false,
          error: 'Paciente não encontrado'
        });
      }
      const { isRecordInOrganizationScope } = require('../services/rbac-assignment.service');
      if (!isRecordInOrganizationScope(patient, req.organizationScope, 'clinicalUnitId')) {
        return res.status(403).json({
          success: false,
          error: 'Acesso negado',
          message: 'Este paciente pertence a outra organização'
        });
      }

      const consent = await consentService.getPatientConsent(db, patient.participantId);
      if (!consent) {
        return res.status(404).json({
          success: false,
          error: 'Consentimento não encontrado'
        });
      }

      const visibleConsent = { ...consent };
      delete visibleConsent.signedTcleEncryption;
      delete visibleConsent.evidenceEncryption;
      return res.status(200).json({
        success: true,
        data: visibleConsent
      });
    } catch (error) {
      logger.error('Erro ao buscar consentimento:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar consentimento',
        message: error.message
      });
    }
  }

  async getSignedTcle(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const consent = await consentService.findConsentById(db, req.params.id);
      if (!consent) {
        return res.status(404).json({
          success: false,
          error: 'Consentimento não encontrado'
        });
      }

      const patient = await patientService.getPatient(db, consent.participantId);
      if (!patient) {
        return res.status(404).json({
          success: false,
          error: 'Paciente não encontrado'
        });
      }
      const { isRecordInOrganizationScope } = require('../services/rbac-assignment.service');
      if (!isRecordInOrganizationScope(patient, req.organizationScope, 'clinicalUnitId')) {
        return res.status(403).json({
          success: false,
          error: 'Acesso negado',
          message: 'Este paciente pertence a outra organização'
        });
      }

      const pdf = consentEvidence.readSignedTcle(consent);
      if (!pdf) {
        return res.status(404).json({
          success: false,
          error: 'Termo assinado não encontrado'
        });
      }

      const disposition = req.query.download === '1' ? 'attachment' : 'inline';
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${disposition}; filename="tcle.pdf"`);
      return res.status(200).send(pdf);
    } catch (error) {
      if (error.statusCode === 400 || error.statusCode === 409) {
        return res.status(error.statusCode).json({
          success: false,
          error: error.message
        });
      }
      logger.error('Erro ao ler o TCLE assinado:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao ler o TCLE assinado',
        message: error.message
      });
    }
  }

  async validateConsentToken(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const patientId = req.body.patientId || req.body.patientID || req.query.patientId || req.query.patientID;
      const token = req.body.token || req.query.token;

      const result = await patientService.validateConsentToken(db, String(patientId), String(token));

      // #809: the page behind this token's link (/patients/:id/consent?token=)
      // is unauthenticated -- it is emailed to a participant, not to a user of
      // the system -- so this response is its only source for the term it asks
      // them to accept. Every other route exposing a ConsentTemplate or an
      // active policy sits behind `authenticate`.
      let template = null;
      try {
        // #1181: the active term of the participant's own lineage.
        template = await consentService.getActiveTemplateForParticipant(db, result.participantId);
      } catch (templateError) {
        // A template-lookup failure is not an invalid token: reporting it as
        // one would tell the participant their link is bad and send them to
        // request another, which would not help.
        logger.error('Erro ao carregar termo ativo do link de consentimento:', templateError.message);
        // #1138: no `message` key. This route is unauthenticated, so the
        // reasoning #823 gave for the 400 and #1127 for the two 503s below
        // applies here unchanged -- whatever getActiveTemplate threw can name
        // a host, a replica-set member or a schema path, and the caller is
        // told a state, not a cause. The detail is in the log line above,
        // which is where an operator reads it.
        return res.status(503).json({
          success: false,
          error: 'Termo de consentimento indisponível'
        });
      }

      let consent = null;
      try {
        consent = await consentService.getPatientConsent(db, result.participantId);
      } catch (consentError) {
        logger.error('Erro ao carregar o consentimento do painel:', consentError.message);
        return res.status(503).json({
          success: false,
          error: 'Termo de consentimento indisponível'
        });
      }

      const derived = consent?.currentStateDerived || null;
      const inForce = consent && consent.status === 'ACTIVE' && derived !== 'revoked' && derived !== 'superseded';
      // An in-person signature can leave the patient row pending while the
      // consent itself is already in force. The panel follows the consent.
      let panel = 'pending';
      if (inForce) panel = 'manage';
      else if (consent && (consent.status === 'REVOKED' || derived === 'revoked' || derived === 'superseded')) panel = 'closed';

      return res.status(200).json({
        success: true,
        data: {
          ...result,
          panel,
          consent: consent
            ? {
              participantId: consent.participantId || result.participantId,
              status: consent.status,
              currentStateDerived: derived,
              signedAt: consent.signedAt || null,
              hasSignedTcle: Boolean(consent.signedTcleDocumentUri),
              effectivePermissions: consent.effectivePermissions || consent.responses || {},
            }
            : null,
          template: template
            ? {
              id: String(template._id),
              title: template.title,
              content: template.content,
              version: template.version || null,
              permissions: Array.isArray(template.permissions) ? template.permissions : []
            }
            : null
        }
      });
    } catch (error) {
      // #823: this route is unauthenticated by design -- the emailed token is
      // the only credential -- so this response IS the disclosure boundary.
      // patientService.validateConsentToken throws four distinguishable
      // messages (participant unknown / not awaiting consent / wrong token /
      // expired), and echoing them let an unauthenticated caller walk the
      // 8-digit participantId space and read biobank membership and consent
      // state straight off the reply. One opaque answer for every failure; the
      // detail stays in the log line above. Deliberately no `message` key --
      // the frontend maps this by status alone (mapConsentTokenError).
      logger.error('Erro ao validar token de consentimento:', error.message);
      // #1127: and the split above has a second half. The four throws are the
      // participant's request being wrong; a driver error inside the token
      // check is not, and reporting it as one tells them their link is bad and
      // sends them to request another that would not help. Same decision the
      // template arm makes above, for the same audience. The detail stays in
      // the log line -- an unauthenticated caller is told a state, not a cause.
      if (!patientService.isConsentTokenRejection(error)) {
        return res.status(503).json({
          success: false,
          error: 'Não foi possível validar o link de consentimento'
        });
      }
      return res.status(400).json({
        success: false,
        error: 'Link inválido ou expirado'
      });
    }
  }

  async acceptConsentToken(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const patientId = req.body.patientId || req.body.patientID || req.query.patientId || req.query.patientID;
      const token = req.body.token || req.query.token;

      // #821: the manifestation itself -- the term the page showed and the
      // participant's per-permission answers -- plus its origin (RF010 AC#4).
      const result = await patientService.acceptConsentToken(db, String(patientId), String(token), {
        consentTemplateId: req.body.consentTemplateId,
        responses: req.body.responses,
        location: req.body.location,
        identityProof: req.body.identityProof,
        ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
        userAgent: req.headers['user-agent']
      });

      return res.status(200).json({
        success: true,
        message: 'Consentimento confirmado com sucesso',
        data: result
      });
    } catch (error) {
      // #823: same oracle as validateConsentToken above, and reached through
      // the same four throws -- acceptConsentToken delegates to
      // validateConsentToken before it writes anything. The issue named only
      // the validate route; both leak, so both answer identically, which also
      // stops the PAIR of endpoints from distinguishing each other.
      logger.error('Erro ao aceitar consentimento:', error.message);
      // #821: the link was good, the answers were not recordable as sent (none,
      // not fitting the term, or the term was republished). Fixed body, same
      // no-`message` rule as the 400: this route is unauthenticated.
      if (patientService.isConsentManifestationRejection(error)) {
        return res.status(422).json({
          success: false,
          error: 'Respostas do termo inválidas ou termo atualizado',
          details: ['Respostas do termo inválidas ou termo atualizado']
        });
      }
      // #1127: worse on this route than on validate. The write recording the
      // acceptance can fail after a good token has been checked, and a 400
      // then tells a participant who DID consent that their link was invalid
      // -- so they believe they failed to consent when the system failed to
      // record it. 503 is the honest answer and the one that asks them to
      // retry rather than to get a new link.
      if (!patientService.isConsentTokenRejection(error)) {
        return res.status(503).json({
          success: false,
          error: 'Não foi possível registrar o consentimento'
        });
      }
      return res.status(400).json({
        success: false,
        error: 'Link inválido ou expirado'
      });
    }
  }

  async revokeConsentToken(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const patientId = req.body.patientId || req.body.participantId;
      const token = req.body.token;
      const result = await patientService.revokeConsentByToken(db, String(patientId || ''), String(token || ''), {
        scope: req.body.scope,
        reason: req.body.reason,
        location: req.body.location,
      });
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error('Erro ao revogar consentimento pelo painel:', error.message);
      if (patientService.isConsentManifestationRejection(error)) {
        return res.status(422).json({
          success: false,
          error: 'Não há consentimento em vigor para revogar',
          details: ['Não há consentimento em vigor para revogar']
        });
      }
      if (!patientService.isConsentTokenRejection(error)) {
        return res.status(503).json({
          success: false,
          error: 'Não foi possível registrar a revogação'
        });
      }
      return res.status(400).json({
        success: false,
        error: 'Link inválido ou expirado'
      });
    }
  }

  // The emailed panel has no staff session. The same token that opens it
  // is the credential for this participant's signed file, and nothing else.
  async getSignedTcleByToken(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const patientId = req.body.patientId || req.body.participantId;
      const token = req.body.token;
      const result = await patientService.validateConsentToken(db, String(patientId || ''), String(token || ''));
      const consent = await consentService.getPatientConsent(db, result.participantId);
      const pdf = consent ? consentEvidence.readSignedTcle(consent) : null;
      if (!pdf) {
        return res.status(404).json({
          success: false,
          error: 'Termo assinado não encontrado'
        });
      }

      const disposition = req.query.download === '1' ? 'attachment' : 'inline';
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${disposition}; filename="tcle.pdf"`);
      return res.status(200).send(pdf);
    } catch (error) {
      if (error.statusCode === 409) {
        logger.error('Erro ao ler o TCLE assinado pelo painel:', error.message);
        return res.status(409).json({
          success: false,
          error: 'Termo assinado não encontrado'
        });
      }
      logger.error('Erro ao ler o TCLE assinado pelo painel:', error.message);
      if (!patientService.isConsentTokenRejection(error)) {
        return res.status(503).json({
          success: false,
          error: 'Não foi possível abrir o termo assinado'
        });
      }
      return res.status(400).json({
        success: false,
        error: 'Link inválido ou expirado'
      });
    }
  }
}

module.exports = new ConsentController();

