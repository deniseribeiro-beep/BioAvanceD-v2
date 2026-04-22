// backend/src/database/neo4j.js
const neo4j = require('neo4j-driver');

let driver;
function getNeo4jDriver() {
  if (!driver) {
    driver = neo4j.driver(
      process.env.NEO4J_URI || 'bolt://localhost:7687',
      neo4j.auth.basic(
        process.env.NEO4J_USERNAME || 'neo4j',
        process.env.NEO4J_PASSWORD || 'password'
      )
    );
  }
  return driver;
}

module.exports = { getNeo4jDriver };
