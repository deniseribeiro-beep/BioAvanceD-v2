const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission, requireOrganizationScope } = require('../../infrastructure/middleware/rbac');
const { isSampleInOrganizationScope, applySampleOrganizationScope } = require('../../services/sampleTenancy.service');
const { enforceCommercialConsent } = require('../../infrastructure/middleware/consent.enforcement');
const logger = require('../../utils/logger');
const { getCollection } = require('../../utils/collectionResolver');
const ResultModel = require('../../models/Result');
const { STORAGE_BASE } = require('../../config/uploadConfig');

// #910: Result carries no organization field of its own (see models/Result.js
// create()), so scope is reached through the join Result.specimenId ->
// the sample's tenancy key (#1192: organizationId, falling back to
// collectionSite; see services/sampleTenancy.service.js) -- the same key
// sample-file.controller.js scopes on.
//
// Fails CLOSED: a result whose specimenId resolves to no sample is out of
// scope for anyone who is not 'global', matching isSampleInOrganizationScope's
// own treatment of a sample with no tenancy key. An orphaned
// result is exactly the case an attacker would reach for otherwise.
const isResultInOrganizationScope = async (db, result, scope) => {
  if (!scope || scope.scope === 'global') return true;
  if (!result || !result.specimenId) return false;
  const sample = await getCollection(db, 'samples').findOne({ specimenId: result.specimenId });
  if (!sample) return false;
  return isSampleInOrganizationScope(sample, scope);
};

const denyOutOfScope = (res) => res.status(403).json({
  success: false,
  error: 'Acesso negado',
  message: 'Este resultado pertence a outra organização'
});

const getResultFileType = (fileName) => {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.pdf') return 'PDF';
  if (ext === '.zip') return 'ZIP';
  if (ext === '.csv') return 'CSV';
  if (ext === '.raw') return 'RAW';
  return null;
};

const resultStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const { specimenId } = req.body;
      if (!specimenId) {
        return cb(new Error('specimenId é obrigatório'), null);
      }

      // #893: derived from STORAGE_BASE (env STORAGE_DIR, defaulting to the
      // same __dirname-relative path as before) so a read_only:true deployment
      // can mount a writable volume outside the application directory.
      const resultDir = path.join(STORAGE_BASE, 'results', String(specimenId));
      if (!fs.existsSync(resultDir)) {
        fs.mkdirSync(resultDir, { recursive: true });
      }
      cb(null, resultDir);
    } catch (error) {
      cb(error, null);
    }
  },
  filename: (req, file, cb) => {
    try {
      const ext = path.extname(file.originalname);
      const baseName = path.basename(file.originalname, ext);
      const sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const uniqueId = crypto.randomBytes(16).toString('hex');
      const finalFileName = `${sanitizedBaseName}_${uniqueId}${ext}`;
      cb(null, finalFileName);
    } catch (error) {
      cb(error, null);
    }
  }
});

const resultUpload = multer({
  storage: resultStorage,
  fileFilter: (req, file, cb) => {
    const fileType = getResultFileType(file.originalname);
    if (!fileType) {
      return cb(new Error('Formato de arquivo inválido. Apenas PDF, ZIP, CSV ou RAW são permitidos.'), false);
    }
    cb(null, true);
  },
  limits: { fileSize: 100 * 1024 * 1024 }
});

// CRUD de Arquivos de Analise
router.get('/', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;

    const resultsCollection = db.collection('results');
    const query = {};

    // #910: this list carried `authenticate` only, so any authenticated
    // principal -- including Usuario Externo, whose documented entitlement is
    // "somente dados e relatorios previamente autorizados" (RF002 AC#4) --
    // could enumerate every analysis result. Narrowed to the specimenIds whose
    // sample is in the caller's organization scope; 'global' is left unfiltered,
    // the same bypass every other RBAC gate gives Administrador.
    if (req.organizationScope && req.organizationScope.scope !== 'global') {
      const inScopeSpecimenIds = await getCollection(db, 'samples')
        .distinct('specimenId', applySampleOrganizationScope({}, req.organizationScope));
      query.specimenId = { $in: inScopeSpecimenIds };
    }

    if (req.query.importJobID) {
      query.importJobID = req.query.importJobID;
    }

    const results = await resultsCollection.find(query).toArray();

    // Registra log de consulta
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      resourceType: 'Result',
      status: 'success',
      severity: 'info',
      message: `Consulta de arquivos de analise - ${results.length} registros`,
      payload: { total: results.length, filters: query },
      req: req,
      module: 'Arquivos de Analise'
    });

    return res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    logger.error('Erro ao listar arquivos de analise:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar arquivos de analise',
      message: error.message
    });
  }
});

router.post('/upload', authenticate, requirePermission('uploadFiles'), requireOrganizationScope, resultUpload.single('file'), enforceCommercialConsent({ resolveSampleId: (req) => req.body?.specimenId }), async (req, res) => {
  try {
    const db = req.app.locals.db;

    const { specimenId, description, method, responsibleResearcher, equipmentID, equipmentName, analysisType } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        error: 'Arquivo não fornecido'
      });
    }

    // #628: resolve the referenced Sample first, then store its own
    // specimenId (business identifier) on the Result -- never the
    // caller-supplied identifier verbatim, whatever shape it's in.
    // Tries _id, then the canonical specimenId. The legacy numeric sampleID
    // tier is gone: nothing writes that key to the samples collection.
    const samplesCollection = getCollection(db, 'samples');
    const { ObjectId } = require('mongodb');
    let sample = null;
    if (ObjectId.isValid(String(specimenId))) {
      sample = await samplesCollection.findOne({ _id: new ObjectId(specimenId) });
    }
    if (!sample) {
      sample = await samplesCollection.findOne({ specimenId: String(specimenId) });
    }

    if (!sample) {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      return res.status(404).json({
        success: false,
        error: 'Amostra não encontrada'
      });
    }

    // #1082: the destination sample must be in the caller's scope, or an
    // upload is a way to plant a result inside another organization. Placed
    // with the other post-resolution guards so it owes the same temp-file
    // cleanup they do.
    if (!isSampleInOrganizationScope(sample, req.organizationScope)) {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      return denyOutOfScope(res);
    }

    const fileType = getResultFileType(file.originalname);
    if (!fileType) {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      return res.status(400).json({
        success: false,
        error: 'Tipo de arquivo inválido'
      });
    }

    if (method && !ResultModel.ANALYSIS_METHODS.includes(method)) {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      return res.status(400).json({
        success: false,
        error: 'Invalid Analysis Method'
      });
    }

    const resultsCollection = db.collection('results');
    const resultPayload = {
      specimenId: sample.specimenId,
      fileType,
      resultFilePath: file.path,
      filePath: file.path,
      description: description || null,
      analysisType: analysisType || null,
      method: method || null,
      responsibleResearcher: responsibleResearcher || null,
      equipmentID: equipmentID ? Number(equipmentID) : null,
      equipmentName: equipmentName || null,
      fileSize: file.size,
      uploadedAt: new Date()
    };

    const validation = ResultModel.validate(resultPayload);
    if (!validation.isValid) {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      return res.status(422).json({
        success: false,
        error: 'Dados inválidos',
        message: validation.errors.join(', '),
        details: validation.errors
      });
    }

    const result = ResultModel.create(resultPayload);
    const insertResult = await resultsCollection.insertOne(result);

    if (req.user) {
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'CREATE',
        resourceType: 'Result',
        resourceId: insertResult.insertedId.toString(),
        status: 'success',
        severity: 'info',
        message: 'Arquivo de analise criado via upload',
        payload: { specimenId: result.specimenId || null },
        req: req,
        module: 'Arquivos de Analise'
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Arquivo de analise criado com sucesso',
      data: { _id: insertResult.insertedId, ...result }
    });
  } catch (error) {
    logger.error('Erro ao fazer upload de arquivo de analise:', error.message);
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        logger.error('Erro ao remover arquivo temporário:', unlinkError.message);
      }
    }
    return res.status(400).json({
      success: false,
      error: 'Erro ao fazer upload de arquivo de analise',
      message: error.message
    });
  }
});

router.get('/:id', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;

    const { ObjectId } = require('mongodb');
    const resultsCollection = db.collection('results');
    const result = await resultsCollection.findOne({ _id: new ObjectId(req.params.id) });

    if (!result) {
      // Registra tentativa de busca de resultado inexistente
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'QUERY',
        resourceType: 'Result',
        status: 'error',
        severity: 'warning',
        message: `Tentativa de buscar arquivo de analise inexistente: ${req.params.id}`,
        req: req,
        module: 'Arquivos de Analise'
      });
      
      return res.status(404).json({
        success: false,
        error: 'Arquivo de analise não encontrado'
      });
    }

    // #910: post-fetch 403 rather than a filtered query, matching
    // sample.routes.js's #624/#340 precedent -- an out-of-scope record that
    // exists 403s rather than 404s.
    if (!(await isResultInOrganizationScope(db, result, req.organizationScope))) {
      return denyOutOfScope(res);
    }

    // Registra log de busca
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      resourceType: 'Result',
      resourceId: req.params.id,
      status: 'success',
      severity: 'info',
      message: 'Arquivo de analise consultado',
      req: req,
      module: 'Arquivos de Analise'
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Erro ao buscar arquivo de analise:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar arquivo de analise',
      message: error.message
    });
  }
});

router.get('/:id/download', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;

    const { ObjectId } = require('mongodb');
    const resultsCollection = db.collection('results');
    const result = await resultsCollection.findOne({ _id: new ObjectId(req.params.id) });

    if (!result) {
      // Registra tentativa de download de resultado inexistente
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'DOWNLOAD',
        resourceType: 'Result',
        status: 'error',
        severity: 'warning',
        message: `Tentativa de download de arquivo de analise inexistente: ${req.params.id}`,
        req: req,
        module: 'Arquivos de Analise'
      });
      
      return res.status(404).json({
        success: false,
        error: 'Arquivo de analise não encontrado'
      });
    }

    // #910: the scope check goes BEFORE the success audit, before the
    // external-URL redirect and before res.download -- otherwise an
    // out-of-scope caller still learns the external URL, or gets the bytes.
    // This is the sharp leg of #910: the payload here is the analysis data
    // itself, not a summary.
    if (!(await isResultInOrganizationScope(db, result, req.organizationScope))) {
      return denyOutOfScope(res);
    }

    // Registra log de download
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'DOWNLOAD',
      resourceType: 'Result',
      resourceId: req.params.id,
      status: 'success',
      severity: 'info',
      message: 'Download de arquivo de analise solicitado',
      req: req,
      module: 'Arquivos de Analise'
    });

    // Se for URL externa, redireciona
    if (result.filePath && result.filePath.startsWith('http')) {
      return res.status(200).json({
        redirect: true,
        url: result.filePath
      });
    }

    if (result.filePath) {
      const resolvedPath = path.resolve(result.filePath);
      if (fs.existsSync(resolvedPath)) {
        return res.download(resolvedPath);
      }
    }

    return res.status(404).json({
      success: false,
      error: 'Arquivo de analise não encontrado'
    });
  } catch (error) {
    logger.error('Erro ao fazer download:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao fazer download',
      message: error.message
    });
  }
});

router.post('/', authenticate, requirePermission('createResult'), requireOrganizationScope, enforceCommercialConsent({ resolveSampleId: (req) => req.body?.specimenId }), async (req, res) => {
  try {
    const db = req.app.locals.db;

    // #628: resolve the referenced Sample first, same three-tier
    // resolution POST /upload uses -- never trust the caller-supplied
    // specimenId verbatim, whatever shape it's in.
    const { ObjectId } = require('mongodb');
    const samplesCollection = getCollection(db, 'samples');
    let sample = null;
    if (ObjectId.isValid(String(req.body?.specimenId))) {
      sample = await samplesCollection.findOne({ _id: new ObjectId(req.body.specimenId) });
    }
    if (!sample) {
      sample = await samplesCollection.findOne({ specimenId: String(req.body?.specimenId || '') });
    }
    if (!sample) {
      return res.status(404).json({
        success: false,
        error: 'Amostra não encontrada'
      });
    }

    // #1082: the destination sample must be in the caller's scope. The
    // handler forces specimenId from the resolved sample, so the body cannot
    // itself re-parent -- this gates which sample may be named at all.
    if (!isSampleInOrganizationScope(sample, req.organizationScope)) {
      return denyOutOfScope(res);
    }

    const resultData = { ...req.body, specimenId: sample.specimenId };

    const validation = ResultModel.validate(resultData);
    if (!validation.isValid) {
      return res.status(422).json({
        success: false,
        error: 'Dados inválidos',
        message: validation.errors.join(', '),
        details: validation.errors
      });
    }

    const resultsCollection = db.collection('results');
    const result = ResultModel.create(resultData);

    const insertResult = await resultsCollection.insertOne(result);

    // Registra log de criação
    if (req.user) {
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'CREATE',
        resourceType: 'Result',
        resourceId: insertResult.insertedId.toString(),
        status: 'success',
        severity: 'info',
        message: 'Arquivo de analise criado',
        payload: { specimenId: result.specimenId || null },
        req: req,
        module: 'Arquivos de Analise'
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Arquivo de analise criado com sucesso',
      data: { _id: insertResult.insertedId, ...result }
    });
  } catch (error) {
    logger.error('Erro ao criar arquivo de analise:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao criar arquivo de analise',
      message: error.message
    });
  }
});

router.put('/:id', authenticate, requirePermission('editResult'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;

    const { ObjectId } = require('mongodb');
    const resultsCollection = db.collection('results');

    // #1082: fetch-404-then-403, mirroring GET /:id (#910) rather than
    // sample.routes.js:1088's null-tolerant `if (record && !inScope)` --
    // that shape is invisible against a mock whose findOne defaults to null.
    // ALLOWED_UPDATE_FIELDS below already excludes specimenId, so there is no
    // destination to check here; only whether this result is the caller's.
    const existing = await resultsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Arquivo de analise não encontrado'
      });
    }
    if (!(await isResultInOrganizationScope(db, existing, req.organizationScope))) {
      return denyOutOfScope(res);
    }

    // #875: a denylist here (previously just specimenId/sampleID/sampleId,
    // #628) passes every other body key straight into $set, including keys
    // that don't belong to the Result document at all. Use an allowlist
    // instead, derived from ResultModel.create()'s field set
    // (src/models/Result.js:53-70) -- add a field there and here together.
    // specimenId/sampleID/sampleId stay excluded: that linkage is owned by
    // PUT /:id/link-sample, not this generic update. resultID and _id are
    // immutable identity and are excluded too.
    const ALLOWED_UPDATE_FIELDS = [
      'fileType',
      'resultFilePath',
      'filePath',
      'description',
      'analysisType',
      'method',
      'responsibleResearcher',
      'equipmentID',
      'equipmentName',
      'fileSize',
      'uploadedAt'
    ];
    const updateFields = {};
    for (const key of ALLOWED_UPDATE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        updateFields[key] = req.body[key];
      }
    }
    updateFields.updatedAt = new Date();

    const result = await resultsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Arquivo de analise não encontrado'
      });
    }

    // Registra log de atualização
    if (req.user) {
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'UPDATE',
        resourceType: 'Result',
        resourceId: req.params.id,
        status: 'success',
        severity: 'info',
        message: 'Arquivo de analise atualizado',
        req: req,
        module: 'Arquivos de Analise'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Arquivo de analise atualizado com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao atualizar arquivo de analise:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao atualizar arquivo de analise',
      message: error.message
    });
  }
});

router.put('/:id/link-sample', authenticate, requirePermission('editResult'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;

    const { specimenId } = req.body;
    if (!specimenId) {
      return res.status(400).json({
        success: false,
        error: 'specimenId é obrigatório'
      });
    }

    const { ObjectId } = require('mongodb');
    const resultsCollection = db.collection('results');

    // #1082: SOURCE check first -- "is the result I am re-parenting mine?".
    // The ordering is load-bearing, not cosmetic: resolving the destination
    // first would let a caller who owns neither end learn from the
    // 404-vs-403 split whether an arbitrary sample id exists before being
    // refused.
    const existing = await resultsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Arquivo de analise não encontrado'
      });
    }
    if (!(await isResultInOrganizationScope(db, existing, req.organizationScope))) {
      return denyOutOfScope(res);
    }

    // #628: resolve the referenced Sample first, same three-tier
    // resolution the create paths use -- never trust the caller-supplied
    // specimenId verbatim, whatever shape it's in.
    const samplesCollection = getCollection(db, 'samples');
    let sample = null;
    if (ObjectId.isValid(String(specimenId))) {
      sample = await samplesCollection.findOne({ _id: new ObjectId(specimenId) });
    }
    if (!sample) {
      sample = await samplesCollection.findOne({ specimenId: String(specimenId) });
    }
    if (!sample) {
      return res.status(404).json({
        success: false,
        error: 'Amostra não encontrada'
      });
    }

    // #1082: DESTINATION check -- rewriting specimenId IS the re-parent,
    // since a Result's organization identity is entirely the
    // specimenId -> sample tenancy key join (#1192). Without this, a caller can
    // push their own result into another organization.
    if (!isSampleInOrganizationScope(sample, req.organizationScope)) {
      return denyOutOfScope(res);
    }

    const result = await resultsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { specimenId: sample.specimenId, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Arquivo de analise não encontrado'
      });
    }

    // Registra log de vinculação
    if (req.user) {
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'UPDATE',
        resourceType: 'Result',
        resourceId: req.params.id,
        status: 'success',
        severity: 'info',
        message: `Arquivo de analise vinculado à amostra: ${sample.specimenId}`,
        payload: { specimenId: sample.specimenId },
        req: req,
        module: 'Arquivos de Analise'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Arquivo de analise vinculado à amostra com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao vincular arquivo de analise:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao vincular arquivo de analise',
      message: error.message
    });
  }
});

router.delete('/:id', authenticate, requirePermission('deleteResult'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;

    const { ObjectId } = require('mongodb');
    const resultsCollection = db.collection('results');

    // #1082: fetch-404-then-403 before the destructive call, mirroring
    // GET /:id (#910).
    const existing = await resultsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Arquivo de analise não encontrado'
      });
    }
    if (!(await isResultInOrganizationScope(db, existing, req.organizationScope))) {
      return denyOutOfScope(res);
    }

    const result = await resultsCollection.deleteOne({ _id: new ObjectId(req.params.id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Arquivo de analise não encontrado'
      });
    }

    // Registra log de deleção
    if (req.user) {
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'DELETE',
        resourceType: 'Result',
        resourceId: req.params.id,
        status: 'success',
        severity: 'warning',
        message: 'Arquivo de analise deletado',
        req: req,
        module: 'Arquivos de Analise'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Arquivo de analise deletado com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao deletar arquivo de analise:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao deletar arquivo de analise',
      message: error.message
    });
  }
});

module.exports = router;

