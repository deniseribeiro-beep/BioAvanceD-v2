import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const authService = require('../../src/services/auth.service');

// #887: four lookups take a value straight off req.body, check only that it
// is truthy, and hand it to a driver call as a filter value. An
// operator-shaped payload -- {"$ne": null}, {"$gt": ""} -- is truthy, passes
// the guard, and reaches MongoDB as an operator.
//
// The sibling in the same file already does it right: AuthService#login
// coerces with `email.trim()` before building the identical email-or-username
// $or, and .trim() throws on a non-string. So this is not a missing
// convention, it is an existing one applied inconsistently -- the same shape
// as #818 fixing groupFields and leaving mapping (#869) twelve lines away.
//
// These tests assert the COERCION, not a specific rejection message: what
// matters is that no object reaches the filter. Asserting on the thrown
// message would pin wording that is not the point.
function collectingDb() {
  const filters = [];
  return {
    filters,
    collection: () => ({
      findOne: vi.fn(async (filter) => {
        filters.push(filter);
        return null;
      }),
      updateOne: vi.fn(async () => ({ matchedCount: 0 })),
    }),
  };
}

// Every value that reaches a filter, however deeply nested through $or/$and,
// must be a primitive. An object there is an operator by definition.
function filterValues(filter, out = []) {
  for (const value of Object.values(filter || {})) {
    if (Array.isArray(value)) {
      for (const entry of value) filterValues(entry, out);
    } else {
      out.push(value);
    }
  }
  return out;
}

const OPERATOR_PAYLOAD = { $ne: null };

describe('#887: a request-body value never reaches a filter as an operator', () => {
  it('setupMFAFirstLogin refuses an operator-shaped username', async () => {
    const db = collectingDb();

    await expect(
      authService.setupMFAFirstLogin(db, { username: OPERATOR_PAYLOAD, password: 'x' })
    ).rejects.toThrow();

    expect(db.filters.flatMap((f) => filterValues(f))).not.toContainEqual(
      expect.objectContaining({ $ne: null })
    );
  });

  it('enableMFAFirstLogin refuses an operator-shaped username', async () => {
    const db = collectingDb();

    await expect(
      authService.enableMFAFirstLogin(
        db,
        { username: OPERATOR_PAYLOAD, password: 'x' },
        '123456',
        {}
      )
    ).rejects.toThrow();

    expect(db.filters.flatMap((f) => filterValues(f))).not.toContainEqual(
      expect.objectContaining({ $ne: null })
    );
  });

  it('requestPasswordReset refuses an operator-shaped email', async () => {
    const db = collectingDb();

    // This one deliberately answers success whether or not a user matches,
    // to avoid being an enumeration oracle -- so it may resolve rather than
    // throw. The assertion that matters either way is that the operator did
    // not reach the driver.
    await authService.requestPasswordReset(db, OPERATOR_PAYLOAD, {}).catch(() => {});

    expect(db.filters.flatMap((f) => filterValues(f))).not.toContainEqual(
      expect.objectContaining({ $ne: null })
    );
  });

  it('still accepts an ordinary string username, unchanged', async () => {
    const db = collectingDb();

    await authService
      .setupMFAFirstLogin(db, { username: '  admin@example.test  ', password: 'x' })
      .catch(() => {});

    // Trimmed, like login() already does with the same field.
    expect(db.filters[0]).toEqual({
      $or: [{ email: 'admin@example.test' }, { username: 'admin@example.test' }],
    });
  });
});
