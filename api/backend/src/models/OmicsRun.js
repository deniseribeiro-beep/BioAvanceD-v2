const { randomUUID } = require('crypto');

/**
 * Modelo de validação e estrutura para OmicsRun (RF027 AC#5, dict-02
 * ELM-0343..0352, "Dados ômicos e imagens" -- genomics/transcriptomics/
 * proteomics/metabolomics/microbiome sub-slice only, all Fase 1).
 *
 * Slice 4/4 of #716 -- a single modality-discriminated model rather than
 * dict-02's 5 separate entities (GenomicsRun/TranscriptomicsRun/
 * ProteomicsRun/MetabolomicsRun/MicrobiomeRun), which are structurally
 * interchangeable file-reference bundles differing only in which file
 * "roles" apply -- same reasoning #668 used to scope RF029's own slices
 * by genuine structural difference, not entity-name difference.
 *
 * `referenceAssembly` (ELM-0343) is AC#5's own named field ("registrar
 * referência genômica quando aplicável") -- optional, since dict-02
 * itself gates it "quando aplicável" (not every modality has one).
 *
 * dict-02's remaining 2 entities in this ELM range -- ImagingStudy
 * (ELM-0353/0354, DICOM study/series metadata) and ImagingDerivedData
 * (ELM-0355/0356, segmentation/radiomic feature sets) -- are
 * deliberately out of this model's scope: they're structured DICOM
 * metadata, not file-reference bundles, so folding them into
 * `fileLinks` would misrepresent their real shape. Filed as a follow-up
 * (see #716's own closing comment) rather than silently absorbed.
 */
const MODALITIES = ['genomics', 'transcriptomics', 'proteomics', 'metabolomics', 'microbiome'];

class OmicsRunModel {
  static validate(data = {}) {
    const errors = [];

    if (!MODALITIES.includes(data.modality)) {
      errors.push(`modality deve ser um de: ${MODALITIES.join(', ')}`);
    }

    if (data.referenceAssembly !== undefined && data.referenceAssembly !== null) {
      if (typeof data.referenceAssembly !== 'string' || data.referenceAssembly.trim() === '') {
        errors.push('referenceAssembly deve ser uma string não vazia');
      }
    }

    if (data.mixsChecklist !== undefined && data.mixsChecklist !== null) {
      if (typeof data.mixsChecklist !== 'string' || data.mixsChecklist.trim() === '') {
        errors.push('mixsChecklist deve ser uma string não vazia');
      }
    }

    if (data.fileLinks !== undefined && data.fileLinks !== null) {
      if (!Array.isArray(data.fileLinks)) {
        errors.push('fileLinks deve ser um array');
      } else {
        data.fileLinks.forEach((link, index) => {
          if (!link || typeof link !== 'object' || Array.isArray(link)) {
            errors.push(`fileLinks[${index}] deve ser um objeto`);
            return;
          }
          if (!link.role || typeof link.role !== 'string' || link.role.trim() === '') {
            errors.push(`fileLinks[${index}].role é obrigatório`);
          }
          if (!link.fileId || typeof link.fileId !== 'string' || link.fileId.trim() === '') {
            errors.push(`fileLinks[${index}].fileId é obrigatório`);
          }
        });
      }
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    return {
      omicsRunId: data.omicsRunId || randomUUID(),
      modality: data.modality,
      referenceAssembly: data.referenceAssembly || null,
      mixsChecklist: data.mixsChecklist || null,
      fileLinks: Array.isArray(data.fileLinks) ? data.fileLinks.map((link) => ({ ...link })) : [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = OmicsRunModel;
module.exports.MODALITIES = MODALITIES;
