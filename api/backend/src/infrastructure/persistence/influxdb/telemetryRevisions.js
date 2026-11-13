const { flux } = require('@influxdata/influxdb-client');

// #1518 (RNF025 C8): a late correction keeps the history. InfluxDB keys a
// point by measurement, tag set and time, so a second reading of one sensor
// at the same time and tags would overwrite the first. A writer reads the
// points stored at that time (storedPointsAt) and plans the new point's
// `revision` tag (revisionPlan); a reader keeps only the highest revision of
// each sensor and time (CURRENT_REVISION_FLUX). An untagged point is
// revision 0. Pure: the callers pass their own query API.
const REVISION_TAG = /^\d+$/;

function revisionOf(row) {
  return REVISION_TAG.test(String(row.revision ?? '')) ? Number(row.revision) : 0;
}

async function storedPointsAt(queryApi, bucket, { measurement, valueField, sensorId, time }) {
  return queryApi.collectRows(flux`from(bucket: ${bucket})
    |> range(start: ${time}, stop: ${new Date(time.getTime() + 1)})
    |> filter(fn: (r) => r._measurement == ${measurement} and r.sensorId == ${sensorId})
    |> filter(fn: (r) => r._field == ${valueField} or r._field == "telemetryReadingId" or r._field == "sourceEventId" or r._field == "payloadHash")
    |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
    |> group()`);
}

// `[inference]` an identical payload at the same sensor and observedAt is
// the reading contract's own derived idempotencyKey (sensor, observedAt,
// payloadHash), so a stored point with the reading's payloadHash is a
// resend, not a correction, even when the resend carries no sourceEventId
// of its own. A stored point with the reading's own sourceEventId is a
// retry too. A retry is written into that point's own series, so it adds no
// revision. A payload that differs in any field (a new sourceEventId
// included) is a correction: one revision past the highest stored, naming
// the reading it supersedes.
function revisionPlan(stored, identity) {
  const rows = Array.isArray(stored) ? stored : [];
  const payloadHash = identity?.payloadHash ? String(identity.payloadHash) : '';
  const sourceEventId = identity?.sourceEventId ? String(identity.sourceEventId) : '';
  const retried = rows.find((row) => row.payloadHash && row.payloadHash === payloadHash)
    || rows.find((row) => sourceEventId && row.sourceEventId === sourceEventId);
  if (retried) {
    return {
      revision: revisionOf(retried) > 0 ? String(revisionOf(retried)) : null,
      supersedesTelemetryReadingId: null,
    };
  }
  if (rows.length) {
    const latest = rows.reduce((top, row) => (revisionOf(row) > revisionOf(top) ? row : top));
    return {
      revision: String(revisionOf(latest) + 1),
      supersedesTelemetryReadingId: latest.telemetryReadingId ? String(latest.telemetryReadingId) : null,
    };
  }
  return { revision: null, supersedesTelemetryReadingId: null };
}

// Keeps, per measurement, sensor and time, only the row of highest revision:
// a superseded reading stays stored, and readable by its id, but a reader of
// the current readings sees its correction alone.
const CURRENT_REVISION_FLUX = `
      |> map(fn: (r) => ({r with _revision: if exists r.revision then int(v: r.revision) else 0}))
      |> group(columns: ["_measurement", "sensorId", "_time"])
      |> max(column: "_revision")
      |> group()`;

module.exports = {
  REVISION_TAG,
  revisionOf,
  storedPointsAt,
  revisionPlan,
  CURRENT_REVISION_FLUX,
};
