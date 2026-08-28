/**
 * #774: `BLOCKED_EQUIPMENT_STATUSES` used to be retyped by hand in three
 * different files (Equipment's own allow-list lived in a fourth), and the
 * copies drifted from the allow-list they were meant to describe — nothing
 * enforced that "not ready" stayed a subset of "valid". This module is the
 * single place that concept lives now: `BLOCKED_EQUIPMENT_STATUSES` is
 * *derived* from `EQUIPMENT_STATUS` (lowercased), so the deny-list and the
 * allow-list are mathematically incapable of disagreeing again.
 *
 * `error` and `retired` are not in `EQUIPMENT_STATUS` — they are legacy
 * values that predate this field's validation and can still be found on
 * documents created before the model enforced the allow-list. They are the
 * whole reason a derivation needs a tail at all: kept only so existing
 * "blocked" behaviour for those legacy values does not change.
 */

const EQUIPMENT_STATUS = [
  'Calibrado',      // Equipamento calibrado e pronto para uso
  'Maintenance',    // Em manutenção
  'Active',         // Ativo e operacional
  'Inactive',       // Inativo
  'Needs Calibration' // Necessita calibração
];

// The subset of EQUIPMENT_STATUS that means "not ready", lowercased to match
// how read sites normalize incoming status values, plus a legacy tail for
// values that were never part of the allow-list (see header comment).
const BLOCKED_EQUIPMENT_STATUSES = [
  'Maintenance',
  'Inactive',
  'Needs Calibration',
].map((status) => status.toLowerCase()).concat([
  // Legacy tail: not in EQUIPMENT_STATUS, retained only for documents
  // created before this field was validated.
  'error',
  'retired',
]);

const CRITICAL_SENSOR_STATUSES = ['maintenance', 'calibration', 'error', 'offline'];

module.exports = {
  EQUIPMENT_STATUS,
  BLOCKED_EQUIPMENT_STATUSES,
  CRITICAL_SENSOR_STATUSES,
};
