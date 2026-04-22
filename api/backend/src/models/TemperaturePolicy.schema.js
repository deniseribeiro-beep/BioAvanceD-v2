const mongoose = require('mongoose');

const TemperaturePolicySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    targetTemp: { type: Number, required: true },
    minTemp: { type: Number, required: true },
    maxTemp: { type: Number, required: true },
    hysteresis: { type: Number, required: true, default: 0.5 },
  },
  {
    collection: 'temperaturePolicies',
    timestamps: true,
  }
);

TemperaturePolicySchema.index({ name: 1 }, { unique: true });
TemperaturePolicySchema.index({ minTemp: 1, maxTemp: 1 });

module.exports = mongoose.models.TemperaturePolicy || mongoose.model('TemperaturePolicy', TemperaturePolicySchema);