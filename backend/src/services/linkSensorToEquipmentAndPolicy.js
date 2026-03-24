const neo4j = require('neo4j-driver');
const env = require('../config/env');

const driver = neo4j.driver(
  env.NEO4J_URI,
  neo4j.auth.basic(env.NEO4J_USERNAME, env.NEO4J_PASSWORD)
);

async function linkSensorToEquipmentAndPolicy(sensorId, equipmentId, policyId) {
  const session = driver.session({ database: env.NEO4J_DATABASE || 'neo4j' });

  try {
    return await session.run(
      `
        MERGE (sensor:Sensor {id: $sensorId})
        MERGE (equipment:Equipment {id: $equipmentId})
        MERGE (policy:Policy {id: $policyId})
        MERGE (sensor)-[:INSTALLED_IN]->(equipment)
        MERGE (sensor)-[:FOLLOWS_POLICY]->(policy)
        RETURN sensor.id AS sensorId, equipment.id AS equipmentId, policy.id AS policyId
      `,
      {
        sensorId: String(sensorId),
        equipmentId: String(equipmentId),
        policyId: String(policyId)
      }
    );
  } finally {
    await session.close();
  }
}

module.exports = {
  driver,
  linkSensorToEquipmentAndPolicy
};