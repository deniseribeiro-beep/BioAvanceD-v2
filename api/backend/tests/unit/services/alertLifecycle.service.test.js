import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const {
  ALERT_TYPES,
  resolveActiveAlert,
  ensureActiveAlert
} = require('../../../src/services/alertLifecycle.service');

const EPISODE = { sensorId: 's-1', type: ALERT_TYPES.THRESHOLD_BREACH, status: 'active' };

describe('alertLifecycle.service (#1142)', () => {
  it('ensureActiveAlert inserts when no episode is active, and returns the new id', async () => {
    const alerts = {
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'new-id' })
    };
    const payload = { ...EPISODE, severity: 'warning' };

    await expect(ensureActiveAlert(alerts, payload)).resolves.toEqual({ created: true, alertId: 'new-id' });
    expect(alerts.findOne).toHaveBeenCalledWith(EPISODE);
    expect(alerts.insertOne).toHaveBeenCalledWith(payload);
  });

  it('ensureActiveAlert skips the insert when an episode is active, and returns its id', async () => {
    const alerts = {
      findOne: vi.fn().mockResolvedValue({ _id: 'open-id' }),
      insertOne: vi.fn()
    };

    await expect(ensureActiveAlert(alerts, { ...EPISODE })).resolves.toEqual({ created: false, alertId: 'open-id' });
    expect(alerts.insertOne).not.toHaveBeenCalled();
  });

  it('resolveActiveAlert closes exactly the episode ensureActiveAlert opens', async () => {
    const alerts = { updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }) };

    await resolveActiveAlert(alerts, 's-1', ALERT_TYPES.THRESHOLD_BREACH);

    expect(alerts.updateMany).toHaveBeenCalledWith(
      EPISODE,
      { $set: { status: 'resolved', resolvedAt: expect.any(Date) } }
    );
  });

  // The defect #1079 was filed for came from two copies of this predicate.
  // Pin that the two alert writers no longer carry one of their own.
  it.each(['scheduler.service.js', 'temperature.service.js'])(
    '%s keeps no inline copy of the episode lifecycle',
    (file) => {
      const source = fs.readFileSync(path.join(__dirname, '../../../src/services', file), 'utf8');
      expect(source).toMatch(/require\('\.\/alertLifecycle\.service'\)/);
      expect(source).not.toMatch(/alertsCollection\.(updateMany|insertOne|findOne)\(/);
      expect(source).not.toMatch(/async function (resolveActiveAlert|ensureActiveAlert)\b/);
    }
  );
});
