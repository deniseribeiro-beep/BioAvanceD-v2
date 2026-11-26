const express = require('express');
const { randomUUID } = require('crypto');
const { ObjectId } = require('mongodb');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole, requireOrganizationScope } = require('../../infrastructure/middleware/rbac');
const {
  applyOrganizationScopeFilter,
  isRecordInOrganizationScope,
  resolveOrganizationIdForCreate,
  assertOrganizationFieldNotReparented,
} = require('../../services/rbac-assignment.service');

// #1182: `scopeField` opts ONE mount into organization scoping, on the named
// field of its own records. Most of the 14 entities this factory serves are
// shared vocabularies with no organization field in dict-02, so scoping is
// per mount rather than on by default. Assay passes 'laboratoryId' (dict-02
// ELM-0293), the field #644 already scopes its files on.
// `immutableFields`: once set, never changed by PUT. An update naming one
// with a different value answers 422 rather than rewriting it (RF020 AC4: a
// collection's governanceRegime changes only through a governed event). A
// record stored before the field existed may receive its first value.
function createMasterDataRouter({ collectionName, idField, model, validateReferences, generateId = randomUUID, scopeField = null, immutableFields = [] }) {
  const router = express.Router();

  router.use(authenticate);
  if (scopeField) {
    router.use(requireOrganizationScope);
  }

  // #1182: fetch-then-check for the by-id routes, the #340/#623 shape. A
  // post-fetch test rather than a scope-filtered query, so a record in
  // another organization answers 403, not a 404 that hides it.
  async function findScopedRecord(req, res, query) {
    const item = await req.app.locals.db.collection(collectionName).findOne(query);
    if (!item) {
      res.status(404).json({ success: false, error: 'Registro não encontrado' });
      return null;
    }
    if (scopeField && !isRecordInOrganizationScope(item, req.organizationScope, scopeField)) {
      res.status(403).json({ success: false, error: 'Acesso negado', message: 'Este registro pertence a outra organização' });
      return null;
    }
    return item;
  }

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

  // #875: PUT used to build `update = {...req.body, updatedAt}; delete
  // update._id;` then `$set: update` with no filter -- every key the
  // client sent rode straight into $set. The allowlist below is derived
  // mechanically from this entity's own model.create({}) shape (the same
  // property Patient.js's CANONICAL_FIELDS precedent documents) instead of
  // 14 hand-written lists, so a new model field is picked up automatically.
  // Computed once per router construction, not per request.
  //
  // Excluded: createdAt/updatedAt (the PUT handler below owns updatedAt)
  // and idField/_id (immutable business identity). The `id` field (the
  // #881/#899 seeded MIABIS business key) is not a key of any model's
  // create() return at all, so it is excluded from every entity's
  // allowlist without needing a separate filter -- deliberate
  // immutable-identity treatment, not an oversight.
  //
  // Six mounted models throw on an empty `model.create({})` probe. Three
  // spread/map a required array field with no fallback when it's absent
  // (Assay.js:105 specimenIds, Dataset.js:56 creators,
  // OmicsQualification.js:52 qcMetrics), and IdentifierNamespaceRegistry,
  // InteroperabilityMappingRelease and FHIRProfileRegistry refuse any row
  // missing a required field. For those six the allowlist falls back to a
  // hand-enumerated list, derived by reading that model's own create()
  // return keys, keyed by collectionName. The namespace list leaves out
  // namespaceKey and systemUri: RULE-036 keeps the URI stable, so a new
  // version is a new row (#1322). The release list leaves out mappingVersion,
  // since a new mapping version is a new row naming the old one in
  // supersedesReleaseId, and the profile list leaves out canonicalUrl and
  // profileVersion, the key the FHIR validator matches meta.profile on
  // (RF011 AC2, #1322).
  const HAND_ENUMERATED_UPDATE_FIELDS = {
    assays: [
      'studyId', 'specimenIds', 'assayType', 'omicsDomain', 'protocolId',
      'operatorId', 'laboratoryId', 'assayDateTime', 'assayBatchId',
      'controls', 'reagentLotIds', 'equipmentIds', 'intendedUse',
    ],
    datasets: [
      'datasetTitle', 'datasetVersion', 'creators', 'doi', 'license',
      'distributionFiles', 'roCrateManifest',
    ],
    omicsQualifications: [
      'targetAssay', 'qcRuleSetVersion', 'qcMetrics', 'qualificationDecision',
      'limitations',
    ],
    identifierNamespaceRegistries: [
      'authorityDomain', 'targetTypes', 'semanticVersion', 'status',
      'effectivePeriod', 'configurationReleaseId',
    ],
    interoperabilityMappingReleases: [
      'standard', 'profile', 'mappingUri', 'checksum', 'authorId', 'status',
      'roundTripLossReportUri', 'canonicalModelReleaseId', 'fhirVersion',
      'implementationGuideCanonical', 'implementationGuideVersion',
      'jurisdiction', 'profileRegistryIds', 'resourceTypes',
      'identifierNamespaceRegistryIds', 'terminologyReleaseIds',
      'mappingDefinitionUri', 'mappingDefinitionHash',
      'conformanceTestReportUri', 'coverageNumerator', 'coverageDenominator',
      'coverageRatio', 'roundTripLossesPresent', 'approvedBy', 'approvedAt',
      'effectivePeriod', 'supersedesReleaseId',
    ],
    fhirProfileRegistries: [
      'fhirVersion', 'identifierSystems', 'capabilityStatementUri',
      'mappingReleaseId', 'status',
    ],
  };

  const allowedUpdateFields = HAND_ENUMERATED_UPDATE_FIELDS[collectionName]
    || Object.keys(model.create({})).filter(
      (key) => key !== 'createdAt' && key !== 'updatedAt' && key !== idField && key !== '_id'
    );

  router.get('/', async (req, res) => {
    try {
      const db = req.app.locals.db;

      let listQuery = scopeField ? applyOrganizationScopeFilter({}, req.organizationScope, scopeField) : {};
      const rawQ = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (rawQ) {
        const safe = rawQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx = new RegExp(safe, 'i');
        listQuery = {
          ...listQuery,
          $or: [
            { [idField]: rx },
            { 'analyte.code': rx },
            { 'analyte.display': rx },
            { 'associatedCondition.code': rx },
            { 'associatedCondition.display': rx },
          ],
        };
      }
      // Optional limit keeps large catalogs (e.g. biomarkerAssociations post-G1) usable.
      const parsedLimit = Number.parseInt(String(req.query.limit || ''), 10);
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 5000)
        : null;
      let cursor = db.collection(collectionName).find(listQuery).sort({ createdAt: -1, _id: -1 });
      if (limit != null) cursor = cursor.limit(limit);
      const items = await cursor.toArray();
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

      const item = await findScopedRecord(req, res, query);
      if (!item) return undefined;

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
      // #1182: an organization-scoped caller creates in its own organization,
      // whatever the body names (#1071's rule for every other scoped create).
      if (scopeField) {
        payload[scopeField] = resolveOrganizationIdForCreate(req.organizationScope, req.body?.[scopeField]);
      }
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
      // #1402: a unique index on a master-data collection refuses the insert with E11000; that is a conflict, not a server error.
      if (error?.code === 11000) return res.status(409).json({ success: false, error: 'Registro duplicado', message: `${idField} já existe` });
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
      const body = req.body || {};

      // #1400: the stored row is read for every mount, since the edit is
      // validated merged into it below. The scope check runs only when the
      // mount sets scopeField.
      const existing = await findScopedRecord(req, res, query);
      if (!existing) return undefined;
      if (scopeField) {
        // #1182: the check above is the SOURCE; this is the destination.
        assertOrganizationFieldNotReparented(req.organizationScope, existing[scopeField], body[scopeField], scopeField);
      }

      const changedImmutable = immutableFields.filter((key) => Object.prototype.hasOwnProperty.call(body, key));
      if (changedImmutable.length > 0) {
        const refused = changedImmutable.filter(
          (key) => existing[key] !== undefined && existing[key] !== null && existing[key] !== body[key]
        );
        if (refused.length > 0) {
          const message = `${refused.join(', ')} não pode ser alterado por edição`;
          return res.status(422).json({
            success: false,
            error: 'Campo imutável',
            message,
            details: [message],
          });
        }
      }

      const update = { updatedAt: new Date() };
      for (const key of allowedUpdateFields) {
        if (Object.prototype.hasOwnProperty.call(body, key)) {
          update[key] = body[key];
        }
      }

      // #1400: an edit must not store a record the model refuses at create,
      // so the stored row merged with this update is validated as POST
      // validates its payload. Only `update` is written; the merge is never $set.
      const merged = { ...existing, ...update };
      const mergedValidation = model.validate(merged);
      if (!mergedValidation.isValid) {
        return res.status(422).json({ success: false, error: 'Payload inválido', details: mergedValidation.errors });
      }

      // #1221: the create path's #664 reference check, over the keys this
      // update carries. Without it an edit could point a record at a
      // specimen, protocol, operator or lot that does not exist.
      if (validateReferences) {
        await validateReferences(db, update);
      }

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
      // #1182: a refused re-parent throws statusCode:403.
      if (error.statusCode === 403) {
        return res.status(403).json({ success: false, error: 'Acesso negado', message: error.message });
      }
      // #1221: an unresolved reference throws statusCode:404, as on create.
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, error: error.message, message: error.message });
      }
      return res.status(500).json({ success: false, error: 'Erro ao atualizar dado mestre', message: error.message });
    }
  });

  router.delete('/:id', requireRole(3, 4), async (req, res) => {
    try {
      const db = req.app.locals.db;

      const rawId = String(req.params.id);
      const query = buildIdQuery(rawId);

      if (scopeField && !(await findScopedRecord(req, res, query))) return undefined;

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
