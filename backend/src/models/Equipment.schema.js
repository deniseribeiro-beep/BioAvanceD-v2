const mongoose = require('mongoose');

const EquipmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    serialNumber: { type: String, required: true, trim: true, index: true },
    purchaseDate: { type: Date, required: true },
    status: { type: String, required: true, trim: true, default: 'Active' },
  },
  {
    collection: 'equipment',
    timestamps: true,
  }
);

module.exports = mongoose.models.Equipment || mongoose.model('Equipment', EquipmentSchema);