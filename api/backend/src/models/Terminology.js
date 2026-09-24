const mongoose = require('mongoose');

// Modelo genérico para armazenar terminologias/ontologias sincronizadas
// Cobre: CID-10, CID-11, HPO, OMIM, ORPHA, Biomarcadores, etc.
const TerminologySchema = new mongoose.Schema(
  {
    // Código/ID da terminologia (ex: "E75.2", "HP:0001014", "OMIM:301500", "ORPHA:324")
    // #941: no field-level `index: true` here -- it was inert (autoIndex:false)
    // and explain() showed a standalone { codigo: 1 } wins only the sync
    // upsert's { sistema, codigo } lookup, and only because the native
    // compound index (terminologySync.service.js) is ineligible for it. That
    // is fixed at the compound index, not by a second index.
    codigo: { type: String, required: true, trim: true },

    // Sistema/Origem (CID10, CID11, HPO, OMIM, ORPHA, BIOMARCADOR, etc.)
    // #1163: no field-level `index: true` either. It was inert, and the
    // listing it would have served is served by terminologies_sistema_codigo_idx_v1
    // (terminologySync.service.js#ensureTerminologyLookupIndexes).
    sistema: { type: String, required: true, trim: true, enum: ['CID10', 'CID11', 'HPO', 'OMIM', 'ORPHA', 'BIOMARCADOR', 'OUTRO'] },

    // Descrição principal
    descricao: { type: String, required: true, trim: true },

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
    // #941: no `index: true` -- inert, and HARMFUL if built: explain() showed
    // the planner picks { ativo: 1 } for dictionary.js's `ativo: { $ne: false }`
    // and walks ~98% of the collection through it, slower than a COLLSCAN.
    ativo: { type: Boolean, default: true },

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

module.exports = mongoose.models.Terminology || mongoose.model('Terminology', TerminologySchema);
