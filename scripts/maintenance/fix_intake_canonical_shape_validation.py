from pathlib import Path

path = Path('api/backend/src/routes/intakeWizard.js')
text = path.read_text(encoding='utf-8')

old = """  try {
    const canonicalViolations = [
"""
new = """  try {
    // Canonical v2 API boundary: malformed core sections are client-contract
    // violations, not runtime failures. Reject them before identity, consent,
    // storage or clinical services are invoked so invalid payloads never fall
    // through as 500 responses.
    const canonicalShapeViolations = [];
    const participantSection = data?.participant;
    const specimenSection = data?.specimen;

    const participantIsObject = Boolean(
      participantSection && typeof participantSection === 'object' && !Array.isArray(participantSection)
    );
    const specimenIsObject = Boolean(
      specimenSection && typeof specimenSection === 'object' && !Array.isArray(specimenSection)
    );

    if (!participantIsObject) canonicalShapeViolations.push('participant');
    if (!specimenIsObject || !normalizeString(specimenSection?.participantId)) {
      canonicalShapeViolations.push('specimen');
    }

    if (canonicalShapeViolations.length > 0) {
      return res.status(422).json({
        error: 'NON_CANONICAL_FIELD',
        fields: [...new Set(canonicalShapeViolations)]
      });
    }

    const canonicalViolations = [
"""

count = text.count(old)
if count != 1:
    raise SystemExit(f'intake canonical validation insertion count={count}')
text = text.replace(old, new, 1)

required = (
    "canonicalShapeViolations.push('participant')",
    "canonicalShapeViolations.push('specimen')",
    "error: 'NON_CANONICAL_FIELD'",
)
for token in required:
    if token not in text:
        raise SystemExit(f'missing canonical shape validation token: {token}')

path.write_text(text, encoding='utf-8')
Path(__file__).unlink()
