const { getCollection } = require('../utils/collectionResolver');
const { findSampleByAnyId } = require('../utils/sampleLookup');
const ShipmentModel = require('../models/Shipment');
const { isRecordInOrganizationScope } = require('./rbac-assignment.service');

// #660 (RF024 AC5, RF026 AC6): a Shipment carries out an authorization that
// already exists, and checks it rather than repeating its rules:
// - an executed `transfer` DispositionAction on the specimens, which consent,
//   ethics, custody and legal hold have already passed at its execution; or
// - an AccessRequest whose distribution was released, which its approved,
//   in-force decision gated.
// Every shipped specimen must be one the authorization names. The sender is
// in the caller's organization scope; the receipt is recorded by the
// recipient's scope.

class ShipmentError extends Error {
  constructor(message, statusCode, code, details = {}) {
    super(message);
    this.name = 'ShipmentError';
    this.statusCode = statusCode;
    this.code = code;
    Object.assign(this, details);
  }
}

const SPECIMEN_ENTITY_TYPES = ['Specimen', 'Sample'];

// Each id a record names, matched by the specimen's canonical id or its _id.
function covers(namedIds, sample) {
  const named = new Set(namedIds.map(String));
  return named.has(String(sample.specimenId)) || named.has(String(sample._id));
}

async function authorizedIdsOf(db, data) {
  if (data.dispositionActionId) {
    const action = await (await getCollection(db, 'dispositionActions')).findOne({ dispositionActionId: String(data.dispositionActionId) });
    if (!action) throw new ShipmentError('Ação de destinação não encontrada', 404, 'AUTHORIZATION_NOT_FOUND');
    if (action.dispositionAction !== 'transfer' || !SPECIMEN_ENTITY_TYPES.includes(action.entityType)) {
      throw new ShipmentError('A ação de destinação não é uma transferência de espécimes', 422, 'AUTHORIZATION_NOT_TRANSFER');
    }
    if ((action.actionStatus || 'executed') !== 'executed') {
      throw new ShipmentError(`A transferência está em ${action.actionStatus}: a remessa exige a transferência executada`, 409, 'AUTHORIZATION_NOT_EXECUTED');
    }
    return action.affectedRecordIds || [];
  }
  const request = await (await getCollection(db, 'accessRequests')).findOne({ accessRequestId: String(data.accessRequestId) });
  if (!request) throw new ShipmentError('Solicitação de acesso não encontrada', 404, 'AUTHORIZATION_NOT_FOUND');
  if (request.distributionStatus !== 'released') {
    throw new ShipmentError(`A solicitação está em distribuição ${request.distributionStatus || 'pending'}: a remessa exige a distribuição liberada`, 409, 'AUTHORIZATION_NOT_RELEASED');
  }
  return (request.requestedItems || []).map((item) => item.itemId);
}

async function createShipment(db, data = {}, { actorId = null, organizationScope = { scope: 'global' } } = {}) {
  const validation = ShipmentModel.validate(data);
  if (!validation.isValid) {
    throw new ShipmentError(validation.errors.join(', '), 422, 'VALIDATION_ERROR', { details: validation.errors });
  }
  if (!isRecordInOrganizationScope(data, organizationScope, 'senderOrganization')) {
    throw new ShipmentError('A organização remetente está fora do seu escopo', 403, 'OUT_OF_SCOPE');
  }
  const organizations = await getCollection(db, 'organizations');
  for (const field of ['senderOrganization', 'recipientOrganization']) {
    if (!await organizations.findOne({ organizationId: String(data[field]).trim() })) {
      throw new ShipmentError(`${field} ${data[field]} não corresponde a uma organização`, 422, 'ORGANIZATION_NOT_FOUND');
    }
  }

  const samples = await getCollection(db, 'samples');
  const authorizedIds = await authorizedIdsOf(db, data);
  const specimenIds = [];
  for (const id of data.specimenIds) {
    const sample = await findSampleByAnyId(samples, String(id).trim());
    if (!sample) throw new ShipmentError(`Espécime ${id} não encontrado`, 422, 'SPECIMEN_NOT_FOUND');
    if (!covers(authorizedIds, sample)) {
      throw new ShipmentError(`Espécime ${id} não está na autorização da remessa`, 422, 'SPECIMEN_NOT_AUTHORIZED');
    }
    specimenIds.push(sample.specimenId || String(sample._id));
  }

  const shipment = ShipmentModel.create({ ...data, specimenIds, createdBy: actorId });
  await (await getCollection(db, 'shipments')).insertOne(shipment);
  return shipment;
}

function isVisibleTo(shipment, organizationScope) {
  return isRecordInOrganizationScope(shipment, organizationScope, 'senderOrganization')
    || isRecordInOrganizationScope(shipment, organizationScope, 'recipientOrganization');
}

async function receiveShipment(db, shipmentId, data = {}, { actorId = null, organizationScope = { scope: 'global' } } = {}) {
  const collection = await getCollection(db, 'shipments');
  const shipment = await collection.findOne({ shipmentId: String(shipmentId) });
  if (!shipment) throw new ShipmentError('Remessa não encontrada', 404, 'SHIPMENT_NOT_FOUND');
  if (!isRecordInOrganizationScope(shipment, organizationScope, 'recipientOrganization')) {
    throw new ShipmentError('O recebimento é registrado pela organização destinatária', 403, 'OUT_OF_SCOPE');
  }
  if (shipment.shipmentStatus !== 'dispatched') {
    throw new ShipmentError(`Remessa em ${shipment.shipmentStatus}: o recebimento já foi registrado`, 409, 'ALREADY_RECEIVED');
  }
  const { errors, set } = ShipmentModel.receipt(shipment, { ...data, receivedBy: actorId });
  if (errors.length > 0) throw new ShipmentError(errors.join(', '), 422, 'VALIDATION_ERROR', { details: errors });
  const result = await collection.updateOne({ shipmentId: shipment.shipmentId, shipmentStatus: 'dispatched' }, { $set: set });
  if (!result || result.matchedCount === 0) {
    throw new ShipmentError('Remessa alterada concorrentemente; leia-a de novo', 409, 'CONCURRENT_UPDATE');
  }
  return collection.findOne({ shipmentId: shipment.shipmentId });
}

async function getShipment(db, shipmentId, organizationScope = { scope: 'global' }) {
  const shipment = await (await getCollection(db, 'shipments')).findOne({ shipmentId: String(shipmentId) });
  if (!shipment) throw new ShipmentError('Remessa não encontrada', 404, 'SHIPMENT_NOT_FOUND');
  if (!isVisibleTo(shipment, organizationScope)) throw new ShipmentError('Esta remessa pertence a outras organizações', 403, 'OUT_OF_SCOPE');
  return shipment;
}

async function listShipments(db, organizationScope = { scope: 'global' }) {
  const filter = organizationScope.scope === 'global'
    ? {}
    : { $or: [{ senderOrganization: { $in: organizationScope.organizationIds } }, { recipientOrganization: { $in: organizationScope.organizationIds } }] };
  return (await getCollection(db, 'shipments')).find(filter).sort({ dispatchDateTime: -1 }).toArray();
}

module.exports = { ShipmentError, createShipment, receiveShipment, getShipment, listShipments };
