const { randomUUID } = require('crypto');

/**
 * Modelo de validação e estrutura para Dataset (RF007 AC#6, dict-02
 * ELM-0416..0423, "FAIR e publicação"). The entity itself is dict-02's
 * "Opcional" priority tier (Fase 1 optional-to-populate, unlike Assay's
 * "Core"), but the fields below still follow the dictionary's own
 * per-field cardinality once a Dataset record is created.
 *
 * Slice 1 of #641 -- models + minimal create/read only. `distributionFiles`
 * (ELM-0422, 1..*) is deliberately left as an empty/optional array here
 * rather than enforced as required -- populating it needs the generalized
 * scientific-file linkage routing #643 will add; a Dataset can't have any
 * files attached before that lands.
 */
class DatasetModel {
  static validate(data = {}) {
    const errors = [];

    if (!data.datasetTitle || typeof data.datasetTitle !== 'string' || data.datasetTitle.trim() === '') {
      errors.push('datasetTitle é obrigatório');
    }

    if (!data.datasetVersion || typeof data.datasetVersion !== 'string' || data.datasetVersion.trim() === '') {
      errors.push('datasetVersion é obrigatório');
    }

    if (!Array.isArray(data.creators) || data.creators.length === 0) {
      errors.push('creators é obrigatório e deve ser um array não vazio');
    }

    if (!data.license || typeof data.license !== 'string' || data.license.trim() === '') {
      errors.push('license é obrigatório');
    }

    if (data.doi !== undefined && data.doi !== null && typeof data.doi !== 'string') {
      errors.push('doi deve ser string');
    }

    if (data.roCrateManifest !== undefined && data.roCrateManifest !== null && typeof data.roCrateManifest !== 'string') {
      errors.push('roCrateManifest deve ser string');
    }

    if (data.distributionFiles !== undefined && data.distributionFiles !== null && !Array.isArray(data.distributionFiles)) {
      errors.push('distributionFiles deve ser um array');
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    return {
      datasetId: randomUUID(),
      datasetTitle: data.datasetTitle,
      datasetVersion: data.datasetVersion,
      creators: [...data.creators],
      doi: data.doi || null,
      license: data.license,
      distributionFiles: Array.isArray(data.distributionFiles) ? data.distributionFiles : [],
      roCrateManifest: data.roCrateManifest || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = DatasetModel;
