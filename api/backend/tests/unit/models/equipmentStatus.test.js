import { describe, it, expect } from 'vitest';

import {
  EQUIPMENT_STATUS,
  BLOCKED_EQUIPMENT_STATUSES,
  CRITICAL_SENSOR_STATUSES,
  isEquipmentReady,
  isEquipmentBlocked,
} from '../../../src/models/equipmentStatus.js';

// #867 inverted the equipment-readiness gate from a deny-list to an
// allow-list, and #774 collapsed the deny-list into this module. Neither
// change moved a single existing assertion -- the suite went 98/98 to 98/98
// -- because no test ever drove the value the bug was about. That is the
// gap this file closes: the fix was correct and unproven, which is the same
// position the guard in #863 was in.

describe('equipmentStatus', () => {
  describe('isEquipmentReady (#867)', () => {
    it('accepts only the two statuses that mean ready', () => {
      expect(isEquipmentReady('Calibrado')).toBe(true);
      expect(isEquipmentReady('Active')).toBe(true);
    });

    it('rejects "operational" -- the value that motivated #867', () => {
      // The old deny-list did not contain 'operational', so it passed the
      // gate; EquipmentModel.validate then rejected it, because it is not in
      // the allow-list either. tests/e2e/helpers/seedParticipant.ts seeded
      // exactly this value, chosen because it was absent from the deny-list.
      expect(isEquipmentReady('operational')).toBe(false);
    });

    it('rejects an unrecognised status rather than defaulting it to ready', () => {
      // The class fix, not the instance. A deny-list answers "ready" for
      // anything it has not heard of; an allow-list answers "not ready".
      expect(isEquipmentReady('wibble')).toBe(false);
      expect(isEquipmentReady('OPERATIONAL-ish')).toBe(false);
    });

    it('rejects the allow-list members that mean not-ready', () => {
      expect(isEquipmentReady('Maintenance')).toBe(false);
      expect(isEquipmentReady('Inactive')).toBe(false);
      expect(isEquipmentReady('Needs Calibration')).toBe(false);
    });

    it('rejects the legacy tail kept for pre-validation documents', () => {
      expect(isEquipmentReady('error')).toBe(false);
      expect(isEquipmentReady('retired')).toBe(false);
    });

    it('does not call an absent status ready', () => {
      // Honest on its own terms -- but read `isEquipmentBlocked` below before
      // using this at a gate. Absent and unrecognised are different cases and
      // the read sites must not conflate them.
      expect(isEquipmentReady(undefined)).toBe(false);
      expect(isEquipmentReady(null)).toBe(false);
      expect(isEquipmentReady('')).toBe(false);
      expect(isEquipmentReady('   ')).toBe(false);
    });
  });

  // The distinction this pair exists to hold. Gating on
  // `!isEquipmentReady(status)` looks equivalent to `isEquipmentBlocked` and
  // is not: it also rejects equipment carrying no status at all, which is a
  // pre-existing data gap the caller cannot fix from the intake path.
  // Shipped that way briefly and it broke 19 sample-creation tests, every one
  // of them ordinary intake against status-less equipment.
  describe('isEquipmentBlocked (#867)', () => {
    it('blocks a status that is present and not ready', () => {
      expect(isEquipmentBlocked('operational')).toBe(true);
      expect(isEquipmentBlocked('Maintenance')).toBe(true);
      expect(isEquipmentBlocked('retired')).toBe(true);
      expect(isEquipmentBlocked('wibble')).toBe(true);
    });

    it('does not block a ready status', () => {
      expect(isEquipmentBlocked('Calibrado')).toBe(false);
      expect(isEquipmentBlocked('Active')).toBe(false);
      expect(isEquipmentBlocked('  aCtIvE ')).toBe(false);
    });

    it('does not block equipment carrying no status at all', () => {
      // The pre-#867 deny-list treated absent as unspecified and allowed it.
      // #867 was about a present-but-unrecognised value passing the gate, not
      // about status-less records, so that behaviour is deliberately kept.
      expect(isEquipmentBlocked(undefined)).toBe(false);
      expect(isEquipmentBlocked(null)).toBe(false);
      expect(isEquipmentBlocked('')).toBe(false);
      expect(isEquipmentBlocked('   ')).toBe(false);
    });

    it('is not simply the negation of isEquipmentReady', () => {
      // If this ever becomes true, the absent case has been collapsed back
      // into the unrecognised one and intake breaks for legacy equipment.
      expect(isEquipmentReady('')).toBe(false);
      expect(isEquipmentBlocked('')).toBe(false);
    });

    it('is case- and whitespace-insensitive, matching the read sites', () => {
      // All three call sites lowercase and trim before deciding; the
      // predicate has to agree or the normalisation is done twice and
      // inconsistently.
      expect(isEquipmentReady('  cAlIbRaDo  ')).toBe(true);
      expect(isEquipmentReady('ACTIVE')).toBe(true);
    });
  });

  describe('the derived deny-list (#774)', () => {
    it('is still byte-identical to the hand-typed list it replaced', () => {
      // #774 collapsed three verbatim copies into one derived value. The
      // whole point was that behaviour did not change, so this pins the
      // exact array -- order included, since a test comparing arrays
      // directly would notice.
      expect(BLOCKED_EQUIPMENT_STATUSES).toEqual([
        'maintenance',
        'inactive',
        'needs calibration',
        'error',
        'retired',
      ]);
    });

    it('derives its first three entries from the allow-list, lowercased', () => {
      // If someone edits EQUIPMENT_STATUS, the deny-list must follow. This
      // is the property that makes the two incapable of drifting, and it is
      // invisible in the assertion above.
      const notReady = EQUIPMENT_STATUS
        .filter((status) => !isEquipmentReady(status))
        .map((status) => status.toLowerCase());

      expect(BLOCKED_EQUIPMENT_STATUSES.slice(0, notReady.length)).toEqual(notReady);
    });

    it('keeps error and retired, which sit outside the allow-list', () => {
      // They are not valid EquipmentModel statuses, so only a raw insert can
      // produce them -- but import-lgpd's suite pins 'retired' as blocking,
      // and pre-validation documents may still carry either.
      for (const legacy of ['error', 'retired']) {
        expect(BLOCKED_EQUIPMENT_STATUSES).toContain(legacy);
        expect(EQUIPMENT_STATUS.map((s) => s.toLowerCase())).not.toContain(legacy);
      }
    });
  });

  describe('the shared constants', () => {
    it('exports the five model statuses', () => {
      expect(EQUIPMENT_STATUS).toEqual([
        'Calibrado',
        'Maintenance',
        'Active',
        'Inactive',
        'Needs Calibration',
      ]);
    });

    it('exports the sensor statuses the same three services share', () => {
      expect(CRITICAL_SENSOR_STATUSES).toEqual([
        'maintenance',
        'calibration',
        'error',
        'offline',
      ]);
    });
  });
});
