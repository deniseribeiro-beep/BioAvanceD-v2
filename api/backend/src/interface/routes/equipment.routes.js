const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const logger = require('../../utils/logger');
const EquipmentModel = require('../../models/Equipment');
const { generateUniqueEquipmentID } = require('../../utils/equipmentIDGenerator');
const defaultQuarantineService = require('../../services/equipment-sensor-quarantine.service');

// CRUD de Equipamentos
router.get('/', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;

    const equipmentCollection = db.collection('equipment');
    const equipment = await equipmentCollection.find({}).toArray();

    // Registra log de consulta
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      entity: 'Equipment',
      result: 'success',
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
router.get('/analytical', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;

    const equipmentCollection = db.collection('equipment');

    // Filtra equipamentos analíticos que não estão em manutenção
    const analyticalEquipment = await equipmentCollection.find({
      type: 'Analytical',
      status: { $ne: 'Maintenance' }
    }).toArray();

    // Registra log de consulta
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      entity: 'Equipment',
      result: 'success',
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

router.get('/:id', authenticate, async (req, res) => {
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
        entity: 'Equipment',
        result: 'error',
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

    // Registra log de busca
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      entity: 'Equipment',
      entityID: req.params.id,
      result: 'success',
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

router.post('/', authenticate, requirePermission('createPatient'), async (req, res) => {
  try {
    const db = req.app.locals.db;

    const validation = EquipmentModel.validate(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Dados inválidos',
        message: validation.errors.join(', ')
      });
    }

    // Prepara os dados, convertendo purchaseDate se necessário
    const equipmentData = { ...req.body };
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
    if (req.user) {
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'CREATE',
        entity: 'Equipment',
        entityID: result.insertedId.toString(),
        result: 'success',
        severity: 'info',
        message: 'Equipamento criado',
        payload: { equipmentName: equipment.equipmentName || equipment.name || null },
        req: req,
        module: 'Equipamentos'
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Equipamento criado com sucesso',
      data: { _id: result.insertedId, ...equipment }
    });
  } catch (error) {
    logger.error('Erro ao criar equipamento:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao criar equipamento',
      message: error.message
    });
  }
});

router.put('/:id', authenticate, requirePermission('createPatient'), async (req, res) => {
  try {
    const quarantineService = req.app?.locals?.quarantineService || defaultQuarantineService;
    const db = req.app.locals.db;

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

    const finalStatus = updateData.status !== undefined ? updateData.status : foundEquipment.status;
    const shouldTriggerQuarantine = quarantineService.isQuarantineTriggerStatus(finalStatus);
    const mongoClient = db?.client;
    const canUseTransaction = shouldTriggerQuarantine && typeof mongoClient?.startSession === 'function';

    if (canUseTransaction) {
      const session = mongoClient.startSession();

      try {
        await session.withTransaction(async () => {
          result = await equipmentCollection.updateOne(
            query,
            { $set: updateData },
            { session }
          );

          quarantineResult = await quarantineService.quarantineByEquipmentStatus(
            db,
            {
              ...foundEquipment,
              ...updateData,
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
      result = await equipmentCollection.updateOne(query, { $set: updateData });

      if (shouldTriggerQuarantine) {
        quarantineResult = await quarantineService.quarantineByEquipmentStatus(
          db,
          {
            ...foundEquipment,
            ...updateData,
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
    if (req.user) {
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'UPDATE',
        entity: 'Equipment',
        entityID: req.params.id,
        result: 'success',
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
    }

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
    return res.status(400).json({
      success: false,
      error: 'Erro ao atualizar equipamento',
      message: error.message
    });
  }
});

router.delete('/:id', authenticate, requirePermission('createPatient'), async (req, res) => {
  try {
    const db = req.app.locals.db;

    const { ObjectId } = require('mongodb');
    const equipmentCollection = db.collection('equipment');

    // Tenta deletar por _id primeiro, depois por equipmentID
    let result = null;
    let deletedEquipment = null;
    
    // Tenta como ObjectId (MongoDB _id)
    try {
      const objectId = new ObjectId(req.params.id);
      deletedEquipment = await equipmentCollection.findOne({ _id: objectId });
      if (deletedEquipment) {
        result = await equipmentCollection.deleteOne({ _id: objectId });
      }
    } catch (err) {
      // Se não for ObjectId válido, tenta como equipmentID numérico
      const equipmentID = parseInt(req.params.id, 10);
      if (!isNaN(equipmentID)) {
        deletedEquipment = await equipmentCollection.findOne({ equipmentID: equipmentID });
        if (deletedEquipment) {
          result = await equipmentCollection.deleteOne({ equipmentID: equipmentID });
        }
      }
    }

    if (!result || result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Equipamento não encontrado'
      });
    }

    // Registra log de deleção
    if (req.user) {
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'DELETE',
        entity: 'Equipment',
        entityID: req.params.id,
        result: 'success',
        severity: 'warning',
        message: 'Equipamento deletado',
        req: req,
        module: 'Equipamentos'
      });
    }

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

