const crypto = require('crypto');

/**
 * RF009 AC#5/AC#7 (dict-02_DICIONARIO.md ELM-0366 to ELM-0376): a distinct
 * entity from TemperatureIncident — same triggering event, but structured to
 * the dictionary's excursion shape (start/end window, min/max observed,
 * device reference) rather than the incident-tracking shape.
 *
 * `triggeringPolicyId` and `originalReading` aren't in the dictionary rows;
 * they exist to satisfy AC#7's "preservar a leitura original e a regra
 * utilizada", which the dictionary's `impactAssessment` free-text field
 * doesn't structurally capture.
 */
class EnvironmentalExcursionModel {
  static create(data) {
    const now = new Date();
    return {
      excursionId: data.excursionId || crypto.randomUUID(),
      equipmentId: data.equipmentId || null, // Device/uuid reference (ELM-0367)
      startDateTime: new Date(data.startDateTime),
      endDateTime: data.endDateTime ? new Date(data.endDateTime) : null,
      minimumValue: Number(data.minimumValue),
      maximumValue: Number(data.maximumValue),
      affectedSpecimenIds: data.affectedSpecimenIds || [],
      excursionStatus: data.excursionStatus || 'under_assessment',
      impactAssessment: data.impactAssessment || null,
      quarantineActionId: data.quarantineActionId || null,
      triggeringPolicyId: data.triggeringPolicyId || null,
      originalReading: Number(data.originalReading),
      createdAt: now,
      updatedAt: now,
    };
  }
}

module.exports = EnvironmentalExcursionModel;
