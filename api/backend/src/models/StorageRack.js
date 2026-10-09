const crypto = require('crypto');
const StoragePositionModel = require('./StoragePosition');

// Canonical Data Model v2.0.0 StorageRack (V2E-0655..0663), RF016 AC2:
// "model rack, position and container separately; for the approved fixture,
// prepare an 8 by 12 grid with 96 unique positions". The grid is derived
// from the rack's rowCount, columnCount, coordinateScheme and
// orientationRule, so a rack's positions are a function of the rack.
//
// coordinateScheme, orientationRule and status accept the catalog's one
// example value each: alpha_numeric (row letter, two-digit column, `A01`),
// top_left_origin (row A at the top, column 01 at the left) and active.
const COORDINATE_SCHEME_VALUES = ['alpha_numeric'];
const ORIENTATION_RULE_VALUES = ['top_left_origin'];
const RACK_STATUS_VALUES = ['active'];
const ROW_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// The approved fixture of RF016 AC2: 8 rows (A-H) by 12 columns (01-12).
const APPROVED_FIXTURE = Object.freeze({
  rackType: 'cryogenic_rack',
  rowCount: 8,
  columnCount: 12,
  coordinateScheme: 'alpha_numeric',
  orientationRule: 'top_left_origin',
});

class StorageRackModel {
  static fieldsOf(data = {}) {
    return {
      storageRackId: data.storageRackId || crypto.randomUUID(),
      rackType: data.rackType ?? null,
      rowCount: data.rowCount ?? null,
      columnCount: data.columnCount ?? null,
      coordinateScheme: data.coordinateScheme || 'alpha_numeric',
      orientationRule: data.orientationRule || 'top_left_origin',
      storageLocationId: data.storageLocationId ? String(data.storageLocationId) : null,
      catalogReference: data.catalogReference ?? null,
      status: data.status ? String(data.status).toLowerCase() : 'active',
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    if (!fields.rackType) throw new Error('rackType é obrigatório para StorageRack (1..1)');
    if (!Number.isInteger(fields.rowCount) || fields.rowCount < 1 || fields.rowCount > ROW_LETTERS.length) {
      throw new Error(`rowCount deve ser um inteiro de 1 a ${ROW_LETTERS.length} no esquema alpha_numeric`);
    }
    if (!Number.isInteger(fields.columnCount) || fields.columnCount < 1 || fields.columnCount > 99) {
      throw new Error('columnCount deve ser um inteiro de 1 a 99 no esquema alpha_numeric');
    }
    if (!COORDINATE_SCHEME_VALUES.includes(fields.coordinateScheme)) {
      throw new Error(`coordinateScheme inválido: ${fields.coordinateScheme}`);
    }
    if (!ORIENTATION_RULE_VALUES.includes(fields.orientationRule)) {
      throw new Error(`orientationRule inválido: ${fields.orientationRule}`);
    }
    if (!RACK_STATUS_VALUES.includes(fields.status)) {
      throw new Error(`status inválido: ${fields.status}`);
    }
    return fields;
  }

  static createApprovedFixture(data = {}) {
    return this.create({ ...APPROVED_FIXTURE, ...data });
  }

  // alpha_numeric: the row letter and the two-digit column, `A01`.
  static positionCode(rowIndex, columnIndex) {
    return `${ROW_LETTERS[rowIndex - 1]}${String(columnIndex).padStart(2, '0')}`;
  }

  // Every position of the rack's grid in top_left_origin order: row A
  // first, columns 01 upwards within a row.
  static positionsOf(rack) {
    const positions = [];
    for (let rowIndex = 1; rowIndex <= rack.rowCount; rowIndex += 1) {
      for (let columnIndex = 1; columnIndex <= rack.columnCount; columnIndex += 1) {
        positions.push(StoragePositionModel.create({
          storageRackId: rack.storageRackId,
          rowIndex,
          columnIndex,
          positionCode: this.positionCode(rowIndex, columnIndex),
        }));
      }
    }
    return positions;
  }
}

module.exports = StorageRackModel;
module.exports.APPROVED_FIXTURE = APPROVED_FIXTURE;
module.exports.COORDINATE_SCHEME_VALUES = COORDINATE_SCHEME_VALUES;
module.exports.ORIENTATION_RULE_VALUES = ORIENTATION_RULE_VALUES;
module.exports.RACK_STATUS_VALUES = RACK_STATUS_VALUES;
