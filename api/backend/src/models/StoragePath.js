const mongoose = require("mongoose");

const StoragePathSchema = new mongoose.Schema(
  {
    // Referências aos containers
    boxId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StorageBox",
      required: true,
    },
    rackId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StorageContainer",
      required: true,
    },
    shelfId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StorageContainer",
      required: true,
    },
    freezerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StorageContainer",
      required: true,
    },

    // Caminho legível
    path: {
      type: String,
      required: true,
      comment: "Ex: FREEZER_01/SHELF_1/RACK_A/BOX_01",
    },

    // Metadados
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
  },
  {
    collection: "storagePaths",
    timestamps: false,
    strict: true,
  }
);

// ==================== PRÉ-SAVE ====================
StoragePathSchema.pre("save", async function (next) {
  // Validar referências
  const StorageContainer = mongoose.model("StorageContainer");
  const StorageBox = mongoose.model("StorageBox");

  const [freezer, shelf, rack, box] = await Promise.all([
    StorageContainer.findById(this.freezerId),
    StorageContainer.findById(this.shelfId),
    StorageContainer.findById(this.rackId),
    StorageBox.findById(this.boxId),
  ]);

  if (!freezer || freezer.containerType !== "FREEZER") {
    throw new Error("freezerId deve referenciar um FREEZER válido");
  }
  if (!shelf || shelf.containerType !== "SHELF") {
    throw new Error("shelfId deve referenciar uma SHELF válida");
  }
  if (!rack || rack.containerType !== "RACK") {
    throw new Error("rackId deve referenciar um RACK válido");
  }
  if (!box) {
    throw new Error("boxId deve referenciar uma BOX válida");
  }

  // Validar hierarquia
  if (rack.parent_id.toString() !== shelf._id.toString()) {
    throw new Error("RACK deve estar dentro da SHELF");
  }
  if (shelf.parent_id.toString() !== freezer._id.toString()) {
    throw new Error("SHELF deve estar dentro do FREEZER");
  }

  // Gerar path se não fornecido
  if (!this.path) {
    this.path = `${freezer.name}/${shelf.name}/${rack.name}/${box.name}`;
  }

  next();
});

// ==================== MÉTODOS ====================

/**
 * Obter caminho completo com dados detalhados
 */
StoragePathSchema.methods.getFullDetails = async function () {
  const StorageContainer = mongoose.model("StorageContainer");
  const StorageBox = mongoose.model("StorageBox");

  const [freezer, shelf, rack, box] = await Promise.all([
    StorageContainer.findById(this.freezerId),
    StorageContainer.findById(this.shelfId),
    StorageContainer.findById(this.rackId),
    StorageBox.findById(this.boxId),
  ]);

  return {
    path: this.path,
    freezer: freezer ? { id: freezer._id, name: freezer.name, temp: freezer.temperature } : null,
    shelf: shelf ? { id: shelf._id, name: shelf.name } : null,
    rack: rack ? { id: rack._id, name: rack.name } : null,
    box: box ? box.getStats() : null,
  };
};

// ==================== STATICS ====================

/**
 * Criar StoragePath automaticamente quando Box é criada
 */
StoragePathSchema.statics.createFromBox = async function (boxId) {
  const StorageBox = mongoose.model("StorageBox");
  const StorageContainer = mongoose.model("StorageContainer");

  const box = await StorageBox.findById(boxId);
  if (!box) throw new Error("Box não encontrada");

  const rack = await StorageContainer.findById(box.parent_id);
  if (!rack || rack.containerType !== "RACK") throw new Error("Rack não encontrado");

  const shelf = await StorageContainer.findById(rack.parent_id);
  if (!shelf || shelf.containerType !== "SHELF") throw new Error("Shelf não encontrada");

  const freezer = await StorageContainer.findById(shelf.parent_id);
  if (!freezer || freezer.containerType !== "FREEZER") throw new Error("Freezer não encontrado");

  const path = `${freezer.name}/${shelf.name}/${rack.name}/${box.name}`;

  return await this.create({
    boxId: box._id,
    rackId: rack._id,
    shelfId: shelf._id,
    freezerId: freezer._id,
    path,
  });
};

/**
 * Validar estrutura
 */
StoragePathSchema.statics.validate = function (data) {
  const errors = [];

  if (!data.boxId) errors.push("boxId é obrigatório");
  if (!data.rackId) errors.push("rackId é obrigatório");
  if (!data.shelfId) errors.push("shelfId é obrigatório");
  if (!data.freezerId) errors.push("freezerId é obrigatório");

  return {
    isValid: errors.length === 0,
    errors,
  };
};

module.exports = mongoose.model("StoragePath", StoragePathSchema);
