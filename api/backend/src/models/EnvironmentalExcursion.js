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
 * doesn't structurally capture. `excursionType` is likewise not a
 * dictionary row — it distinguishes AC#4's two excursion triggers
 * (`temperature_out_of_range` vs `missing_reading`, #299) since a missing
 * reading has no numeric value to preserve; `minimumValue`/`maximumValue`/
 * `originalReading` stay null for that type (the dictionary already marks
 * min/maxValue 0..1, i.e. optional — ELM-0370/ELM-0371).
 */
class EnvironmentalExcursionModel {
  static create(data) {
    const now = new Date();
    return {
      excursionId: data.excursionId || crypto.randomUUID(),
      equipmentId: data.equipmentId || null, // Device/uuid reference (ELM-0367)
      startDateTime: new Date(data.startDateTime),
      endDateTime: data.endDateTime ? new Date(data.endDateTime) : null,
      minimumValue: data.minimumValue === null || data.minimumValue === undefined ? null : Number(data.minimumValue),
      maximumValue: data.maximumValue === null || data.maximumValue === undefined ? null : Number(data.maximumValue),
      affectedSpecimenIds: data.affectedSpecimenIds || [],
      excursionStatus: data.excursionStatus || 'under_assessment',
      excursionType: data.excursionType || 'temperature_out_of_range',
      impactAssessment: data.impactAssessment || null,
      quarantineActionId: data.quarantineActionId || null,
      triggeringPolicyId: data.triggeringPolicyId || null,
      originalReading: data.originalReading === null || data.originalReading === undefined ? null : Number(data.originalReading),
      createdAt: now,
      updatedAt: now,
    };
  }
}

module.exports = EnvironmentalExcursionModel;
