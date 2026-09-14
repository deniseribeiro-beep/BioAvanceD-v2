from pathlib import Path

sample_path = Path('api/backend/src/services/sample.service.js')
sample = sample_path.read_text()
old_import = "const LineageRepository = require('../infrastructure/database/neo4j/LineageRepository');\n"
new_import = "const MongoLineageRepository = require('../infrastructure/persistence/mongo/MongoLineageRepository');\n"
if sample.count(old_import) != 1:
    raise SystemExit(f'expected one legacy LineageRepository import, found {sample.count(old_import)}')
sample = sample.replace(old_import, new_import, 1)
old_ctor = "        lineageRepository: new LineageRepository(options?.neo4jDriver || null)\n"
new_ctor = "        lineageRepository: new MongoLineageRepository(db)\n"
if sample.count(old_ctor) != 1:
    raise SystemExit(f'expected one legacy LineageRepository construction, found {sample.count(old_ctor)}')
sample = sample.replace(old_ctor, new_ctor, 1)
sample = sample.replace(
    '// performs the atomic occupancyGrid write, storageLocation update,\n      // StorageAssignment record, and audit/lineage trail (same use case\n',
    '// performs the normalized physical assignment mutation and the\n      // audit/transactional-outbox lineage trail (same use case\n',
)
sample = sample.replace(
    '// #510: expose the canonical StorageAssignment (dict-02 ELM-0167-0178)\n      // the allocation above just opened, alongside the legacy storageLocation\n      // snapshot — additive, same precedent #507 set for findSampleById.\n',
    '// Expose the current normalized physical assignment resolved by the\n      // canonical storage repository. `storageLocation` below is response-only\n      // compatibility data and is never persisted as specimen authority.\n',
)
sample_path.write_text(sample)

adapter = Path('api/backend/src/infrastructure/database/neo4j/LineageRepository.js')
if not adapter.exists():
    raise SystemExit('legacy compatibility LineageRepository.js unexpectedly absent before controlled deletion')
adapter.unlink()

arch_path = Path('api/backend/tests/architecture/wave2-v2-invariants.arch.test.js')
arch = arch_path.read_text()
anchor = """test('Wave 2 never uses COMPROMISED as a specimenStatus value', () => {
  const offenders = sourceFiles()
    .filter(({ source }) => /specimenStatus[\\s\\S]{0,80}['\"]COMPROMISED['\"]|['\"]COMPROMISED['\"][\\s\\S]{0,80}specimenStatus/.test(source))
    .map(({ relative }) => relative);
  assert.deepEqual(offenders, [], `COMPROMISED specimenStatus residuals: ${offenders.join(', ')}`);
});

"""
addition = """test('Wave 2 has no legacy Neo4j lineage compatibility adapter', () => {
  const legacyAdapterPath = path.join(SRC_ROOT, 'infrastructure/database/neo4j/LineageRepository.js');
  assert.equal(fs.existsSync(legacyAdapterPath), false, 'legacy LineageRepository.js must be physically removed');
  const offenders = violationsFor(/database\\/neo4j\\/LineageRepository|new\\s+LineageRepository\\s*\\(/);
  assert.deepEqual(offenders, [], `legacy lineage adapter consumers: ${offenders.join(', ')}`);
});

"""
if arch.count(anchor) != 1:
    raise SystemExit(f'architecture anchor count={arch.count(anchor)}')
arch_path.write_text(arch.replace(anchor, anchor + addition, 1))

# Prove the active source tree no longer depends on the compatibility adapter.
residuals = []
for path in Path('api/backend/src').rglob('*.js'):
    text = path.read_text(errors='ignore')
    if 'database/neo4j/LineageRepository' in text or 'new LineageRepository(' in text:
        residuals.append(str(path))
if residuals:
    raise SystemExit(f'legacy lineage adapter residuals: {residuals}')

for temporary in [
    Path('.github/workflows/wave2-remove-lineage-adapter.yml'),
    Path('scripts/wave2-remove-lineage-adapter.py'),
]:
    if temporary.exists():
        temporary.unlink()

print('Wave 2 legacy lineage compatibility adapter removed')
