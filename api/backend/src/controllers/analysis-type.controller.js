const logger = require('../utils/logger');
const AnalysisTypeModel = require('../models/AnalysisType');

const getAnalysisTypes = async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const collection = db.collection('analysisTypes');
    const types = await collection.find({ active: true }).sort({ name: 1 }).toArray();

    return res.status(200).json({
      success: true,
      data: types
    });
  } catch (error) {
    logger.error('Erro ao listar tipos de análise:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar tipos de análise',
      message: error.message
    });
  }
};

const createAnalysisType = async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const collection = db.collection('analysisTypes');
    const payload = { ...req.body };

    if (!payload.code && payload.name) {
      payload.code = AnalysisTypeModel.slugify(payload.name);
    }

    if (payload.code) {
      payload.code = String(payload.code).toLowerCase();
    }

    const validation = AnalysisTypeModel.validate(payload);
    if (!validation.isValid) {
      return res.status(422).json({
        success: false,
        error: 'Dados inválidos',
        message: validation.errors.join(', ')
      });
    }

    const existingByCode = await collection.findOne({ code: payload.code });
    if (existingByCode) {
      return res.status(409).json({
        success: false,
        error: 'Código já existe',
        message: `Já existe um tipo com o código ${payload.code}`
      });
    }

    const analysisType = AnalysisTypeModel.create(payload);
    const result = await collection.insertOne(analysisType);

    return res.status(201).json({
      success: true,
      message: 'Tipo de análise criado com sucesso',
      data: { _id: result.insertedId, ...analysisType }
    });
  } catch (error) {
    logger.error('Erro ao criar tipo de análise:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao criar tipo de análise',
      message: error.message
    });
  }
};

module.exports = {
  getAnalysisTypes,
  createAnalysisType
};
