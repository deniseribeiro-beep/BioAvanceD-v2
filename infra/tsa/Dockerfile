FROM node:22-alpine

RUN apk add --no-cache openssl

WORKDIR /app

# #955: entrypoint.sh mkdir -p's these four paths under "set -eu", and
# compose.prod.yml runs this image read_only:true. mkdir -p on an EXISTING
# directory is a no-op even on a read-only filesystem, so creating them at
# build time is what lets the entrypoint survive; compose then mounts writable
# volumes over the three that are actually written to.
RUN mkdir -p /etc/tsa/certs /etc/tsa/secrets /var/lib/tsa /run/secrets

COPY tsa-server.js /app/tsa-server.js
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8095

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "/app/tsa-server.js"]
