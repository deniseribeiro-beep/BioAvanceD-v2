const express = require('express');
const { ObjectId } = require('mongodb');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const { getCollection } = require('../../utils/collectionResolver');
const OrganizationModel = require('../../models/Organization');

const router = express.Router();
let ensuredIndexes = false;

async function ensureIndexes(collection) {
  if (ensuredIndexes || !collection) return;

  const indexDefinitions = [
    [{ organizationId: 1 }, { name: 'organizations_organization_id_uq', unique: true }],
    [{ normalizedName: 1 }, { name: 'organizations_normalized_name_uq', unique: true }]
  ];

  for (const [keys, options] of indexDefinitions) {
    try {
      await collection.createIndex(keys, options);
    } catch (_) {}
  }

  ensuredIndexes = true;
}

router.get('/', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const collection = await getCollection(db, 'organizations');
    await ensureIndexes(collection);

    const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
    const items = await collection.find({}).sort({ officialName: 1 }).limit(limit).toArray();

    return res.status(200).json({ success: true, data: items });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Erro ao listar organizações', message: error.message });
  }
});

router.post('/', authenticate, requirePermission('manageOrganizations'), async (req, res) => {
  try {
    const payload = {
      officialName: req.body?.officialName,
      acronym: req.body?.acronym,
      organizationType: req.body?.organizationType,
      countryCode: req.body?.countryCode,
      website: req.body?.website,
      contact: req.body?.contact,
      qualityStandards: req.body?.qualityStandards
    };

    const validation = OrganizationModel.validate(payload);
    if (!validation.isValid) {
      return res.status(400).json({ success: false, error: 'Dados inválidos', message: validation.errors.join(', ') });
    }

    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const collection = await getCollection(db, 'organizations');
    await ensureIndexes(collection);

    const document = OrganizationModel.create(payload);

    const existing = await collection.findOne({ normalizedName: document.normalizedName });
    if (existing) {
      return res.status(200).json({ success: true, data: existing, message: 'Organização já existente' });
    }

    const result = await collection.insertOne(document);
    const created = await collection.findOne({ _id: new ObjectId(result.insertedId) });

    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    if (error && error.code === 11000) {
      const db = req.app.locals.db;
      const collection = await getCollection(db, 'organizations');
      const fallback = await collection.findOne({
        normalizedName: OrganizationModel.normalizeName(req.body?.officialName)
      });
      if (fallback) {
        return res.status(200).json({ success: true, data: fallback, message: 'Organização já existente' });
      }
    }

    return res.status(500).json({ success: false, error: 'Erro ao criar organização', message: error.message });
  }
});

module.exports = router;
