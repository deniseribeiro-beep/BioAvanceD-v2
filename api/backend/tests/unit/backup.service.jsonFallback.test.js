import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const { ObjectId, Decimal128, Long, Binary, BSON } = require('mongodb');
const backupService = require('../../src/services/backup.service');

// #738 (RF013 AC#3): the Docker images ship no mongodump/mongorestore, so
// every containerized backup takes the JSON fallback -- which means the
// fallback is not a degraded-mode safety net there, it is the only path.
// It serialized with JSON.stringify and restored with JSON.parse +
// insertMany, so BSON types did not survive the round trip: ObjectId _ids
// and refs came back as 24-character strings and Dates as ISO strings, and
// every `findOne({ _id: new ObjectId(id) })` and date-range query in the
// app would stop matching after a restore. The checksum in AC#3 is computed
// over the JSON files, so it could not catch this either.
describe('#738: JSON-fallback backup round trip preserves BSON types', () => {
  const roundTrip = (docs) => backupService.parseBackupDocs(backupService.serializeBackupDocs(docs));

  it('preserves ObjectId, so _id and refs stay queryable after a restore', () => {
    const id = new ObjectId('507f1f77bcf86cd799439011');
    const ref = new ObjectId('507f191e810c19729de860ea');

    const [doc] = roundTrip([{ _id: id, specimenRef: ref, name: 'S1' }]);

    expect(doc._id).toBeInstanceOf(ObjectId);
    expect(doc._id.equals(id)).toBe(true);
    expect(doc.specimenRef).toBeInstanceOf(ObjectId);
    expect(doc.specimenRef.equals(ref)).toBe(true);
    expect(doc.name).toBe('S1');
  });

  it('preserves Date, so date-range queries still match after a restore', () => {
    const registeredAt = new Date('2026-01-02T03:04:05.678Z');

    const [doc] = roundTrip([{ registeredAt }]);

    expect(doc.registeredAt).toBeInstanceOf(Date);
    expect(doc.registeredAt.toISOString()).toBe('2026-01-02T03:04:05.678Z');
  });

  it('preserves Decimal128, Long and Binary', () => {
    const [doc] = roundTrip([
      {
        quantity: Decimal128.fromString('12.345'),
        counter: Long.fromString('9007199254740993'),
        payload: new Binary(Buffer.from('bioavanced')),
      },
    ]);

    expect(doc.quantity).toBeInstanceOf(Decimal128);
    expect(doc.quantity.toString()).toBe('12.345');
    expect(doc.counter).toBeInstanceOf(Long);
    expect(doc.counter.toString()).toBe('9007199254740993');
    expect(doc.payload).toBeInstanceOf(Binary);
    expect(Buffer.from(doc.payload.buffer).toString()).toBe('bioavanced');
  });

  it('preserves nested and array-held values, not just top-level fields', () => {
    const id = new ObjectId('507f1f77bcf86cd799439011');
    const when = new Date('2026-03-04T05:06:07.000Z');

    const [doc] = roundTrip([{ storageLocation: { boxId: id }, events: [{ at: when }] }]);

    expect(doc.storageLocation.boxId).toBeInstanceOf(ObjectId);
    expect(doc.events[0].at).toBeInstanceOf(Date);
  });

  it('round-trips an empty collection without throwing', () => {
    expect(roundTrip([])).toEqual([]);
  });

  // Backups written before this change are plain JSON with no $oid/$date
  // wrappers. They must still restore -- as lossily as they always did,
  // but without erroring -- or the fix would strand every existing backup.
  it('still parses a pre-existing plain-JSON backup', () => {
    const legacy = JSON.stringify([{ _id: '507f1f77bcf86cd799439011', registeredAt: '2026-01-02T03:04:05.678Z', n: 42 }], null, 2);

    const docs = backupService.parseBackupDocs(legacy);

    expect(docs).toHaveLength(1);
    // Untagged, so still a plain string -- the old lossiness preserved,
    // not newly introduced. Nothing throws, which is the point.
    expect(docs[0]._id).toBe('507f1f77bcf86cd799439011');
    // Canonical mode (relaxed: false) wraps a bare JSON number in Int32,
    // same as every other number in this file -- constraining the type
    // here, not just the value, is what would catch a numeric-type
    // regression (e.g. it silently becoming a native number).
    expect(docs[0].n).toBeInstanceOf(BSON.Int32);
    expect(Number(docs[0].n)).toBe(42);
  });

  // #865: a legacy plain-JSON backup can contain a field whose NAME happens
  // to begin with `$` -- e.g. carried over from a source system, or a user
  // field named `$oid`/`$date`/`$numberInt`. EJSON.parse(raw, { relaxed:
  // false }) reinterprets these as canonical type wrappers instead of
  // passing them through, and restoreFromJsonBackup has already wiped
  // earlier collections (deleteMany({}) before insertMany) by the time a
  // later collection's parseBackupDocs runs -- so a newly-introduced throw
  // here would leave those earlier collections dropped and empty.
  describe('#865: legacy fields whose names collide with EJSON type wrappers', () => {
    it('passes through a legacy-looking $oid field instead of throwing (malformed as an ObjectId)', () => {
      const raw = JSON.stringify([{ a: { $oid: 'zzz' } }]);

      const docs = backupService.parseBackupDocs(raw);

      expect(docs).toHaveLength(1);
      expect(docs[0].a).toEqual({ $oid: 'zzz' });
    });

    it('passes through a legacy-looking $date field instead of silently losing it', () => {
      const raw = JSON.stringify([{ a: { $date: 'nope' } }]);

      const docs = backupService.parseBackupDocs(raw);

      expect(docs).toHaveLength(1);
      expect(docs[0].a).toEqual({ $date: 'nope' });
    });

    it('passes through a legacy-looking $numberInt field and keeps its sibling key', () => {
      const raw = JSON.stringify([{ a: { $numberInt: '1', b: 2 } }]);

      const docs = backupService.parseBackupDocs(raw);

      expect(docs).toHaveLength(1);
      expect(docs[0].a).toEqual({ $numberInt: '1', b: 2 });
    });

    it('still converts a genuine canonical $oid wrapper to an ObjectId', () => {
      const raw = JSON.stringify([{ a: { $oid: '507f1f77bcf86cd799439011' } }]);

      const docs = backupService.parseBackupDocs(raw);

      expect(docs[0].a).toBeInstanceOf(ObjectId);
      expect(docs[0].a.toHexString()).toBe('507f1f77bcf86cd799439011');
    });

    it('still converts a genuine canonical $date wrapper to a Date', () => {
      const raw = backupService.serializeBackupDocs([{ when: new Date('2026-01-02T03:04:05.678Z') }]);

      const docs = backupService.parseBackupDocs(raw);

      expect(docs[0].when).toBeInstanceOf(Date);
      expect(docs[0].when.toISOString()).toBe('2026-01-02T03:04:05.678Z');
    });

    it('handles a file mixing a legacy $-named field and a genuine wrapper', () => {
      const raw = JSON.stringify([
        { legacy: { $oid: 'zzz' }, wrapped: { $oid: '507f1f77bcf86cd799439011' } },
      ]);

      const docs = backupService.parseBackupDocs(raw);

      expect(docs[0].legacy).toEqual({ $oid: 'zzz' });
      expect(docs[0].wrapped).toBeInstanceOf(ObjectId);
      expect(docs[0].wrapped.toHexString()).toBe('507f1f77bcf86cd799439011');
    });

    it('keeps current EJSON behaviour for a DBRef, which legitimately keeps sibling keys', () => {
      const raw = JSON.stringify([{ $ref: 'c', $id: 1, b: 2 }]);

      const expected = BSON.EJSON.parse(raw, { relaxed: false });
      const docs = backupService.parseBackupDocs(raw);

      expect(docs).toEqual(expected);
      expect(docs[0]).toBeInstanceOf(BSON.DBRef);
    });
  });

  describe('item 8 wrapper-shape branch closure', () => {
    it('recognizes the remaining well-formed EJSON wrapper shapes without degrading them to legacy JSON', () => {
      const raw = JSON.stringify([{
        uuid: { $uuid: '00112233-4455-6677-8899-aabbccddeeff' },
        symbol: { $symbol: 'BIO' },
        numberDouble: { $numberDouble: '1.25' },
        minKey: { $minKey: 1 },
        maxKey: { $maxKey: 1 },
        regex: { $regex: '^BIO$', $options: 'i' },
        regularExpression: { $regularExpression: { pattern: '^ADV$', options: 'i' } },
        timestamp: { $timestamp: { t: 10, i: 2 } },
        undefinedValue: { $undefined: true },
        code: { $code: 'return x;', $scope: { x: { $numberInt: '1' } } },
        dbPointer: {
          $dbPointer: {
            $ref: 'samples',
            $id: { $oid: '507f1f77bcf86cd799439011' }
          }
        }
      }]);

      const expected = BSON.EJSON.parse(raw, { relaxed: false });
      const docs = backupService.parseBackupDocs(raw);

      expect(docs).toEqual(expected);
    });

    it('keeps malformed wrapper collisions plain while exercising every shape guard fail-closed', () => {
      const malformed = {
        oid: { $oid: 'not-an-object-id' },
        binary: { $binary: { base64: '*not-base64*', subType: 'zz' } },
        uuid: { $uuid: 'not-a-uuid' },
        symbol: { $symbol: 42 },
        numberInt: { $numberInt: '2147483648' },
        numberDecimal: { $numberDecimal: 'not-a-number' },
        numberDouble: { $numberDouble: 'not-a-number' },
        numberLong: { $numberLong: '9223372036854775808' },
        minKey: { $minKey: 0 },
        maxKey: { $maxKey: 0 },
        regex: { $regex: '^BIO$', $options: 'q' },
        regularExpression: { $regularExpression: { pattern: '^BIO$', options: 'q' } },
        timestamp: { $timestamp: { t: '10', i: 2 } },
        undefinedValue: { $undefined: false },
        date: { $date: 'not-a-date' },
        code: { $code: 'return x;', $scope: 'not-an-object' },
        dbPointer: { $dbPointer: { $ref: 'samples' } },
      };

      const docs = backupService.parseBackupDocs(JSON.stringify([{ malformed }]));

      expect(docs).toEqual([{ malformed }]);
    });

    it('keeps objects with unknown or extra dollar keys plain instead of selecting a near-match wrapper', () => {
      const rawDoc = {
        unknown: { $bioavanced: 'value' },
        extra: { $oid: '507f1f77bcf86cd799439011', $extra: true },
        codeExtra: { $code: 'return 1;', $scope: {}, ordinarySibling: true },
        dbRefMissingId: { $ref: 'samples', ordinarySibling: true },
      };

      const docs = backupService.parseBackupDocs(JSON.stringify([rawDoc]));

      expect(docs).toEqual([rawDoc]);
    });
  });

  // Canonical mode wraps plain numbers in Int32/Double rather than
  // returning native JS numbers. That is deliberate and must not be
  // "simplified" to `relaxed: true`: relaxed parsing returns native numbers
  // but silently truncates Long past 2^53 -- Long('9007199254740993') comes
  // back as 9007199254740992, which is the exact class of silent corruption
  // this issue exists to remove. The wrappers cost nothing on restore, since
  // the driver serializes Int32/Double straight back to the same BSON
  // numeric types on insertMany.
  it('keeps numeric types tagged rather than trading Long precision for native numbers', () => {
    const docs = backupService.parseBackupDocs(
      backupService.serializeBackupDocs([{ counter: Long.fromString('9007199254740993'), n: 42 }])
    );

    expect(docs[0].counter.toString()).toBe('9007199254740993');
    expect(Number(docs[0].n)).toBe(42);
  });

  it('serializes to an indented body that is still valid JSON', () => {
    const serialized = backupService.serializeBackupDocs([{ n: 1, when: new Date('2026-01-02T00:00:00.000Z') }]);

    const LF = String.fromCharCode(10);
    expect(serialized.split(LF).length).toBeGreaterThan(1);
    // Extended JSON is JSON, just type-tagged.
    const asPlainJson = JSON.parse(serialized);
    expect(asPlainJson[0].n).toEqual({ $numberInt: '1' });
    expect(asPlainJson[0].when).toEqual({ $date: { $numberLong: String(Date.UTC(2026, 0, 2)) } });
  });
});