const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const logger = require('../../utils/logger');

/**
 * Facility CRUD — dict-02 StorageAssignment.facilityId (ELM-0168, 1..1 Core).
 * Deferred from #418 (models added, no CRUD path); closes that gap (#419).
 * Reads/writes `facilities` directly, same convention as every other
 * admin-config CRUD route in this repo (equipment.routes.js,
 * location.routes.js) — MongoStorageRepository already reads Facility/Room
 * via raw collections rather than the mongoose models added in #418.
 */

function validateFacilityInput(data) {
  const errors = [];
  if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
    errors.push('name é obrigatório');
  }
  return { isValid: errors.length === 0, errors };
}

router.get('/', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const facilities = await db.collection('facilities')
      .find({ deletedAt: null })
      .sort({ name: 1 })
      .toArray();

    return res.status(200).json({ success: true, data: facilities });
  } catch (error) {
    logger.error('Erro ao listar facilities:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar facilities',
      message: error.message
    });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;

    let facility;
    try {
      facility = await db.collection('facilities').findOne({ _id: new ObjectId(req.params.id), deletedAt: null });
    } catch (err) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    if (!facility) {
      return res.status(404).json({ success: false, error: 'Facility não encontrada' });
    }

    return res.status(200).json({ success: true, data: facility });
  } catch (error) {
    logger.error('Erro ao buscar facility:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar facility',
      message: error.message
    });
  }
});

router.post('/', authenticate, requirePermission('createPatient'), async (req, res) => {
  try {
    const db = req.app.locals.db;

    const validation = validateFacilityInput(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Dados inválidos',
        message: validation.errors.join(', ')
      });
    }

    const now = new Date();
    const facility = {
      name: req.body.name.trim(),
      code: req.body.code ?? null,
      address: req.body.address ?? null,
      description: req.body.description ?? null,
      createdBy: req.user?.userID || null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    };

    const result = await db.collection('facilities').insertOne(facility);

    return res.status(201).json({
      success: true,
      message: 'Facility criada com sucesso',
      data: { _id: result.insertedId, ...facility }
    });
  } catch (error) {
    logger.error('Erro ao criar facility:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao criar facility',
      message: error.message
    });
  }
});

router.put('/:id', authenticate, requirePermission('createPatient'), async (req, res) => {
  try {
    const db = req.app.locals.db;

    const updateData = {};
    for (const field of ['name', 'code', 'address', 'description']) {
      if (req.body[field] !== undefined) updateData[field] = req.body[field];
    }
    updateData.updatedAt = new Date();

    let result;
    try {
      result = await db.collection('facilities').findOneAndUpdate(
        { _id: new ObjectId(req.params.id), deletedAt: null },
        { $set: updateData },
        { returnDocument: 'after' }
      );
    } catch (err) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    const facility = result?.value ?? result;
    if (!facility) {
      return res.status(404).json({ success: false, error: 'Facility não encontrada' });
    }

    return res.status(200).json({
      success: true,
      message: 'Facility atualizada com sucesso',
      data: facility
    });
  } catch (error) {
    logger.error('Erro ao atualizar facility:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao atualizar facility',
      message: error.message
    });
  }
});

router.delete('/:id', authenticate, requirePermission('createPatient'), async (req, res) => {
  try {
    const db = req.app.locals.db;

    let result;
    try {
      result = await db.collection('facilities').findOneAndUpdate(
        { _id: new ObjectId(req.params.id), deletedAt: null },
        { $set: { deletedAt: new Date() } },
        { returnDocument: 'after' }
      );
    } catch (err) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    const facility = result?.value ?? result;
    if (!facility) {
      return res.status(404).json({ success: false, error: 'Facility não encontrada' });
    }

    return res.status(200).json({
      success: true,
      message: 'Facility removida com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao remover facility:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao remover facility',
      message: error.message
    });
  }
});

module.exports = router;
