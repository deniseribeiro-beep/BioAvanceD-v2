const express = require('express');
const { authenticate } = require('../../infrastructure/middleware/auth');

const router = express.Router();
let ensuredIndexes = false;

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePhoneCodeDocument(document = {}) {
  const countryName = String(document.countryName || document.country || document.name || document.label || '').trim();
  const iso2 = String(document.iso2 || document.countryCode || document.code || '').trim().toUpperCase() || null;
  const rawDialCode = String(document.dialCode || document.phoneCode || document.code || '').trim();
  const dialDigits = rawDialCode.replace(/\D/g, '');
  const dialCode = dialDigits ? `+${dialDigits}` : '';

  return {
    _id: String(document._id || ''),
    countryName,
    iso2,
    dialCode,
    searchLabel: `${countryName}${dialCode ? ` (${dialCode})` : ''}`.trim()
  };
}

async function ensureIndexes(collection) {
  if (ensuredIndexes || !collection) return;

  const indexDefinitions = [
    [{ dialCode: 1 }, { name: 'phone_codes_dial_code_idx' }],
    [{ phoneCode: 1 }, { name: 'phone_codes_phone_code_idx' }],
    [{ countryName: 'text', country: 'text', name: 'text' }, { name: 'phone_codes_country_text' }]
  ];

  for (const [keys, options] of indexDefinitions) {
    try {
      await collection.createIndex(keys, options);
    } catch (_) {}
  }

  ensuredIndexes = true;
}

router.get('/search', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const collection = db.collection('phoneCodes');
    await ensureIndexes(collection);

    const term = String(req.query.q || '').trim();
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 20, 50));

    let docs;
    if (!term) {
      docs = await collection
        .find({})
        .sort({ dialCode: 1, countryName: 1, country: 1, name: 1 })
        .limit(limit)
        .toArray();
    } else {
      const escapedTerm = escapeRegex(term);
      const textMatches = term.length >= 2
        ? await collection
          .find(
            { $text: { $search: term } },
            {
              projection: {
                score: { $meta: 'textScore' },
                countryName: 1,
                country: 1,
                name: 1,
                iso2: 1,
                countryCode: 1,
                dialCode: 1,
                phoneCode: 1,
                code: 1
              }
            }
          )
          .sort({ score: { $meta: 'textScore' }, dialCode: 1 })
          .limit(limit)
          .toArray()
        : [];

      if (textMatches.length >= limit) {
        docs = textMatches;
      } else {
        const regexMatches = await collection
          .find({
            $or: [
              { countryName: { $regex: escapedTerm, $options: 'i' } },
              { country: { $regex: escapedTerm, $options: 'i' } },
              { name: { $regex: escapedTerm, $options: 'i' } },
              { iso2: { $regex: `^${escapedTerm}`, $options: 'i' } },
              { countryCode: { $regex: `^${escapedTerm}`, $options: 'i' } },
              { dialCode: { $regex: `^\\+?${escapedTerm.replace(/^\+/, '')}` } },
              { phoneCode: { $regex: `^\\+?${escapedTerm.replace(/^\+/, '')}` } },
              { code: { $regex: `^\\+?${escapedTerm.replace(/^\+/, '')}` } }
            ]
          })
          .sort({ dialCode: 1, countryName: 1, country: 1, name: 1 })
          .limit(limit)
          .toArray();

        const merged = [];
        const seenIds = new Set();
        [...textMatches, ...regexMatches].forEach((item) => {
          const key = String(item?._id || '');
          if (!key || seenIds.has(key)) return;
          seenIds.add(key);
          merged.push(item);
        });

        docs = merged.slice(0, limit);
      }
    }

    const items = docs
      .map((doc) => normalizePhoneCodeDocument(doc))
      .filter((doc) => doc.dialCode && doc.countryName);

    return res.status(200).json({ success: true, data: items });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Erro ao buscar códigos telefônicos', message: error.message });
  }
});

module.exports = router;
