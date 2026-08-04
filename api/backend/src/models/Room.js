const mongoose = require("mongoose");

/**
 * dict-02 StorageAssignment.roomId (ELM-0169, 1..1 Core): "Sala controlada
 * onde está o equipamento" — sits between Facility and the FREEZER
 * StorageContainer in the hierarchy (RF017 AC#1's Freezer > Prateleira >
 * Rack > Caixa > Posição chain doesn't itself mandate Facility/Room; those
 * come from dict-02's StorageAssignment reference fields — see #418).
 */
const RoomSchema = new mongoose.Schema(
  {
    facilityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Facility",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      example: "Sala de Amostras Biológicas",
    },
    code: {
      type: String,
      trim: true,
      default: null,
    },
    description: {
      type: String,
      default: null,
    },

    createdBy: mongoose.Schema.Types.ObjectId,
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    deletedAt: { type: Date, default: null },
  },
  {
    collection: "rooms",
    timestamps: false,
    strict: true,
  }
);

RoomSchema.index({ facilityId: 1, name: 1 });

RoomSchema.pre("save", async function (next) {
  const Facility = mongoose.model("Facility");
  const facility = await Facility.findById(this.facilityId);
  if (!facility) {
    throw new Error("facilityId deve referenciar uma Facility válida");
  }

  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("Room", RoomSchema);
