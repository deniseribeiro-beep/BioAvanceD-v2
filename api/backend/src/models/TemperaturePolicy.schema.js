const mongoose = require('mongoose');

// #678: dict-02_DICIONARIO.md's ThresholdProfile entity (P1X-0105..P1X-0112,
// domain "Telemetria") is this collection's real dict-02 counterpart --
// same domain, same conceptual role (threshold rule for a monitored
// metric), just predating the dictionary alignment pass. Rather than
// rename the collection/existing fields (a real migration touching
// iot.controller.js's live populate() path and every e2e fixture), this
// adds ThresholdProfile's still-missing fields onto the existing shape.
// The dictionary's own field names map onto fields already here:
// thresholdProfileId -> this doc's `_id`; profileName -> `name`;
// lowerLimit/upperLimit -> `minTemp`/`maxTemp` (already the same
// min/max-tolerance concept, just named for this collection's original
// temperature-only scope). `metricType`/`ruleVersion`/`effectivePeriod`/
// `minimumDuration` genuinely didn't exist and are added below.
const TemperaturePolicySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    targetTemp: { type: Number, required: true },
    minTemp: { type: Number, required: true },
    maxTemp: { type: Number, required: true },
    hysteresis: { type: Number, required: true, default: 0.5 },
    // dict-02 P1X-0107: this collection has only ever modeled temperature
    // thresholds, so 'temperature' is the correct default, not a guess.
    metricType: { type: String, required: true, default: 'temperature' },
    // dict-02 P1X-0112 (SemVer): versions the detection logic this
    // profile encodes, so a future rule-shape change can be told apart
    // from today's plain min/max/hysteresis check.
    ruleVersion: { type: String, required: true, default: '1.0.0' },
    // dict-02 P1X-0111 (Period, 1..1 Core): `end: null` means open-ended,
    // same "no end date yet" convention AccessRequest.approvalPeriod uses.
    effectivePeriod: {
      start: { type: Date, required: true, default: Date.now },
      end: { type: Date, default: null },
    },
    // dict-02 P1X-0110 (Duration, 0..1 Essencial): "how long out of range
    // before it counts as an excursion", in MINUTES (dict-02 types this
    // Duration/UCUM but names no concrete unit; minutes is this repo's
    // inferred convention -- see #688). #688: TelemetryMonitor now consumes
    // this per-sensor via the sensor's bound temperaturePolicy, falling
    // back to the global TELEMETRY_CRITICAL_DURATION_HOURS threshold
    // whenever this stays at its `null` default (or any other non-positive
    // value), which is why this field remains optional here.
    minimumDuration: { type: Number, default: null },
  },
  {
    collection: 'temperaturePolicies',
    timestamps: true,
  }
);

TemperaturePolicySchema.index({ name: 1 }, { unique: true });
TemperaturePolicySchema.index({ minTemp: 1, maxTemp: 1 });

module.exports = mongoose.models.TemperaturePolicy || mongoose.model('TemperaturePolicy', TemperaturePolicySchema);