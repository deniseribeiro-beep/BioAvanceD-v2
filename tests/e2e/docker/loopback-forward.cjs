#!/usr/bin/env node
// #1233: playwright-runner's in-container loopback forwarder.
//
// frontend-app-test is a static bundle with VITE_API_BASE_URL baked in as
// http://localhost:3000/api, for the host browser (test:e2e:docker). A browser
// inside playwright-runner loading that bundle calls its OWN localhost:3000,
// where nothing listens. Rather than build a second bundle (and widen the
// backend's CORS allowlist for a compose hostname), this makes the runner's
// loopback look like the host's: localhost:5173 -> frontend-app-test:5173 and
// localhost:3000 -> backend-app-test:3000. The page's origin, its API base, the
// CORS allowlist and cookie scoping are then the same as in a host-side run.
//
// Usage: node loopback-forward.cjs [<bind>:]<port>=<host>:<port> [...] [-- <cmd> [args...]]
// With no <bind>, listens on 127.0.0.1 and ::1 (Chromium may resolve localhost
// to either). With a command, runs it and exits with its exit code; without
// one, forwards until signalled.
//
// #1263: compose.test.yml's trusted-hop-test runs this with
// 0.0.0.0:3100=127.0.0.1:3000 inside backend-app-test's network namespace, so
// the backend sees the hop's connections arrive from loopback.
//
// #1234: every upstream connect is timed. A connect still pending at
// SLOW_CONNECT_MS, and every upstream error, is logged as it happens, and a
// summary prints at exit, so a request that got no response can be matched to
// (or ruled out from) a stalled connect through this hop.

'use strict';

const net = require('net');
const { spawn } = require('child_process');

const SLOW_CONNECT_MS = 1000;

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const specs = sep === -1 ? argv : argv.slice(0, sep);
const cmd = sep === -1 ? [] : argv.slice(sep + 1);

if (specs.length === 0 || (sep !== -1 && cmd.length === 0)) {
  console.error('usage: loopback-forward.cjs [<bind>:]<port>=<host>:<port> [...] [-- <cmd> [args...]]');
  process.exit(2);
}

function parseSpec(spec) {
  const m = /^(?:([^=]+):)?(\d+)=([^:]+):(\d+)$/.exec(spec);
  if (!m) throw new Error(`bad forward spec: ${spec}`);
  return { bind: m[1] || null, listenPort: Number(m[2]), host: m[3], port: Number(m[4]) };
}

const stats = { connections: 0, slow: 0, errors: 0, maxConnectMs: 0 };

function log(message) {
  console.log(`[loopback-forward] ${new Date().toISOString()} ${message}`);
}

function elapsedMs(started) {
  return Number(process.hrtime.bigint() - started) / 1e6;
}

function listen(address, { listenPort, host, port }) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((client) => {
      stats.connections += 1;
      const started = process.hrtime.bigint();
      const upstream = net.connect({ host, port });
      // A connect that never completes is the shape #1234 is after, so the
      // log fires while it is still pending, not only once it lands.
      let slow = false;
      const slowTimer = setTimeout(() => {
        slow = true;
        stats.slow += 1;
        log(`upstream connect still pending after ${SLOW_CONNECT_MS} ms: ${host}:${port} (listener :${listenPort})`);
      }, SLOW_CONNECT_MS);
      upstream.once('close', () => clearTimeout(slowTimer));
      upstream.once('connect', () => {
        clearTimeout(slowTimer);
        const ms = elapsedMs(started);
        if (ms > stats.maxConnectMs) stats.maxConnectMs = ms;
        if (slow) log(`slow upstream connect: ${host}:${port} took ${ms.toFixed(0)} ms (listener :${listenPort})`);
      });
      client.pipe(upstream);
      upstream.pipe(client);
      const close = () => {
        client.destroy();
        upstream.destroy();
      };
      client.on('error', close);
      upstream.on('error', (err) => {
        stats.errors += 1;
        log(`upstream error: ${host}:${port} ${err.code || err.message} after ${elapsedMs(started).toFixed(0)} ms (listener :${listenPort})`);
        close();
      });
    });
    server.once('error', reject);
    server.listen({ host: address, port: listenPort, ipv6Only: address === '::1' }, () => resolve(server));
  });
}

function summary() {
  log(
    `summary: ${stats.connections} connections, max upstream connect ${stats.maxConnectMs.toFixed(0)} ms, ` +
      `${stats.slow} at or over ${SLOW_CONNECT_MS} ms, ${stats.errors} upstream errors`
  );
}

async function main() {
  const forwards = specs.map(parseSpec);
  for (const f of forwards) {
    if (f.bind) {
      await listen(f.bind, f);
    } else {
      await listen('127.0.0.1', f);
      try {
        await listen('::1', f);
      } catch (err) {
        // A container without IPv6 loopback has no ::1 to bind; 127.0.0.1 suffices there.
        if (err.code !== 'EADDRNOTAVAIL' && err.code !== 'EAFNOSUPPORT') throw err;
      }
    }
    console.log(`[loopback-forward] ${f.bind || 'localhost'}:${f.listenPort} -> ${f.host}:${f.port}`);
  }

  if (cmd.length === 0) {
    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.on(sig, () => {
        summary();
        process.exit(0);
      });
    }
    return;
  }

  const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit' });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => child.kill(sig));
  }
  child.on('exit', (code, signal) => {
    summary();
    process.exit(code ?? (signal ? 1 : 0));
  });
}

main().catch((err) => {
  console.error(`[loopback-forward] ${err.message}`);
  process.exit(1);
});
