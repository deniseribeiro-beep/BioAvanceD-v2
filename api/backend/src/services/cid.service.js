const { resolveCollectionName } = require('../utils/collectionResolver');
const logger = require('../utils/logger');

const indexedCollections = new Set();

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => normalizeStringList(item))
      .filter(Boolean);
  }

  if (value && typeof value === 'object') {
    return Object.values(value)
      .flatMap((item) => normalizeStringList(item))
      .filter(Boolean);
  }

  const text = String(value || '').trim();
  return text ? [text] : [];
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function buildSearchRegexes(term) {
  const escapedTerm = escapeRegex(term);
  return {
    prefix: new RegExp(`^${escapedTerm}`, 'i'),
    contains: new RegExp(escapedTerm, 'i')
  };
}

function buildSearchFilter(term) {
  const normalizedTerm = String(term || '').trim();

  if (!normalizedTerm) {
    return getActiveSearchFilter();
  }

  if (normalizedTerm.length < 2) {
    return null;
  }

  const { prefix, contains } = buildSearchRegexes(normalizedTerm);
  const looksLikeCode = /^[A-Za-z0-9.\-]+$/.test(normalizedTerm);
  const textMatcher = looksLikeCode ? prefix : contains;

  return {
    $and: [
      getActiveSearchFilter(),
      {
        $or: [
          { Codigo_Tabulacao: { $regex: prefix } },
          { Codigos_CID10: { $regex: prefix } },
          { icd_code: { $regex: prefix } },
          { ORPHA: { $regex: prefix } },
          { OMIM: { $regex: prefix } },
          { code: { $regex: prefix } },
          { description: { $regex: textMatcher } },
          { Descricao: { $regex: textMatcher } },
          { name: { $regex: textMatcher } },
          { namePt: { $regex: textMatcher } },
          { nameEn: { $regex: textMatcher } },
          { nameEs: { $regex: textMatcher } },
          { aliases: { $regex: textMatcher } },
          { synonyms: { $regex: textMatcher } },
          { alternativeNames: { $regex: textMatcher } }
        ]
      }
    ]
  };
}

function getActiveSearchFilter() {
  return {
    $and: [
      {
        $or: [
          { active: { $exists: false } },
          { active: true }
        ]
      },
      {
        $or: [
          { is_active: { $exists: false } },
          { is_active: true }
        ]
      }
    ]
  };
}

class CidService {
  async ensureIndexes(collection, collectionName) {
    if (!collection || !collectionName || indexedCollections.has(collectionName)) return;

    const indexDefinitions = [
      [{ Codigo_Tabulacao: 1 }, { name: 'codigo_tabulacao_idx' }],
      [{ Codigos_CID10: 1 }, { name: 'codigos_cid10_idx' }],
      [{ ORPHA: 1 }, { name: 'orpha_idx' }],
      [{ OMIM: 1 }, { name: 'omim_idx' }],
      [{ Descricao: 1 }, { name: 'descricao_idx' }],
      [{ aliases: 1 }, { name: 'aliases_idx' }],
      [{ namePt: 1 }, { name: 'name_pt_idx' }],
      [{ nameEn: 1 }, { name: 'name_en_idx' }],
      [{ nameEs: 1 }, { name: 'name_es_idx' }],
      [{ translations: 1 }, { name: 'translations_idx' }],
      [{ code: 1 }, { name: 'code_idx' }],
      [{ Descricao: 'text', Codigos_CID10: 'text', ORPHA: 'text', OMIM: 'text', description: 'text', code: 'text', orpha: 'text', omim: 'text', aliases: 'text', namePt: 'text', nameEn: 'text', nameEs: 'text', synonyms: 'text', alternativeNames: 'text' }, { name: 'cid_text_search_v3' }]
    ];

    for (const [keys, options] of indexDefinitions) {
      try {
        await collection.createIndex(keys, options);
      } catch (error) {
        logger.warn(`Não foi possível criar índice ${options.name} em ${collectionName}: ${error.message}`);
      }
    }

    indexedCollections.add(collectionName);
  }

  normalizeDocument(item = {}) {
    const code = String(item.Codigo_Tabulacao || item.code || item.Codigos_CID10 || '').trim();
    const cid10 = String(item.Codigos_CID10 || item.code || item.Codigo_Tabulacao || '').trim();
    const description = String(item.Descricao || item.description || '').trim();
    const aliases = uniqueStrings([
      ...normalizeStringList(item.aliases),
      ...normalizeStringList(item.synonyms),
      ...normalizeStringList(item.alternativeNames),
      ...normalizeStringList(item.altNames),
      ...normalizeStringList(item.alias),
    ]);
    const translations = item.translations && typeof item.translations === 'object' ? item.translations : null;
    const names = item.names && typeof item.names === 'object' ? item.names : null;
    const namePt = String(item.namePt || item.nomePt || translations?.pt || names?.pt || '').trim();
    const nameEn = String(item.nameEn || item.nomeEn || translations?.en || names?.en || '').trim();
    const nameEs = String(item.nameEs || item.nomeEs || translations?.es || names?.es || '').trim();

    return {
      ...item,
      Codigo_Tabulacao: code,
      Codigos_CID10: cid10 || code,
      Descricao: description,
      icd_code: String(item.icd_code || item.icdCode || cid10 || code).trim(),
      ORPHA: String(item.ORPHA || item.orpha || item.orphaCode || item.orpha_code || '').trim(),
      OMIM: String(item.OMIM || item.omim || item.omimCode || item.omim_code || '').trim(),
      Capitulo: item.Capitulo || item.chapter || null,
      aliases,
      synonyms: aliases,
      alternativeNames: aliases,
      namePt,
      nameEn,
      nameEs,
      names: names || translations || null,
      translations: translations || names || null
    };
  }

  getSearchableTexts(item = {}) {
    return uniqueStrings([
      item.Codigo_Tabulacao,
      item.Codigos_CID10,
      item.icd_code,
      item.icdCode,
      item.ORPHA,
      item.OMIM,
      item.Descricao,
      item.description,
      item.name,
      item.namePt,
      item.nameEn,
      item.nameEs,
      ...(Array.isArray(item.aliases) ? item.aliases : []),
      ...(Array.isArray(item.synonyms) ? item.synonyms : []),
      ...(Array.isArray(item.alternativeNames) ? item.alternativeNames : []),
      ...(item.translations && typeof item.translations === 'object' ? Object.values(item.translations) : []),
      ...(item.names && typeof item.names === 'object' ? Object.values(item.names) : []),
    ]).filter(Boolean);
  }

  matchesTerm(item = {}, term = '') {
    const normalizedTerm = String(term || '').trim().toLowerCase();
    if (!normalizedTerm) return false;

    return this.getSearchableTexts(item).some((value) => String(value).toLowerCase().includes(normalizedTerm));
  }

  async searchPaginated(db, term, page = 1, limit = 10) {
    const normalizedTerm = String(term || '').trim();
    const normalizedPage = Math.max(1, Number(page) || 1);
    const cappedLimit = Math.max(1, Math.min(Number(limit) || 10, 100));
    const sourceCollectionName = await resolveCollectionName(db, 'cids');
    const cidsCollection = db.collection(sourceCollectionName);

    await this.ensureIndexes(cidsCollection, sourceCollectionName);

    const projection = {
      Capitulo: 1,
      Codigo_Tabulacao: 1,
      Descricao: 1,
      Codigos_CID10: 1,
      icd_code: 1,
      ORPHA: 1,
      OMIM: 1,
      aliases: 1,
      synonyms: 1,
      alternativeNames: 1,
      altNames: 1,
      alias: 1,
      namePt: 1,
      nameEn: 1,
      nameEs: 1,
      names: 1,
      translations: 1,
      chapter: 1,
      code: 1,
      description: 1,
    };
    const filter = buildSearchFilter(normalizedTerm);
    const pageIndex = Math.max(0, normalizedPage - 1);

    if (!filter) {
      return {
        items: [],
        pagination: {
          page: normalizedPage,
          limit: cappedLimit,
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false,
          query: normalizedTerm
        }
      };
    }

    const total = await cidsCollection.countDocuments(filter);
    const docs = total > 0
      ? await cidsCollection
        .find(filter, { projection })
        .sort({ Codigo_Tabulacao: 1, code: 1, Descricao: 1 })
        .skip(pageIndex * cappedLimit)
        .limit(cappedLimit)
        .toArray()
      : [];

    const items = docs
      .map((item) => this.normalizeDocument(item))
      .filter((item) => item.Codigo_Tabulacao || item.Codigos_CID10 || item.Descricao);

    return {
      items,
      pagination: {
        page: normalizedPage,
        limit: cappedLimit,
        total,
        totalPages: total > 0 ? Math.ceil(total / cappedLimit) : 0,
        hasNext: pageIndex * cappedLimit + items.length < total,
        hasPrev: pageIndex > 0,
        query: normalizedTerm
      }
    };
  }

  async search(db, term, limit = 10) {
    const result = await this.searchPaginated(db, term, 1, limit);
    return result.items;
  }
}

module.exports = new CidService();
