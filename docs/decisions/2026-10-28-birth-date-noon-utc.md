# 2026-10-28: a birth date is stored at 12:00 UTC of its calendar day

Issue #1412.

## The question

An ISO `YYYY-MM-DD` birth date went through `new Date(value)`, which is UTC midnight, so on a UTC-3 host (Brazil) it was stored, hashed and shown as the day before. A DD/MM/YYYY one (#1411) was built as host-local midnight, a different instant again, so the same person typed two ways got two blind-index values (`birthDateHash`, RF005/RNF007). What instant stands for a calendar day, and how is the day read back?

## Decided

`[inference]`, from the issue's own done rule (a date normalised to a fixed noon) and the repo's consistent choice of a `Date` for this field (`models/Patient.js` `type: 'date'`, `decryptIdentity` returning `new Date(...)`, consumers calling `getFullYear`/`toISOString`, which a date-only string would break), by the coordinator for #1412, on 2026-10-28:

1. **A birth date is the instant 12:00:00.000 UTC of its calendar day, and its day is read with UTC getters.** Noon UTC is the same calendar day in every zone from UTC-11 to UTC+11, and on any server host. UTC noon rather than host-local noon, so the instant does not depend on the server's zone. `api/backend/src/utils/birthDate.js` is the one reader: DD/MM/YYYY and YYYY-MM-DD are parsed field by field (31/02 stays invalid, never rolled), and the blind-index key is the UTC `YYYY-MM-DD` of the noon value (`birthDateKey`).
2. **Every identity writer stores the noon value**: `encryptIdentityFields` canonicalises `birthDate` before the ciphertext and the hash are derived, beside the identityDocument (#1109) and recordNumber (#1386) canonicalisation.
3. **A legacy value is read by `calendarDayOf`**: an instant at exactly noon UTC is its UTC day; one at exactly local midnight on the reading host is its local day (the #1411 writer, import-lgpd's `parseBirthDate`); any other instant is its UTC day (a legacy UTC-midnight value, an ISO datetime). So both the UTC-midnight and the host-local-midnight writers are recovered on the host that wrote them. A local midnight written on a host east of UTC and read on another host is not.
4. **Stored records are migrated**: `npm run migrate:participant-birth-dates` (`src/scripts/migrateParticipantBirthDates.js`) rewrites each `participantIdentities` birth date to its noon value and recomputes `birthDateHash`. It is owed once on every deployment, after `migrate:participant-identity-ciphertext-names`, and is done there when it reports `remaining: 0`.

The day-range arms of the keyless stack (#1083) query `[00:00Z, next 00:00Z)` of the day (`birthDateDayRange`), which holds the noon value, a legacy UTC midnight and a UTC-3 local midnight.

## Not decided here

- **The frontend**: what the browser sends and how it renders a birth date is not changed here.
- **A zone beyond UTC±11** (UTC+12 to UTC+14, UTC-12): noon UTC is a different local calendar day there.
