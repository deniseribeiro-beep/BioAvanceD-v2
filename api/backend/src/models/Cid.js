const mongoose = require('mongoose');

const CidSchema = new mongoose.Schema(
  {
    Capitulo: { type: String, trim: true },
    Codigo_Tabulacao: { type: String, required: true, trim: true },
    Descricao: { type: String, required: true, trim: true },
    Codigos_CID10: { type: String, required: true, trim: true },
    ORPHA: { type: String, trim: true, default: null },
    OMIM: { type: String, trim: true, default: null },
    aliases: { type: [String], default: [] },
    synonyms: { type: [String], default: [] },
    alternativeNames: { type: [String], default: [] },
    namePt: { type: String, trim: true, default: null },
    nameEn: { type: String, trim: true, default: null },
    nameEs: { type: String, trim: true, default: null },
    translations: { type: mongoose.Schema.Types.Mixed, default: null },
    names: { type: mongoose.Schema.Types.Mixed, default: null },
    active: { type: Boolean, default: true, index: true }
  },
  {
    collection: 'cids',
    timestamps: true
  }
);

module.exports = mongoose.models.Cid || mongoose.model('Cid', CidSchema);
