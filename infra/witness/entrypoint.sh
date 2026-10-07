#!/bin/sh
set -eu

# #1177: the guard and the writer must resolve the SAME path. The guard used to
# test the /run/secrets literal while the node writer honoured
# WITNESS_PRIVATE_KEY_PEM_FILE, so any non-default path minted a fresh key on
# every start and orphaned the one earlier tree heads were co-signed with.
KEY_PATH="${WITNESS_PRIVATE_KEY_PEM_FILE:-/run/secrets/witness_key.pem}"

# For the default path this is exactly the old `mkdir -p /run/secrets`.
mkdir -p "$(dirname "$KEY_PATH")"

if [ ! -f "$KEY_PATH" ]; then
  KEY_PATH="$KEY_PATH" node - <<'NODE'
const { generateKeyPairSync } = require('crypto');
const { writeFileSync } = require('fs');
const keyPath = process.env.KEY_PATH;
const { privateKey } = generateKeyPairSync('ed25519');
writeFileSync(keyPath, privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), { mode: 0o600 });
NODE
fi

exec "$@"
