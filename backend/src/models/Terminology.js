const mongoose = require('mongoose');

// Modelo genérico para armazenar terminologias/ontologias sincronizadas
// Cobre: CID-10, CID-11, HPO, OMIM, ORPHA, Biomarcadores, etc.
const TerminologySchema = new mongoose.Schema(
  {
    // Código/ID da terminologia (ex: "E75.2", "HP:0001014", "OMIM:301500", "ORPHA:324")
    codigo: { type: String, required: true, trim: true, index: true },

    // Sistema/Origem (CID10, CID11, HPO, OMIM, ORPHA, BIOMARCADOR, etc.)
    sistema: { type: String, required: true, trim: true, index: true, enum: ['CID10', 'CID11', 'HPO', 'OMIM', 'ORPHA', 'BIOMARCADOR', 'OUTRO'] },

    // Descrição principal
    descricao: { type: String, required: true, trim: true, index: 'text' },

    // Metadados adicionais (rótulo, sinônimos, tradução, etc.)
    label: { type: String, trim: true },
    sinonimos: { type: [String], default: [] },
    aliases: { type: [String], default: [] },

    // Referências opcionais de outras terminologias
    relacoes: {
      cid: { type: String, trim: true },
      hpo: { type: String, trim: true },
      omim: { type: String, trim: true },
      orpha: { type: String, trim: true },
    },

    // Status
    ativo: { type: Boolean, default: true, index: true },

    // Metadados de sincronização
    sincronizadoEm: { type: Date, default: Date.now },
    fonte: { type: String, trim: true, default: 'orphadata' },
    hashConteudo: { type: String, trim: true }, // Para detectar mudanças
  },
  {
    collection: 'terminologies',
    timestamps: true,
  }
);

// Índice composto para garantir unicidade por sistema + código
TerminologySchema.index({ sistema: 1, codigo: 1 }, { unique: true });

// Índice de texto para busca
TerminologySchema.index({ descricao: 'text', label: 'text', sinonimos: 'text', aliases: 'text' });

module.exports = mongoose.models.Terminology || mongoose.model('Terminology', TerminologySchema);
