FROM node:22-alpine

WORKDIR /app

# #955: same as infra/tsa/Dockerfile -- entrypoint.sh mkdir -p's this under
# "set -eu" and compose.prod.yml runs the image read_only:true.
RUN mkdir -p /run/secrets

COPY witness-server.js /app/witness-server.js
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8096

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "/app/witness-server.js"]
