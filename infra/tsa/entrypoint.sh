#!/bin/sh
set -eu

mkdir -p /etc/tsa/certs /etc/tsa/secrets /var/lib/tsa /run/secrets

# #954: openssl-ts.cnf:5 points "serial" here and "openssl ts -reply" both
# reads and increments it. The Dockerfile COPYs a seed, but compose.prod.yml
# mounts a named volume over /var/lib/tsa -- Docker only seeds a volume that
# is EMPTY on first use, so a volume created before that COPY existed would
# mask it. Guard rather than assume.
if [ ! -f /var/lib/tsa/serial ]; then
  echo 01 > /var/lib/tsa/serial
fi

if [ ! -f /etc/tsa/certs/ca.crt.pem ] || [ ! -f /etc/tsa/certs/tsa.crt.pem ] || [ ! -f /run/secrets/tsa_key.pem ]; then
  if [ ! -f /run/secrets/tsa_key.pem ]; then
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out /run/secrets/tsa_key.pem
    chmod 600 /run/secrets/tsa_key.pem || true
  fi
  if [ ! -f /etc/tsa/certs/ca.key.pem ]; then
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out /etc/tsa/certs/ca.key.pem
  fi
  if [ ! -f /etc/tsa/certs/ca.crt.pem ]; then
    openssl req -x509 -new -sha256 -days 3650 -key /etc/tsa/certs/ca.key.pem -subj "/C=BR/O=BioAvanceD Development/CN=BioAvanceD Dev Root CA" -out /etc/tsa/certs/ca.crt.pem
  fi
  if [ ! -f /etc/tsa/certs/tsa.crt.pem ]; then
    openssl req -new -key /run/secrets/tsa_key.pem -subj "/C=BR/O=BioAvanceD Development/CN=BioAvanceD Dev TSA" -out /tmp/tsa.csr.pem
    cat > /tmp/tsa.ext <<'EOF'
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,nonRepudiation
extendedKeyUsage = critical,timeStamping
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
EOF
    openssl x509 -req -in /tmp/tsa.csr.pem -CA /etc/tsa/certs/ca.crt.pem -CAkey /etc/tsa/certs/ca.key.pem -CAcreateserial -days 825 -sha256 -extfile /tmp/tsa.ext -out /etc/tsa/certs/tsa.crt.pem
  fi
fi

exec "$@"
