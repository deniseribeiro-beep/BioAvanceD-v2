const crypto = require('crypto');

// dict-02 P1X-0113–0119 ("Gestão da qualidade" domain) — quarantine as an
// append-only, referenced entity (specimenIds may cover a batch), not
// embedded fields on Sample. RF019 ("Quarentena lógica") AC#6/AC#7 require
// cause, originating event, and moment recorded, and release only by an
// authorized actor with evidence — reasonCodes/startedAt/authorizedBy/
// releasedAt below carry that. See
// docs/architecture/canonical-data-contract-v1.md's QuarantineAction
// section for the contract this mirrors (#383/#388's RcsAssessment/
// SpecimenPreanalytics pattern).
//
// dict-02's own actionStatus (P1X-0118) domain only lists `active` — a
// documented local extension, same mechanism as Sample.js's `disposed`
// extension of specimenStatus, carries today's actual code vocabulary
// (QUARANTINED/RELEASED/PENDING_REVIEW), case-folded.
const ACTION_STATUS_VALUES = ['active', 'released', 'pending_review'];

class QuarantineActionModel {
  static validateActionStatus(status) {
    return ACTION_STATUS_VALUES.includes(String(status || '').toLowerCase());
  }

  static fieldsOf(data = {}) {
    const specimenIds = Array.isArray(data.specimenIds)
      ? data.specimenIds.map((id) => String(id)).filter(Boolean)
      : [String(data.specimenIds || '')].filter(Boolean);

    return {
      quarantineActionId: data.quarantineActionId || crypto.randomUUID(),
      specimenIds,
      reasonCodes: Array.isArray(data.reasonCodes) ? data.reasonCodes : [],
      actionStatus: data.actionStatus ? String(data.actionStatus).toLowerCase() : 'active',
      authorizedBy: data.authorizedBy ?? null,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    if (fields.specimenIds.length === 0) {
      throw new Error('specimenIds é obrigatório para QuarantineAction (1..*)');
    }
    if (!this.validateActionStatus(fields.actionStatus)) {
      throw new Error(`actionStatus inválido: ${fields.actionStatus}`);
    }
    const now = new Date();
    return {
      ...fields,
      startedAt: data.startedAt ? new Date(data.startedAt) : now,
      releasedAt: data.releasedAt ? new Date(data.releasedAt) : null,
      createdAt: now,
    };
  }

  /** Marks an action released — the 0..1 releasedAt field, present only once released. */
  static release(action, releasedAt = new Date()) {
    return { ...action, actionStatus: 'released', releasedAt: new Date(releasedAt) };
  }
}

module.exports = QuarantineActionModel;
module.exports.ACTION_STATUS_VALUES = ACTION_STATUS_VALUES;
