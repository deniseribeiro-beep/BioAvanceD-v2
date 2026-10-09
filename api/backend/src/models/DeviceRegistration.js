const crypto = require('crypto');

// Canonical Data Model v2.0.0 DeviceRegistration (V2E-0618..0623), RF017
// AC7 (#1316): a device enrolled on a communication profile. The credential
// stays outside the canonical payload; the registration records only an
// opaque credentialReference into the secret manager, in the catalog's
// `secret-manager:device/sensor-001` form.
const STATUS_VALUES = ['active', 'suspended', 'revoked'];

// `<manager>:<path>`: a lowercase scheme naming the store, then a path of
// plain segments. A bearer token, a key or a password does not fit it: no
// spaces, no `=`, no `+`, nothing a base64 or JWT secret needs.
const CREDENTIAL_REFERENCE = /^[a-z][a-z0-9-]*:[A-Za-z0-9._\-/]+$/;
// A field under any of these names would carry the credential itself.
const SECRET_FIELDS = ['credential', 'secret', 'password', 'token', 'apiKey', 'privateKey', 'clientSecret'];

function optionalString(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

class DeviceRegistrationModel {
  static fieldsOf(data = {}) {
    return {
      deviceRegistrationId: data.deviceRegistrationId || crypto.randomUUID(),
      deviceId: optionalString(data.deviceId),
      communicationProfileId: optionalString(data.communicationProfileId),
      credentialReference: optionalString(data.credentialReference),
      registeredAt: data.registeredAt ? new Date(data.registeredAt) : null,
      status: data.status ? String(data.status).toLowerCase() : 'active',
    };
  }

  // Only the canonical fields are kept, so a credential sent beside them
  // never reaches storage; one sent at all is refused, so the sender learns.
  static create(data = {}) {
    const carried = SECRET_FIELDS.filter((field) => data[field] !== undefined);
    if (carried.length) {
      throw new Error(`A credencial não entra no payload canônico (${carried.join(', ')}): registre só credentialReference (RF017 AC7)`);
    }
    const fields = this.fieldsOf(data);
    for (const field of ['deviceId', 'communicationProfileId', 'credentialReference']) {
      if (!fields[field]) throw new Error(`${field} é obrigatório para DeviceRegistration (1..1)`);
    }
    if (!CREDENTIAL_REFERENCE.test(fields.credentialReference)) {
      throw new Error('credentialReference deve ser uma referência opaca <gerenciador>:<caminho>, nunca a credencial (RF017 AC7)');
    }
    if (!STATUS_VALUES.includes(fields.status)) throw new Error(`status inválido: ${fields.status}`);
    const registeredAt = fields.registeredAt || new Date();
    if (Number.isNaN(registeredAt.getTime())) throw new Error('registeredAt deve ser uma data ISO 8601');
    return { ...fields, registeredAt };
  }
}

module.exports = DeviceRegistrationModel;
module.exports.STATUS_VALUES = STATUS_VALUES;
module.exports.SECRET_FIELDS = SECRET_FIELDS;
