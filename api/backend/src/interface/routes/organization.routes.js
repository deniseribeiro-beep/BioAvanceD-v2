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
    // #1280: an offset, so a client can read past the first page. _id breaks
    // ties so consecutive pages neither repeat nor skip a row.
    const skip = Math.max(0, Math.floor(Number(req.query.skip)) || 0);
    const items = await collection.find({}).sort({ officialName: 1, _id: 1 }).skip(skip).limit(limit).toArray();

    return res.status(200).json({ success: true, data: items });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Erro ao listar organizações', message: error.message });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const collection = await getCollection(db, 'organizations');
    const query = buildIdQuery(String(req.params.id));

    const item = await collection.findOne(query);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Organização não encontrada' });
    }

    return res.status(200).json({ success: true, data: item });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Erro ao buscar organização', message: error.message });
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
      return res.status(422).json({ success: false, error: 'Dados inválidos', message: validation.errors.join(', ') });
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

function buildIdQuery(rawId) {
  return {
    $or: [
      ...(ObjectId.isValid(rawId) ? [{ _id: new ObjectId(rawId) }] : []),
      { organizationId: rawId }
    ]
  };
}

// #1284: every record that names an organization by its organizationId
// (a UUID string, never the Mongo _id), with the field it uses. Keys go
// through getCollection where the collection is canonical, raw names
// otherwise, as their own routes resolve them.
const ORGANIZATION_REFERENCES = [
  { label: 'equipment', name: 'equipment', filter: (id) => ({ organizationId: id }) },
  { label: 'sensors', name: 'sensors', filter: (id) => ({ organizationId: id }) },
  { label: 'temperatures', name: 'temperatures', filter: (id) => ({ organizationId: id }) },
  // A sensor's delete is a hard delete that leaves its alerts, and the alert
  // read is scoped by this organizationId, so alerts outlive their sensor.
  { label: 'alerts', name: 'alerts', filter: (id) => ({ organizationId: id }) },
  { label: 'samples', canonicalKey: 'samples', filter: (id) => ({ collectionSite: id }) },
  { label: 'assays', name: 'assays', filter: (id) => ({ laboratoryId: id }) },
  { label: 'users', name: 'users', filter: (id) => ({ $or: [{ organizationId: id }, { organizationIds: id }] }) },
  { label: 'reports', name: 'reports', filter: (id) => ({ organizationIds: id }) },
  { label: 'patients', canonicalKey: 'patients', filter: (id) => ({ clinicalUnitId: id }) },
  { label: 'userRoleAssignments', canonicalKey: 'userRoleAssignments', filter: (id) => ({ scopeType: 'organization', scopeId: id }) }
];

async function findOrganizationReferences(db, organizationId) {
  if (!organizationId) return [];
  const id = String(organizationId);
  const counts = await Promise.all(ORGANIZATION_REFERENCES.map(async (ref) => {
    const collection = ref.canonicalKey ? await getCollection(db, ref.canonicalKey) : db.collection(ref.name);
    return collection.countDocuments(ref.filter(id), { limit: 1 });
  }));
  return ORGANIZATION_REFERENCES.filter((_, i) => counts[i] > 0).map((ref) => ref.label);
}

router.put('/:id', authenticate, requirePermission('manageOrganizations'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const collection = await getCollection(db, 'organizations');
    await ensureIndexes(collection);

    const query = buildIdQuery(String(req.params.id));
    const existing = await collection.findOne(query);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Organização não encontrada' });
    }

    const payload = {
      officialName: req.body?.officialName ?? existing.officialName,
      acronym: req.body?.acronym ?? existing.acronym,
      organizationType: req.body?.organizationType ?? existing.organizationType,
      countryCode: req.body?.countryCode ?? existing.countryCode,
      website: req.body?.website ?? existing.website,
      contact: req.body?.contact ?? existing.contact,
      qualityStandards: req.body?.qualityStandards ?? existing.qualityStandards
    };

    const validation = OrganizationModel.validate(payload);
    if (!validation.isValid) {
      return res.status(422).json({ success: false, error: 'Dados inválidos', message: validation.errors.join(', ') });
    }

    const update = {
      officialName: String(payload.officialName).trim().replace(/\s+/g, ' '),
      normalizedName: OrganizationModel.normalizeName(payload.officialName),
      acronym: payload.acronym ? String(payload.acronym).trim() : null,
      organizationType: payload.organizationType || null,
      countryCode: String(payload.countryCode).trim().toUpperCase(),
      website: payload.website ? String(payload.website).trim() : null,
      contact: payload.contact || null,
      qualityStandards: Array.isArray(payload.qualityStandards) ? payload.qualityStandards : [],
      updatedAt: new Date()
    };

    const result = await collection.findOneAndUpdate(query, { $set: update }, { returnDocument: 'after' });
    if (!result) {
      return res.status(404).json({ success: false, error: 'Organização não encontrada' });
    }

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, error: 'Já existe uma organização com esse nome' });
    }

    return res.status(500).json({ success: false, error: 'Erro ao atualizar organização', message: error.message });
  }
});

router.delete('/:id', authenticate, requirePermission('manageOrganizations'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const collection = await getCollection(db, 'organizations');
    const query = buildIdQuery(String(req.params.id));

    const existing = await collection.findOne(query);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Organização não encontrada' });
    }

    // #1284: a delete used to leave every record naming the organization
    // pointing at nothing, tenancy keys included. dict-02 gives Organization
    // no status element, so there is no deactivation to fall back on: the
    // delete is refused while anything still references it.
    const references = await findOrganizationReferences(db, existing.organizationId);
    if (references.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Organização em uso',
        message: `A organização é referenciada por: ${references.join(', ')}`,
        references
      });
    }

    const result = await collection.deleteOne({ _id: existing._id });
    if (!result || result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Organização não encontrada' });
    }

    return res.status(200).json({ success: true, message: 'Organização removida' });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Erro ao remover organização', message: error.message });
  }
});

module.exports = router;
