const mongoose = require("mongoose");

/**
 * dict-02 StorageAssignment.facilityId (ELM-0168, 1..1 Core): "Instituição/
 * prédio de armazenamento" — the top of the storage hierarchy, above Room.
 */
const FacilitySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      example: "Campus Central",
    },
    code: {
      type: String,
      trim: true,
      default: null,
    },
    address: {
      type: String,
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
    collection: "facilities",
    timestamps: false,
    strict: true,
  }
);

FacilitySchema.index({ name: 1 });

FacilitySchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("Facility", FacilitySchema);
