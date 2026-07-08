const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const logger = require('../../utils/logger');
const LocationModel = require('../../models/Location');

// CRUD de Localizações

// IMPORTANTE: Rotas específicas devem vir ANTES de rotas com parâmetros (/:id)
// Endpoint para atualizar localizações antigas sem locationID
router.patch('/fix-missing-locationids', authenticate, requirePermission('createSample'), async (req, res) => {
  try {
    const db = req.app.locals.db;

    const locationsCollection = db.collection('locations');

    // Busca localizações sem locationID ou com locationID inválido
    const locationsWithoutID = await locationsCollection.find({
      $or: [
        { locationID: { $exists: false } },
        { locationID: null },
        { locationID: { $type: 'string' } }, // locationID como string
        { locationID: 0 },
        { locationID: { $lt: 1 } } // locationID negativo ou zero
      ]
    }).toArray();

    if (locationsWithoutID.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Todas as localizações já possuem locationID válido',
        updated: 0
      });
    }

    const { generateUniqueLocationID } = require('../../utils/locationIDGenerator');
    let updatedCount = 0;

    // Atualiza cada localização sem locationID
    for (const location of locationsWithoutID) {
      try {
        const newLocationID = await generateUniqueLocationID(db, 'locations');
        
        await locationsCollection.updateOne(
          { _id: location._id },
          { 
            $set: { 
              locationID: newLocationID,
              updatedAt: new Date()
            } 
          }
        );
        
        updatedCount++;
        logger.info(`Localização ${location._id} atualizada com locationID: ${newLocationID}`);
      } catch (error) {
        logger.error(`Erro ao atualizar localização ${location._id}:`, error.message);
      }
    }

    // Registra log de atualização em massa
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'UPDATE',
      entity: 'Location',
      result: 'success',
      severity: 'info',
      message: `Atualização em massa: ${updatedCount} localização(ões) atualizada(s) com locationID`,
      payload: { updated: updatedCount, total: locationsWithoutID.length },
      req: req,
      module: 'Localizações'
    });

    return res.status(200).json({
      success: true,
      message: `${updatedCount} localização(ões) atualizada(s) com locationID válido`,
      updated: updatedCount,
      total: locationsWithoutID.length
    });
  } catch (error) {
    logger.error('Erro ao atualizar localizações sem locationID:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao atualizar localizações',
      message: error.message
    });
  }
});

router.get('/', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const locationsCollection = db.collection('locations');
    const locations = await locationsCollection.find({}).toArray();

    // Registra log de consulta
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      entity: 'Location',
      result: 'success',
      severity: 'info',
      message: `Consulta de localizações - ${locations.length} registros`,
      payload: { total: locations.length },
      req: req,
      module: 'Localizações'
    });

    return res.status(200).json({
      success: true,
      data: locations
    });
  } catch (error) {
    logger.error('Erro ao listar localizações:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar localizações',
      message: error.message
    });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;

    const { ObjectId } = require('mongodb');
    const locationsCollection = db.collection('locations');
    const location = await locationsCollection.findOne({ _id: new ObjectId(req.params.id) });

    if (!location) {
      // Registra tentativa de busca de localização inexistente
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'QUERY',
        entity: 'Location',
        result: 'error',
        severity: 'warning',
        message: `Tentativa de buscar localização inexistente: ${req.params.id}`,
        req: req,
        module: 'Localizações'
      });
      
      return res.status(404).json({
        success: false,
        error: 'Localização não encontrada'
      });
    }

    // Registra log de busca
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      entity: 'Location',
      entityID: req.params.id,
      result: 'success',
      severity: 'info',
      message: 'Localização consultada',
      req: req,
      module: 'Localizações'
    });

    return res.status(200).json({
      success: true,
      data: location
    });
  } catch (error) {
    logger.error('Erro ao buscar localização:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar localização',
      message: error.message
    });
  }
});

router.post('/', authenticate, requirePermission('createSample'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    // Prepara os dados, convertendo strings para números quando necessário
    const locationData = { ...req.body };
    
    // Converte campos numéricos se vierem como string
    if (locationData.equipmentType !== undefined && locationData.equipmentType !== null) {
      locationData.equipmentType = Number(locationData.equipmentType);
    }
    if (locationData.equipmentID !== undefined && locationData.equipmentID !== null) {
      locationData.equipmentID = Number(locationData.equipmentID);
    }
    if (locationData.block !== undefined && locationData.block !== null) {
      locationData.block = Number(locationData.block);
    }
    if (locationData.rack !== undefined && locationData.rack !== null) {
      locationData.rack = Number(locationData.rack);
    }
    if (locationData.drawer !== undefined && locationData.drawer !== null) {
      locationData.drawer = Number(locationData.drawer);
    }
    if (locationData.box !== undefined && locationData.box !== null) {
      locationData.box = Number(locationData.box);
    }

    const validation = LocationModel.validate(locationData);
    if (!validation.isValid) {
      logger.error('Erro de validação na localização:', validation.errors);
      return res.status(400).json({
        success: false,
        error: 'Dados inválidos',
        message: validation.errors.join(', ')
      });
    }

    const locationsCollection = db.collection('locations');
    
    // Gera locationID único se não fornecido
    if (!locationData.locationID) {
      const { generateUniqueLocationID } = require('../../utils/locationIDGenerator');
      locationData.locationID = await generateUniqueLocationID(db, 'locations');
      logger.info(`LocationID gerado automaticamente: ${locationData.locationID}`);
    } else {
      // Verifica se locationID já existe
      const existing = await locationsCollection.findOne({ locationID: Number(locationData.locationID) });
      if (existing) {
        return res.status(400).json({
          success: false,
          error: 'LocationID já existe',
          message: `Já existe uma localização com o locationID ${locationData.locationID}`
        });
      }
    }
    
    const location = LocationModel.create(locationData);

    const result = await locationsCollection.insertOne(location);

    // Registra log de criação
    if (req.user) {
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'CREATE',
        entity: 'Location',
        entityID: result.insertedId.toString(),
        result: 'success',
        severity: 'info',
        message: 'Localização criada',
        payload: { 
          locationID: location.locationID,
          equipmentType: location.equipmentType,
          block: location.block,
          rack: location.rack
        },
        req: req,
        module: 'Localizações'
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Localização criada com sucesso',
      data: { _id: result.insertedId, ...location }
    });
  } catch (error) {
    logger.error('Erro ao criar localização:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao criar localização',
      message: error.message
    });
  }
});

router.put('/:id', authenticate, requirePermission('createSample'), async (req, res) => {
  try {
    const db = req.app.locals.db;

    // Prepara os dados, convertendo strings para números quando necessário
    const updateData = { ...req.body };
    
    // Converte campos numéricos se vierem como string
    if (updateData.equipmentType !== undefined && updateData.equipmentType !== null) {
      updateData.equipmentType = Number(updateData.equipmentType);
    }
    if (updateData.equipmentID !== undefined && updateData.equipmentID !== null) {
      updateData.equipmentID = Number(updateData.equipmentID);
    }
    if (updateData.block !== undefined && updateData.block !== null) {
      updateData.block = Number(updateData.block);
    }
    if (updateData.rack !== undefined && updateData.rack !== null) {
      updateData.rack = Number(updateData.rack);
    }
    if (updateData.drawer !== undefined && updateData.drawer !== null) {
      updateData.drawer = Number(updateData.drawer);
    }
    if (updateData.box !== undefined && updateData.box !== null) {
      updateData.box = Number(updateData.box);
    }
    
    // Converte eppendorfWell para wellPosition se necessário
    if (updateData.eppendorfWell && !updateData.wellPosition) {
      if (Array.isArray(updateData.eppendorfWell)) {
        updateData.wellPosition = `${updateData.eppendorfWell[0]}x${updateData.eppendorfWell[1]}`;
      } else if (typeof updateData.eppendorfWell === 'string') {
        updateData.wellPosition = updateData.eppendorfWell;
      }
      delete updateData.eppendorfWell;
    }

    updateData.updatedAt = new Date();

    const locationsCollection = db.collection('locations');
    const result = await locationsCollection.updateOne(
      { _id: new (require('mongodb').ObjectId)(req.params.id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Localização não encontrada'
      });
    }

    // Registra log de atualização
    if (req.user) {
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'UPDATE',
        entity: 'Location',
        entityID: req.params.id,
        result: 'success',
        severity: 'info',
        message: 'Localização atualizada',
        req: req,
        module: 'Localizações'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Localização atualizada com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao atualizar localização:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao atualizar localização',
      message: error.message
    });
  }
});

router.delete('/:id', authenticate, requirePermission('createSample'), async (req, res) => {
  try {
    const db = req.app.locals.db;

    const { ObjectId } = require('mongodb');
    const locationsCollection = db.collection('locations');
    const result = await locationsCollection.deleteOne({ _id: new ObjectId(req.params.id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Localização não encontrada'
      });
    }

    // Registra log de deleção
    if (req.user) {
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'DELETE',
        entity: 'Location',
        entityID: req.params.id,
        result: 'success',
        severity: 'warning',
        message: 'Localização deletada',
        req: req,
        module: 'Localizações'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Localização deletada com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao deletar localização:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao deletar localização',
      message: error.message
    });
  }
});

module.exports = router;

