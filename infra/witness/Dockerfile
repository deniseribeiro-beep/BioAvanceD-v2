FROM node:22-alpine

WORKDIR /app

COPY witness-server.js /app/witness-server.js
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8096

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "/app/witness-server.js"]
