const mongoose = require("mongoose");

const StorageBoxSchema = new mongoose.Schema(
  {
    // Identificação
    boxID: {
      type: Number,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      example: "Box A1-01",
    },
    description: {
      type: String,
      default: null,
    },

    // Referência ao Rack pai
    parent_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StorageContainer", // Deve ser um RACK ou, quando presente, um DRAWER
      required: true,
    },

    // Dimensões da caixa
    dimension: {
      rows: {
        type: Number,
        required: true,
        min: 1,
        max: 26, // Máximo até Z (26 letras)
        example: 9,
      },
      cols: {
        type: Number,
        required: true,
        min: 1,
        max: 100,
        example: 9,
      },
    },

    // Grid de ocupação: mapa posição -> sampleID
    // Estructura: { "A1": sampleID, "A2": null, "B1": sampleID, ... }
    occupancyGrid: {
      type: Map,
      of: mongoose.Schema.Types.ObjectId,
      default: new Map(),
      comment: "Map<position, sampleID>. null significa vazio.",
    },

    // Contadores
    capacity: {
      type: Number,
      computed: true,
      comment: "rows * cols (computado)",
    },
    currentOccupancy: {
      type: Number,
      default: 0,
      comment: "Número de posições ocupadas",
    },

    // Status
    status: {
      type: String,
      enum: ["ACTIVE", "FULL", "RETIRED"],
      default: "ACTIVE",
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
    lastModified: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: "storageBoxes",
    timestamps: false,
    strict: true,
  }
);

// ==================== ÍNDICES ====================
StorageBoxSchema.index({ parent_id: 1, status: 1 });
// #941: `index({ name: 1 })` deleted here, for the same measured reason as
// StorageContainer.js -- never the winning plan, because the only
// .sort({ name: 1 }) on this collection follows a parent_id filter. The
// { parent_id, status } index above IS built now, natively, by
// utils/storageIndexes.js#ensureStorageBoxIndexes.
// #941: `index({ status: 1 })` deleted here. Not merely unbuilt -- unused:
// every storageBoxes query in the tree filters on _id or parent_id, and the
// only whole-collection reads sort on { name, boxID, _id }. Nothing anywhere
// filters or sorts these documents on `status`, so the declaration described
// an index no query would have used even if it had been built.

// ==================== VIRTUAL: capacity ====================
StorageBoxSchema.virtual("capacityTotal").get(function () {
  return this.dimension.rows * this.dimension.cols;
});

// ==================== PRÉ-SAVE VALIDAÇÕES ====================
StorageBoxSchema.pre("save", async function (next) {
  // Validar dimensões
  if (!this.dimension || !this.dimension.rows || !this.dimension.cols) {
    throw new Error("dimension.rows e dimension.cols são obrigatórios");
  }

  if (this.dimension.rows < 1 || this.dimension.rows > 26) {
    throw new Error("rows deve estar entre 1 e 26");
  }

  if (this.dimension.cols < 1 || this.dimension.cols > 100) {
    throw new Error("cols deve estar entre 1 e 100");
  }

  // Validar parent_id (deve existir e ser um RACK ou, quando presente, um DRAWER)
  const StorageContainer = mongoose.model("StorageContainer");
  const parent = await StorageContainer.findById(this.parent_id);
  if (!parent) {
    throw new Error("Rack pai não encontrado");
  }
  if (!["RACK", "DRAWER"].includes(parent.containerType)) {
    throw new Error("parent_id deve referenciar um RACK ou DRAWER");
  }

  // Sincronizar currentOccupancy
  if (this.occupancyGrid) {
    let count = 0;
    for (const value of this.occupancyGrid.values()) {
      if (value) count++;
    }
    this.currentOccupancy = count;
  }

  // Atualizar status baseado em ocupação
  const capacity = this.dimension.rows * this.dimension.cols;
  if (this.currentOccupancy >= capacity) {
    this.status = "FULL";
  } else if (this.status === "FULL" && this.currentOccupancy < capacity) {
    this.status = "ACTIVE";
  }

  this.updatedAt = new Date();
  this.lastModified = new Date();
  next();
});

// ==================== MÉTODOS ====================

/**
 * Serializar occupancyGrid (Map -> Object) para JSON
 */
StorageBoxSchema.methods.toJSON = function () {
  const obj = this.toObject();
  if (this.occupancyGrid) {
    obj.occupancyGrid = Object.fromEntries(this.occupancyGrid);
  }
  obj.capacityTotal = this.dimension.rows * this.dimension.cols;
  obj.availablePositions = obj.capacityTotal - this.currentOccupancy;
  return obj;
};

/**
 * Gerar lista de todas as posições válidas (ex: A1, A2, ... I9 para 9x9)
 */
StorageBoxSchema.methods.getAllValidPositions = function () {
  const positions = [];
  const maxRow = Math.min(this.dimension.rows, 26); // A-Z

  for (let row = 0; row < maxRow; row++) {
    const rowLetter = String.fromCharCode(65 + row); // A, B, C...
    for (let col = 1; col <= this.dimension.cols; col++) {
      positions.push(`${rowLetter}${col}`);
    }
  }

  return positions;
};

/**
 * Verificar se uma posição é válida (ex: A1 em caixa 9x9)
 */
StorageBoxSchema.methods.isValidPosition = function (position) {
  if (!position || typeof position !== "string") return false;

  const match = position.match(/^([A-Z])(\d+)$/);
  if (!match) return false;

  const [, rowLetter, colStr] = match;
  const row = rowLetter.charCodeAt(0) - 65; // 0-indexed
  const col = parseInt(colStr, 10);

  // Validar limites
  if (row < 0 || row >= this.dimension.rows) return false;
  if (col < 1 || col > this.dimension.cols) return false;

  return true;
};

/**
 * Verificar se uma posição está ocupada
 * Retorna: { occupied: boolean, sampleID: ObjectId | null }
 */
StorageBoxSchema.methods.checkPositionOccupancy = function (position) {
  if (!this.isValidPosition(position)) {
    return { occupied: null, error: "INVALID_POSITION", sampleID: null };
  }

  const sampleID = this.occupancyGrid?.get(position) || null;
  return { occupied: !!sampleID, sampleID };
};

/**
 * Adicionar amostra a uma posição (PASSO 2 usará isso)
 * Retorna: { success: boolean, error?: string }
 */
StorageBoxSchema.methods.addSample = function (position, sampleID) {
  // Validar posição
  if (!this.isValidPosition(position)) {
    return { success: false, error: "INVALID_POSITION" };
  }

  // Verificar colisão
  if (this.occupancyGrid?.has(position) && this.occupancyGrid.get(position)) {
    return { success: false, error: "POSITION_OCCUPIED", sampleID: this.occupancyGrid.get(position) };
  }

  // Adicionar
  this.occupancyGrid.set(position, sampleID);
  this.currentOccupancy += 1;

  return { success: true };
};

/**
 * Remover amostra de uma posição
 */
StorageBoxSchema.methods.removeSample = function (position) {
  if (!this.isValidPosition(position)) {
    return { success: false, error: "INVALID_POSITION" };
  }

  if (!this.occupancyGrid?.has(position) || !this.occupancyGrid.get(position)) {
    return { success: false, error: "POSITION_EMPTY" };
  }

  const sampleID = this.occupancyGrid.get(position);
  this.occupancyGrid.delete(position);
  this.currentOccupancy -= 1;

  return { success: true, sampleID };
};

/**
 * Obter todas as posições vazias
 */
StorageBoxSchema.methods.getAvailablePositions = function () {
  const available = [];
  const allPositions = this.getAllValidPositions();

  for (const pos of allPositions) {
    if (!this.occupancyGrid?.has(pos) || !this.occupancyGrid.get(pos)) {
      available.push(pos);
    }
  }

  return available;
};

/**
 * Retornar estado legível da caixa
 */
StorageBoxSchema.methods.getStats = function () {
  const total = this.dimension.rows * this.dimension.cols;
  return {
    boxID: this.boxID,
    name: this.name,
    dimension: this.dimension,
    capacity: total,
    occupied: this.currentOccupancy,
    available: total - this.currentOccupancy,
    occupancyPercent: Math.round((this.currentOccupancy / total) * 100),
    status: this.status,
  };
};

// ==================== STATICS ====================

/**
 * Validar estrutura
 */
StorageBoxSchema.statics.validate = function (data) {
  const errors = [];

  if (!data.name) errors.push("name é obrigatório");
  if (!data.parent_id) errors.push("parent_id é obrigatório");
  if (!data.dimension?.rows) errors.push("dimension.rows é obrigatório");
  if (!data.dimension?.cols) errors.push("dimension.cols é obrigatório");

  if (data.dimension?.rows && (data.dimension.rows < 1 || data.dimension.rows > 26)) {
    errors.push("rows deve estar entre 1 e 26");
  }

  if (data.dimension?.cols && (data.dimension.cols < 1 || data.dimension.cols > 100)) {
    errors.push("cols deve estar entre 1 e 100");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

module.exports = mongoose.model("StorageBox", StorageBoxSchema);
