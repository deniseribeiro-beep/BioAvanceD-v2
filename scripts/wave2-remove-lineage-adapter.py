import re
from pathlib import Path


def replace_once(path, old, new, label):
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    path.write_text(text.replace(old, new, 1))


# sample.service.js: runtime lineage authority becomes Mongo + transactional outbox.
sample_path = Path('api/backend/src/services/sample.service.js')
replace_once(
    sample_path,
    "const LineageRepository = require('../infrastructure/database/neo4j/LineageRepository');\n",
    "const MongoLineageRepository = require('../infrastructure/persistence/mongo/MongoLineageRepository');\n",
    'sample.service import',
)
replace_once(
    sample_path,
    "        lineageRepository: new LineageRepository(options?.neo4jDriver || null)\n",
    "        lineageRepository: new MongoLineageRepository(db)\n",
    'sample.service constructor',
)

# import-lgpd.service.js: allocation lineage also uses canonical Mongo + outbox.
import_lgpd = Path('api/backend/src/services/import-lgpd.service.js')
replace_once(
    import_lgpd,
    "const LineageRepository = require('../infrastructure/database/neo4j/LineageRepository');\n",
    "const MongoLineageRepository = require('../infrastructure/persistence/mongo/MongoLineageRepository');\n",
    'import-lgpd import',
)
replace_once(
    import_lgpd,
    "    const { startBoxId = null, autoIncrement = false, groupFields = {}, neo4jDriver = null, actor = {} } = options;\n",
    "    const { startBoxId = null, autoIncrement = false, groupFields = {}, actor = {} } = options;\n",
    'import-lgpd options',
)
replace_once(
    import_lgpd,
    "        lineageRepository: new LineageRepository(neo4jDriver)\n",
    "        lineageRepository: new MongoLineageRepository(db)\n",
    'import-lgpd constructor',
)

# sample.routes.js: RegisterSampleUseCase receives canonical Mongo lineage repository.
sample_routes = Path('api/backend/src/interface/routes/sample.routes.js')
replace_once(
    sample_routes,
    "const LineageRepository = require('../../infrastructure/database/neo4j/LineageRepository');\n",
    "const MongoLineageRepository = require('../../infrastructure/persistence/mongo/MongoLineageRepository');\n",
    'sample.routes import',
)
replace_once(
    sample_routes,
    "        lineageRepository: new LineageRepository(req.app.locals.neo4jDriver || null),\n",
    "        lineageRepository: new MongoLineageRepository(db),\n",
    'sample.routes constructor',
)

# user.routes.js contains the same legacy RegisterSampleUseCase construction.
user_routes = Path('api/backend/src/interface/routes/user.routes.js')
replace_once(
    user_routes,
    "const LineageRepository = require('../../infrastructure/database/neo4j/LineageRepository');\n",
    "const MongoLineageRepository = require('../../infrastructure/persistence/mongo/MongoLineageRepository');\n",
    'user.routes import',
)
replace_once(
    user_routes,
    "      lineageRepository: new LineageRepository(req.app.locals.neo4jDriver || null),\n",
    "      lineageRepository: new MongoLineageRepository(db),\n",
    'user.routes constructor',
)

# Physical deletion is part of the Wave 2 acceptance criterion: no replaced implementation in parallel.
adapter = Path('api/backend/src/infrastructure/database/neo4j/LineageRepository.js')
if not adapter.exists():
    raise SystemExit('legacy compatibility LineageRepository.js unexpectedly absent before controlled deletion')
adapter.unlink()

# Permanent regression gate: file absent and no executable consumer can reappear.
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
  const executablePattern = /(?:const|let|var)\\s+LineageRepository\\s*=\\s*require\\s*\\(\\s*['\"][^'\"]*database\\/neo4j\\/LineageRepository['\"]\\s*\\)|new\\s+LineageRepository\\s*\\(/;
  const offenders = sourceFiles()
    .filter(({ source }) => {
      const withoutComments = source
        .replace(/\\/\\*[\\s\\S]*?\\*\\//g, '')
        .replace(/^\\s*\\/\\/.*$/gm, '');
      return executablePattern.test(withoutComments);
    })
    .map(({ relative }) => relative);
  assert.deepEqual(offenders, [], `legacy lineage adapter consumers: ${offenders.join(', ')}`);
});

"""
if addition not in arch:
    if arch.count(anchor) != 1:
        raise SystemExit(f'architecture anchor count={arch.count(anchor)}')
    arch_path.write_text(arch.replace(anchor, anchor + addition, 1))

# Fail before commit if any executable adapter consumer survives.
runtime_pattern = re.compile(
    r"(?:const|let|var)\s+LineageRepository\s*=\s*require\s*\(\s*['\"][^'\"]*database/neo4j/LineageRepository['\"]\s*\)|new\s+LineageRepository\s*\("
)
residuals = []
for js_path in Path('api/backend/src').rglob('*.js'):
    text = js_path.read_text(errors='ignore')
    text = re.sub(r'/\*[\s\S]*?\*/', '', text)
    text = re.sub(r'^\s*//.*$', '', text, flags=re.MULTILINE)
    if runtime_pattern.search(text):
        residuals.append(str(js_path))
if residuals:
    raise SystemExit(f'legacy lineage adapter executable residuals: {residuals}')

# Temporary mutation machinery must not survive the functional cleanup commit.
for temporary in [
    Path('.github/workflows/wave2-remove-lineage-adapter.yml'),
    Path('scripts/wave2-remove-lineage-adapter.py'),
]:
    if temporary.exists():
        temporary.unlink()

print('Wave 2 legacy lineage compatibility adapter removed with zero executable consumers')
