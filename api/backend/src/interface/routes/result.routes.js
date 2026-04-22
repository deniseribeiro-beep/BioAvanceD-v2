const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const { enforceCommercialConsent } = require('../../infrastructure/middleware/consent.enforcement');
const logger = require('../../utils/logger');
const ResultModel = require('../../models/Result');

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
      const { sampleID } = req.body;
      if (!sampleID) {
        return cb(new Error('sampleID é obrigatório'), null);
      }

      const resultDir = path.join(__dirname, '../../storage/results', String(sampleID));
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
router.get('/', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const resultsCollection = db.collection('results');
    const query = {};

    if (req.query.importJobID) {
      query.importJobID = req.query.importJobID;
    }

    const results = await resultsCollection.find(query).toArray();

    // Registra log de consulta
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      entity: 'Result',
      result: 'success',
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

router.post('/upload', authenticate, requirePermission('uploadFiles'), enforceCommercialConsent({ resolveSampleId: (req) => req.body?.sampleID }), resultUpload.single('file'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { sampleID, description, method, responsibleResearcher, equipmentID, equipmentName, analysisType } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        error: 'Arquivo não fornecido'
      });
    }

    if (!sampleID) {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      return res.status(400).json({
        success: false,
        error: 'sampleID é obrigatório'
      });
    }

    const samplesCollection = db.collection('amostras');
    let sample;
    try {
      const { ObjectId } = require('mongodb');
      sample = await samplesCollection.findOne({ _id: new ObjectId(sampleID) });
    } catch (idError) {
      sample = await samplesCollection.findOne({ sampleID: Number(sampleID) });
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
      sampleID: sample._id ? sample._id.toString() : sampleID,
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
      return res.status(400).json({
        success: false,
        error: 'Dados inválidos',
        message: validation.errors.join(', ')
      });
    }

    const result = ResultModel.create(resultPayload);
    const insertResult = await resultsCollection.insertOne(result);

    if (req.user) {
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'CREATE',
        entity: 'Result',
        entityID: insertResult.insertedId.toString(),
        result: 'success',
        severity: 'info',
        message: 'Arquivo de analise criado via upload',
        payload: { sampleID: result.sampleID || null },
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

router.get('/:id', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { ObjectId } = require('mongodb');
    const resultsCollection = db.collection('results');
    const result = await resultsCollection.findOne({ _id: new ObjectId(req.params.id) });

    if (!result) {
      // Registra tentativa de busca de resultado inexistente
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'QUERY',
        entity: 'Result',
        result: 'error',
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

    // Registra log de busca
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'QUERY',
      entity: 'Result',
      entityID: req.params.id,
      result: 'success',
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

router.get('/:id/download', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { ObjectId } = require('mongodb');
    const resultsCollection = db.collection('results');
    const result = await resultsCollection.findOne({ _id: new ObjectId(req.params.id) });

    if (!result) {
      // Registra tentativa de download de resultado inexistente
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'DOWNLOAD',
        entity: 'Result',
        result: 'error',
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

    // Registra log de download
    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'DOWNLOAD',
      entity: 'Result',
      entityID: req.params.id,
      result: 'success',
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

router.post('/', authenticate, requirePermission('createPatient'), enforceCommercialConsent({ resolveSampleId: (req) => req.body?.sampleID }), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const validation = ResultModel.validate(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Dados inválidos',
        message: validation.errors.join(', ')
      });
    }

    const resultsCollection = db.collection('results');
    const result = ResultModel.create(req.body);

    const insertResult = await resultsCollection.insertOne(result);

    // Registra log de criação
    if (req.user) {
      const auditLogger = require('../../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'CREATE',
        entity: 'Result',
        entityID: insertResult.insertedId.toString(),
        result: 'success',
        severity: 'info',
        message: 'Arquivo de analise criado',
        payload: { sampleID: result.sampleID || null },
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

router.put('/:id', authenticate, requirePermission('createPatient'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { ObjectId } = require('mongodb');
    const resultsCollection = db.collection('results');
    req.body.updatedAt = new Date();

    const result = await resultsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: req.body }
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
        entity: 'Result',
        entityID: req.params.id,
        result: 'success',
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

router.put('/:id/link-sample', authenticate, requirePermission('createPatient'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { sampleID } = req.body;
    if (!sampleID) {
      return res.status(400).json({
        success: false,
        error: 'sampleID é obrigatório'
      });
    }

    const { ObjectId } = require('mongodb');
    const resultsCollection = db.collection('results');

    const result = await resultsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { sampleID, updatedAt: new Date() } }
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
        entity: 'Result',
        entityID: req.params.id,
        result: 'success',
        severity: 'info',
        message: `Arquivo de analise vinculado à amostra: ${sampleID}`,
        payload: { sampleID },
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

router.delete('/:id', authenticate, requirePermission('createPatient'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { ObjectId } = require('mongodb');
    const resultsCollection = db.collection('results');
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
        entity: 'Result',
        entityID: req.params.id,
        result: 'success',
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

