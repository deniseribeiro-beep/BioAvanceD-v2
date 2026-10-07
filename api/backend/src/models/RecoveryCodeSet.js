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
}

module.exports = RecoveryCodeSetModel;
module.exports.LEGACY_FIELDS = LEGACY_FIELDS;
