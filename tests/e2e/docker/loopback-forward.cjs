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
// Usage: node loopback-forward.cjs <port>=<host>:<port> [...] -- <cmd> [args...]
// Listens on 127.0.0.1 and ::1 (Chromium may resolve localhost to either),
// then runs <cmd> and exits with its exit code.

'use strict';

const net = require('net');
const { spawn } = require('child_process');

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const specs = sep === -1 ? argv : argv.slice(0, sep);
const cmd = sep === -1 ? [] : argv.slice(sep + 1);

if (specs.length === 0 || cmd.length === 0) {
  console.error('usage: loopback-forward.cjs <port>=<host>:<port> [...] -- <cmd> [args...]');
  process.exit(2);
}

function parseSpec(spec) {
  const m = /^(\d+)=([^:]+):(\d+)$/.exec(spec);
  if (!m) throw new Error(`bad forward spec: ${spec}`);
  return { listenPort: Number(m[1]), host: m[2], port: Number(m[3]) };
}

function listen(address, { listenPort, host, port }) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((client) => {
      const upstream = net.connect({ host, port });
      client.pipe(upstream);
      upstream.pipe(client);
      const close = () => {
        client.destroy();
        upstream.destroy();
      };
      client.on('error', close);
      upstream.on('error', close);
    });
    server.once('error', reject);
    server.listen({ host: address, port: listenPort, ipv6Only: address === '::1' }, () => resolve(server));
  });
}

async function main() {
  const forwards = specs.map(parseSpec);
  for (const f of forwards) {
    await listen('127.0.0.1', f);
    try {
      await listen('::1', f);
    } catch (err) {
      // A container without IPv6 loopback has no ::1 to bind; 127.0.0.1 suffices there.
      if (err.code !== 'EADDRNOTAVAIL' && err.code !== 'EAFNOSUPPORT') throw err;
    }
    console.log(`[loopback-forward] localhost:${f.listenPort} -> ${f.host}:${f.port}`);
  }

  const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit' });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => child.kill(sig));
  }
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

main().catch((err) => {
  console.error(`[loopback-forward] ${err.message}`);
  process.exit(1);
});
