const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const logger = require('../../utils/logger');

/**
 * Room CRUD — dict-02 StorageAssignment.roomId (ELM-0169, 1..1 Core).
 * Deferred from #418 (models added, no CRUD path); closes that gap (#419).
 * Reads/writes `rooms` directly, same convention as facility.routes.js.
 */

function validateRoomInput(data) {
  const errors = [];
  if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
    errors.push('name é obrigatório');
  }
  if (!data.facilityId || typeof data.facilityId !== 'string') {
    errors.push('facilityId é obrigatório');
  } else if (!ObjectId.isValid(data.facilityId)) {
    errors.push('facilityId inválido');
  }
  return { isValid: errors.length === 0, errors };
}

router.get('/', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;

    const query = { deletedAt: null };
    if (req.query.facilityId) {
      if (!ObjectId.isValid(req.query.facilityId)) {
        return res.status(400).json({ success: false, error: 'facilityId inválido' });
      }
      query.facilityId = new ObjectId(req.query.facilityId);
    }

    const rooms = await db.collection('rooms').find(query).sort({ name: 1 }).toArray();
    return res.status(200).json({ success: true, data: rooms });
  } catch (error) {
    logger.error('Erro ao listar rooms:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar rooms',
      message: error.message
    });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;

    let room;
    try {
      room = await db.collection('rooms').findOne({ _id: new ObjectId(req.params.id), deletedAt: null });
    } catch (err) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    if (!room) {
      return res.status(404).json({ success: false, error: 'Room não encontrada' });
    }

    return res.status(200).json({ success: true, data: room });
  } catch (error) {
    logger.error('Erro ao buscar room:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar room',
      message: error.message
    });
  }
});

router.post('/', authenticate, requirePermission('createPatient'), async (req, res) => {
  try {
    const db = req.app.locals.db;

    const validation = validateRoomInput(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Dados inválidos',
        message: validation.errors.join(', ')
      });
    }

    const facility = await db.collection('facilities').findOne({
      _id: new ObjectId(req.body.facilityId),
      deletedAt: null
    });
    if (!facility) {
      return res.status(400).json({
        success: false,
        error: 'FACILITY_NOT_FOUND',
        message: 'facilityId deve referenciar uma Facility válida'
      });
    }

    const now = new Date();
    const room = {
      facilityId: new ObjectId(req.body.facilityId),
      name: req.body.name.trim(),
      code: req.body.code ?? null,
      description: req.body.description ?? null,
      createdBy: req.user?.userID || null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    };

    const result = await db.collection('rooms').insertOne(room);

    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'CREATE',
      resourceType: 'Room',
      resourceId: result.insertedId.toString(),
      status: 'success',
      severity: 'info',
      message: 'Room criada',
      payload: { name: room.name, facilityId: room.facilityId.toString() },
      req: req,
      module: 'Armazenamento'
    });

    return res.status(201).json({
      success: true,
      message: 'Room criada com sucesso',
      data: { _id: result.insertedId, ...room }
    });
  } catch (error) {
    logger.error('Erro ao criar room:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao criar room',
      message: error.message
    });
  }
});

router.put('/:id', authenticate, requirePermission('createPatient'), async (req, res) => {
  try {
    const db = req.app.locals.db;

    if (req.body.facilityId !== undefined) {
      if (!ObjectId.isValid(req.body.facilityId)) {
        return res.status(400).json({ success: false, error: 'facilityId inválido' });
      }
      const facility = await db.collection('facilities').findOne({
        _id: new ObjectId(req.body.facilityId),
        deletedAt: null
      });
      if (!facility) {
        return res.status(400).json({
          success: false,
          error: 'FACILITY_NOT_FOUND',
          message: 'facilityId deve referenciar uma Facility válida'
        });
      }
    }

    const updateData = {};
    for (const field of ['name', 'code', 'description']) {
      if (req.body[field] !== undefined) updateData[field] = req.body[field];
    }
    if (req.body.facilityId !== undefined) {
      updateData.facilityId = new ObjectId(req.body.facilityId);
    }
    updateData.updatedAt = new Date();

    let result;
    try {
      result = await db.collection('rooms').findOneAndUpdate(
        { _id: new ObjectId(req.params.id), deletedAt: null },
        { $set: updateData },
        { returnDocument: 'after' }
      );
    } catch (err) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    const room = result?.value ?? result;
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room não encontrada' });
    }

    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'UPDATE',
      resourceType: 'Room',
      resourceId: req.params.id,
      status: 'success',
      severity: 'info',
      message: 'Room atualizada',
      req: req,
      module: 'Armazenamento'
    });

    return res.status(200).json({
      success: true,
      message: 'Room atualizada com sucesso',
      data: room
    });
  } catch (error) {
    logger.error('Erro ao atualizar room:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao atualizar room',
      message: error.message
    });
  }
});

router.delete('/:id', authenticate, requirePermission('createPatient'), async (req, res) => {
  try {
    const db = req.app.locals.db;

    let result;
    try {
      result = await db.collection('rooms').findOneAndUpdate(
        { _id: new ObjectId(req.params.id), deletedAt: null },
        { $set: { deletedAt: new Date() } },
        { returnDocument: 'after' }
      );
    } catch (err) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    const room = result?.value ?? result;
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room não encontrada' });
    }

    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'DELETE',
      resourceType: 'Room',
      resourceId: req.params.id,
      status: 'success',
      severity: 'warning',
      message: 'Room removida',
      req: req,
      module: 'Armazenamento'
    });

    return res.status(200).json({
      success: true,
      message: 'Room removida com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao remover room:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao remover room',
      message: error.message
    });
  }
});

module.exports = router;
