const crypto = require('crypto');

// #660 (RF024 AC5, RF026): Canonical Data Model v2.0.0 Shipment
// (ELM-0396..0407, domain "Transporte e distribuição"): who sent which
// specimens to which organization, under which transfer agreement, packed
// how, and in what condition they arrived.
//
// Local extensions, none of them a canonical row:
// - `shipmentStatus`, `dispatched` then `received`: the receipt is recorded
//   once, after the dispatch.
// - `dispositionActionId` or `accessRequestId`: the authorization the
//   shipment carries out, an executed transfer DispositionAction or a
//   released AccessRequest. RF024 AC5 links an approval to the remessa.
// - `createdBy`, `receivedBy`, `createdAt`, `updatedAt`.
//
// `mtaId` (ELM-0400, 1..1 Reference) maps to FHIR Contract, and dictionary
// v2.0.0 holds no MTA entity, so it is kept as the agreement's own reference.
// [inference] Like an evidence id, it names the document; nothing resolves it.

const SHIPMENT_STATUSES = ['dispatched', 'received'];
// ELM-0407 "Integridade, temperatura, embalagem e discrepâncias".
const RECEIPT_CONDITION_KEYS = ['integrity', 'temperature', 'packaging', 'discrepancies'];

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validDate(value) {
  if (value === undefined || value === null || value === '') return false;
  return !Number.isNaN(new Date(value).getTime());
}

// A CodeableConcept given as its code, or as `{ code, display }`.
function packagingOf(value) {
  if (nonEmptyString(value)) return { code: value.trim(), display: null };
  if (value && typeof value === 'object' && nonEmptyString(value.code)) {
    return { code: value.code.trim(), display: nonEmptyString(value.display) ? value.display.trim() : null };
  }
  return null;
}

function optionalString(value) {
  return nonEmptyString(value) ? value.trim() : null;
}

class ShipmentModel {
  /** The canonical element names, for the catalog conformance test. */
  static fieldsOf(data = {}) {
    return {
      shipmentId: data.shipmentId,
      specimenIds: data.specimenIds,
      senderOrganization: data.senderOrganization,
      recipientOrganization: data.recipientOrganization,
      mtaId: data.mtaId,
      carrier: data.carrier,
      trackingNumber: data.trackingNumber,
      packagingType: data.packagingType,
      temperatureLoggerId: data.temperatureLoggerId,
      dispatchDateTime: data.dispatchDateTime,
      receiptDateTime: data.receiptDateTime,
      conditionOnReceipt: data.conditionOnReceipt,
    };
  }

  static validate(data = {}) {
    const errors = [];
    if (!Array.isArray(data.specimenIds) || data.specimenIds.length === 0) {
      errors.push('specimenIds é obrigatório e deve ser um array não vazio (ELM-0397)');
    } else if (data.specimenIds.some((value) => !nonEmptyString(value))) {
      errors.push('specimenIds deve conter apenas strings não vazias');
    }
    for (const [field, code] of [['senderOrganization', 'ELM-0398'], ['recipientOrganization', 'ELM-0399'], ['mtaId', 'ELM-0400']]) {
      if (!nonEmptyString(data[field])) errors.push(`${field} é obrigatório (${code})`);
    }
    if (nonEmptyString(data.senderOrganization) && data.senderOrganization === data.recipientOrganization) {
      errors.push('recipientOrganization deve ser outra organização que não a remetente');
    }
    if (!packagingOf(data.packagingType)) {
      errors.push('packagingType é obrigatório: um código ou { code, display } (ELM-0403)');
    }
    if (!validDate(data.dispatchDateTime)) {
      errors.push('dispatchDateTime é obrigatório e deve ser uma data ISO 8601 (ELM-0405)');
    }
    for (const field of ['carrier', 'trackingNumber', 'temperatureLoggerId']) {
      if (data[field] !== undefined && data[field] !== null && typeof data[field] !== 'string') {
        errors.push(`${field} deve ser string`);
      }
    }
    const authorizations = [data.dispositionActionId, data.accessRequestId].filter(nonEmptyString);
    if (authorizations.length !== 1) {
      errors.push('Informe exatamente uma autorização: dispositionActionId (transferência executada) ou accessRequestId (solicitação distribuída)');
    }
    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    const now = new Date();
    return {
      shipmentId: crypto.randomUUID(),
      specimenIds: data.specimenIds.map((value) => value.trim()),
      senderOrganization: data.senderOrganization.trim(),
      recipientOrganization: data.recipientOrganization.trim(),
      mtaId: data.mtaId.trim(),
      carrier: optionalString(data.carrier),
      trackingNumber: optionalString(data.trackingNumber),
      packagingType: packagingOf(data.packagingType),
      temperatureLoggerId: optionalString(data.temperatureLoggerId),
      dispatchDateTime: new Date(data.dispatchDateTime),
      receiptDateTime: null,
      conditionOnReceipt: null,
      shipmentStatus: 'dispatched',
      dispositionActionId: optionalString(data.dispositionActionId),
      accessRequestId: optionalString(data.accessRequestId),
      createdBy: data.createdBy ?? null,
      receivedBy: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** The receipt's own fields, or the errors that refuse it. */
  static receipt(shipment, data = {}) {
    const errors = [];
    if (!validDate(data.receiptDateTime)) {
      errors.push('receiptDateTime é obrigatório e deve ser uma data ISO 8601 (ELM-0406)');
    } else if (new Date(data.receiptDateTime) < new Date(shipment.dispatchDateTime)) {
      errors.push('receiptDateTime não pode ser anterior a dispatchDateTime');
    }
    const condition = data.conditionOnReceipt;
    if (condition !== undefined && condition !== null) {
      if (typeof condition !== 'object' || Array.isArray(condition)) {
        errors.push('conditionOnReceipt deve ser um objeto');
      } else {
        const unknown = Object.keys(condition).filter((key) => !RECEIPT_CONDITION_KEYS.includes(key));
        if (unknown.length > 0) errors.push(`conditionOnReceipt aceita só: ${RECEIPT_CONDITION_KEYS.join(', ')}`);
      }
    }
    if (errors.length > 0) return { errors };
    return {
      errors: [],
      set: {
        receiptDateTime: new Date(data.receiptDateTime),
        conditionOnReceipt: condition
          ? Object.fromEntries(RECEIPT_CONDITION_KEYS.map((key) => [key, condition[key] ?? null]))
          : null,
        shipmentStatus: 'received',
        receivedBy: data.receivedBy ?? null,
        updatedAt: new Date(),
      },
    };
  }
}

module.exports = ShipmentModel;
module.exports.SHIPMENT_STATUSES = SHIPMENT_STATUSES;
module.exports.RECEIPT_CONDITION_KEYS = RECEIPT_CONDITION_KEYS;
