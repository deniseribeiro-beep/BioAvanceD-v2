class SampleMovementModel {
  static MOVEMENT_TYPES = {
    WITHDRAW: 'withdraw',
    RETURN: 'return',
    ADJUST: 'adjust',
    MOVE: 'move'
  };

  static RETURN_CONDITIONS = {
    INTACT: 'intact',
    PARTIALLY_COMPROMISED: 'partially_compromised',
    UNUSABLE: 'unusable'
  };

  static normalizeReturnCondition(condition) {
    const normalized = String(condition || '').trim().toLowerCase();
    if (normalized === 'íntegra' || normalized === 'integra') return 'intact';
    if (normalized === 'partially compromised') return 'partially_compromised';
    if (normalized === 'inutilizada') return 'unusable';
    return normalized;
  }

  static validate(data) {
    const errors = [];
    if (!data.specimenId) errors.push('specimenId é obrigatório');
    if (!data.type || !Object.values(this.MOVEMENT_TYPES).includes(data.type)) errors.push('type inválido');
    if (!(Number(data.quantity) > 0)) errors.push('quantity deve ser um número maior que zero');
    if (!data.responsible || typeof data.responsible !== 'string') errors.push('responsible é obrigatório');
    return { isValid: errors.length === 0, errors };
  }

  static create(data) {
    const now = new Date();
    return {
      movementId: data.movementId || data.movementID || null,
      specimenId: String(data.specimenId),
      barcode: data.barcode || null,
      type: data.type,
      quantity: data.quantity,
      unit: data.unit || 'µL',
      responsible: data.responsible,
      destination: data.destination || null,
      purpose: data.purpose || null,
      linkedProject: data.linkedProject || null,
      condition: data.condition ? this.normalizeReturnCondition(data.condition) : null,
      relatedWithdrawalId: data.relatedWithdrawalId || data.relatedWithdrawalID || null,
      observations: data.observations || null,
      userId: data.userId || null,
      userName: data.userName || null,
      userRole: data.userRole || null,
      ipAddress: data.ipAddress || null,
      userAgent: data.userAgent || null,
      previousQuantity: data.previousQuantity ?? null,
      newQuantity: data.newQuantity ?? null,
      quantityLedgerVersion: data.quantityLedgerVersion ?? null,
      previousState: data.previousState || null,
      newState: data.newState || null,
      hash: data.hash || null,
      previousHash: data.previousHash || null,
      createdAt: now,
      updatedAt: now
    };
  }

  static async generateMovementID(db, session) {
    const countersCollection = db.collection('counters');
    // #1369: inside a transaction the id is taken in the caller's session, so
    // it is given back on abort and does not conflict with the same
    // transaction's later in-session bump of this counter.
    const counter = await countersCollection.findOneAndUpdate(
      { _id: 'sample_movements' },
      { $inc: { seq: 1 }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true, returnDocument: 'after', ...(session ? { session } : {}) }
    );
    // mongodb driver v5+ returns the modified document directly, not
    // wrapped in `{ value: doc }` (that shape only applies with
    // `includeResultMetadata: true`) — `counter.value.seq` was always
    // undefined, so this counter never advanced past 1 and every
    // sample after the first collided on movementId (#294).
    return counter?.seq || 1;
  }
}

module.exports = SampleMovementModel;
