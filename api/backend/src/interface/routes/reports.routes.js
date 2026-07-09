const express = require('express');
const { ObjectId } = require('mongodb');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const ReportsModel = require('../../models/Reports');
const logger = require('../../utils/logger');

function normalizeReport(report) {
  return {
    ...report,
    reportID: Number(report.reportID || 0),
    generatedAt: report.generatedAt || report.createdAt || new Date(),
  };
}

function resolveCollection(db, candidates = []) {
  for (const name of candidates) {
    try {
      const collection = db.collection(name);
      if (collection) return collection;
    } catch (_) {}
  }
  return db.collection(candidates[0]);
}

async function nextReportId(reportsCollection) {
  const last = await reportsCollection
    .find({ reportID: { $exists: true } })
    .sort({ reportID: -1 })
    .limit(1)
    .toArray();

  const max = Number(last?.[0]?.reportID || 0);
  return max + 1;
}

function typeIncludes(type, patterns) {
  const value = String(type || '').toLowerCase();
  return patterns.some((pattern) => value.includes(pattern));
}

function normalizeTypeValue(rawType = '') {
  return decodeURIComponent(String(rawType || ''))
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function buildDateQuery(filters = {}) {
  if (!filters.startDate && !filters.endDate) {
    return null;
  }

  const range = {};
  if (filters.startDate) {
    range.$gte = new Date(filters.startDate);
  }

  if (filters.endDate) {
    const endDate = new Date(filters.endDate);
    endDate.setHours(23, 59, 59, 999);
    range.$lte = endDate;
  }

  return range;
}

function normalizeFilterText(value) {
  return String(value || '').trim();
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toRegex(value) {
  return new RegExp(escapeRegex(value), 'i');
}

function isTruthyFilter(value) {
  return ['true', '1', 'yes', 'sim'].includes(String(value || '').trim().toLowerCase());
}

function normalizeReleaseStatus(value) {
  const normalized = normalizeFilterText(value).toUpperCase().replace(/\s+/g, '_');
  if (!normalized) return '';
  if (['ATIVA', 'AVAILABLE', 'DISPONIVEL', 'DISPONÍVEL'].includes(normalized)) return 'AVAILABLE';
  if (['QUARENTINE', 'QUARANTINE', 'EM_QUARENTENA', 'QUARENTENA'].includes(normalized)) return 'QUARANTINE';
  if (['ESGOTADA', 'DEPLETED', 'BLOCKED', 'BLOQUEADA'].includes(normalized)) return 'BLOCKED';
  return normalized;
}

function normalizeTreatmentStatus(value) {
  const normalized = normalizeFilterText(value).toUpperCase().replace(/\s+/g, '_');
  if (!normalized) return '';
  if (['NAIVE', 'INICIAL'].includes(normalized)) return 'NAIVE';
  if (['ON_TREATMENT', 'EM_TRATAMENTO', 'EMTRATAMENTO', 'TREATED'].includes(normalized)) return 'ON_TREATMENT';
  if (['WASHOUT', 'LAVAGEM'].includes(normalized)) return 'WASHOUT';
  return normalized;
}

function normalizeSprecCode(value) {
  return normalizeFilterText(value).toUpperCase();
}

function buildSampleQuery(filters = {}) {
  const conditions = [];

  const orphaCode = normalizeFilterText(filters.orphaCode || filters.orpha || filters.disease);
  if (orphaCode) {
    const cleanedOrpha = orphaCode.replace(/^ORPHA:/i, '');
    conditions.push({
      $or: [
        { 'clinicalData.orphaCode': cleanedOrpha },
        { 'clinicalData.orphaCode': toRegex(cleanedOrpha) },
        { orphaCode: toRegex(cleanedOrpha) },
      ],
    });
  }

  const drugQuery = normalizeFilterText(filters.atcCode || filters.genericName || filters.drug);
  if (drugQuery) {
    const cleanedDrug = drugQuery.replace(/^ATC:/i, '');
    const drugRegex = toRegex(cleanedDrug);
    conditions.push({
      $or: [
        { 'pharmacologyData.atcCode': drugRegex },
        { 'pharmacologyData.medicationName': drugRegex },
        { 'pharmacologyData.atcClass': drugRegex },
      ],
    });
  }

  const treatmentStatus = normalizeTreatmentStatus(filters.treatmentStatus);
  if (treatmentStatus) {
    conditions.push({ 'pharmacologyData.treatmentStatus': treatmentStatus });
  }

  const sprecMatrix = normalizeFilterText(filters.sprecMatrixType || filters.sprecMatrix || filters.matrixType).toLowerCase();
  if (sprecMatrix) {
    conditions.push({ 'sprec.matrixType': sprecMatrix });
  }

  const sprecSampleType = normalizeSprecCode(filters.sprecSampleType);
  if (sprecSampleType) {
    conditions.push({ 'sprec.sampleType': sprecSampleType });
  }

  const sprecPrimaryContainer = normalizeSprecCode(filters.sprecPrimaryContainer);
  if (sprecPrimaryContainer) {
    conditions.push({ 'sprec.primaryContainer': sprecPrimaryContainer });
  }

  const sprecPreCentrifugation = normalizeSprecCode(filters.sprecPreCentrifugation);
  if (sprecPreCentrifugation) {
    conditions.push({ 'sprec.preCentrifugation': sprecPreCentrifugation });
  }

  const sprecCentrifugation = normalizeSprecCode(filters.sprecCentrifugation);
  if (sprecCentrifugation) {
    conditions.push({ 'sprec.centrifugation': sprecCentrifugation });
  }

  const sprecSecondCentrifugation = normalizeSprecCode(filters.sprecSecondCentrifugation);
  if (sprecSecondCentrifugation) {
    conditions.push({ 'sprec.secondCentrifugation': sprecSecondCentrifugation });
  }

  const sprecPostCentrifugationDelay = normalizeSprecCode(filters.sprecPostCentrifugationDelay);
  if (sprecPostCentrifugationDelay) {
    conditions.push({ 'sprec.postCentrifugationDelay': sprecPostCentrifugationDelay });
  }

  const sprecLongTermStorage = normalizeSprecCode(filters.sprecLongTermStorage);
  if (sprecLongTermStorage) {
    conditions.push({ 'sprec.longTermStorage': sprecLongTermStorage });
  }

  const qualityCategory = normalizeFilterText(filters.sprecCategory || filters.qualityCategory).toUpperCase();
  if (qualityCategory) {
    conditions.push({ final_grade: qualityCategory });
  }

  const releaseStatus = normalizeReleaseStatus(filters.status || filters.releaseStatus || filters.graphStatus);
  if (releaseStatus) {
    conditions.push({ release_status: releaseStatus });
  }

  return conditions.length > 0 ? { $and: conditions } : {};
}

async function getMatchingPatientIds(samplesCollection, sampleQuery) {
  if (!sampleQuery || Object.keys(sampleQuery).length === 0) {
    return [];
  }

  const patientIds = await samplesCollection.distinct('participantId', sampleQuery);
  return Array.isArray(patientIds)
    ? patientIds.map((patientID) => String(patientID || '').trim()).filter(Boolean)
    : [];
}

async function buildPreviewData(db, rawType, filters = {}) {
  const type = decodeURIComponent(rawType || '').toLowerCase();
  const normalizedType = normalizeTypeValue(rawType);
  const isSamplesByPatient =
    normalizedType === 'samplesbypatient' ||
    typeIncludes(type, ['amostras por paciente', 'samples by patient']);

  const isTemperatureControl =
    normalizedType === 'temperaturecontrol' ||
    typeIncludes(type, ['controle de temperatura', 'temperature control']);

  const isWithdrawalHistory =
    normalizedType === 'withdrawalhistory' ||
    typeIncludes(type, ['historico de retirada', 'withdrawal history', 'retirada']);

  const isAccessLogs =
    normalizedType === 'accesslogs' ||
    typeIncludes(type, ['logs de acesso', 'access logs']);

  const isSampleAnalysis =
    normalizedType === 'sampleanalysis' ||
    typeIncludes(type, ['analise das amostras', 'sample analysis']);

  const isTissueOriginHistory =
    normalizedType === 'tissueoriginhistory' ||
    typeIncludes(type, ['origem de tecido', 'tissue origin']);

  const isExtracellularNetwork =
    normalizedType === 'extracellularnetwork' ||
    typeIncludes(type, ['rede extracelular', 'extracellular network']);

  if (isSamplesByPatient) {
    const patientsCollection = resolveCollection(db, ['patients', 'pacientes']);
    const samplesCollection = resolveCollection(db, ['samples', 'amostras']);
    const sampleQuery = buildSampleQuery(filters);
    const matchingPatientIds = await getMatchingPatientIds(samplesCollection, sampleQuery);

    const patientQueryParts = [];
    if (filters.keyword) {
      patientQueryParts.push({
        $or: [
        { patientName: { $regex: String(filters.keyword), $options: 'i' } },
        { patientID: { $regex: String(filters.keyword), $options: 'i' } },
        ],
      });
    }

    const orphaCode = normalizeFilterText(filters.orphaCode || filters.orpha || filters.disease);
    if (orphaCode) {
      const cleanedOrpha = orphaCode.replace(/^ORPHA:/i, '');
      patientQueryParts.push({
        $or: [
          { orphaCode: cleanedOrpha },
          { orphaCode: toRegex(cleanedOrpha) },
          { 'icdReference.ORPHA': toRegex(cleanedOrpha) },
          { diagnosticHypothesis: toRegex(cleanedOrpha) },
        ],
      });
    }

    if (matchingPatientIds.length > 0) {
      patientQueryParts.push({ patientID: { $in: matchingPatientIds } });
    }

    const patientQuery = patientQueryParts.length > 0 ? { $and: patientQueryParts } : {};
    const patients = await patientsCollection.find(patientQuery).limit(20).toArray();
    const patientIds = patients.map((patient) => patient.patientID).filter(Boolean);
    const sampleFilter = { ...(Object.keys(sampleQuery).length > 0 ? sampleQuery : {}) };
    const samples = patientIds.length
      ? await samplesCollection.find({
          $and: [
            { patientID: { $in: patientIds } },
            ...(Object.keys(sampleFilter).length > 0 ? [sampleFilter] : []),
          ],
        }).toArray()
      : [];

    const groupedSamples = samples.reduce((acc, sample) => {
      const key = String(sample.patientID || '');
      if (!key) {
        return acc;
      }
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(sample);
      return acc;
    }, {});

    const enrichedPatients = patients.map((patient) => {
      const key = String(patient.patientID || '');
      const patientSamples = groupedSamples[key] || [];
      const limitedSamples = patientSamples.slice(0, 10);
      return {
        ...patient,
        sampleCount: patientSamples.length,
        samples: limitedSamples,
        samplesLimited: patientSamples.length > limitedSamples.length,
      };
    });

    return {
      total: enrichedPatients.length,
      patients: enrichedPatients,
      previewLimited: enrichedPatients.length >= 20,
    };
  }

  if (typeIncludes(type, ['paciente', 'patient'])) {
    const collection = resolveCollection(db, ['patients', 'pacientes']);
    const samplesCollection = resolveCollection(db, ['samples', 'amostras']);
    const sampleQuery = buildSampleQuery(filters);
    const matchingPatientIds = await getMatchingPatientIds(samplesCollection, sampleQuery);

    const patientQueryParts = [];
    if (filters.keyword) {
      patientQueryParts.push({
        $or: [
          { patientName: { $regex: String(filters.keyword), $options: 'i' } },
          { patientID: { $regex: String(filters.keyword), $options: 'i' } },
        ],
      });
    }

    const orphaCode = normalizeFilterText(filters.orphaCode || filters.orpha || filters.disease);
    if (orphaCode) {
      const cleanedOrpha = orphaCode.replace(/^ORPHA:/i, '');
      patientQueryParts.push({
        $or: [
          { orphaCode: cleanedOrpha },
          { orphaCode: toRegex(cleanedOrpha) },
          { 'icdReference.ORPHA': toRegex(cleanedOrpha) },
          { diagnosticHypothesis: toRegex(cleanedOrpha) },
        ],
      });
    }

    if (matchingPatientIds.length > 0) {
      patientQueryParts.push({ patientID: { $in: matchingPatientIds } });
    }

    const query = patientQueryParts.length > 0 ? { $and: patientQueryParts } : {};
    const patients = await collection.find(query).limit(50).toArray();
    const total = await collection.countDocuments(query);
    return { total, patients, previewLimited: total > 50 };
  }

  if (isSampleAnalysis) {
    const samplesCollection = resolveCollection(db, ['samples', 'amostras']);
    const resultsCollection = resolveCollection(db, ['results']);
    const samples = await samplesCollection.find({}).limit(100).toArray();

    const sampleIds = samples.map((sample) => sample.sampleID).filter((sampleID) => sampleID !== undefined && sampleID !== null);
    const results = sampleIds.length
      ? await resultsCollection.find({ sampleID: { $in: sampleIds } }).toArray()
      : [];

    const groupedResults = results.reduce((acc, result) => {
      const key = String(result.sampleID || '');
      if (!key) {
        return acc;
      }
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(result);
      return acc;
    }, {});

    const analysis = samples.map((sample) => {
      const key = String(sample.sampleID || '');
      const sampleResults = groupedResults[key] || [];
      return {
        sampleID: sample.sampleID || sample._id,
        barcode: sample.barcode || null,
        sampleType: sample.sampleType || null,
        patientID: sample.patientID || null,
        status: sample.currentStatus || sample.status || null,
        resultCount: sampleResults.length,
        hasResults: sampleResults.length > 0,
      };
    });

    const withResults = analysis.filter((item) => item.hasResults).length;
    const withoutResults = analysis.length - withResults;
    return {
      total: analysis.length,
      analysis,
      withResults,
      withoutResults,
      previewLimited: analysis.length >= 100,
    };
  }

  if (typeIncludes(type, ['amostra', 'sample'])) {
    const collection = resolveCollection(db, ['samples', 'amostras']);
    const sampleQuery = buildSampleQuery(filters);
    const samples = await collection.find(sampleQuery).limit(100).toArray();
    const total = await collection.countDocuments(sampleQuery);
    return { total, samples, previewLimited: total > 100 };
  }

  if (typeIncludes(type, ['temperatura', 'temperature'])) {
    const collection = resolveCollection(db, ['temperature', 'temperatures']);
    const dateRange = buildDateQuery(filters);
    const queryParts = [];
    if (dateRange) {
      queryParts.push({ $or: [{ timestamp: dateRange }, { dateTime: dateRange }] });
    }

    if (isTruthyFilter(filters.criticalAlertsOnly)) {
      queryParts.push({
        $or: [
          { readingStatus: { $regex: 'critical|alert', $options: 'i' } },
          { severity: { $regex: 'critical|alert', $options: 'i' } },
          { alertType: { $regex: 'critical', $options: 'i' } },
          { sensorStatus: { $regex: 'faulty|maintenance', $options: 'i' } },
        ],
      });
    }

    const query = queryParts.length > 0 ? { $and: queryParts } : {};
    const temperatures = await collection.find(query).sort({ timestamp: -1, dateTime: -1 }).limit(100).toArray();
    const total = await collection.countDocuments(query);

    const values = temperatures
      .map((entry) => Number(entry.temperatureValue))
      .filter((value) => Number.isFinite(value));

    const statistics = values.length
      ? {
          average: values.reduce((sum, value) => sum + value, 0) / values.length,
          min: Math.min(...values),
          max: Math.max(...values),
          alerts: temperatures.filter((entry) =>
            String(entry.readingStatus || '').toLowerCase().includes('alert') ||
            String(entry.readingStatus || '').toLowerCase().includes('critical')
          ).length,
        }
      : undefined;

    return {
      total,
      temperatures,
      statistics,
      mode: isTemperatureControl ? 'control' : 'report',
      previewLimited: total > 100,
    };
  }

  if (typeIncludes(type, ['sensor'])) {
    const collection = resolveCollection(db, ['sensors']);
    const sensors = await collection.find({}).limit(100).toArray();
    const total = await collection.countDocuments({});
    return { total, sensors, previewLimited: total > 100 };
  }

  if (typeIncludes(type, ['equipamento', 'equipment'])) {
    const collection = resolveCollection(db, ['equipment']);
    const equipment = await collection.find({}).limit(100).toArray();
    const total = await collection.countDocuments({});
    return { total, equipment, previewLimited: total > 100 };
  }

  if (typeIncludes(type, ['resultado', 'result'])) {
    const collection = resolveCollection(db, ['results']);
    const results = await collection.find({}).limit(100).toArray();
    const total = await collection.countDocuments({});
    return { total, results, previewLimited: total > 100 };
  }

  if (isWithdrawalHistory) {
    const collection = resolveCollection(db, ['withdrawals', 'withdrawalHistory']);
    const dateRange = buildDateQuery(filters);
    const query = dateRange
      ? {
          $or: [{ withdrawalDate: dateRange }, { createdAt: dateRange }],
        }
      : {};

    const withdrawals = await collection.find(query).sort({ withdrawalDate: -1, createdAt: -1 }).limit(100).toArray();
    const total = await collection.countDocuments(query);
    return { total, withdrawals, previewLimited: total > 100 };
  }

  if (isTissueOriginHistory || isExtracellularNetwork) {
    const collection = resolveCollection(db, ['samples', 'amostras']);
    const query = isExtracellularNetwork
      ? {
          $or: [
            { linkedProject: { $regex: 'extracel', $options: 'i' } },
            { sampleOrigin: { $regex: 'extracel', $options: 'i' } },
          ],
        }
      : {
          $or: [{ sampleOrigin: { $exists: true, $ne: null } }, { linkedProject: { $exists: true, $ne: null } }],
        };

    const samples = await collection.find(query).sort({ registrationDate: -1, createdAt: -1 }).limit(100).toArray();
    const total = await collection.countDocuments(query);
    return { total, samples, previewLimited: total > 100 };
  }

  if (typeIncludes(type, ['log', 'audit', 'acesso', 'access']) || isAccessLogs) {
    const collection = resolveCollection(db, ['logs']);
    const query = {};

    const dateQuery = buildDateQuery(filters);
    if (dateQuery) {
      query.$or = [{ dateTime: dateQuery }, { timestamp: dateQuery }];
    }

    const logs = await collection.find(query).sort({ dateTime: -1, timestamp: -1 }).limit(200).toArray();
    const total = await collection.countDocuments(query);
    return { total, logs, previewLimited: total > 200 };
  }

  return {
    total: 0,
    message: 'Tipo de relatório disponível, mas sem pré-visualização específica para este formato.',
    type,
  };
}

function toCsvRows(previewData) {
  const collectionCandidates = [
    previewData?.patients,
    previewData?.samples,
    previewData?.temperatureLogs,
    previewData?.sensors,
    previewData?.equipment,
    previewData?.results,
    previewData?.logs,
  ];

  const rows = collectionCandidates.find((entry) => Array.isArray(entry)) || [];
  if (!rows.length) {
    return 'total,message\n0,"Sem dados para exportação"';
  }

  const headers = Object.keys(rows[0]);
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

  const csvRows = rows.map((row) => headers.map((header) => escape(row?.[header])).join(','));
  return [headers.join(','), ...csvRows].join('\n');
}

router.get('/', authenticate, requirePermission('viewReports'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ error: 'Banco de dados não disponível' });
    }

    const reports = await db.collection('reports').find({}).sort({ generatedAt: -1, createdAt: -1 }).toArray();
    return res.status(200).json(reports.map(normalizeReport));
  } catch (error) {
    logger.error('Erro ao listar relatórios:', error.message || error);
    return res.status(500).json({ error: 'Erro ao listar relatórios', message: error.message });
  }
});

router.get('/:id', authenticate, requirePermission('viewReports'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ error: 'Banco de dados não disponível' });
    }

    const { id } = req.params;
    const reportsCollection = db.collection('reports');

    let report = null;
    if (/^\d+$/.test(id)) {
      report = await reportsCollection.findOne({ reportID: Number(id) });
    }

    if (!report && ObjectId.isValid(id)) {
      report = await reportsCollection.findOne({ _id: new ObjectId(id) });
    }

    if (!report) {
      return res.status(404).json({ error: 'Relatório não encontrado' });
    }

    return res.status(200).json(normalizeReport(report));
  } catch (error) {
    logger.error('Erro ao buscar relatório:', error.message || error);
    return res.status(500).json({ error: 'Erro ao buscar relatório', message: error.message });
  }
});

router.post('/generate', authenticate, requirePermission('viewReports'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ error: 'Banco de dados não disponível' });
    }

    const { reportType, filters = {} } = req.body || {};
    if (!reportType) {
      return res.status(400).json({ error: 'reportType é obrigatório' });
    }

    const reportsCollection = db.collection('reports');
    const previewData = await buildPreviewData(db, reportType, filters);
    const reportID = await nextReportId(reportsCollection);

    const report = ReportsModel.create({
      reportID,
      reportType,
      filters,
      generatedBy: req.user?.userID || req.user?._id || null,
      status: 'completed',
      generatedAt: new Date(),
      reportData: JSON.stringify(previewData),
    });

    const result = await reportsCollection.insertOne(report);
    return res.status(201).json(normalizeReport({ _id: result.insertedId, ...report }));
  } catch (error) {
    logger.error('Erro ao gerar relatório:', error.message || error);
    return res.status(500).json({ error: 'Erro ao gerar relatório', message: error.message });
  }
});

router.delete('/:id', authenticate, requirePermission('viewReports'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ error: 'Banco de dados não disponível' });
    }

    const reportsCollection = db.collection('reports');
    const { id } = req.params;

    let deleteResult = null;
    if (/^\d+$/.test(id)) {
      deleteResult = await reportsCollection.deleteOne({ reportID: Number(id) });
    }

    if ((!deleteResult || deleteResult.deletedCount === 0) && ObjectId.isValid(id)) {
      deleteResult = await reportsCollection.deleteOne({ _id: new ObjectId(id) });
    }

    if (!deleteResult || deleteResult.deletedCount === 0) {
      return res.status(404).json({ error: 'Relatório não encontrado' });
    }

    return res.status(200).json({ success: true, message: 'Relatório removido com sucesso' });
  } catch (error) {
    logger.error('Erro ao remover relatório:', error.message || error);
    return res.status(500).json({ error: 'Erro ao remover relatório', message: error.message });
  }
});

router.get('/:type/filters', authenticate, requirePermission('viewReports'), async (_req, res) => {
  try {
    const filters = [
      { name: 'startDate', label: 'Data Inicial', type: 'date' },
      { name: 'endDate', label: 'Data Final', type: 'date' },
      { name: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] },
      { name: 'keyword', label: 'Palavra-chave', type: 'text' },
    ];

    return res.status(200).json({ filters });
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao obter filtros', message: error.message });
  }
});

router.post('/:type/preview', authenticate, requirePermission('viewReports'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const previewData = await buildPreviewData(db, req.params.type, req.body?.filters || {});
    return res.status(200).json({
      success: true,
      reportType: req.params.type,
      generatedAt: new Date().toISOString(),
      data: previewData,
    });
  } catch (error) {
    logger.error('Erro ao gerar pré-visualização de relatório:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao gerar pré-visualização', message: error.message });
  }
});

router.get('/:type/export', authenticate, requirePermission('viewReports'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ error: 'Banco de dados não disponível' });
    }

    const previewData = await buildPreviewData(db, req.params.type, req.query || {});
    const csv = toCsvRows(previewData);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=report_${Date.now()}.csv`);
    return res.status(200).send(csv);
  } catch (error) {
    logger.error('Erro ao exportar relatório CSV:', error.message || error);
    return res.status(500).json({ error: 'Erro ao exportar relatório CSV', message: error.message });
  }
});

router.get('/:type/export/pdf', authenticate, requirePermission('viewReports'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ error: 'Banco de dados não disponível' });
    }

    const previewData = await buildPreviewData(db, req.params.type, req.query || {});
    return res.status(200).json({ success: true, format: 'pdf', data: previewData });
  } catch (error) {
    logger.error('Erro ao exportar relatório PDF:', error.message || error);
    return res.status(500).json({ error: 'Erro ao exportar relatório PDF', message: error.message });
  }
});

module.exports = router;
