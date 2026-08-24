const express = require('express');
const { ObjectId } = require('mongodb');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const ReportTemplateModel = require('../../models/ReportTemplate');
const logger = require('../../utils/logger');

router.use(authenticate);

function resolveTemplateQuery(id) {
  const rawId = String(id);
  return {
    $or: [
      ...(ObjectId.isValid(rawId) ? [{ _id: new ObjectId(rawId) }] : []),
      { code: rawId },
    ],
  };
}

function actingUserRef(req) {
  const userId = req.user?.userID || req.user?._id;
  return userId ? `User/${userId}` : null;
}

// #726 (RF008 AC#6): any viewReports holder can list/select templates when
// generating a report -- only creating/editing them is Coordenador/
// Administrador-gated, via manageReportTemplates below.
router.get('/', requirePermission('viewReports'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const templates = await db.collection('reportTemplates').find({}).sort({ isSystemDefined: -1, name: 1 }).toArray();
    return res.status(200).json({ success: true, data: templates });
  } catch (error) {
    logger.error('Erro ao listar modelos de relatório:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao listar modelos de relatório', message: error.message });
  }
});

router.get('/:id', requirePermission('viewReports'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const template = await db.collection('reportTemplates').findOne(resolveTemplateQuery(req.params.id));
    if (!template) {
      return res.status(404).json({ success: false, error: 'Modelo de relatório não encontrado' });
    }

    return res.status(200).json({ success: true, data: template });
  } catch (error) {
    logger.error('Erro ao buscar modelo de relatório:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao buscar modelo de relatório', message: error.message });
  }
});

router.post('/', requirePermission('manageReportTemplates'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const validation = ReportTemplateModel.validate(req.body || {});
    if (!validation.isValid) {
      return res.status(422).json({ success: false, error: 'Payload inválido', details: validation.errors });
    }

    const collection = db.collection('reportTemplates');
    const code = String(req.body.code || '').trim().toLowerCase();
    const existing = await collection.findOne({ code });
    if (existing) {
      return res.status(409).json({ success: false, error: 'Já existe um modelo de relatório com este código' });
    }

    const document = ReportTemplateModel.create({
      ...req.body,
      isSystemDefined: false,
      createdBy: actingUserRef(req),
    });
    const result = await collection.insertOne(document);
    return res.status(201).json({ success: true, data: { _id: result.insertedId, ...document } });
  } catch (error) {
    logger.error('Erro ao criar modelo de relatório:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao criar modelo de relatório', message: error.message });
  }
});

router.put('/:id', requirePermission('manageReportTemplates'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const collection = db.collection('reportTemplates');
    const existing = await collection.findOne(resolveTemplateQuery(req.params.id));
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Modelo de relatório não encontrado' });
    }

    // `code` is the template's stable business key -- immutable after creation,
    // same as roleCode/permissionCode elsewhere in this RBAC/catalog family.
    const merged = {
      ...existing,
      ...req.body,
      code: existing.code,
    };

    const validation = ReportTemplateModel.validate(merged);
    if (!validation.isValid) {
      return res.status(422).json({ success: false, error: 'Payload inválido', details: validation.errors });
    }

    const update = {
      name: merged.name,
      description: merged.description ?? null,
      handlerKey: merged.handlerKey,
      handlerOptions: merged.handlerOptions && typeof merged.handlerOptions === 'object' ? merged.handlerOptions : {},
      templateStatus: merged.templateStatus || 'active',
      updatedBy: actingUserRef(req),
      updatedAt: new Date(),
    };

    const result = await collection.findOneAndUpdate(
      { _id: existing._id },
      { $set: update },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ success: false, error: 'Modelo de relatório não encontrado' });
    }

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    logger.error('Erro ao atualizar modelo de relatório:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao atualizar modelo de relatório', message: error.message });
  }
});

router.delete('/:id', requirePermission('manageReportTemplates'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const collection = db.collection('reportTemplates');
    const existing = await collection.findOne(resolveTemplateQuery(req.params.id));
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Modelo de relatório não encontrado' });
    }

    // Seeded rows back the report types already in production use
    // (reports.routes.js's buildPreviewData) -- removing one would break
    // report generation for that type until buildPreviewData is repointed
    // onto templates (see ReportTemplate.js's header comment).
    if (existing.isSystemDefined) {
      return res.status(400).json({ success: false, error: 'Modelos de relatório do sistema não podem ser removidos' });
    }

    await collection.deleteOne({ _id: existing._id });
    return res.status(200).json({ success: true, message: 'Modelo de relatório removido com sucesso' });
  } catch (error) {
    logger.error('Erro ao remover modelo de relatório:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao remover modelo de relatório', message: error.message });
  }
});

module.exports = router;
