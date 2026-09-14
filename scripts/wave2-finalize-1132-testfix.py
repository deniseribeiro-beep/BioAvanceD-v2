from pathlib import Path

path = Path('api/backend/tests/architecture/ingestion-civil-data-boundary.arch.test.js')
text = path.read_text()

old_import = "const { schemas } = require('../../src/contracts/canonical/v1');\n"
new_import = "const { getSchema } = require('../../src/contracts/canonical/v2');\n"
if text.count(old_import) != 1:
    raise SystemExit(f'expected one canonical/v1 import, found {text.count(old_import)}')
text = text.replace(old_import, new_import, 1)

old_comment = """// list is derived from contracts/canonical/v1's own participantSchema
// (minus participantId, which IS allowed — every appendXEvent payload
// legitimately carries it as the aggregate/correlation id), not a
// hand-maintained duplicate — so it can't silently drift from the canonical
// contract the way two independently-maintained lists could.
const FORBIDDEN_CIVIL_FIELDS = Object.keys(schemas.participantSchema.properties)
  .filter((field) => field !== 'participantId');
"""
new_comment = """// list is derived from the approved canonical v2 ParticipantIdentity schema
// (minus participantId, which IS allowed — every appendXEvent payload
// legitimately carries it as the aggregate/correlation id), not a
// hand-maintained duplicate — so it cannot silently drift from the canonical
// contract the way two independently-maintained lists could.
"""
if text.count(old_comment) != 1:
    raise SystemExit(f'expected one legacy civil-field derivation, found {text.count(old_comment)}')
text = text.replace(old_comment, new_comment, 1)

old_test = "test('no outbox appendEvent call site writes a civil/identity field into its payload', () => {\n  const hits = [];\n"
new_test = """test('no outbox appendEvent call site writes a civil/identity field into its payload', async () => {
  const participantIdentitySchema = await getSchema('ParticipantIdentity');
  assert.ok(participantIdentitySchema, 'canonical v2 must expose ParticipantIdentity');
  const forbiddenCivilFields = Object.keys(participantIdentitySchema.properties || {})
    .filter((field) => field !== 'participantId');
  const hits = [];
"""
if text.count(old_test) != 1:
    raise SystemExit(f'expected one civil boundary test anchor, found {text.count(old_test)}')
text = text.replace(old_test, new_test, 1)
text = text.replace('for (const field of FORBIDDEN_CIVIL_FIELDS) {', 'for (const field of forbiddenCivilFields) {')

path.write_text(text)
Path('scripts/wave2-finalize-1132-testfix.py').unlink()
print('migrated ingestion civil-data boundary test to canonical v2')
