// #1142: the alert-episode lifecycle, shared by every writer of the `alerts`
// collection. scheduler.service.js and temperature.service.js each carried a
// copy of this pair, linked by "same as" comments -- the shape #1079 was
// filed for, where two writers disagreed on the episode predicate and neither
// could close the other's rows. The pair lives here, with no dependencies, so
// temperature.service.js can share it without importing scheduler.service.js
// and, through it, node-cron and three unrelated services.
//
// An episode is identified by { sensorId, type, status: 'active' }. Every
// writer must stamp a `type` from ALERT_TYPES or neither helper can reach its
// rows.

const ALERT_TYPES = Object.freeze({
  // scheduler.service.js#checkStaleTemperatureReadings
  MISSING_READING: 'missing_reading',
  STALE_READING: 'stale_reading',
  // temperature.service.js#checkTemperaturePolicy
  THRESHOLD_BREACH: 'threshold_breach'
});

// Closes the open episode, if any. No debounce or hysteresis: callers resolve
// the moment the good condition holds.
async function resolveActiveAlert(alertsCollection, sensorId, type) {
  await alertsCollection.updateMany(
    { sensorId, type, status: 'active' },
    { $set: { status: 'resolved', resolvedAt: new Date() } }
  );
}

// Opens an episode unless one is already active for the payload's sensor and
// type. Returns whether a row was inserted, and the id of the episode either
// way, so a caller can link a notification to the event that originated it
// (RF015 AC#6) whether or not this reading opened it.
async function ensureActiveAlert(alertsCollection, payload) {
  const existing = await alertsCollection.findOne({
    sensorId: payload.sensorId,
    type: payload.type,
    status: 'active'
  });

  if (existing) {
    return { created: false, alertId: existing._id };
  }

  const result = await alertsCollection.insertOne(payload);
  return { created: true, alertId: result?.insertedId };
}

module.exports = {
  ALERT_TYPES,
  resolveActiveAlert,
  ensureActiveAlert
};
