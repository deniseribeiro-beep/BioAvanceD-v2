const express = require('express');
const { randomUUID } = require('crypto');
const { ObjectId } = require('mongodb');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole } = require('../../infrastructure/middleware/rbac');

function createMasterDataRouter({ collectionName, idField, model, validateReferences, generateId = randomUUID }) {
  const router = express.Router();

  router.use(authenticate);

  // #881: seeded rows carry a string business key on `id` (e.g. "PLASMA"),
  // separate from the collection's own `idField` (e.g. "sampleTypeID").
  // The `{ id: rawId }` branch is purely additive -- it does not touch the
  // existing `_id` / numeric-idField / string-idField branches, so any
  // caller relying on those keeps working exactly as before.
  function buildIdQuery(rawId) {
    const numericId = Number(rawId);
    return {
      $or: [
        ...(ObjectId.isValid(rawId) ? [{ _id: new ObjectId(rawId) }] : []),
        ...(Number.isFinite(numericId) ? [{ [idField]: numericId }] : []),
        { [idField]: rawId },
        { id: rawId },
      ],
    };
  }

  router.get('/', async (req, res) => {
    try {
      const db = req.app.locals.db;

      const items = await db.collection(collectionName).find({}).sort({ createdAt: -1, _id: -1 }).toArray();
      return res.status(200).json({ success: true, data: items });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Erro ao listar dados mestre', message: error.message });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const db = req.app.locals.db;

      const rawId = String(req.params.id);
      const query = buildIdQuery(rawId);

      const item = await db.collection(collectionName).findOne(query);
      if (!item) {
        return res.status(404).json({ success: false, error: 'Registro não encontrado' });
      }

      return res.status(200).json({ success: true, data: item });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Erro ao buscar dado mestre', message: error.message });
    }
  });

  router.post('/', requireRole(3, 4), async (req, res) => {
    try {
      const db = req.app.locals.db;

      const payload = {
        ...req.body,
        // #896/#876: randomUUID(), not Date.now(). Settled by the canonical
        // dictionary rather than by inference -- dict-02 ELM-0298 types
        // ReagentLot.reagentId as `uuid`, and near every other entity's
        // identifier in that table is `uuid` too. An epoch millisecond is not
        // the specified shape.
        //
        // The bare Date.now() also emitted a NUMBER, which every consumer
        // rejects: Assay.js:86 answers `reagentLotIds deve conter apenas
        // strings nao vazias`, i.e. two e2e gate failures. Several of these
        // models (ReagentLot.js:43 among them) already default to
        // randomUUID() on their own -- this fallback was pre-empting the
        // model's correct, dict-02-aligned default with a wrong-typed value.
        //
        // Backward compatible: buildIdQuery above $or's over BOTH a numeric
        // and a string idField, so rows already written with an epoch number
        // keep resolving. Nothing sorts or compares these numerically (the
        // list route sorts on createdAt/_id).
        [idField]: req.body?.[idField] ?? generateId(),
      };
      const validation = model.validate(payload);
      if (!validation.isValid) {
        return res.status(422).json({ success: false, error: 'Payload inválido', details: validation.errors });
      }

      // #664: optional per-entity referential-integrity check (e.g. Assay's
      // specimen/protocol/operator/laboratory/reagentLot/equipment links) --
      // runs after format validation, before the document is created.
      if (validateReferences) {
        await validateReferences(db, payload);
      }

      const document = model.create(payload);
      const result = await db.collection(collectionName).insertOne(document);
      return res.status(201).json({ success: true, data: { _id: result.insertedId, ...document } });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, error: error.message, message: error.message });
      }
      return res.status(500).json({ success: false, error: 'Erro ao criar dado mestre', message: error.message });
    }
  });

  router.put('/:id', requireRole(3, 4), async (req, res) => {
    try {
      const db = req.app.locals.db;

      const rawId = String(req.params.id);
      const query = buildIdQuery(rawId);
      const update = { ...req.body, updatedAt: new Date() };
      delete update._id;

      const result = await db.collection(collectionName).findOneAndUpdate(
        query,
        { $set: update },
        { returnDocument: 'after' }
      );

      if (!result) {
        return res.status(404).json({ success: false, error: 'Registro não encontrado' });
      }

      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Erro ao atualizar dado mestre', message: error.message });
    }
  });

  router.delete('/:id', requireRole(3, 4), async (req, res) => {
    try {
      const db = req.app.locals.db;

      const rawId = String(req.params.id);
      const query = buildIdQuery(rawId);

      const result = await db.collection(collectionName).deleteOne(query);
      if (result.deletedCount === 0) {
        return res.status(404).json({ success: false, error: 'Registro não encontrado' });
      }

      return res.status(200).json({ success: true, message: 'Registro removido' });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Erro ao remover dado mestre', message: error.message });
    }
  });

  return router;
}

module.exports = createMasterDataRouter;
