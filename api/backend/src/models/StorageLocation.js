const crypto = require('crypto');

// Canonical Data Model v2.0.0 StorageLocation (P1X-0098..0104), RF017
// AC1/AC3/AC8: a place in the configured physical hierarchy (a facility, a
// room, a freezer) that a rack is located at. Each location belongs to one
// organization (P1X-0103, 1..1), so a rack's tenancy is its location's.
//
// - locationType is a free code (P1X-0099 is `code` with no closed list;
//   the catalog's one example is `facility`), lowercased.
// - parentLocationId (P1X-0102, 0..1) builds the hierarchy of RF017 AC1.
// - locationStatus: the catalog gives `active`. RF017 AC8 asks to block a
//   location that is unavailable or interdicted, so `unavailable` and
//   `interdicted` are documented local values, and only `active` is usable.
const LOCATION_STATUS_VALUES = ['active', 'unavailable', 'interdicted'];
const USABLE_STATUS = 'active';

class StorageLocationModel {
  static fieldsOf(data = {}) {
    return {
      storageLocationId: data.storageLocationId ? String(data.storageLocationId) : crypto.randomUUID(),
      locationType: data.locationType ? String(data.locationType).trim().toLowerCase() : null,
      name: data.name ? String(data.name).trim() : null,
      code: data.code ? String(data.code).trim() : null,
      parentLocationId: data.parentLocationId ? String(data.parentLocationId) : null,
      organizationId: data.organizationId ? String(data.organizationId) : null,
      locationStatus: data.locationStatus ? String(data.locationStatus).toLowerCase() : 'active',
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    for (const field of ['locationType', 'name', 'code', 'organizationId']) {
      if (!fields[field]) {
        throw new Error(`${field} é obrigatório para StorageLocation (1..1)`);
      }
    }
    this.assertStatus(fields.locationStatus);
    if (fields.parentLocationId === fields.storageLocationId) {
      throw new Error('parentLocationId não pode ser o próprio local');
    }
    return fields;
  }

  static assertStatus(locationStatus) {
    if (!LOCATION_STATUS_VALUES.includes(locationStatus)) {
      throw new Error(`locationStatus inválido: ${locationStatus}`);
    }
  }

  // RF017 AC1: a child stays in its parent's organization, so a location's
  // tenancy never crosses organizations along the hierarchy.
  static assertParentCompatible(location, parent) {
    if (String(parent.organizationId) !== String(location.organizationId)) {
      throw new Error(`Local pai ${parent.storageLocationId} pertence a outra organização`);
    }
  }

  static isUsable(location) {
    return location.locationStatus === USABLE_STATUS;
  }
}

module.exports = StorageLocationModel;
module.exports.LOCATION_STATUS_VALUES = LOCATION_STATUS_VALUES;
