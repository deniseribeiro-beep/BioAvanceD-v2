#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const dockerConfigDir = path.join(os.tmpdir(), 'bioavanced-docker-config');
fs.mkdirSync(dockerConfigDir, { recursive: true });

const args = process.argv.slice(2);
const result = spawnSync('docker', ['compose', ...args], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DOCKER_CONFIG: dockerConfigDir,
  },
});

if (result.error) {
  console.error(result.error.message || result.error);
  process.exit(1);
}

process.exit(typeof result.status === 'number' ? result.status : 1);
