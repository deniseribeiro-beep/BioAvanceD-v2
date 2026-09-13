import { describe, it, expect } from 'vitest';
import {
  serializeLog,
  serializeLogs,
  serializeLogSimple,
  serializeValue,
  isObjectId,
} from '../../../src/utils/logSerializer.js';

class FakeObjectId {
  constructor(hex) {
    this._hex = hex;
  }
  toString() {
    return this._hex;
  }
  toHexString() {
    return this._hex;
  }
  valueOf() {
    return this._hex;
  }
}
Object.defineProperty(FakeObjectId.prototype.constructor, 'name', { value: 'ObjectId' });

const VALID_HEX = '507f1f77bcf86cd799439011';

describe('logSerializer', () => {
  describe('isObjectId', () => {
    it('returns false for null/undefined/falsy values', () => {
      expect(isObjectId(null)).toBe(false);
      expect(isObjectId(undefined)).toBe(false);
      expect(isObjectId(0)).toBe(false);
      expect(isObjectId('')).toBe(false);
    });

    it('returns true when constructor.name is ObjectId', () => {
      const oid = new FakeObjectId(VALID_HEX);
      expect(isObjectId(oid)).toBe(true);
    });

    it('returns true when object has toString/toHexString/valueOf and a valid hex string', () => {
      const oid = {
        toString: () => VALID_HEX,
        toHexString: () => VALID_HEX,
        valueOf: () => VALID_HEX,
      };
      expect(isObjectId(oid)).toBe(true);
    });

    it('returns false when toString does not return a 24-char hex string', () => {
      const notOid = {
        toString: () => 'not-a-hex-string',
        toHexString: () => 'x',
        valueOf: () => 'x',
      };
      expect(isObjectId(notOid)).toBe(false);
    });

    it('returns false when object lacks toHexString/valueOf', () => {
      expect(isObjectId({ toString: () => VALID_HEX })).toBe(false);
    });

    it('returns false when toString throws', () => {
      const throwing = {
        toString: () => {
          throw new Error('boom');
        },
        toHexString: () => 'x',
        valueOf: () => 'x',
      };
      expect(isObjectId(throwing)).toBe(false);
    });
  });

  describe('serializeValue', () => {
    it('returns null and undefined as-is', () => {
      expect(serializeValue(null)).toBeNull();
      expect(serializeValue(undefined)).toBeUndefined();
    });

    it('returns primitives as-is', () => {
      expect(serializeValue('hello')).toBe('hello');
      expect(serializeValue(42)).toBe(42);
      expect(serializeValue(true)).toBe(true);
    });

    it('serializes an ObjectId to a tagged shape', () => {
      const oid = new FakeObjectId(VALID_HEX);
      expect(serializeValue(oid)).toEqual({ _type: 'ObjectId', _value: VALID_HEX });
    });

    it('serializes a Date to a tagged shape with ISO and pt-BR formatted values', () => {
      const date = new Date('2024-03-15T12:30:00.000Z');
      const result = serializeValue(date);
      expect(result._type).toBe('Date');
      expect(result._value).toBe(date.toISOString());
      expect(typeof result._formatted).toBe('string');
    });

    it('serializes a Buffer to a tagged base64 shape', () => {
      const buf = Buffer.from('hello world');
      const result = serializeValue(buf);
      expect(result).toEqual({
        _type: 'Buffer',
        _value: buf.toString('base64'),
        _size: buf.length,
      });
    });

    it('serializes arrays recursively', () => {
      const date = new Date('2024-01-01T00:00:00.000Z');
      const result = serializeValue([1, 'a', date]);
      expect(result[0]).toBe(1);
      expect(result[1]).toBe('a');
      expect(result[2]._type).toBe('Date');
    });

    it('serializes plain objects recursively, skipping $-prefixed and __proto__ keys', () => {
      const obj = { a: 1, $internal: 'skip', nested: { b: 2 } };
      Object.defineProperty(obj, '__proto__', {
        value: { c: 3 },
        enumerable: true,
        configurable: true,
      });
      const result = serializeValue(obj);
      expect(result.a).toBe(1);
      expect(result.$internal).toBeUndefined();
      expect(result.nested).toEqual({ b: 2 });
    });

    it('detects circular references and returns a marker instead of infinite recursion', () => {
      const obj = { a: 1 };
      obj.self = obj;
      const result = serializeValue(obj);
      expect(result.a).toBe(1);
      expect(result.self).toBe('[Referência circular]');
    });

    it('stops recursion past max depth and returns a marker', () => {
      let deep = { value: 'bottom' };
      for (let i = 0; i < 15; i++) {
        deep = { child: deep };
      }
      const result = serializeValue(deep);
      let cursor = result;
      let hitMarker = false;
      for (let i = 0; i < 20 && cursor && typeof cursor === 'object'; i++) {
        if (cursor === '[Profundidade máxima atingida]') {
          hitMarker = true;
          break;
        }
        cursor = cursor.child;
      }
      expect(hitMarker || cursor === '[Profundidade máxima atingida]').toBe(true);
    });

    it('captures per-key serialization errors instead of throwing', () => {
      const obj = {
        get poison() {
          throw new Error('cannot read');
        },
      };
      const result = serializeValue(obj);
      expect(result.poison).toContain('[Erro ao serializar: cannot read]');
    });
  });

  describe('serializeLog', () => {
    it('returns null for falsy input', () => {
      expect(serializeLog(null)).toBeNull();
      expect(serializeLog(undefined)).toBeNull();
    });

    it('delegates to serializeValue for a real object', () => {
      const oid = new FakeObjectId(VALID_HEX);
      const result = serializeLog({ _id: oid, name: 'test' });
      expect(result._id).toEqual({ _type: 'ObjectId', _value: VALID_HEX });
      expect(result.name).toBe('test');
    });
  });

  describe('serializeLogs', () => {
    it('maps serializeLog over an array', () => {
      const result = serializeLogs([{ a: 1 }, null, { b: 2 }]);
      expect(result).toEqual([{ a: 1 }, null, { b: 2 }]);
    });

    it('falls back to serializeLog for non-array input', () => {
      expect(serializeLogs(null)).toBeNull();
      expect(serializeLogs({ a: 1 })).toEqual({ a: 1 });
    });
  });

  describe('serializeLogSimple', () => {
    it('returns null for falsy input', () => {
      expect(serializeLogSimple(null)).toBeNull();
    });

    it('returns log as-is if already tagged with _type', () => {
      const tagged = { _type: 'Date', _value: 'x' };
      expect(serializeLogSimple(tagged)).toBe(tagged);
    });

    it('serializes an ObjectId _id to a string', () => {
      const oid = new FakeObjectId(VALID_HEX);
      const result = serializeLogSimple({ _id: oid });
      expect(result._id).toBe(VALID_HEX);
    });

    it('serializes a partially-converted (non-ObjectId object with toString) _id', () => {
      const result = serializeLogSimple({ _id: { toString: () => 'abc123' } });
      expect(result._id).toBe('abc123');
    });

    it('converts a Date timestamp to ISO string, and leaves string/already-serialized timestamps alone', () => {
      const date = new Date('2024-06-01T00:00:00.000Z');
      expect(serializeLogSimple({ timestamp: date }).timestamp).toBe(date.toISOString());
      expect(serializeLogSimple({ timestamp: 'already-a-string' }).timestamp).toBe(
        'already-a-string'
      );
      const alreadySerialized = { _type: 'Date', _value: 'x' };
      expect(serializeLogSimple({ timestamp: alreadySerialized }).timestamp).toBe(
        alreadySerialized
      );
    });

    it('converts Date dateTime/createdAt/updatedAt fields to ISO strings', () => {
      const date = new Date('2024-06-01T00:00:00.000Z');
      const result = serializeLogSimple({
        dateTime: date,
        createdAt: date,
        updatedAt: date,
      });
      expect(result.dateTime).toBe(date.toISOString());
      expect(result.createdAt).toBe(date.toISOString());
      expect(result.updatedAt).toBe(date.toISOString());
    });

    it('recursively serializes payload and metadata objects', () => {
      const date = new Date('2024-06-01T00:00:00.000Z');
      const result = serializeLogSimple({
        payload: { when: date },
        metadata: { when: date },
      });
      expect(result.payload.when._type).toBe('Date');
      expect(result.metadata.when._type).toBe('Date');
    });

    it('serializes entityID: ObjectId to string', () => {
      const oid = new FakeObjectId(VALID_HEX);
      expect(serializeLogSimple({ entityID: oid }).entityID).toBe(VALID_HEX);
    });

    it('serializes entityID: object with _value extracts the value as string', () => {
      const result = serializeLogSimple({ entityID: { _value: 123 } });
      expect(result.entityID).toBe('123');
    });

    it('serializes entityID: object with usable toString uses it', () => {
      const result = serializeLogSimple({ entityID: { toString: () => 'my-id' } });
      expect(result.entityID).toBe('my-id');
    });

    it('serializes entityID: object whose toString yields [object Object] falls back to JSON.stringify', () => {
      const obj = { a: 1 };
      const result = serializeLogSimple({ entityID: obj });
      expect(result.entityID).toBe(JSON.stringify(obj));
    });

    it('serializes entityID: object whose toString throws falls back to JSON.stringify', () => {
      const obj = {
        a: 1,
        toString() {
          throw new Error('nope');
        },
      };
      const result = serializeLogSimple({ entityID: obj });
      expect(result.entityID).toBe(JSON.stringify(obj));
    });

    it('coerces a non-string/number/object entityID to a string', () => {
      const result = serializeLogSimple({ entityID: true });
      expect(result.entityID).toBe('true');
    });

    it('serializes userID: ObjectId to string, and generic object via toString', () => {
      const oid = new FakeObjectId(VALID_HEX);
      expect(serializeLogSimple({ userID: oid }).userID).toBe(VALID_HEX);
      expect(serializeLogSimple({ userID: { toString: () => 'user-str' } }).userID).toBe(
        'user-str'
      );
    });

    it('serializes userId (lowercase d variant): ObjectId to string, and generic object via toString', () => {
      const oid = new FakeObjectId(VALID_HEX);
      expect(serializeLogSimple({ userId: oid }).userId).toBe(VALID_HEX);
      expect(serializeLogSimple({ userId: { toString: () => 'user-str2' } }).userId).toBe(
        'user-str2'
      );
    });

    it('leaves a log with none of the special fields unchanged aside from spreading', () => {
      const result = serializeLogSimple({ foo: 'bar' });
      expect(result).toEqual({ foo: 'bar' });
    });
  });
});
