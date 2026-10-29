const crypto = require('crypto');

// RF017 AC6/AC8 (#1316): a device's installation, movement, homologation and
// retirement, recorded as an append-only history. The canon names no entity
// for it (dict v2.0.0 has Device, DeviceProfile, DeviceRegistration and
// DeviceCommunicationProfile, none with a history), so this is a documented
// local record, not a canonical one, and stays out of the catalog guard.
//
// Each event moves the device's derived state, which the service stamps on
// the Device row: where it is installed, whether it is homologated, and
// whether it is retired. Retirement is final.
const EVENT_TYPES = ['installed', 'moved', 'qualified', 'disqualified', 'retired'];

// Device.qualificationStatus (ELM-0312) names `qualified` alone. `pending`,
// a registered device not yet homologated, and `disqualified`, one whose
// homologation was withdrawn, are local extensions; only `qualified` makes a
// device usable.
const QUALIFICATION_STATUSES = ['pending', 'qualified', 'disqualified'];

function optionalString(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

class DeviceLifecycleEventModel {
  static create(data = {}) {
    const event = {
      deviceLifecycleEventId: data.deviceLifecycleEventId || crypto.randomUUID(),
      deviceId: optionalString(data.deviceId),
      eventType: data.eventType ? String(data.eventType).toLowerCase() : null,
      locationId: optionalString(data.locationId),
      reason: optionalString(data.reason),
      evidenceUri: optionalString(data.evidenceUri),
      actorId: optionalString(data.actorId),
      occurredAt: data.occurredAt ? new Date(data.occurredAt) : new Date(),
    };
    if (!event.deviceId) throw new Error('deviceId é obrigatório');
    if (!EVENT_TYPES.includes(event.eventType)) {
      throw new Error(`eventType deve ser um de: ${EVENT_TYPES.join(', ')}`);
    }
    if (Number.isNaN(event.occurredAt.getTime())) throw new Error('occurredAt deve ser uma data ISO 8601');
    if (['installed', 'moved'].includes(event.eventType) && !event.locationId) {
      throw new Error(`locationId é obrigatório para ${event.eventType}`);
    }
    if (event.eventType === 'qualified' && !event.evidenceUri) {
      throw new Error('evidenceUri é obrigatório para homologação');
    }
    if (['disqualified', 'retired'].includes(event.eventType) && !event.reason) {
      throw new Error(`reason é obrigatório para ${event.eventType}`);
    }
    return event;
  }

  // The device's state after the event, or a refusal. `state` is the
  // derived fields the Device row carries.
  static apply(state, event) {
    if (state.retiredAt) throw new Error(`Dispositivo ${event.deviceId} retirado: nenhum evento posterior`);
    switch (event.eventType) {
      case 'installed':
        if (state.currentLocationId) throw new Error(`Dispositivo ${event.deviceId} já instalado em ${state.currentLocationId}`);
        return { ...state, currentLocationId: event.locationId };
      case 'moved':
        if (!state.currentLocationId) throw new Error(`Dispositivo ${event.deviceId} não está instalado`);
        if (state.currentLocationId === event.locationId) throw new Error(`Dispositivo ${event.deviceId} já está em ${event.locationId}`);
        return { ...state, currentLocationId: event.locationId };
      case 'qualified':
        return { ...state, qualificationStatus: 'qualified' };
      case 'disqualified':
        return { ...state, qualificationStatus: 'disqualified' };
      case 'retired':
        return { ...state, currentLocationId: null, retiredAt: event.occurredAt };
      default:
        throw new Error(`eventType inválido: ${event.eventType}`);
    }
  }

  // RF017 AC8: why a device may not be used now, or null.
  static usabilityRefusal(device) {
    if (!device) return 'Dispositivo não registrado';
    if (device.retiredAt) return `Dispositivo ${device.deviceId} retirado`;
    if (device.qualificationStatus !== 'qualified') {
      return `Dispositivo ${device.deviceId} não homologado (qualificationStatus: ${device.qualificationStatus || 'ausente'})`;
    }
    return null;
  }
}

module.exports = DeviceLifecycleEventModel;
module.exports.EVENT_TYPES = EVENT_TYPES;
module.exports.QUALIFICATION_STATUSES = QUALIFICATION_STATUSES;
