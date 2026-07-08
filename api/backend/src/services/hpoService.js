// backend/src/services/hpoService.js
const COLLECTION = 'hpo_terms';
const HPO_API_URL = process.env.HPO_API_URL || '';

function isExternalHpoLookupEnabled() {
  const raw = String(process.env.ALLOW_EXTERNAL_HPO_LOOKUP || process.env.ALLOW_CLOUD_INTEGRATIONS || '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function searchHpoLocal(query, db) {
  const col = db.collection(COLLECTION);
  const regex = new RegExp(escapeRegExp(query), 'i');
  return col.find({
    $or: [
      { label: regex },
      { hpoId: regex },
      { synonyms: regex }
    ],
    isObsolete: { $ne: true }
  }).limit(20).toArray();
}

async function searchHpoExternal(query) {
  if (!isExternalHpoLookupEnabled()) {
    return [];
  }
  if (!HPO_API_URL) {
    return [];
  }

  const url = `${HPO_API_URL}${encodeURIComponent(query)}&rows=20`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Erro ao buscar na API HPO');
  const data = await res.json();
  return (data?.response?.docs || []).map(doc => ({
    hpoId: doc.id,
    label: doc.label,
    synonyms: doc.synonym,
    definition: doc.definition,
    isObsolete: doc.is_obsolete
  }));
}

module.exports = { searchHpoLocal, searchHpoExternal, isExternalHpoLookupEnabled };
