const mongoose = require('mongoose');

const CidSchema = new mongoose.Schema(
  {
    Capitulo: { type: String, trim: true },
    Codigo_Tabulacao: { type: String, required: true, trim: true },
    Descricao: { type: String, required: true, trim: true },
    Codigos_CID10: { type: String, required: true, trim: true }
  },
  {
    collection: 'cids',
    timestamps: true
  }
);

CidSchema.index({ Codigo_Tabulacao: 1 }, { unique: true });
CidSchema.index({ Descricao: 'text', Codigos_CID10: 'text' });

module.exports = mongoose.models.Cid || mongoose.model('Cid', CidSchema);
