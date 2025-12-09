// Implementação dos métodos da classe Sensor conforme diagrama UML

import { Sensor, Temperature } from '../types/models';

/**
 * Coleta leitura de temperatura do sensor
 * Implementa: Sensor.collectReading(): TemperatureLog
 * Retorna Temperature (TemperatureLog não existe no diagrama, retornamos Temperature)
 */
export function collectReading(sensor: Sensor): Temperature {
  // Simula coleta de leitura do sensor
  const reading: Temperature = {
    logID: `TEMP-${Date.now()}`,
    timestamp: new Date(),
    temperatureValue: -80.0, // Valor simulado
    temperatureUnit: '°C',
    readingStatus: 'valid',
    dataQualityScore: 0.95,
    sensorID: sensor.sensorID,
    policyID: sensor.policyID,
  };
  
  return reading;
}


