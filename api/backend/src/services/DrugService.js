const DEFAULT_LIMIT = 10;
const logService = require('./log.service');
const { escapeRegex } = require('../utils/escapeRegex');

const ATC_LEVEL_1_CLASSES = {
  A: 'Alimentary tract and metabolism',
  B: 'Blood and blood forming organs',
  C: 'Cardiovascular system',
  D: 'Dermatologicals',
  G: 'Genito urinary system and sex hormones',
  H: 'Systemic hormonal preparations, excluding sex hormones and insulins',
  J: 'Antiinfectives for systemic use',
  L: 'Antineoplastic and immunomodulating agents',
  M: 'Musculo-skeletal system',
  N: 'Nervous system',
  P: 'Antiparasitic products, insecticides and repellents',
  R: 'Respiratory system',
  S: 'Sensory organs',
  V: 'Various',
};

function isExternalDrugLookupEnabled() {
  const raw = String(process.env.ALLOW_EXTERNAL_DRUG_LOOKUP || process.env.ALLOW_CLOUD_INTEGRATIONS || '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

function normalizeString(value) {
  return String(value || '').trim();
}

function toAtcLevel1(code) {
  const normalized = normalizeString(code).toUpperCase();
  return normalized ? normalized.charAt(0) : '';
}

function toDrugClass(code) {
  const level1 = toAtcLevel1(code);
  return level1 ? (ATC_LEVEL_1_CLASSES[level1] || '') : '';
}

class DrugService {
  constructor(db) {
    this.db = db;
  }

  async searchAndCacheDrug(query, options = {}) {
    const normalizedQuery = normalizeString(query);
    if (!normalizedQuery) {
      return [];
    }

    const limit = Math.min(Math.max(Number(options.limit ?? DEFAULT_LIMIT), 1), 50);
    const collection = this.db.collection('medication_dictionary');
    const regex = new RegExp(escapeRegex(normalizedQuery), 'i');

    const localRows = await collection
      .find({
        active: { $ne: false },
        $or: [
          { generic_name: regex },
          { name: regex },
          { synonyms: regex },
          { code: regex },
          { atc_code: regex },
        ],
      })
      .limit(limit)
      .toArray();

    if (localRows.length > 0) {
      return localRows.map((row) => this._normalizeDrugRecord(row));
    }

    if (!isExternalDrugLookupEnabled()) {
      await this._logAtcDictionarySync({
        query: normalizedQuery,
        cacheMiss: true,
        upsertedCount: 0,
        status: 'warning',
        message: 'Cache miss de ATC resolvido sem fallback externo: lookup ChEMBL desabilitado em ambiente local.',
        auditContext: options.auditContext || null,
      });
      return [];
    }

    const remoteRows = await this._searchChembl(normalizedQuery, limit);
    if (remoteRows.length === 0) {
      await this._logAtcDictionarySync({
        query: normalizedQuery,
        cacheMiss: true,
        upsertedCount: 0,
        status: 'warning',
        message: 'Cache miss de ATC sem resultados no ChEMBL.',
        auditContext: options.auditContext || null,
      });
      return [];
    }

    await this._cacheDrugs(remoteRows, collection);
    await this._logAtcDictionarySync({
      query: normalizedQuery,
      cacheMiss: true,
      upsertedCount: remoteRows.length,
      status: 'success',
      message: 'Cache miss de ATC resolvido com sincronização ChEMBL e upsert local.',
      auditContext: options.auditContext || null,
    });
    return remoteRows;
  }

  async _logAtcDictionarySync({ query, cacheMiss, upsertedCount, status, message, auditContext }) {
    try {
      if (!this.db) return;
      const req = auditContext?.req || null;
      const userID = auditContext?.userID || req?.user?.userID || req?.user?.id || req?.user?._id || 'USR-SYSTEM';
      await logService.createLog(this.db, {
        userID: String(userID || 'USR-SYSTEM'),
        action: 'ATC_DICTIONARY_SYNC',
        resourceType: 'MedicationDictionary',
        resourceId: String(query || '').toUpperCase() || null,
        entity: 'Sistema',
        entityID: String(query || '').toUpperCase() || null,
        status,
        result: status,
        severity: status === 'success' ? 'info' : 'warning',
        module: 'Importação',
        message,
        payload: {
          query,
          cacheMiss: Boolean(cacheMiss),
          source: 'CHEMBL',
          upsertedCount: Number(upsertedCount || 0),
        }
      }, req);
    } catch (_) {
      // Falha de auditoria não bloqueia a operação de busca.
    }
  }

  async _searchChembl(query, limit) {
    const baseUrl = String(process.env.CHEMBL_API_URL || '').trim();
    if (!baseUrl) {
      return [];
    }

    const endpoint = `${baseUrl.replace(/\/$/, '')}/molecule?molecule_properties__mw_free__lte=500&format=json&limit=${encodeURIComponent(String(limit))}&pref_name__icontains=${encodeURIComponent(query)}`;
    const response = await fetch(endpoint);

    if (!response.ok) {
      throw new Error(`Falha ao consultar ChEMBL (${response.status})`);
    }

    const payload = await response.json();
    const molecules = Array.isArray(payload?.molecules) ? payload.molecules : [];

    const mapped = [];
    molecules.forEach((item) => {
      const prefName = normalizeString(item?.pref_name);
      const atcList = Array.isArray(item?.atc_classifications)
        ? item.atc_classifications.map((code) => normalizeString(code).toUpperCase()).filter(Boolean)
        : [];

      if (!prefName || atcList.length === 0) {
        return;
      }

      atcList.forEach((atcCode) => {
        mapped.push(this._normalizeDrugRecord({
          generic_name: prefName,
          name: prefName,
          code: `ATC:${atcCode}`,
          atc_code: atcCode,
          atc_level_1: toAtcLevel1(atcCode),
          drug_class: toDrugClass(atcCode),
          atc_classifications: atcList,
          source: 'CHEMBL',
          active: true,
        }));
      });
    });

    const dedup = new Map();
    mapped.forEach((item) => {
      dedup.set(`${item.name}|${item.atc_code}`, item);
    });

    return Array.from(dedup.values());
  }

  async _cacheDrugs(drugs, collection) {
    if (!Array.isArray(drugs) || drugs.length === 0) {
      return;
    }

    const now = new Date();
    const ops = drugs.map((item) => ({
      updateOne: {
        filter: {
          generic_name: item.generic_name || item.name,
          atc_code: item.atc_code,
        },
        upsert: true,
        update: {
          $set: {
            generic_name: item.generic_name || item.name,
            name: item.name || item.generic_name,
            code: item.code,
            atc_code: item.atc_code,
            atc_level_1: item.atc_level_1,
            drug_class: item.drug_class || toDrugClass(item.atc_code),
            atc_classifications: item.atc_classifications,
            source: item.source || 'CHEMBL',
            active: true,
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
      },
    }));

    await collection.bulkWrite(ops, { ordered: false });
  }

  _normalizeDrugRecord(row = {}) {
    const atcCode = normalizeString(row.atc_code || row.code).replace(/^ATC:/i, '').toUpperCase();
    const atcClassifications = Array.isArray(row.atc_classifications)
      ? row.atc_classifications.map((code) => normalizeString(code).replace(/^ATC:/i, '').toUpperCase()).filter(Boolean)
      : (atcCode ? [atcCode] : []);
    const atcLevel1 = normalizeString(row.atc_level_1).toUpperCase() || toAtcLevel1(atcCode);

    return {
      generic_name: normalizeString(row.generic_name || row.name),
      name: normalizeString(row.name),
      code: normalizeString(row.code) || (atcCode ? `ATC:${atcCode}` : ''),
      atc_code: atcCode,
      atc_level_1: atcLevel1,
      atc_classifications: atcClassifications,
      source: normalizeString(row.source || 'LOCAL') || 'LOCAL',
      drug_class: normalizeString(row.drug_class) || toDrugClass(atcCode),
      disease_categories: Array.isArray(row.disease_categories) ? row.disease_categories : [],
      synonyms: Array.isArray(row.synonyms) ? row.synonyms : [],
    };
  }
}

module.exports = DrugService;
module.exports.isExternalDrugLookupEnabled = isExternalDrugLookupEnabled;
