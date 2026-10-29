const crypto = require('crypto');

// Canonical Data Model v2.0.0 Container (V2E-0646..0654), RF016 AC1: the
// tube or vial the Data Matrix identifies. A container exists before any
// specimen does, and an empty one never implies a Specimen (RULE-031,
// RULE-032). Its content is a SpecimenContainerAssignment, never a field
// here.
//
// emptyStatus (V2E-0648) follows its catalog description: empty, occupied,
// or content not confirmed. status (V2E-0653) lists only `active` in the
// catalog, and that is the one value accepted.
const EMPTY_STATUS_VALUES = ['empty', 'occupied', 'unconfirmed'];
const CONTAINER_STATUS_VALUES = ['active'];

class ContainerModel {
  static fieldsOf(data = {}) {
    return {
      containerId: data.containerId || crypto.randomUUID(),
      containerType: data.containerType ?? null,
      emptyStatus: data.emptyStatus ? String(data.emptyStatus).toLowerCase() : 'empty',
      manufacturerMetadata: data.manufacturerMetadata ?? null,
      catalogReference: data.catalogReference ?? null,
      lotIdentifier: data.lotIdentifier ?? null,
      capacity: data.capacity ?? null,
      status: data.status ? String(data.status).toLowerCase() : 'active',
      createdAt: data.createdAt ? new Date(data.createdAt) : null,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    if (!fields.containerType) {
      throw new Error('containerType é obrigatório para Container (1..1)');
    }
    if (!EMPTY_STATUS_VALUES.includes(fields.emptyStatus)) {
      throw new Error(`emptyStatus inválido: ${fields.emptyStatus}`);
    }
    if (!CONTAINER_STATUS_VALUES.includes(fields.status)) {
      throw new Error(`status inválido: ${fields.status}`);
    }
    return { ...fields, createdAt: fields.createdAt || new Date() };
  }

  // RULE-031/RULE-032: a container's emptiness follows its active content.
  static withContent(container, hasActiveAssignment) {
    return { ...container, emptyStatus: hasActiveAssignment ? 'occupied' : 'empty' };
  }
}

module.exports = ContainerModel;
module.exports.EMPTY_STATUS_VALUES = EMPTY_STATUS_VALUES;
module.exports.CONTAINER_STATUS_VALUES = CONTAINER_STATUS_VALUES;
