const mongoose = require("mongoose");

const StorageContainerSchema = new mongoose.Schema(
  {
    // Identificação
    containerID: {
      type: Number,
      // #941: INERT. mongoose connects with autoIndex:false
      // (infrastructure/database/mongodb/connection.js) and nothing calls
      // syncIndexes()/createIndexes(), so this declaration is never built on any
      // stack. The constraint below is a real requirement with live writers -- it
      // is not decorative -- but it is NOT enforced today. Do not read it as a
      // guarantee. Building it means a native ensureIndexes helper on the
      // utils/sampleIndexes.js precedent, wired into the write path.
      unique: true,
      sparse: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      example: "Ultra-Freezer 01",
    },
    description: {
      type: String,
      default: null,
    },

    // Tipo de container na hierarquia ISO 20387
    containerType: {
      type: String,
      enum: ["FREEZER", "SHELF", "RACK", "DRAWER"],
      required: true,
    },

    // Hierarquia
    parent_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StorageContainer",
      default: null,
      comment: "null para FREEZER, SHELF_ID para RACK, FREEZER_ID para SHELF",
    },

    // dict-02 StorageAssignment.roomId (ELM-0169): sala controlada onde o
    // equipamento está instalado. Aplicável apenas a FREEZER.
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      default: null,
    },

    // Apenas Freezers
    temperature: {
      type: Number,
      default: null,
      comment: "Ex: -80 para ultra-congelador",
    },
    temperatureUnit: {
      type: String,
      enum: ["CELSIUS", "FAHRENHEIT"],
      default: "CELSIUS",
    },

    // Capacidade total
    capacity: {
      type: Number,
      min: 0,
      default: null,
      comment: "Número máximo de slots/subcontainers que pode abrigar",
    },

    // Status operacional
    status: {
      type: String,
      enum: ["OPERATIONAL", "MAINTENANCE", "RETIRED"],
      default: "OPERATIONAL",
    },

    // Auditoria
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
    collection: "storageContainers",
    timestamps: false, // Controlamos manualmente
    strict: true,
  }
);

// ==================== ÍNDICES ====================
StorageContainerSchema.index({ containerType: 1, status: 1 });
StorageContainerSchema.index({ parent_id: 1, containerType: 1 });
// #941: `index({ name: 1 })` deleted here. Measured on mongo:7 against a
// representative tree: it is never the winning plan for any query shape in
// src/. Every .sort({ name: 1 }) on this collection follows a SELECTIVE
// filter (containerType+status, or parent_id+containerType), so the planner
// takes that compound index and sorts the already-small result in memory.
// Both compound indexes ARE built now, natively, by
// utils/storageIndexes.js#ensureStorageContainerIndexes.
// #941: this line declared the SAME {containerID} unique+sparse spec already
// declared field-level at the top of this schema. One of the two was pure
// noise; the field-level one survives, marked there.

// ==================== VALIDAÇÕES CUSTOMIZADAS ====================
StorageContainerSchema.pre("save", async function (next) {
  // Validação: FREEZER não pode ter parent_id
  if (this.containerType === "FREEZER" && this.parent_id) {
    throw new Error("FREEZER não pode ter pai (parent_id deve ser null)");
  }

  // Validação: SHELF, RACK e DRAWER devem ter parent_id
  if (["SHELF", "RACK", "DRAWER"].includes(this.containerType) && !this.parent_id) {
    throw new Error(`${this.containerType} deve ter um parent_id`);
  }

  // Validação: temperatura apenas para FREEZER
  if (this.containerType !== "FREEZER" && this.temperature !== null) {
    throw new Error("Apenas FREEZER pode ter temperatura");
  }

  // Validação: roomId apenas para FREEZER
  if (this.containerType !== "FREEZER" && this.roomId) {
    throw new Error("Apenas FREEZER pode ter roomId");
  }

  // Verificar hierarquia correta (SHELF pai de RACK)
  if (this.containerType === "RACK" && this.parent_id) {
    const parent = await mongoose.model("StorageContainer").findById(this.parent_id);
    if (!parent) {
      throw new Error("Container pai não encontrado");
    }
    if (parent.containerType !== "SHELF") {
      throw new Error("RACK só pode ter SHELF como pai");
    }
  }

  if (this.containerType === "SHELF" && this.parent_id) {
    const parent = await mongoose.model("StorageContainer").findById(this.parent_id);
    if (!parent) {
      throw new Error("Container pai não encontrado");
    }
    if (parent.containerType !== "FREEZER") {
      throw new Error("SHELF só pode ter FREEZER como pai");
    }
  }

  if (this.containerType === "DRAWER" && this.parent_id) {
    const parent = await mongoose.model("StorageContainer").findById(this.parent_id);
    if (!parent) {
      throw new Error("Container pai não encontrado");
    }
    if (parent.containerType !== "RACK") {
      throw new Error("DRAWER só pode ter RACK como pai");
    }
  }

  this.updatedAt = new Date();
  next();
});

// ==================== MÉTODOS ====================

/**
 * Obter caminho completo (FREEZER > SHELF > RACK)
 */
StorageContainerSchema.methods.getFullPath = async function () {
  const path = [{ id: this._id, name: this.name, type: this.containerType }];

  let current = this;
  while (current.parent_id) {
    const parent = await mongoose.model("StorageContainer").findById(current.parent_id);
    if (!parent) break;
    path.unshift({ id: parent._id, name: parent.name, type: parent.containerType });
    current = parent;
  }

  return path;
};

/**
 * Obter todos os filhos (recursivo)
 */
StorageContainerSchema.methods.getChildren = async function () {
  const StorageBox = mongoose.model("StorageBox");

  if (this.containerType === "FREEZER" || this.containerType === "SHELF") {
    // Buscar próximo nível (SHELF ou RACK)
    const nextType = this.containerType === "FREEZER" ? "SHELF" : "RACK";
    return await mongoose.model("StorageContainer").find({
      parent_id: this._id,
      containerType: nextType,
    });
  }

  if (this.containerType === "RACK") {
    // Buscar DRAWERs e Boxes (DRAWER é um nível opcional entre RACK e BOX)
    const drawers = await mongoose.model("StorageContainer").find({
      parent_id: this._id,
      containerType: "DRAWER",
    });
    const boxes = await StorageBox.find({ parent_id: this._id });
    return [...drawers, ...boxes];
  }

  if (this.containerType === "DRAWER") {
    // Buscar Boxes
    return await StorageBox.find({ parent_id: this._id });
  }

  return [];
};

/**
 * Validar estrutura (usada em PASSO 2)
 */
StorageContainerSchema.statics.validate = function (data) {
  const errors = [];

  if (!data.name) errors.push("name é obrigatório");
  if (!data.containerType) errors.push("containerType é obrigatório");
  if (!["FREEZER", "SHELF", "RACK", "DRAWER"].includes(data.containerType)) {
    errors.push("containerType inválido");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

module.exports = mongoose.model("StorageContainer", StorageContainerSchema);
