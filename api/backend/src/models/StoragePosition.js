// Canonical Data Model v2.0.0 StoragePosition (V2E-0664..0669), RF016 AC2:
// one cell of a rack's grid. Its id is the rack's id and the position code,
// `rack-96-001:A01` in the catalog's own example. Occupancy is never a field
// here: it is a ContainerPositionAssignment over time. status (V2E-0669)
// lists only `available` in the catalog, and that is the one value accepted.
const POSITION_STATUS_VALUES = ['available'];

class StoragePositionModel {
  static fieldsOf(data = {}) {
    return {
      storagePositionId: data.storagePositionId ?? null,
      storageRackId: data.storageRackId ? String(data.storageRackId) : null,
      rowIndex: data.rowIndex ?? null,
      columnIndex: data.columnIndex ?? null,
      positionCode: data.positionCode ?? null,
      status: data.status ? String(data.status).toLowerCase() : 'available',
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    for (const field of ['storageRackId', 'positionCode']) {
      if (!fields[field]) throw new Error(`${field} é obrigatório para StoragePosition (1..1)`);
    }
    for (const field of ['rowIndex', 'columnIndex']) {
      if (!Number.isInteger(fields[field]) || fields[field] < 1) {
        throw new Error(`${field} deve ser um inteiro a partir de 1`);
      }
    }
    if (!POSITION_STATUS_VALUES.includes(fields.status)) {
      throw new Error(`status inválido: ${fields.status}`);
    }
    return { ...fields, storagePositionId: fields.storagePositionId || `${fields.storageRackId}:${fields.positionCode}` };
  }
}

module.exports = StoragePositionModel;
module.exports.POSITION_STATUS_VALUES = POSITION_STATUS_VALUES;
