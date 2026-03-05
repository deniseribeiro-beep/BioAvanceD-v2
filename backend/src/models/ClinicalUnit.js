class ClinicalUnitModel {
  static normalizeName(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
  }

  static fillAcronym(name) {
    const normalized = ClinicalUnitModel.normalizeName(name);
    if (!normalized) return null;

    const stopWords = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'OF', 'THE', 'DEL', 'LA', 'EL', 'Y']);
    const words = normalized.split(/\s+/).filter(Boolean);
    const relevantWords = words.filter((word) => !stopWords.has(word));
    const source = relevantWords.length > 0 ? relevantWords : words;

    const initials = source.map((word) => word[0]).join('').slice(0, 6);
    return initials || null;
  }

  static validate(data = {}) {
    const errors = [];

    const name = String(data.name || '').trim();
    if (!name) {
      errors.push('name é obrigatório');
    } else if (name.length < 3) {
      errors.push('name deve ter ao menos 3 caracteres');
    }

    if (data.active !== undefined && typeof data.active !== 'boolean') {
      errors.push('active deve ser boolean');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data = {}) {
    const name = String(data.name || '').trim().replace(/\s+/g, ' ');
    const normalizedName = ClinicalUnitModel.normalizeName(name);

    return {
      name,
      normalizedName,
      acronym: ClinicalUnitModel.fillAcronym(name),
      active: data.active !== undefined ? Boolean(data.active) : true,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = ClinicalUnitModel;
