FROM node:22.23.4-alpine

RUN apk add --no-cache openssl

WORKDIR /app

# #955: entrypoint.sh mkdir -p's these four paths under "set -eu", and
# compose.prod.yml runs this image read_only:true. mkdir -p on an EXISTING
# directory is a no-op even on a read-only filesystem, so creating them at
# build time is what lets the entrypoint survive; compose then mounts writable
# volumes over the three that are actually written to.
RUN mkdir -p /etc/tsa/certs /etc/tsa/secrets /var/lib/tsa /run/secrets

# #954: tsa-server.js:10 defaults TSA_CONFIG to /etc/tsa/openssl-ts.cnf and
# :51 runs "openssl ts -reply -config <TSA_CONFIG>". This file has existed in
# the repo since the TSA was written and was never copied into the image, so
# EVERY stack -- dev, test and prod -- failed with
#   Can't open "/etc/tsa/openssl-ts.cnf" for reading, No such file or directory
# while /health kept returning 200 unconditionally (tsa-server.js:66-69).
COPY openssl-ts.cnf /etc/tsa/openssl-ts.cnf
# openssl-ts.cnf:5 declares "serial = /var/lib/tsa/serial" and nothing created
# it. Seeded from the tracked infra/tsa/data/serial; under compose.prod.yml's
# tsa_state volume Docker copies this into the empty volume on first use, and
# entrypoint.sh guards the case where the volume already exists but is empty.
COPY data/serial /var/lib/tsa/serial

COPY tsa-server.js /app/tsa-server.js
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# RNF014 C3 (#1470): compose.prod.yml runs this image as uid 10001.
RUN addgroup -S -g 10001 app && adduser -S -u 10001 -G app app \
  && chown -R app:app /etc/tsa/certs /etc/tsa/secrets /var/lib/tsa /run/secrets

EXPOSE 8095

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "/app/tsa-server.js"]
