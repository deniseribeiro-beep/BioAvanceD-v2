// dict-02 P1X-0268..0275 RecoveryCodeSet: the one live set of MFA recovery
// codes a UserAccount holds, stored in `recovery_codes`, one document per
// user. This is the shape userSecurityService.generateRecoveryCodes writes;
// it keeps the collection's existing field names (userID, codes, remaining,
// usedCodes), which the canonical catalog names userAccountId, codeHashes,
// remainingCount and usedCodeHashes. The catalog conformance guard records
// that drift until the stored documents are migrated.
class RecoveryCodeSetModel {
  static fieldsOf(data = {}) {
    const codes = Array.isArray(data.codes) ? data.codes : [];
    return {
      userID: data.userID ?? null,
      codes,
      remaining: data.remaining ?? codes.length,
      usedCodes: Array.isArray(data.usedCodes) ? data.usedCodes : [],
      createdAt: data.createdAt ? new Date(data.createdAt) : null,
      updatedAt: data.updatedAt ? new Date(data.updatedAt) : null,
    };
  }
}

module.exports = RecoveryCodeSetModel;
