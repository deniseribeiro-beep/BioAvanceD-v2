import { describe, it, expect } from 'vitest';

const TemperatureIncidentModel = require('../../src/models/TemperatureIncident');

describe('TemperatureIncidentModel', () => {
  it('valida payload obrigatorio para incidente', () => {
    const invalid = TemperatureIncidentModel.validate({
      sensorKey: '',
      sensorName: '',
      openedAt: 'invalid-date',
      currentTemperature: 'x',
      maxTemperature: null,
      minTemperature: undefined,
      samplesOutOfRange: -1,
      status: 'invalid-status',
    });

    expect(invalid.isValid).toBe(false);
    expect(invalid.errors.length).toBeGreaterThan(0);
  });

  it('cria incidente normalizado com status open por padrao', () => {
    const incident = TemperatureIncidentModel.create({
      sensorKey: '  freezer-01  ',
      sensorName: ' Sensor Principal ',
      openedAt: '2026-04-10T10:00:00.000Z',
      currentTemperature: -10.4,
      maxTemperature: -8.9,
      minTemperature: -12.7,
      samplesOutOfRange: 3,
    });

    expect(incident.sensorKey).toBe('freezer-01');
    expect(incident.sensorName).toBe('Sensor Principal');
    expect(incident.status).toBe('open');
    expect(incident.escalationLevel).toBe(0);
    expect(incident.notes).toEqual([]);
    expect(incident.createdAt).toBeInstanceOf(Date);
    expect(incident.updatedAt).toBeInstanceOf(Date);
  });
});
