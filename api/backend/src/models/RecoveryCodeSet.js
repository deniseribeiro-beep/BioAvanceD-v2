// dict-02 P1X-0268..0275 RecoveryCodeSet: the one live set of MFA recovery
// codes a UserAccount holds, stored in `recovery_codes`, one document per
// user. Each generation is a new set: a new recoveryCodeSetId and
// generatedAt, with regeneratedAt set when it replaced an earlier set.
//
// LEGACY_FIELDS are the names documents carried before the canonical ones:
// userID, codes, remaining, usedCodes, createdAt and updatedAt. A reader
// falls back to them, and a regeneration removes them.
const LEGACY_FIELDS = ['userID', 'codes', 'remaining', 'usedCodes', 'createdAt', 'updatedAt'];

class RecoveryCodeSetModel {
  static fieldsOf(data = {}) {
    const codeHashes = Array.isArray(data.codeHashes) ? data.codeHashes : [];
    return {
      recoveryCodeSetId: data.recoveryCodeSetId ?? null,
      userAccountId: data.userAccountId ?? null,
      codeHashes,
      remainingCount: data.remainingCount ?? codeHashes.length,
      usedCodeHashes: Array.isArray(data.usedCodeHashes) ? data.usedCodeHashes : [],
      generatedAt: data.generatedAt ? new Date(data.generatedAt) : null,
      regeneratedAt: data.regeneratedAt ? new Date(data.regeneratedAt) : null,
      invalidatedAt: data.invalidatedAt ? new Date(data.invalidatedAt) : null,
    };
  }

  // The owner filter that finds a user's set under either name.
  static ownerFilter(userAccountId) {
    return { $or: [{ userAccountId }, { userID: userAccountId }] };
  }

  // Codes left in a stored set, canonical or legacy.
  static remainingOf(doc) {
    return doc?.remainingCount ?? doc?.remaining ?? 0;
  }

  // The hashes a stored set can still redeem. P1X-0270 codeHashes holds only
  // the codes still valid; a legacy document kept them under `codes`. A set
  // with invalidatedAt (P1X-0275) redeems nothing.
  static unspentHashesOf(doc) {
    if (!doc || doc.invalidatedAt) return [];
    const hashes = Array.isArray(doc.codeHashes) ? doc.codeHashes : doc.codes;
    return Array.isArray(hashes) ? hashes : [];
  }

  // #1331: spending one code, as a filter and an update for one updateOne.
  // The filter matches only while the hash is still unspent, so two sign-ins
  // racing on one code modify the document once. The hash leaves codeHashes
  // for usedCodeHashes (P1X-0272) and remainingCount drops by one.
  //
  // A legacy document is converted by the same write: its canonical fields
  // are set whole and its old names removed, as a regeneration does. It
  // never carried a set id, so `newSetId` gives it one.
  static spendOf(doc, hash, newSetId = null) {
    if (Array.isArray(doc.codeHashes)) {
      return {
        filter: { _id: doc._id, codeHashes: hash, invalidatedAt: null },
        update: {
          $pull: { codeHashes: hash },
          $push: { usedCodeHashes: hash },
          $inc: { remainingCount: -1 },
        },
      };
    }
    const codeHashes = RecoveryCodeSetModel.unspentHashesOf(doc).filter((h) => h !== hash);
    const usedCodes = Array.isArray(doc.usedCodes) ? doc.usedCodes : [];
    const set = RecoveryCodeSetModel.fieldsOf({
      recoveryCodeSetId: newSetId,
      userAccountId: doc.userID,
      codeHashes,
      usedCodeHashes: [...usedCodes, hash],
      generatedAt: doc.createdAt,
    });
    const unset = Object.fromEntries(LEGACY_FIELDS.map((field) => [field, '']));
    return {
      filter: { _id: doc._id, codes: hash },
      update: { $set: set, $unset: unset },
    };
  }
}

module.exports = RecoveryCodeSetModel;
module.exports.LEGACY_FIELDS = LEGACY_FIELDS;
