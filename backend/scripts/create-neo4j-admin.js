#!/usr/bin/env node
// Script para criar usuário admin no Neo4j em ambiente de desenvolvimento
const neo4j = require('neo4j-driver');
require('dotenv').config();

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USERNAME = process.env.NEO4J_USERNAME || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'neo4j';
const ADMIN_USER = process.env.NEO4J_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.NEO4J_ADMIN_PASS || 'Admin@123';

(async () => {
  const driver = neo4j.driver(
    NEO4J_URI,
    neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD)
  );
  const session = driver.session();
  try {
    // Verifica se o usuário admin já existe
    const checkResult = await session.run(
      "SHOW USERS YIELD user WHERE user = $adminUser RETURN user",
      { adminUser: ADMIN_USER }
    );
    if (checkResult.records.length > 0) {
      console.log(`ℹ️ Usuário admin '${ADMIN_USER}' já existe no Neo4j.`);
      process.exit(0);
    }
    // Cria o usuário admin
    await session.run(
      `CREATE USER ${ADMIN_USER} SET PASSWORD '${ADMIN_PASS}';`
    );
    await session.run(
      `GRANT ROLE admin TO ${ADMIN_USER};`
    );
    console.log(`✅ Usuário admin '${ADMIN_USER}' criado no Neo4j com senha padrão.`);
    console.log(`Usuário: ${ADMIN_USER}`);
    console.log(`Senha: ${ADMIN_PASS}`);
  } catch (e) {
    console.error('❌ Erro ao criar usuário admin no Neo4j:', e.message);
    process.exit(1);
  } finally {
    await session.close();
    await driver.close();
  }
})();
