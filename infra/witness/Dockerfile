FROM node:22.23.4-alpine

WORKDIR /app

# #955: same as infra/tsa/Dockerfile -- entrypoint.sh mkdir -p's this under
# "set -eu" and compose.prod.yml runs the image read_only:true.
RUN mkdir -p /run/secrets

COPY witness-server.js /app/witness-server.js
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# RNF014 C3 (#1470): compose.prod.yml runs this image as uid 10001.
RUN addgroup -S -g 10001 app && adduser -S -u 10001 -G app app \
  && chown -R app:app /run/secrets

EXPOSE 8096

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "/app/witness-server.js"]
