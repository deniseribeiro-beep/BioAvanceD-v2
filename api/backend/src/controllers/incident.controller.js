const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { connectMongoDB } = require('../infrastructure/database/mongodb/connection');
const TemperatureIncidentModel = require('../models/TemperatureIncident');
const UserModel = require('../models/User');
const { sendIncidentAlertEmail } = require('../services/sendIncidentAlertEmail');
const coldChainQuarantineService = require('../services/equipment-sensor-quarantine.service');
const { findUserAccountIdsByRoleCodes } = require('../services/rbac-assignment.service');
const { datastreamEquipmentIdsBySensor } = require('../services/sensorDatastream.service');

const NOTIFIABLE_ROLE_CODES = ['technician', 'coordinator', 'administrator'];

let TemperatureIncidentCollection = null;
let UserCollection = null;
let CachedDb = null;

async function getCollections() {
  if (!TemperatureIncidentCollection || !UserCollection || !CachedDb) {
    const db = await connectMongoDB();
    CachedDb = db;
    TemperatureIncidentCollection = db.collection('temperatureIncidents');
    UserCollection = db.collection('users');
  }
  return { db: CachedDb, TemperatureIncidentCollection, UserCollection };
}

async function getAlertRecipients() {
  try {
    const { db, UserCollection } = await getCollections();
    // #426: resolve via UserRoleAssignment -> Role, não accessType direto.
    const userAccountIds = await findUserAccountIdsByRoleCodes(db, NOTIFIABLE_ROLE_CODES);
    if (!userAccountIds.length) return [];
    // #651: same fix as the other four ObjectId sites in this file -- db
    // here is the mongoose connection, and mongoose bundles its own bson
    // (major-version-diverged from the top-level `mongodb` package's
    // bson), so ObjectId must come from mongoose.Types, not `require('mongodb')`.
    const { ObjectId } = mongoose.Types;
    const objectIds = userAccountIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
    const recipients = await UserCollection
      .find({ _id: { $in: objectIds }, ...UserModel.accountStatusFilter('active') })
      .project({ email: 1, username: 1 })
      .toArray();
    return recipients.map(u => u.email).filter(e => e);
  } catch (error) {
    logger.error('[INCIDENT] Erro ao buscar destinatários de alertas:', error.message);
    return [];
  }
}

async function applyColdChainQuarantine(db, incident) {
  try {
    return await coldChainQuarantineService.quarantineByColdChainIncident(db, incident);
  } catch (error) {
    logger.error('[INCIDENT] Falha ao aplicar quarentena de cadeia fria:', error.message || error);
    return { triggered: false, error: error.message || String(error) };
  }
}

// #301: TemperatureIncident and EnvironmentalExcursion are opened together
// (iot.controller.js's upsertTemperatureIncidentAndQuarantine/
// upsertEnvironmentalExcursion, keyed by sensorKey and equipmentId
// respectively) but nothing closed the excursion when its incident resolved.
// #1392: the excursion's key is the equipmentId of the sensor's temperature
// datastream valid now, else its SensorMetadata device's deviceId. The open
// excursion under each of the two keys is closed, so one opened under the
// device before the sensor was bound is not left open; the first closed, in
// that order, is returned
// (docs/decisions/2026-10-21-sensor-readers-from-datastream.md, decision 5).
async function closeEnvironmentalExcursion(db, sensorKey, closedAt) {
  const keys = [];
  const datastreamKey = (await datastreamEquipmentIdsBySensor(db, [sensorKey])).get(String(sensorKey));
  if (datastreamKey) keys.push(datastreamKey);

  const sensorMetadata = await db.collection('sensorMetadata').findOne({ sensorId: sensorKey });
  if (sensorMetadata?.device) {
    const device = await db.collection('devices').findOne({ _id: sensorMetadata.device });
    if (device?.deviceId && !keys.includes(device.deviceId)) keys.push(device.deviceId);
  }

  const ExcursionCollection = db.collection('environmentalExcursions');
  let firstClosed = null;
  for (const equipmentId of keys) {
    const openExcursion = await ExcursionCollection.findOne({
      equipmentId,
      excursionStatus: { $in: ['open', 'under_assessment'] }
    });
    if (!openExcursion) continue;

    const duration = closedAt.getTime() - new Date(openExcursion.startDateTime).getTime();
    await ExcursionCollection.updateOne(
      { _id: openExcursion._id },
      { $set: { endDateTime: closedAt, excursionStatus: 'resolved', duration, updatedAt: closedAt } }
    );
    firstClosed = firstClosed || { ...openExcursion, endDateTime: closedAt, excursionStatus: 'resolved', duration };
  }
  return firstClosed;
}

async function markColdChainReview(db, incident) {
  try {
    return await coldChainQuarantineService.markColdChainIncidentSamplesForReview(db, incident);
  } catch (error) {
    logger.error('[INCIDENT] Falha ao marcar revisão pós-incidente:', error.message || error);
    return { reviewRequired: false, error: error.message || String(error) };
  }
}

async function createOrUpdateIncident(req, res) {
  try {
    const { sensorKey, sensorName, currentTemperature, maxTemperature, minTemperature, samplesOutOfRange } = req.body;
    const validation = TemperatureIncidentModel.validate({ sensorKey, sensorName, openedAt: new Date(), currentTemperature, maxTemperature, minTemperature, samplesOutOfRange });

    if (!validation.isValid) {
      return res.status(422).json({ success: false, error: 'Validação falhou', details: validation.errors });
    }

    const { db, TemperatureIncidentCollection } = await getCollections();
    const existingIncident = await TemperatureIncidentCollection.findOne({ sensorKey, status: { $in: ['open', 'acknowledged', 'escalated'] } });
    let incident;

    if (existingIncident) {
      const nextData = {
        currentTemperature,
        maxTemperature: Math.max(existingIncident.maxTemperature, maxTemperature),
        minTemperature: Math.min(existingIncident.minTemperature, minTemperature),
        samplesOutOfRange: existingIncident.samplesOutOfRange + samplesOutOfRange,
        updatedAt: new Date()
      };
      await TemperatureIncidentCollection.updateOne({ _id: existingIncident._id }, { $set: nextData });
      incident = { ...existingIncident, ...nextData };
    } else {
      const newIncident = TemperatureIncidentModel.create({ sensorKey, sensorName, openedAt: new Date(), currentTemperature, maxTemperature, minTemperature, samplesOutOfRange });
      const result = await TemperatureIncidentCollection.insertOne(newIncident);
      incident = { ...newIncident, _id: result.insertedId };
      const recipients = await getAlertRecipients();
      if (recipients.length > 0) {
        void sendIncidentAlertEmail(incident, recipients, 0).catch(err => logger.error('[INCIDENT_EMAIL] Erro ao enviar alerta:', err.message));
      }
    }

    const quarantine = await applyColdChainQuarantine(db, incident);
    return res.status(200).json({ success: true, incident, quarantine });
  } catch (error) {
    logger.error('[INCIDENT] Erro ao criar/atualizar incidente:', error);
    return res.status(500).json({ success: false, error: 'Erro ao processar incidente', details: error.message });
  }
}

async function getIncidents(req, res) {
  try {
    const { status, sensorKey, limit = 50, skip = 0, excludeResolved } = req.query;
    const { TemperatureIncidentCollection } = await getCollections();
    const filter = {};
    if (status) filter.status = status;
    else if (excludeResolved === 'true' || excludeResolved === true) filter.status = { $ne: 'resolved' };
    if (sensorKey) filter.sensorKey = sensorKey;
    const incidents = await TemperatureIncidentCollection.find(filter).sort({ openedAt: -1 }).skip(Number(skip)).limit(Number(limit)).toArray();
    const total = await TemperatureIncidentCollection.countDocuments(filter);
    return res.status(200).json({ success: true, incidents, total, limit: Number(limit), skip: Number(skip) });
  } catch (error) {
    logger.error('[INCIDENT] Erro ao listar incidentes:', error);
    return res.status(500).json({ success: false, error: 'Erro ao listar incidentes', details: error.message });
  }
}

async function acknowledgeIncident(req, res) {
  try {
    const { incidentId } = req.params;
    const { userId, notes } = req.body;
    const { TemperatureIncidentCollection } = await getCollections();
    const { ObjectId } = mongoose.Types;
    const result = await TemperatureIncidentCollection.updateOne(
      { _id: new ObjectId(incidentId) },
      { $set: { status: 'acknowledged', acknowledgedAt: new Date(), acknowledgedBy: userId, updatedAt: new Date() }, $push: { notes: { timestamp: new Date(), userId, action: 'acknowledged', message: notes || 'Incidente reconhecido' } } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Incidente não encontrado' });
    return res.status(200).json({ success: true, message: 'Incidente reconhecido' });
  } catch (error) {
    logger.error('[INCIDENT] Erro ao reconhecer incidente:', error);
    return res.status(500).json({ success: false, error: 'Erro ao reconhecer incidente', details: error.message });
  }
}

async function resolveIncident(req, res) {
  try {
    const { incidentId } = req.params;
    const { userId, notes } = req.body;
    const { db, TemperatureIncidentCollection } = await getCollections();
    const { ObjectId } = mongoose.Types;
    const objectId = new ObjectId(incidentId);
    const incident = await TemperatureIncidentCollection.findOne({ _id: objectId });
    if (!incident) return res.status(404).json({ success: false, error: 'Incidente não encontrado' });
    const closedAt = new Date();
    const result = await TemperatureIncidentCollection.updateOne(
      { _id: objectId },
      { $set: { status: 'resolved', closedAt, updatedAt: closedAt }, $push: { notes: { timestamp: closedAt, userId, action: 'resolved', message: notes || 'Incidente resolvido' } } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Incidente não encontrado' });
    const postIncidentReview = await markColdChainReview(db, { ...incident, status: 'resolved', closedAt });
    const environmentalExcursion = await closeEnvironmentalExcursion(db, incident.sensorKey, closedAt).catch((error) => {
      logger.error('[INCIDENT] Falha ao encerrar excursão ambiental:', error.message || error);
      return null;
    });
    return res.status(200).json({ success: true, message: 'Incidente resolvido; amostras afetadas permanecem bloqueadas para revisão pós-incidente.', postIncidentReview, environmentalExcursion });
  } catch (error) {
    logger.error('[INCIDENT] Erro ao resolver incidente:', error);
    return res.status(500).json({ success: false, error: 'Erro ao resolver incidente', details: error.message });
  }
}

async function escalateIncident(req, res) {
  try {
    const { incidentId } = req.params;
    const { userId, notes } = req.body;
    const { TemperatureIncidentCollection } = await getCollections();
    const { ObjectId } = mongoose.Types;
    const incident = await TemperatureIncidentCollection.findOne({ _id: new ObjectId(incidentId) });
    if (!incident) return res.status(404).json({ success: false, error: 'Incidente não encontrado' });
    const newEscalationLevel = Math.min(incident.escalationLevel + 1, 2);
    await TemperatureIncidentCollection.updateOne(
      { _id: new ObjectId(incidentId) },
      { $set: { status: 'escalated', escalationLevel: newEscalationLevel, lastEscalatedAt: new Date(), updatedAt: new Date() }, $push: { notes: { timestamp: new Date(), userId, action: 'escalated', escalationLevel: newEscalationLevel, message: notes || `Escalado para nível ${newEscalationLevel}` } } }
    );
    const recipients = await getAlertRecipients();
    if (recipients.length > 0) {
      void sendIncidentAlertEmail(incident, recipients, newEscalationLevel).catch(err => logger.error('[INCIDENT_EMAIL] Erro ao enviar alerta de escalação:', err.message));
    }
    return res.status(200).json({ success: true, message: `Incidente escalado para nível ${newEscalationLevel}`, escalationLevel: newEscalationLevel });
  } catch (error) {
    logger.error('[INCIDENT] Erro ao escalar incidente:', error);
    return res.status(500).json({ success: false, error: 'Erro ao escalar incidente', details: error.message });
  }
}

async function addNoteToIncident(req, res) {
  try {
    const { incidentId } = req.params;
    const { userId, message } = req.body;
    const { TemperatureIncidentCollection } = await getCollections();
    if (!message || typeof message !== 'string') return res.status(400).json({ success: false, error: 'message é obrigatório' });
    const { ObjectId } = mongoose.Types;
    const result = await TemperatureIncidentCollection.updateOne(
      { _id: new ObjectId(incidentId) },
      { $push: { notes: { timestamp: new Date(), userId, action: 'note', message } }, $set: { updatedAt: new Date() } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Incidente não encontrado' });
    return res.status(200).json({ success: true, message: 'Nota adicionada ao incidente' });
  } catch (error) {
    logger.error('[INCIDENT] Erro ao adicionar nota:', error);
    return res.status(500).json({ success: false, error: 'Erro ao adicionar nota', details: error.message });
  }
}

module.exports = { createOrUpdateIncident, getIncidents, acknowledgeIncident, resolveIncident, escalateIncident, addNoteToIncident, getAlertRecipients };
