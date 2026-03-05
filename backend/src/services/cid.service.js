const { resolveSourceCollectionName } = require('../utils/collectionResolver');
const logger = require('../utils/logger');

const indexedCollections = new Set();

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class CidService {
  async ensureIndexes(collection, collectionName) {
    if (!collection || !collectionName || indexedCollections.has(collectionName)) return;

    const indexDefinitions = [
      [{ Codigo_Tabulacao: 1 }, { name: 'codigo_tabulacao_idx' }],
      [{ code: 1 }, { name: 'code_idx' }],
      [{ Descricao: 'text', Codigos_CID10: 'text', description: 'text', code: 'text' }, { name: 'cid_text_search_v2' }]
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

    return {
      ...item,
      Codigo_Tabulacao: code,
      Codigos_CID10: cid10 || code,
      Descricao: description,
      Capitulo: item.Capitulo || item.chapter || null
    };
  }

  async search(db, term, limit = 10) {
    const normalizedTerm = String(term || '').trim();
    const cappedLimit = Math.max(1, Math.min(Number(limit) || 10, 20));
    const sourceCollectionName = await resolveSourceCollectionName(db, 'cids');
    const cidsCollection = db.collection(sourceCollectionName);

    await this.ensureIndexes(cidsCollection, sourceCollectionName);

    if (!normalizedTerm) {
      const defaultDocs = await cidsCollection
        .find(
          {},
          {
            projection: {
              Capitulo: 1,
              Codigo_Tabulacao: 1,
              Descricao: 1,
              Codigos_CID10: 1,
              chapter: 1,
              code: 1,
              description: 1,
              active: 1
            }
          }
        )
        .sort({ Codigo_Tabulacao: 1, code: 1 })
        .limit(cappedLimit)
        .toArray();

      return defaultDocs
        .map((item) => this.normalizeDocument(item))
        .filter((item) => item.Codigo_Tabulacao || item.Codigos_CID10 || item.Descricao)
        .slice(0, cappedLimit);
    }

    if (normalizedTerm.length < 2) return [];

    const projection = {
      Capitulo: 1,
      Codigo_Tabulacao: 1,
      Descricao: 1,
      Codigos_CID10: 1,
      chapter: 1,
      code: 1,
      description: 1,
      score: { $meta: 'textScore' }
    };

    const looksLikeCode = /^[A-Za-z0-9.\-]+$/.test(normalizedTerm);
    let textMatches = [];

    if (!looksLikeCode || normalizedTerm.length >= 3) {
      try {
        textMatches = await cidsCollection
          .find({ $text: { $search: normalizedTerm } }, { projection })
          .sort({ score: { $meta: 'textScore' }, Codigo_Tabulacao: 1, code: 1 })
          .limit(cappedLimit)
          .toArray();
      } catch (_) {
        textMatches = [];
      }
    }

    if (textMatches.length >= cappedLimit) {
      return textMatches;
    }

    const escapedTerm = escapeRegex(normalizedTerm);
    const regexMatches = await cidsCollection
      .find(
        {
          $or: [
            { Codigo_Tabulacao: { $regex: `^${escapedTerm}`, $options: 'i' } },
            { Codigos_CID10: { $regex: escapedTerm, $options: 'i' } },
            { Descricao: { $regex: escapedTerm, $options: 'i' } },
            { code: { $regex: `^${escapedTerm}`, $options: 'i' } },
            { description: { $regex: escapedTerm, $options: 'i' } }
          ]
        },
        {
          projection: {
            Capitulo: 1,
            Codigo_Tabulacao: 1,
            Descricao: 1,
            Codigos_CID10: 1,
            chapter: 1,
            code: 1,
            description: 1
          }
        }
      )
      .sort({ Codigo_Tabulacao: 1, code: 1 })
      .limit(cappedLimit)
      .toArray();

    const merged = [];
    const seenIds = new Set();

    [...textMatches, ...regexMatches].forEach((item) => {
      const key = String(item._id);
      if (seenIds.has(key)) return;
      seenIds.add(key);
      merged.push(this.normalizeDocument(item));
    });

    return merged
      .filter((item) => item.Codigo_Tabulacao || item.Codigos_CID10 || item.Descricao)
      .sort((a, b) => String(a.Codigo_Tabulacao || '').localeCompare(String(b.Codigo_Tabulacao || '')))
      .slice(0, cappedLimit);
  }
}

module.exports = new CidService();
