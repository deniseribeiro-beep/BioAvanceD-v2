/**
 * #1120: reason tokens for machine-ingest rejection audits.
 * MQTT already named reasons; HTTP controllers share the same vocabulary so
 * an empty sensorId and a non-finite temperature are distinguishable.
 */

function classifyTelemetryRejection({ sensorId, temperature } = {}) {
  const normalizedSensorId = String(sensorId ?? '').trim();
  if (!normalizedSensorId) return 'empty_sensorId';

  const normalizedTemperature = Number(temperature);
  if (!Number.isFinite(normalizedTemperature)) return 'non_finite_temperature';

  return null;
}

/**
 * Temperature HTTP ingest accepts `temperatureValue` (model) or legacy
 * aliases. Prefer body shape; fall back to the thrown validation message.
 */
function classifyTemperatureReadingRejection(body = {}, error = null) {
  const sensorId = body?.sensorId || body?.sensorID;
  if (!String(sensorId ?? '').trim()) return 'empty_sensorId';

  const raw =
    body?.temperatureValue !== undefined
      ? body.temperatureValue
      : body?.temperature !== undefined
        ? body.temperature
        : body?.value;
  if (raw !== undefined && raw !== null && raw !== '') {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) return 'non_finite_temperature';
  } else {
    return 'non_finite_temperature';
  }

  const message = String(error?.message || '');
  if (/sensorId/i.test(message) && /obrigat/i.test(message)) return 'empty_sensorId';
  if (/temperatureValue/i.test(message)) return 'non_finite_temperature';
  if (error?.statusCode === 404) return 'sensor_not_found';

  return 'invalid_payload';
}

module.exports = {
  classifyTelemetryRejection,
  classifyTemperatureReadingRejection,
};
