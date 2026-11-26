const { getCollection } = require('../utils/collectionResolver');
const ProtocolModel = require('../models/PhysicalIdentificationValidationProtocol');

// RF016 AC7, RULE-037 (#1514): the ex ante physical identification protocol
// is registered here, and a run of it is authorized only through
// ProtocolModel.assertExecutable on the stored record: approvalStatus
// approved_for_execution and, in the ex_ante_synthetic scope,
// realSpecimenUse false. The authorization is not a result of the assay.

const COLLECTION = 'physicalIdentificationValidationProtocols';

class ValidationProtocolError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = 'ValidationProtocolError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

async function registerProtocol(db, data = {}) {
  // A given id is a non-empty string: a number would be stored under a key
  // the executions route, reading a path parameter, never reaches, and an
  // object would reach findOne as a query operator.
  const id = data.physicalIdentificationValidationProtocolId;
  if (id !== undefined && id !== null && (typeof id !== 'string' || id.trim() === '')) {
    throw new ValidationProtocolError('physicalIdentificationValidationProtocolId deve ser um texto não vazio', 'VALIDATION_ERROR', 422);
  }
  let protocol;
  try {
    protocol = ProtocolModel.create(data);
  } catch (error) {
    throw new ValidationProtocolError(error.message, 'VALIDATION_ERROR', 422);
  }
  // V2E-0709: an approved protocol carries a real approvedAt; an unparseable
  // one becomes an Invalid Date the model's presence check lets through.
  if (protocol.approvalStatus === 'approved_for_execution' && Number.isNaN(protocol.approvedAt?.getTime?.())) {
    throw new ValidationProtocolError('approvedAt deve ser uma data ISO 8601 (V2E-0709)', 'VALIDATION_ERROR', 422);
  }
  const collection = await getCollection(db, COLLECTION);
  const clash = await collection.findOne({
    $or: [
      { physicalIdentificationValidationProtocolId: protocol.physicalIdentificationValidationProtocolId },
      { protocolVersion: protocol.protocolVersion },
    ],
  });
  if (clash) {
    throw new ValidationProtocolError(`Protocolo ${protocol.protocolVersion} já registrado`, 'PROTOCOL_EXISTS', 409);
  }
  await collection.insertOne({ ...protocol });
  return protocol;
}

async function authorizeExecution(db, protocolId) {
  const collection = await getCollection(db, COLLECTION);
  const protocol = await collection.findOne({ physicalIdentificationValidationProtocolId: String(protocolId) });
  if (!protocol) {
    throw new ValidationProtocolError(`Protocolo ${protocolId} não encontrado`, 'PROTOCOL_NOT_FOUND', 404);
  }
  try {
    ProtocolModel.assertExecutable(protocol);
  } catch (error) {
    throw new ValidationProtocolError(error.message, 'PROTOCOL_NOT_EXECUTABLE', 409);
  }
  return {
    physicalIdentificationValidationProtocolId: protocol.physicalIdentificationValidationProtocolId,
    protocolVersion: protocol.protocolVersion,
    scope: protocol.scope,
    approvalStatus: protocol.approvalStatus,
    realSpecimenUse: protocol.realSpecimenUse,
    authorizedAt: new Date(),
  };
}

module.exports = { registerProtocol, authorizeExecution };
