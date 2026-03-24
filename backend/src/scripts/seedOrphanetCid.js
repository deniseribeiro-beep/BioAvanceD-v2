
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { XMLParser } = require('fast-xml-parser');
const { connectDB, closeConnection } = require('../database/mongo');
const { getCollection } = require('../utils/collectionResolver');

const XML_SOURCES = [
  {
    language: 'en',
    path: path.resolve(__dirname, '../../../data/orphanet_classification.xml')
  },
  {
    language: 'pt',
    path: path.resolve(__dirname, '../../../data/pt_orphanet_classification.xml')
  },
  {
    language: 'es',
    path: path.resolve(__dirname, '../../../data/es_orphanet_classification.xml')
  }
];

const CSV_PATH = path.resolve(__dirname, '../../../data/cid10_completo.csv');
const XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: true,
  parseAttributeValue: true,
  processEntities: false
});

function cleanValue(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .replace(/^"+|"+$/g, '')
    .replace(/""/g, '"')
    .trim();
}

function normalizeLanguage(language) {
  const normalized = cleanValue(language).toLowerCase();
  return ['en', 'pt', 'es'].includes(normalized) ? normalized : null;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => cleanValue(value)).filter(Boolean))];
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function getNodeText(node) {
  if (node === undefined || node === null) return '';

  if (typeof node === 'string' || typeof node === 'number') {
    return cleanValue(node);
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      const text = getNodeText(item);
      if (text) return text;
    }
    return '';
  }

  if (typeof node === 'object') {
    if (node['#text'] !== undefined) {
      return cleanValue(node['#text']);
    }

    if (node.text !== undefined) {
      return cleanValue(node.text);
    }

    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('@_')) continue;
      const text = getNodeText(value);
      if (text) return text;
    }
  }

  return '';
}

function getNodeLanguage(node) {
  if (!node || typeof node !== 'object') return null;
  return normalizeLanguage(node['@_lang'] || node.lang || node.language || node['@lang']);
}

function extractTextsByLanguage(node, preferredLanguage) {
  const items = normalizeArray(node);
  const entries = [];

  for (const item of items) {
    if (!item) continue;
    const text = getNodeText(item);
    if (!text) continue;
    entries.push({ language: getNodeLanguage(item), text });
  }

  if (entries.length === 0) return [];

  const preferred = normalizeLanguage(preferredLanguage);
  if (!preferred) {
    return entries.map((entry) => entry.text);
  }

  const preferredTexts = entries.filter((entry) => entry.language === preferred).map((entry) => entry.text);
  return preferredTexts.length > 0 ? preferredTexts : entries.map((entry) => entry.text);
}

function extractFirstText(node, preferredLanguage) {
  return extractTextsByLanguage(node, preferredLanguage)[0] || '';
}

function getDisorderCollection(xml) {
  const jdbor = xml?.JDBOR || xml;
  const disorderList = jdbor?.DisorderList?.Disorder || jdbor?.Disorder || [];
  return normalizeArray(disorderList);
}

function extractExternalReferences(disorder) {
  const referenceList = disorder?.ExternalReferenceList?.ExternalReference;
  const references = normalizeArray(referenceList);
  const icdCodes = [];
  const omimCodes = [];

  for (const reference of references) {
    const source = cleanValue(getNodeText(reference?.Source)).toUpperCase();
    const code = cleanValue(getNodeText(reference?.Reference));

    if (!source || !code) continue;

    if ((source === 'ICD-10' || source === 'ICD-11' || source === 'ICD') && !icdCodes.includes(code)) {
      icdCodes.push(code);
    }

    if (source === 'OMIM' && !omimCodes.includes(code)) {
      omimCodes.push(code);
    }
  }

  return { icdCodes, omimCodes };
}

function extractSynonyms(disorder, preferredLanguage) {
  const synonymList = disorder?.SynonymList?.Synonym;
  return uniqueStrings(extractTextsByLanguage(synonymList, preferredLanguage));
}

function readOrphanetXml(filePath, language) {
  const xml = fs.readFileSync(filePath, 'utf8');
  const parsed = XML_PARSER.parse(xml);
  const disorders = getDisorderCollection(parsed);
  const normalizedLanguage = normalizeLanguage(language);

  return disorders
    .map((disorder) => {
      const orphaCode = cleanValue(getNodeText(disorder?.OrphaCode));
      const localizedName = extractFirstText(disorder?.Name, normalizedLanguage);

      if (!orphaCode || !localizedName) {
        return null;
      }

      const { icdCodes, omimCodes } = extractExternalReferences(disorder);

      return {
        orphaCode,
        language: normalizedLanguage,
        name: localizedName,
        synonyms: extractSynonyms(disorder, normalizedLanguage),
        icdCodes,
        omimCodes
      };
    })
    .filter(Boolean);
}

function mergeSourceRecord(target, source) {
  if (!source || !source.language || !source.name) {
    return target;
  }

  target.names[source.language] = source.name;
  target.translations[source.language] = source.name;

  if (source.language === 'en' && !target.nameEn) {
    target.nameEn = source.name;
  }

  if (source.language === 'pt' && !target.namePt) {
    target.namePt = source.name;
  }

  if (source.language === 'es' && !target.nameEs) {
    target.nameEs = source.name;
  }

  if (!target.Descricao) {
    target.Descricao = source.language === 'en' ? source.name : target.Descricao || source.name;
  }

  for (const synonym of source.synonyms || []) {
    target.aliases.add(synonym);
  }

  for (const code of source.icdCodes || []) {
    target.icdCodes.add(code);
  }

  for (const code of source.omimCodes || []) {
    target.omimCodes.add(code);
  }

  return target;
}

function buildOrphanetCatalog(sourceRows) {
  const records = new Map();

  for (const row of sourceRows) {
    const current = records.get(row.orphaCode) || {
      Capitulo: null,
      Codigo_Tabulacao: row.orphaCode,
      Descricao: '',
      Codigos_CID10: '',
      ORPHA: row.orphaCode,
      OMIM: '',
      aliases: new Set(),
      icdCodes: new Set(),
      omimCodes: new Set(),
      names: {},
      translations: {},
      namePt: null,
      nameEn: null,
      nameEs: null
    };

    mergeSourceRecord(current, row);
    records.set(row.orphaCode, current);
  }

  return [...records.values()].map((record) => {
    const icdCodes = uniqueStrings([...record.icdCodes]);
    const omimCodes = uniqueStrings([...record.omimCodes]);
    const aliases = uniqueStrings([...record.aliases]);

    return {
      Capitulo: record.Capitulo,
      Codigo_Tabulacao: record.Codigo_Tabulacao,
      Descricao: record.Descricao,
      Codigos_CID10: icdCodes.join(' | ') || record.Codigo_Tabulacao,
      icd_code: icdCodes[0] || record.Codigo_Tabulacao,
      ORPHA: record.ORPHA,
      OMIM: omimCodes.join(' | ') || null,
      aliases,
      synonyms: aliases,
      alternativeNames: aliases,
      namePt: record.namePt || null,
      nameEn: record.nameEn || null,
      nameEs: record.nameEs || null,
      translations: Object.keys(record.translations).length > 0 ? record.translations : null,
      names: Object.keys(record.names).length > 0 ? record.names : null,
      active: true
    };
  });
}

function normalizePossiblyCollapsedRow(rawRow) {
  const row = {
    Capitulo: cleanValue(rawRow.Capitulo),
    Codigo_Tabulacao: cleanValue(rawRow.Codigo_Tabulacao),
    Descricao: cleanValue(rawRow.Descricao),
    Codigos_CID10: cleanValue(rawRow.Codigos_CID10)
  };

  if (row.Codigo_Tabulacao && row.Descricao && row.Codigos_CID10) {
    return row;
  }

  const flattened = [rawRow.Capitulo, rawRow.Codigo_Tabulacao, rawRow.Descricao, rawRow.Codigos_CID10]
    .filter((part) => part !== undefined && part !== null && String(part).trim() !== '')
    .map((part) => cleanValue(part))
    .join(',');

  const match = flattened.match(/^([IVXLCDM]+),([^,]+),(.+),([A-Z0-9][A-Z0-9.,\-\s]+)$/i);
  if (!match) {
    return row;
  }

  return {
    Capitulo: cleanValue(match[1]),
    Codigo_Tabulacao: cleanValue(match[2]),
    Descricao: cleanValue(match[3]),
    Codigos_CID10: cleanValue(match[4])
  };
}

function readCidCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];

    fs.createReadStream(filePath, { encoding: 'utf8' })
      .pipe(csv())
      .on('data', (rawRow) => {
        const row = normalizePossiblyCollapsedRow(rawRow);
        if (!row.Codigo_Tabulacao) return;

        rows.push({
          Capitulo: row.Capitulo || null,
          Codigo_Tabulacao: row.Codigo_Tabulacao,
          Descricao: row.Descricao || null,
          Codigos_CID10: row.Codigos_CID10 || null
        });
      })
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

function buildBulkOps(rows) {
  const now = new Date();

  return rows.map((row) => ({
    updateOne: {
      filter: { Codigo_Tabulacao: row.Codigo_Tabulacao },
      upsert: true,
      update: {
        $set: {
          Capitulo: row.Capitulo,
          Codigo_Tabulacao: row.Codigo_Tabulacao,
          Descricao: row.Descricao,
          Codigos_CID10: row.Codigos_CID10,
          icd_code: row.icd_code || row.Codigos_CID10 || row.Codigo_Tabulacao,
          ORPHA: row.ORPHA || row.Codigo_Tabulacao,
          OMIM: row.OMIM,
          aliases: row.aliases || [],
          synonyms: row.synonyms || [],
          alternativeNames: row.alternativeNames || [],
          namePt: row.namePt || null,
          nameEn: row.nameEn || null,
          nameEs: row.nameEs || null,
          translations: row.translations || null,
          names: row.names || null,
          active: row.active !== false,
          updatedAt: now
        },
        $setOnInsert: {
          createdAt: now
        }
      }
    }
  }));
}

async function run() {
  const db = await connectDB();
  const cidsCollection = await getCollection(db, 'cids');

  let rows = [];
  const availableXmlSources = XML_SOURCES.filter((source) => fs.existsSync(source.path));

  if (availableXmlSources.length > 0) {
    const sourceRows = [];

    for (const source of availableXmlSources) {
      const parsedRows = readOrphanetXml(source.path, source.language);
      sourceRows.push(...parsedRows);
    }

    rows = buildOrphanetCatalog(sourceRows);
  } else if (fs.existsSync(CSV_PATH)) {
    rows = await readCidCsv(CSV_PATH);
  } else {
    const xmlPaths = XML_SOURCES.map((source) => source.path).join(' | ');
    throw new Error(`Arquivo XML ou CSV não encontrado. XMLs: ${xmlPaths} | CSV: ${CSV_PATH}`);
  }


  if (rows.length === 0) {
    return;
  }

  const ops = buildBulkOps(rows);
  const chunkSize = 500;
  let totalMatched = 0;
  let totalModified = 0;
  let totalUpserted = 0;

  for (let index = 0; index < ops.length; index += chunkSize) {
    const chunk = ops.slice(index, index + chunkSize);
    const result = await cidsCollection.bulkWrite(chunk, { ordered: false });
    totalMatched += result.matchedCount || 0;
    totalModified += result.modifiedCount || 0;
    totalUpserted += result.upsertedCount || 0;
  }

  await cidsCollection.createIndex({ Codigo_Tabulacao: 1 }, { unique: true, name: 'codigo_tabulacao_unique' });
  await cidsCollection.createIndex({ ORPHA: 1 }, { name: 'orpha_idx' });
  await cidsCollection.createIndex({ OMIM: 1 }, { name: 'omim_idx' });
  await cidsCollection.createIndex({ namePt: 1 }, { name: 'name_pt_idx' });
  await cidsCollection.createIndex({ nameEn: 1 }, { name: 'name_en_idx' });
  await cidsCollection.createIndex({ nameEs: 1 }, { name: 'name_es_idx' });
  await cidsCollection.createIndex({ aliases: 1 }, { name: 'aliases_idx' });
  await cidsCollection.createIndex({ synonyms: 1 }, { name: 'synonyms_idx' });
  await cidsCollection.createIndex({ alternativeNames: 1 }, { name: 'alternative_names_idx' });
  try {
    await cidsCollection.dropIndex('cid_text_search');
  } catch (_) {}
  await cidsCollection.createIndex(
    {
      Descricao: 'text',
      Codigos_CID10: 'text',
      ORPHA: 'text',
      OMIM: 'text',
      aliases: 'text',
      synonyms: 'text',
      alternativeNames: 'text',
      namePt: 'text',
      nameEn: 'text',
      nameEs: 'text'
    },
    { name: 'cid_text_search' }
  );


}

run()
  .catch((error) => {
    console.error('❌ Erro ao executar seed de CID:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closeConnection();
    } catch (_) {}
  });
