const mongoose = require("mongoose");

/**
 * Storage room configuration between Facility and the FREEZER layout.
 */
const RoomSchema = new mongoose.Schema(
  {
    facilityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Facility",
      required: true,
    },
    name: { type: String, required: true, trim: true, example: "Sala de Amostras Biológicas" },
    code: { type: String, trim: true, default: null },
    description: { type: String, default: null },
    createdBy: mongoose.Schema.Types.ObjectId,
    createdAt: { type: Date, default: Date.now, immutable: true },
    updatedAt: { type: Date, default: Date.now },
    deletedAt: { type: Date, default: null },
  },
  { collection: "rooms", timestamps: false, strict: true }
);

// #941: production CRUD uses the native driver. The executable index is
// rooms_facility_active_name_v1 in utils/storageIndexes.js.

RoomSchema.pre("save", async function (next) {
  const Facility = mongoose.model("Facility");
  const facility = await Facility.findById(this.facilityId);
  if (!facility) throw new Error("facilityId deve referenciar uma Facility válida");
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("Room", RoomSchema);
