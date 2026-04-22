import { describe, it, expect } from 'vitest';

const SensorModel = require('../../src/models/Sensor');
const TemperatureModel = require('../../src/models/Temperature');
const PolicyModel = require('../../src/models/Policy');
const TemperatureIncidentModel = require('../../src/models/TemperatureIncident');

describe('SensorModel', () => {
  it('valida sensor com identificador, tipo e status válidos', () => {
    const result = SensorModel.validate({
      sensorId: 'S-100',
      sensorType: 'thermometer',
      maintenanceStatus: 'operational'
    });

    expect(result).toEqual({ isValid: true, errors: [] });
  });

  it('rejeita sensor sem id e com status inválido', () => {
    const result = SensorModel.validate({
      sensorType: 'thermometer',
      maintenanceStatus: 'broken'
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('sensorId é obrigatório');
    expect(result.errors).toContain('maintenanceStatus inválido');
  });

  it('cria sensor com defaults esperados', () => {
    const created = SensorModel.create({
      sensorID: 'S-200',
      sensorType: 'fridge',
      locationID: 'LOC-1',
      policyID: 'POL-1',
      lastCalibration: '2024-01-10T00:00:00.000Z'
    });

    expect(created.sensorId).toBe('S-200');
    expect(created.maintenanceStatus).toBe('operational');
    expect(created.locationId).toBe('LOC-1');
    expect(created.policyId).toBe('POL-1');
    expect(created.lastCalibration).toBeInstanceOf(Date);
    expect(created.createdAt).toBeInstanceOf(Date);
  });
});

describe('TemperatureModel', () => {
  it('valida leitura completa dentro das regras', () => {
    const result = TemperatureModel.validate({
      sensorId: 'S-100',
      temperatureValue: 4.2,
      temperatureUnit: '°C',
      readingStatus: 'valid',
      sensorStatus: 'normal',
      signalQuality: 'good',
      maintenanceStatus: 'ok',
      batteryLevel: 88,
      dataQualityScore: 0.95
    });

    expect(result).toEqual({ isValid: true, errors: [] });
  });

  it('rejeita leitura com unidade e campos inválidos', () => {
    const result = TemperatureModel.validate({
      sensorID: 'S-100',
      temperatureValue: '4.2',
      temperatureUnit: 'CELSIUS',
      readingStatus: 'strange',
      sensorStatus: 'offline',
      signalQuality: 'average',
      maintenanceStatus: 'late',
      batteryLevel: 120,
      dataQualityScore: 1.5
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('temperatureValue é obrigatório e deve ser number');
    expect(result.errors).toContain('temperatureUnit deve ser °C, °F ou K');
    expect(result.errors).toContain('readingStatus deve ser: valid, invalid ou suspicious');
    expect(result.errors).toContain('sensorStatus deve ser: normal, faulty ou maintenance');
    expect(result.errors).toContain('signalQuality deve ser: excellent, good, poor ou lost');
    expect(result.errors).toContain('maintenanceStatus deve ser: ok, pending ou overdue');
    expect(result.errors).toContain('batteryLevel deve ser entre 0 e 100');
    expect(result.errors).toContain('dataQualityScore deve ser entre 0 e 1');
  });

  it('cria leitura com defaults e conversões esperadas', () => {
    const created = TemperatureModel.create({
      sensorID: 'S-300',
      temperatureValue: 3.7,
      facility: 'Central',
      zone: 'Freezer A',
      lastCalibration: '2024-01-10T00:00:00.000Z'
    });

    expect(created.sensorId).toBe('S-300');
    expect(created.temperatureUnit).toBe('°C');
    expect(created.readingStatus).toBe('valid');
    expect(created.sensorStatus).toBe('normal');
    expect(created.lastCalibration).toBeInstanceOf(Date);
    expect(created.createdAt).toBeInstanceOf(Date);
  });

  it('avalia intervalo e condição de alerta', () => {
    expect(TemperatureModel.validateReading(4, 2, 8)).toBe(true);
    expect(TemperatureModel.validateReading(9, 2, 8)).toBe(false);
    expect(TemperatureModel.validateTemperatureUnit('K')).toBe(true);
    expect(TemperatureModel.validateTemperatureUnit('CELSIUS')).toBe(false);
    expect(TemperatureModel.shouldGenerateAlert(9, 2, 8, 5)).toBe(true);
    expect(TemperatureModel.shouldGenerateAlert(5, 2, 8, 5)).toBe(false);
  });
});

describe('PolicyModel', () => {
  it('valida política com limites coerentes', () => {
    const result = PolicyModel.validate({
      minThreshold: 2,
      maxThreshold: 8,
      targetTemperature: 5,
      temperatureUnit: '°C'
    });

    expect(result).toEqual({ isValid: true, errors: [] });
  });

  it('rejeita política com limites invertidos e unidade inválida', () => {
    const result = PolicyModel.validate({
      minThreshold: 8,
      maxThreshold: 2,
      targetTemperature: '5',
      temperatureUnit: 'K'
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('minThreshold deve ser menor que maxThreshold');
    expect(result.errors).toContain('targetTemperature é obrigatório e deve ser number');
    expect(result.errors).toContain('temperatureUnit deve ser °C ou °F');
  });

  it('cria política com defaults esperados', () => {
    const created = PolicyModel.create({
      policyID: 'POL-10',
      minThreshold: 2,
      maxThreshold: 8,
      targetTemperature: 5,
      validFrom: '2024-01-10T00:00:00.000Z'
    });

    expect(created.policyId).toBe('POL-10');
    expect(created.hysteresis).toBe(0.5);
    expect(created.alertDelayMin).toBe(5);
    expect(created.temperatureUnit).toBe('°C');
    expect(created.validFrom).toBeInstanceOf(Date);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);
  });

  it('compara faixas de temperatura corretamente', () => {
    expect(PolicyModel.validateThresholds(2, 8)).toBe(true);
    expect(PolicyModel.validateThresholds(8, 2)).toBe(false);
  });
});

describe('TemperatureIncidentModel', () => {
  it('valida incidente aberto completo', () => {
    const result = TemperatureIncidentModel.validate({
      sensorKey: 'S-100',
      sensorName: 'Freezer A',
      openedAt: '2024-01-10T10:00:00.000Z',
      currentTemperature: 10.5,
      maxTemperature: 8,
      minTemperature: 2,
      samplesOutOfRange: 3,
      status: 'open'
    });

    expect(result).toEqual({ isValid: true, errors: [] });
  });

  it('rejeita incidente com dados ausentes e status inválido', () => {
    const result = TemperatureIncidentModel.validate({
      sensorKey: '',
      sensorName: 10,
      openedAt: 'invalid-date',
      closedAt: 'also-invalid',
      currentTemperature: NaN,
      maxTemperature: Infinity,
      minTemperature: 'low',
      samplesOutOfRange: -1,
      status: 'ignored'
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('sensorKey é obrigatório e deve ser string');
    expect(result.errors).toContain('sensorName é obrigatório e deve ser string');
    expect(result.errors).toContain('openedAt é obrigatório e deve ser uma data válida');
    expect(result.errors).toContain('closedAt deve ser uma data válida');
    expect(result.errors).toContain('currentTemperature é obrigatório e deve ser um número');
    expect(result.errors).toContain('maxTemperature é obrigatório e deve ser um número');
    expect(result.errors).toContain('minTemperature é obrigatório e deve ser um número');
    expect(result.errors).toContain('samplesOutOfRange deve ser um número não-negativo');
    expect(result.errors).toContain('status deve ser: open, acknowledged, escalated, resolved');
  });

  it('cria incidente com defaults e normalização', () => {
    const created = TemperatureIncidentModel.create({
      sensorKey: '  S-100  ',
      sensorName: '  Freezer A  ',
      openedAt: '2024-01-10T10:00:00.000Z',
      currentTemperature: '10.5',
      maxTemperature: '8',
      minTemperature: '2',
      samplesOutOfRange: '3'
    });

    expect(created.sensorKey).toBe('S-100');
    expect(created.sensorName).toBe('Freezer A');
    expect(created.status).toBe('open');
    expect(created.escalationLevel).toBe(0);
    expect(created.openedAt).toBeInstanceOf(Date);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);
  });

  it('traduz status para rótulo legível', () => {
    expect(TemperatureIncidentModel.statusLabel('acknowledged')).toBe('Reconhecido');
    expect(TemperatureIncidentModel.statusLabel('resolved')).toBe('Resolvido');
    expect(TemperatureIncidentModel.statusLabel('other')).toBe('other');
  });
});
