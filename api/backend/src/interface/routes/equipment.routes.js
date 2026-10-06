const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission, requireOrganizationScope } = require('../../infrastructure/middleware/rbac');
const logger = require('../../utils/logger');
const EquipmentModel = require('../../models/Equipment');
const { generateUniqueEquipmentID } = require('../../utils/equipmentIDGenerator');
const defaultQuarantineService = require('../../services/equipment-sensor-quarantine.service');
const { applyOrganizationScopeFilter, isRecordInOrganizationScope, resolveOrganizationIdForCreate, assertOrganizationFieldNotReparented } = require('../../services/rbac-assignment.service');
const { isTransactionCapable } = require('../../utils/mongoTransaction');

// #1081: the fields a PUT may write, derived from EquipmentModel.create()'s
// own shape rather than from what callers happen to send. The PUT used to
// spread req.body straight into $set, so any key reached the document --
// including _id, createdAt, and keys no schema knows about.
//
// Three of create()'s fields are deliberately absent:
//   equipmentID -- identity. It is this route's own numeric-fallback lookup
//     key, and #1070 records five live readers joining storageContainers on
//     it. Same call ALLOWED_SENSOR_UPDATE_FIELDS makes for sensorId/sensorID.
//   createdAt   -- immutable by definition.
//   updatedAt   -- stamped by the handler below, never caller-supplied.
//
// organizationId IS here, deliberately: assertOrganizationFieldNotReparented
// is what governs re-parenting, so the allowlist must not also block it or
// an Administrador loses the ability to assign an organization at all.
const ALLOWED_EQUIPMENT_UPDATE_FIELDS = [
  'equipmentDescription', 'name', 'model', 'serialNumber',
  'type', 'status', 'purchaseDate', 'organizationId'
];

function createEquipmentValidationError(message, statusCode = 422) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

// #635: mirrors sample.service.js's/sensor.service.js's own organizationId
// validation -- when provided, it must resolve to a real Organization.
async function assertOrganizationIdResolves(db, organizationId) {
  if (organizationId === undefined || organizationId === null || organizationId === '') {
    return;
  }
  const organization = await db.collection('organizations').findOne({ organizationId: String(organizationId) });
  if (!organization) {
    throw createEquipmentValidationError(`organizationId ${organizationId} não encontrado`, 404);
  }
}

// CRUD de Equipamentos
// #1087: the three GETs below now also carry a viewEquipment gate, a new
// READ-only code. (Named without the call syntax on purpose: the #921/#630
// architecture test parses this file for gate call sites, and a literal one
// in a comment reads to it as a route registration that does not exist.)
// They were authenticate + scope only, so any
// authenticated principal could list the inventory. See
// rbac-catalog-seed.service.js for why it is not manageStorageTopology --
// short version, Tecnico does not hold that one and RF025 AC#3 is written
// for Tecnico. The permission runs BEFORE the scope check, matching the
// writes in this file.
//
// #635: requireOrganizationScope filters/gates by the caller's own
// organizationId scope -- see the query build below and GET /:id.
router.get('/', authenticate, requirePermission('viewEquipment'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;

    const equipmentCollection = db.collection('equipment');
    const query = applyOrganizationScopeFilter({}, req.organizationScope, 'organizationId');
    const equipment = await equipmentCollection.find(query).toArray();

    // Registra log de consulta
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      resourceType: 'Equipment',
      status: 'success',
      severity: 'info',
      message: `Consulta de equipamentos - ${equipment.length} registros`,
      payload: { total: equipment.length },
      req: req,
      module: 'Equipamentos'
    });

    return res.status(200).json({
      success: true,
      data: equipment
    });
  } catch (error) {
    logger.error('Erro ao listar equipamentos:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar equipamentos',
      message: error.message
    });
  }
});

/**
 * GET /api/equipment/analytical
 * Retorna apenas equipamentos analíticos (excluindo freezers)
 * Filtra por type='Analytical' e status != 'Maintenance'
 */
router.get('/analytical', authenticate, requirePermission('viewEquipment'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;

    const equipmentCollection = db.collection('equipment');

    // Filtra equipamentos analíticos que não estão em manutenção
    // #1087: this read had NO organization scope at all, so it returned
    // every organization's analytical equipment to any authenticated
    // caller. The middleware alone is not enough -- without the filter it
    // would refuse an unassigned caller while still handing an assigned one
    // every other organization's rows. Same idiom as GET / above (#635).
    const query = applyOrganizationScopeFilter({
      type: 'Analytical',
      status: { $ne: 'Maintenance' }
    }, req.organizationScope, 'organizationId');
    const analyticalEquipment = await equipmentCollection.find(query).toArray();

    // Registra log de consulta
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      resourceType: 'Equipment',
      status: 'success',
      severity: 'info',
      message: `Consulta de equipamentos analíticos - ${analyticalEquipment.length} registros`,
      payload: { total: analyticalEquipment.length },
      req: req,
      module: 'Equipamentos'
    });

    return res.status(200).json({
      success: true,
      data: analyticalEquipment
    });
  } catch (error) {
    logger.error('Erro ao listar equipamentos analíticos:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar equipamentos analíticos',
      message: error.message
    });
  }
});

router.get('/:id', authenticate, requirePermission('viewEquipment'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;

    const { ObjectId } = require('mongodb');
    const equipmentCollection = db.collection('equipment');

    let equipment = null;
    try {
      equipment = await equipmentCollection.findOne({ _id: new ObjectId(req.params.id) });
    } catch (err) {
      // Não é um ObjectId válido; tenta como equipmentID numérico
      const equipmentID = parseInt(req.params.id, 10);
      if (isNaN(equipmentID)) {
        return res.status(400).json({
          success: false,
          error: 'ID inválido',
          message: 'O ID fornecido não é válido'
        });
      }
      equipment = await equipmentCollection.findOne({ equipmentID: equipmentID });
    }

    if (!equipment) {
      // Registra tentativa de busca de equipamento inexistente
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'QUERY',
        resourceType: 'Equipment',
        status: 'error',
        severity: 'warning',
        message: `Tentativa de buscar equipamento inexistente: ${req.params.id}`,
        req: req,
        module: 'Equipamentos'
      });
      
      return res.status(404).json({
        success: false,
        error: 'Equipamento não encontrado'
      });
    }

    // #635 (F3-G09): mirrors sensor.controller.js's own out-of-scope 403
    // pattern -- a null organizationId (unscoped/legacy equipment) is out
    // of scope for anyone but a global caller.
    if (req.organizationScope && !isRecordInOrganizationScope(equipment, req.organizationScope, 'organizationId')) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Este equipamento pertence a outra organização'
      });
    }

    // Registra log de busca
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      resourceType: 'Equipment',
      resourceId: req.params.id,
      status: 'success',
      severity: 'info',
      message: 'Equipamento consultado',
      req: req,
      module: 'Equipamentos'
    });

    return res.status(200).json({
      success: true,
      data: equipment
    });
  } catch (error) {
    logger.error('Erro ao buscar equipamento:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar equipamento',
      message: error.message
    });
  }
});

// #1071: requireOrganizationScope added -- this create had no scope
// middleware at all, so there was nothing to stamp from and an org-less
// caller was never refused.
router.post('/', authenticate, requirePermission('manageStorageTopology'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;

    const validation = EquipmentModel.validate(req.body);
    if (!validation.isValid) {
      return res.status(422).json({
        success: false,
        error: 'Dados inválidos',
        message: validation.errors.join(', '),
        details: validation.errors
      });
    }

    // #1071: the organization comes from the caller's resolved scope, not
    // the body. assertOrganizationIdResolves only checks the org EXISTS.
    const organizationId = resolveOrganizationIdForCreate(req.organizationScope, req.body?.organizationId);
    await assertOrganizationIdResolves(db, organizationId);

    // Prepara os dados, convertendo purchaseDate se necessário
    const equipmentData = { ...req.body, organizationId };
    if (equipmentData.purchaseDate) {
      equipmentData.purchaseDate = new Date(equipmentData.purchaseDate);
    }

    // Gera equipmentID automaticamente se não fornecido
    if (!equipmentData.equipmentID) {
      equipmentData.equipmentID = await generateUniqueEquipmentID(db, 'equipment');
      logger.info(`EquipmentID gerado automaticamente: ${equipmentData.equipmentID}`);
    } else {
      // Verifica se o equipmentID fornecido já existe
      const equipmentCollection = db.collection('equipment');
      const existing = await equipmentCollection.findOne({ equipmentID: equipmentData.equipmentID });
      if (existing) {
        return res.status(400).json({
          success: false,
          error: 'Já existe um equipamento com este ID',
          message: `O equipmentID ${equipmentData.equipmentID} já está em uso`
        });
      }
    }

    const equipmentCollection = db.collection('equipment');
    const equipment = EquipmentModel.create(equipmentData);

    const result = await equipmentCollection.insertOne(equipment);

    // Registra log de criação
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'CREATE',
      resourceType: 'Equipment',
      resourceId: result.insertedId.toString(),
      status: 'success',
      severity: 'info',
      message: 'Equipamento criado',
      payload: { equipmentName: equipment.equipmentName || equipment.name || null },
      req: req,
      module: 'Equipamentos'
    });

    return res.status(201).json({
      success: true,
      message: 'Equipamento criado com sucesso',
      data: { _id: result.insertedId, ...equipment }
    });
  } catch (error) {
    logger.error('Erro ao criar equipamento:', error.message);
    // #635: organizationId lookup failures throw statusCode:404.
    if (error.statusCode === 404) {
      return res.status(404).json({
        success: false,
        error: error.message,
        message: error.message
      });
    }
    return res.status(500).json({
      success: false,
      error: 'Erro ao criar equipamento',
      message: error.message
    });
  }
});

// #1081: requireOrganizationScope was on both GETs since #635 and on POST
// since #1071, but not here or on DELETE -- so create was gated while update
// and delete were not. It is load-bearing rather than decoration: the source
// check below is written in this file's own guarded form, so without the
// middleware req.organizationScope is undefined and the check silently
// passes everything.
router.put('/:id', authenticate, requirePermission('manageStorageTopology'), requireOrganizationScope, async (req, res) => {
  try {
    const quarantineService = req.app?.locals?.quarantineService || defaultQuarantineService;
    const db = req.app.locals.db;

    await assertOrganizationIdResolves(db, req.body.organizationId);

    const { ObjectId } = require('mongodb');
    const equipmentCollection = db.collection('equipment');

    // Prepara os dados para atualização, convertendo purchaseDate se necessário
    const updateData = { ...req.body };
    updateData.updatedAt = new Date();
    if (updateData.purchaseDate) {
      updateData.purchaseDate = new Date(updateData.purchaseDate);
    }

    // Tenta atualizar por _id primeiro, depois por equipmentID
    let result = null;
    let query = {};
    let foundEquipment = null;
    let quarantineResult = null;
    
    logger.info(`Tentando atualizar equipamento com ID: ${req.params.id}`);
    
    // Tenta como ObjectId (MongoDB _id)
    try {
      const objectId = new ObjectId(req.params.id);
      foundEquipment = await equipmentCollection.findOne({ _id: objectId });
      if (foundEquipment) {
        logger.info(`Equipamento encontrado por _id: ${req.params.id}`);
        query = { _id: objectId };
      } else {
        logger.warn(`Equipamento não encontrado por _id: ${req.params.id}`);
      }
    } catch (err) {
      // Se não for ObjectId válido, tenta como equipmentID numérico
      logger.info(`Tentando como equipmentID numérico: ${req.params.id}`);
      const equipmentID = parseInt(req.params.id, 10);
      if (!isNaN(equipmentID)) {
        foundEquipment = await equipmentCollection.findOne({ equipmentID: equipmentID });
        if (foundEquipment) {
          logger.info(`Equipamento encontrado por equipmentID: ${equipmentID}`);
          query = { equipmentID: equipmentID };
        } else {
          logger.warn(`Equipamento não encontrado por equipmentID: ${equipmentID}`);
        }
      } else {
        logger.error(`ID inválido: ${req.params.id}`);
        return res.status(400).json({
          success: false,
          error: 'ID inválido',
          message: 'O ID fornecido não é válido'
        });
      }
    }

    // Se não encontrou o equipamento, retorna erro
    if (!foundEquipment) {
      logger.error(`Equipamento não encontrado com ID: ${req.params.id}`);
      return res.status(404).json({
        success: false,
        error: 'Equipamento não encontrado',
        message: `Nenhum equipamento encontrado com o ID: ${req.params.id}`
      });
    }

    // #1081 SOURCE check -- is the equipment I am updating mine? Deliberately
    // AFTER the 404, mirroring GET /:id at the top of this file and
    // sensor.controller.js's update: a record that does not exist 404s, and
    // one that exists outside your scope 403s. The fetch this needs was
    // already here; #1081's body claimed it was not, which was wrong.
    if (req.organizationScope && !isRecordInOrganizationScope(foundEquipment, req.organizationScope, 'organizationId')) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Equipamento fora do escopo organizacional do usuário'
      });
    }

    // #1081 DESTINATION check -- am I moving it somewhere that is mine?
    // assertOrganizationIdResolves above only asserts the Organization
    // EXISTS, so naming a real organization you do not belong to passed it
    // (the correction #1071 recorded). A global scope is unconstrained and
    // an absent organizationId in the body is a no-op; both are handled
    // inside the helper. It throws statusCode 403, which the catch below
    // now maps -- previously anything but a 404 fell through to 400.
    assertOrganizationFieldNotReparented(
      req.organizationScope,
      foundEquipment.organizationId,
      req.body?.organizationId
    );

    // #868: PUT was writing whatever it was handed. EquipmentModel.validate
    // is a whole-document validator, so it cannot be applied to the patch
    // directly -- a patch changing only `status` carries no
    // equipmentDescription and would fail on its absence.
    //
    // Validating the MERGED document is the obvious next move and is also
    // wrong: the validator requires a numeric equipmentID and a
    // description unconditionally, and documents predating those rules
    // exist -- #757 records a raw insertOne putting a string equipmentID
    // past both schemas. Merge-validation would make every such document
    // permanently un-updatable, including by the very patch that would
    // repair it.
    //
    // So reject only what this request actually introduces: validate
    // before and after, and fail on errors the patch added. A caller is
    // never punished for a pre-existing defect it did not cause, and an
    // invalid status still cannot reach quarantineByEquipmentStatus below.
    const priorErrors = new Set(EquipmentModel.validate(foundEquipment).errors);
    const introducedErrors = EquipmentModel
      .validate({ ...foundEquipment, ...updateData })
      .errors
      .filter((error) => !priorErrors.has(error));

    if (introducedErrors.length > 0) {
      logger.warn(`Validação falhou ao atualizar equipamento ${req.params.id}: ${introducedErrors.join(', ')}`);
      return res.status(422).json({
        success: false,
        error: 'Dados inválidos',
        message: introducedErrors.join(', '),
        details: introducedErrors
      });
    }

    // #1081: project through the allowlist HERE, after the #868 diff above
    // and before either $set below. The ordering is load-bearing and is not
    // interchangeable: projecting BEFORE the diff would stop an invalid value
    // in a dropped field from producing an introducedError, turning today's
    // 422-with-a-message into a 200 that discards the field in silence. The
    // diff therefore still sees the caller's whole patch; only persistence is
    // filtered. equipment.api.test.js's "#1081 ordering control" pins this.
    const persistedUpdate = {};
    for (const field of ALLOWED_EQUIPMENT_UPDATE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(updateData, field)) {
        persistedUpdate[field] = updateData[field];
      }
    }
    persistedUpdate.updatedAt = updateData.updatedAt;

    const finalStatus = updateData.status !== undefined ? updateData.status : foundEquipment.status;
    const shouldTriggerQuarantine = quarantineService.isQuarantineTriggerStatus(finalStatus);
    const mongoClient = db?.client;
    const canUseTransaction = shouldTriggerQuarantine && (await isTransactionCapable(db));

    if (canUseTransaction) {
      const session = mongoClient.startSession();

      try {
        await session.withTransaction(async () => {
          result = await equipmentCollection.updateOne(
            query,
            { $set: persistedUpdate },
            { session }
          );

          quarantineResult = await quarantineService.quarantineByEquipmentStatus(
            db,
            {
              ...foundEquipment,
              ...persistedUpdate,
              _id: foundEquipment._id,
              equipmentID: foundEquipment.equipmentID
            },
            finalStatus,
            {
              session,
              auditInfo: {
                userId: req.user?.userID || null,
                userName: req.user?.name || req.user?.userName || 'SYSTEM',
                userRole: req.user?.role || null,
                ipAddress: req.ip || null,
                userAgent: req.get('user-agent') || null
              }
            }
          );
        });
      } finally {
        await session.endSession();
      }
    } else {
      result = await equipmentCollection.updateOne(query, { $set: persistedUpdate });

      if (shouldTriggerQuarantine) {
        quarantineResult = await quarantineService.quarantineByEquipmentStatus(
          db,
          {
            ...foundEquipment,
            ...persistedUpdate,
            _id: foundEquipment._id,
            equipmentID: foundEquipment.equipmentID
          },
          finalStatus,
          {
            auditInfo: {
              userId: req.user?.userID || null,
              userName: req.user?.name || req.user?.userName || 'SYSTEM',
              userRole: req.user?.role || null,
              ipAddress: req.ip || null,
              userAgent: req.get('user-agent') || null
            }
          }
        );
      }
    }

    if (!result || result.matchedCount === 0) {
      logger.error(`Erro ao atualizar equipamento: matchedCount = ${result?.matchedCount}`);
      return res.status(500).json({
        success: false,
        error: 'Erro ao atualizar equipamento',
        message: 'O equipamento foi encontrado mas não pôde ser atualizado'
      });
    }
    
    logger.info(`Equipamento atualizado com sucesso: ${req.params.id}`);

    // Registra log de atualização
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'UPDATE',
      resourceType: 'Equipment',
      resourceId: req.params.id,
      status: 'success',
      severity: 'info',
      message: 'Equipamento atualizado',
      payload: quarantineResult && quarantineResult.triggered
        ? {
          quarantineTriggered: true,
          samplesMatched: quarantineResult.matched,
          samplesQuarantined: quarantineResult.quarantined,
          movementsCreated: quarantineResult.movements,
          reason: quarantineResult.reason
        }
        : { quarantineTriggered: false },
      req: req,
      module: 'Equipamentos'
    });

    return res.status(200).json({
      success: true,
      message: 'Equipamento atualizado com sucesso',
      quarantine: quarantineResult && quarantineResult.triggered
        ? {
          triggered: true,
          matched: quarantineResult.matched,
          quarantined: quarantineResult.quarantined,
          movements: quarantineResult.movements,
          reason: quarantineResult.reason
        }
        : { triggered: false }
    });
  } catch (error) {
    logger.error('Erro ao atualizar equipamento:', error.message);
    // #635: organizationId lookup failures throw statusCode:404.
    if (error.statusCode === 404) {
      return res.status(404).json({
        success: false,
        error: error.message,
        message: error.message
      });
    }
    // #1081: assertOrganizationFieldNotReparented throws statusCode 403.
    // Mapped explicitly rather than by honouring error.statusCode generally,
    // for the reason sensor.controller.js:327-330 gives -- widening it would
    // reclassify the validation errors that deliberately answer 422/400.
    if (error.statusCode === 403) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: error.message
      });
    }
    return res.status(400).json({
      success: false,
      error: 'Erro ao atualizar equipamento',
      message: error.message
    });
  }
});

// #1081: same gap as PUT, and the unrecoverable half of it -- a re-parent
// can be undone, a cross-organization delete cannot.
router.delete('/:id', authenticate, requirePermission('manageStorageTopology'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;

    const { ObjectId } = require('mongodb');
    const equipmentCollection = db.collection('equipment');

    // Tenta deletar por _id primeiro, depois por equipmentID
    let result = null;
    let deletedEquipment = null;
    // #1081: the fetch and the delete used to be adjacent inside each
    // branch, leaving nowhere to put a scope check. Resolving the query
    // first and deleting once, below, is what makes room for it.
    let deleteQuery = null;
    
    // Tenta como ObjectId (MongoDB _id)
    try {
      const objectId = new ObjectId(req.params.id);
      deletedEquipment = await equipmentCollection.findOne({ _id: objectId });
      if (deletedEquipment) {
        deleteQuery = { _id: objectId };
      }
    } catch (err) {
      // Se não for ObjectId válido, tenta como equipmentID numérico
      const equipmentID = parseInt(req.params.id, 10);
      if (!isNaN(equipmentID)) {
        deletedEquipment = await equipmentCollection.findOne({ equipmentID: equipmentID });
        if (deletedEquipment) {
          deleteQuery = { equipmentID: equipmentID };
        }
      }
    }

    // #1081 SOURCE check, between the fetch and the delete. Same
    // 404-then-403 ordering as PUT and as GET /:id.
    if (deletedEquipment && req.organizationScope
      && !isRecordInOrganizationScope(deletedEquipment, req.organizationScope, 'organizationId')) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Equipamento fora do escopo organizacional do usuário'
      });
    }

    if (deleteQuery) {
      result = await equipmentCollection.deleteOne(deleteQuery);
    }

    if (!result || result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Equipamento não encontrado'
      });
    }

    // Registra log de deleção
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'DELETE',
      resourceType: 'Equipment',
      resourceId: req.params.id,
      status: 'success',
      severity: 'warning',
      message: 'Equipamento deletado',
      req: req,
      module: 'Equipamentos'
    });

    return res.status(200).json({
      success: true,
      message: 'Equipamento deletado com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao deletar equipamento:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao deletar equipamento',
      message: error.message
    });
  }
});

module.exports = router;

