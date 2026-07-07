#!/bin/sh
set -eu

mkdir -p /run/secrets

if [ ! -f /run/secrets/witness_key.pem ]; then
  node - <<'NODE'
const { generateKeyPairSync } = require('crypto');
const { writeFileSync } = require('fs');
const { env } = process;
const keyPath = env.WITNESS_PRIVATE_KEY_PEM_FILE || '/run/secrets/witness_key.pem';
const { privateKey } = generateKeyPairSync('ed25519');
writeFileSync(keyPath, privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), { mode: 0o600 });
NODE
fi

exec "$@"
