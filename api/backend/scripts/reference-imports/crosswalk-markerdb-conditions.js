require('dotenv').config();

const path = require('path');
const { main } = require('../../src/reference-data/reference-imports/lab/crosswalkMarkerDbConditions');

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { main, scriptPath: path.join(__dirname, 'crosswalk-markerdb-conditions.js') };