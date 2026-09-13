import { describe, it, expect, afterEach } from 'vitest';

// #749: env.js is a plain literal `module.exports = { ... }` with no
// `...process.env` spread, so a key that is read somewhere but never listed
// here is simply `undefined` forever -- and the read site's `|| '<default>'`
// fallback silently wins. There is no error, and the variable looks
// supported because it is named in the code, which is what makes this
// failure mode invisible by construction.
//
// scheduler.service.test.js cannot catch it: those tests assign
// `env.RETENTION_SWEEP_CRON = '...'` onto the already-required env object,
// which proves the scheduler *reads* the key but says nothing about whether
// env.js ever *exposes* it from process.env. This file tests the other half.
const envPath = require.resolve('../../../src/config/env');

function freshEnv() {
  delete require.cache[envPath];
  return require(envPath);
}

describe('config/env - schedule cron overrides (#749)', () => {
  // Every cron expression scheduler.service.js reads off the env module.
  // RETENTION_SWEEP_CRON was the one that was never registered; the rest are
  // the controls that prove the test itself works.
  //
  // #778: CONSENT_SYNC_CRON was in this list and should not have been --
  // startConsentSyncSchedule has been a stub since the legacy consent sync
  // was replaced by the canonical outbox, so the scheduler never read it.
  // Its declaration is gone from env.js; asserting it here would pin a knob
  // that configures nothing, which is the state #778 removed.
  const CRON_KEYS = [
    'BACKUP_CRON',
    'RESTORE_TEST_CRON',
    'TEMP_MONITOR_CRON',
    'RETENTION_SWEEP_CRON'
  ];

  const originals = {};
  for (const key of CRON_KEYS) originals[key] = process.env[key];

  afterEach(() => {
    for (const key of CRON_KEYS) {
      if (originals[key] === undefined) delete process.env[key];
      else process.env[key] = originals[key];
    }
    delete require.cache[envPath];
  });

  it.each(CRON_KEYS)('exposes %s from the environment', (key) => {
    process.env[key] = '9 9 * * 3';

    expect(freshEnv()[key]).toBe('9 9 * * 3');
  });

  it('exposes each cron independently, so one key cannot stand in for another', () => {
    CRON_KEYS.forEach((key, index) => { process.env[key] = `${index} 9 * * *`; });

    const env = freshEnv();

    CRON_KEYS.forEach((key, index) => {
      expect(env[key]).toBe(`${index} 9 * * *`);
    });
  });
});
