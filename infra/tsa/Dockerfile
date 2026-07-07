FROM node:22-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY tsa-server.js /app/tsa-server.js
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8095

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "/app/tsa-server.js"]
