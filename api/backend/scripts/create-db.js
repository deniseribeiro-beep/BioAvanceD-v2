// The explicit Foundation pipeline owns canonical collections and indexes.
// Keep the historical npm entry point, but do not maintain a second schema builder.
const { main } = require('./run-foundation-data-pipeline');

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}

module.exports = { main };
