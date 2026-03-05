const express = require('express');
const { ObjectId } = require('mongodb');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const { getCollection } = require('../../utils/collectionResolver');
const ClinicalUnitModel = require('../../models/ClinicalUnit');

const router = express.Router();
let ensuredIndexes = false;

async function ensureIndexes(collection) {
  if (ensuredIndexes || !collection) return;

  const indexDefinitions = [
    [{ normalizedName: 1 }, { name: 'clinical_units_normalized_name_uq', unique: true }],
    [{ name: 'text' }, { name: 'clinical_units_name_text' }],
    [{ active: 1, name: 1 }, { name: 'clinical_units_active_name_idx' }]
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

    const collection = await getCollection(db, 'clinicalUnits');
    await ensureIndexes(collection);

    const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
    const query = includeInactive ? {} : { active: { $ne: false } };

    const items = await collection.find(query).sort({ name: 1 }).limit(limit).toArray();

    return res.status(200).json({ success: true, data: items });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Erro ao listar unidades clínicas', message: error.message });
  }
});

router.get('/search', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const collection = await getCollection(db, 'clinicalUnits');
    await ensureIndexes(collection);

    const rawTerm = String(req.query.q || '').trim();
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 10, 50));

    if (!rawTerm) {
      const items = await collection
        .find({ active: { $ne: false } })
        .sort({ name: 1 })
        .limit(limit)
        .toArray();

      return res.status(200).json({ success: true, data: items });
    }

    const normalizedTerm = ClinicalUnitModel.normalizeName(rawTerm);
    let textMatches = [];

    if (rawTerm.length >= 3) {
      try {
        textMatches = await collection
          .find(
            { $text: { $search: rawTerm }, active: { $ne: false } },
            { projection: { score: { $meta: 'textScore' }, name: 1, acronym: 1, normalizedName: 1, active: 1 } }
          )
          .sort({ score: { $meta: 'textScore' }, name: 1 })
          .limit(limit)
          .toArray();
      } catch (_) {
        textMatches = [];
      }
    }

    if (textMatches.length >= limit) {
      return res.status(200).json({ success: true, data: textMatches });
    }

    const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const regexMatches = await collection
      .find({
        active: { $ne: false },
        $or: [
          { normalizedName: { $regex: `^${escaped}`, $options: 'i' } },
          { name: { $regex: escaped, $options: 'i' } },
          { acronym: { $regex: `^${escaped}`, $options: 'i' } }
        ]
      })
      .sort({ name: 1 })
      .limit(limit)
      .toArray();

    const merged = [];
    const seenIds = new Set();

    [...textMatches, ...regexMatches].forEach((item) => {
      const key = String(item._id);
      if (seenIds.has(key)) return;
      seenIds.add(key);
      merged.push(item);
    });

    return res.status(200).json({ success: true, data: merged.slice(0, limit) });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Erro ao buscar unidades clínicas', message: error.message });
  }
});

router.post('/', authenticate, requirePermission('createPatient'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const payload = {
      name: req.body?.name,
      active: req.body?.active
    };

    const validation = ClinicalUnitModel.validate(payload);
    if (!validation.isValid) {
      return res.status(400).json({ success: false, error: 'Dados inválidos', message: validation.errors.join(', ') });
    }

    const collection = await getCollection(db, 'clinicalUnits');
    await ensureIndexes(collection);

    const document = ClinicalUnitModel.create(payload);

    const existing = await collection.findOne({ normalizedName: document.normalizedName });
    if (existing) {
      return res.status(200).json({ success: true, data: existing, message: 'Unidade clínica já existente' });
    }

    const result = await collection.insertOne(document);
    const created = await collection.findOne({ _id: new ObjectId(result.insertedId) });

    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    if (error && error.code === 11000) {
      const db = req.app.locals.db;
      const collection = await getCollection(db, 'clinicalUnits');
      const fallback = await collection.findOne({ normalizedName: ClinicalUnitModel.normalizeName(req.body?.name) });
      if (fallback) {
        return res.status(200).json({ success: true, data: fallback, message: 'Unidade clínica já existente' });
      }
    }

    return res.status(500).json({ success: false, error: 'Erro ao criar unidade clínica', message: error.message });
  }
});

module.exports = router;
