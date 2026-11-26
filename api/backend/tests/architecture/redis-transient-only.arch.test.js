// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375.
//
// RNF016 C5 (#1554): Redis holds only cache, locks and transient data. Every
// backend file that reaches Redis (a Redis client or queue package, or
// src/config/redis.js or src/config/queue.js, by require, import or dynamic
// import) is listed below with what it keeps there, so a new Redis consumer
// fails this test until it is reviewed and listed. The classification is
// decided in docs/decisions/2026-11-14-redis-transient-only.md.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const { stripComments } = require('./helpers/strip-comments');

const backendRoot = path.resolve(__dirname, '..', '..');
const srcDir = path.join(backendRoot, 'src');
const ENTRY_FILES = ['server.js', 'app.js'].map((f) => path.join(backendRoot, f));
// A package specifier (not a relative path) whose name holds `redis`
// (redis, @redis/client, ioredis, redis-om, @upstash/redis, connect-redis)
// or starts with `bull` or `@bull` (bull, bullmq, @bull-board/api): any
// package of that kind is reviewed before it is listed.
function isRedisPackage(spec) {
  if (spec.startsWith('.') || spec.startsWith('/')) return false;
  return /redis/i.test(spec) || /^@?bull/i.test(spec);
}
const REDIS_CONFIG = new Set(['config/redis', 'config/queue'].map((f) => path.join(srcDir, f)));

// What each consumer keeps in Redis.
const CONSUMERS = {
  'server.js': 'transient: starts the job queue and the custody-event retry worker',
  'src/config/redis.js': 'connection: the shared ioredis client',
  'src/config/queue.js': 'transient: BullMQ import queue, completed jobs removed after 24 h, failed after 7 days',
  'src/infrastructure/health/dependencyHealth.js': 'connection: health ping only',
  'src/infrastructure/metrics/queueDepth.js': 'transient: reads the queue depth',
  'src/infrastructure/queue/Neo4jQuarantineService.js': 'transient: retry list of lineage writes the graph refused',
  'src/infrastructure/queue/TopologicalQuarantine.js': 'transient: retry list of custody events until the outbox records them',
  'src/routes/dictionary.js': 'cache: terminology lookups written with setEx, so each expires',
  'src/services/NotificationService.js': 'transient: notification jobs, completed removed after 24 h, failed after 7 days',
  'src/services/import-async.service.js': 'transient: enqueues import jobs',
  'src/services/iot-streaming.service.js': 'transient: enqueues a streamed reading until the worker writes it to InfluxDB',
  'src/services/staging-import.service.js': 'transient: enqueues staging import jobs',
  'src/workers/import-worker.js': 'transient: consumes import jobs',
  'src/workers/worker.js': 'transient: the worker process, Redis ping for its heartbeat',
};

// The members of the dictionary's Redis client it may touch: reads, the
// connection, and setEx, the one write, which always carries an expiry.
const DICTIONARY_CLIENT_MEMBERS = new Set(['connect', 'get', 'isOpen', 'on', 'setEx']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'build', 'coverage'].includes(entry.name)) continue;
      walk(full, out);
    } else if (/\.(c|m)?js$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// A module specifier in require(...), import(...), import ... from '...',
// export ... from '...' or a bare import '...', in quotes or a template
// literal without a substitution.
const SPECIFIER =
  /\brequire\s*\(\s*(['"`])([^'"`$]+)\1\s*\)|\bimport\s*\(\s*(['"`])([^'"`$]+)\3\s*\)|\bfrom\s*(['"`])([^'"`$]+)\5|\bimport\s*(['"`])([^'"`$]+)\7/g;

function specifiers(content) {
  return [...content.matchAll(SPECIFIER)].map((m) => m[2] || m[4] || m[6] || m[8]);
}

function textReachesRedis(content, file) {
  for (const spec of specifiers(content)) {
    if (isRedisPackage(spec)) return true;
    if (spec.startsWith('.')) {
      const resolved = path.resolve(path.dirname(file), spec).replace(/\.(c|m)?js$/, '');
      if (REDIS_CONFIG.has(resolved)) return true;
    }
  }
  return false;
}

function reachesRedis(file) {
  return textReachesRedis(stripComments(fs.readFileSync(file, 'utf8')), file);
}

function redisConsumers() {
  return [...walk(srcDir), ...ENTRY_FILES.filter((f) => fs.existsSync(f))]
    .filter(reachesRedis)
    .map((f) => path.relative(backendRoot, f).split(path.sep).join('/'))
    .sort();
}

// The names bound to a Redis client (from createClient(...) or
// getRedisClient()), and every member read off them; a computed member
// (client['set']) reads as '[', which no allow-list holds.
function clientMembers(content) {
  const names = new Set();
  const BINDING = /([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:[\w$]+\s*\.\s*)?(?:createClient|getRedisClient)\s*\(/g;
  for (const m of content.matchAll(BINDING)) names.add(m[1]);
  const members = [];
  for (const name of names) {
    const escaped = name.replace(/\$/g, '\\$');
    const member = new RegExp(`(?<![\\w$.])${escaped}\\s*(?:\\?\\.\\s*|\\.\\s*)([A-Za-z_$][\\w$]*)|(?<![\\w$.])${escaped}\\s*(?:\\?\\.\\s*)?(\\[)`, 'g');
    for (const m of content.matchAll(member)) members.push(m[1] || m[2]);
  }
  return { names: [...names].sort(), members };
}

function refusedMembers(content) {
  return clientMembers(content).members.filter((m) => !DICTIONARY_CLIENT_MEMBERS.has(m));
}

test('the scan finds the Redis client itself (control row)', () => {
  assert.ok(redisConsumers().includes('src/config/redis.js'));
});

test('the scan reads every form a Redis module is reached by (RNF016 C5)', () => {
  const file = path.join(srcDir, 'services', 'probe.js');
  const reached = [
    "require('ioredis')",
    "require ('redis')",
    'require(`bullmq`)',
    "require('bull')",
    "require('@redis/client')",
    "require('ioredis/built/Redis')",
    "require('connect-redis')",
    "require('rate-limit-redis')",
    "require('redis-om')",
    "import { Redis } from '@upstash/redis'",
    "require('@bull-board/api')",
    "import Redis from 'ioredis'",
    "import { createClient } from '@redis/client'",
    "await import('redis')",
    "import 'bullmq'",
    "export { Queue } from 'bullmq'",
    "require('../config/redis')",
    "require('../config/queue.js')",
    "import queue from '../config/queue'",
  ];
  assert.deepStrictEqual(reached.filter((s) => !textReachesRedis(s, file)), []);
  const notReached = [
    "require('./redisHelpers')",
    "require('../config/redisOptions')",
    "require('lodash')",
    "require('express-rate-limit')",
    "require('mongoose')",
  ];
  assert.deepStrictEqual(notReached.filter((s) => textReachesRedis(s, file)), []);
});

test('every backend file that reaches Redis is a reviewed cache, lock or transient consumer (RNF016 C5)', () => {
  assert.deepStrictEqual(redisConsumers(), Object.keys(CONSUMERS).sort());
});

test('the dictionary check refuses every Redis client member outside its read-or-expiring set (RNF016 C5)', () => {
  const head = 'const c = await getRedisClient();\n';
  assert.deepStrictEqual(refusedMembers(`${head}await c.setEx(k, 60, v); c.get(k); c.isOpen;`), []);
  const writes = [
    'c.set(k, v)',
    'c.SET(k, v)',
    'c.set (k, v)',
    'c?.set(k, v)',
    "c['set'](k, v)",
    'c.mSet([k, v])',
    'c.setNX(k, v)',
    'c.hSetNX(h, k, v)',
    'c.sendCommand(["SET", k, v])',
    'c.json.set(k, "$", v)',
  ];
  assert.deepStrictEqual(writes.filter((w) => refusedMembers(`${head}await ${w};`).length === 0), []);
});

test('the dictionary cache writes Redis only with an expiry (RNF016 C5)', () => {
  const content = stripComments(fs.readFileSync(path.join(srcDir, 'routes', 'dictionary.js'), 'utf8'));
  const { names, members } = clientMembers(content);
  assert.ok(names.includes('redisClient') && names.includes('client'), `client bindings found: ${names}`);
  assert.ok(members.includes('setEx'));
  assert.deepStrictEqual(refusedMembers(content), []);
});
