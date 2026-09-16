from pathlib import Path


def replace_exact(text: str, old: str, new: str, *, expected: int = 1, label: str = "replacement") -> str:
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{label}: expected {expected} occurrence(s), found {count}")
    return text.replace(old, new, expected)


# 1) The auto-allocation HTTP contract is specimenId, not Mongo _id. The
# normalized placement already returns the canonical specimenId; make the
# integration fixture exercise and assert that canonical identity end-to-end.
storage_path = Path("api/backend/tests/integration/storage-auto-allocation.api.test.js")
storage = storage_path.read_text()

storage = replace_exact(
    storage,
    "  const specimenObjectId = new ObjectId();\n  const boxId = new ObjectId();\n  const specimen = specimenMissing ? null : {\n    _id: specimenObjectId,\n    specimenId: 'SP-1006-AUTO',",
    "  const specimenObjectId = new ObjectId();\n  const canonicalSpecimenId = 'SP-1006-AUTO';\n  const boxId = new ObjectId();\n  const specimen = specimenMissing ? null : {\n    _id: specimenObjectId,\n    specimenId: canonicalSpecimenId,",
    label="declare canonical auto-allocation specimenId",
)

storage = replace_exact(
    storage,
    "  return { db, specimenObjectId, boxId, collections };",
    "  return { db, specimenObjectId, canonicalSpecimenId, boxId, collections };",
    label="return canonical auto-allocation specimenId",
)

storage = replace_exact(
    storage,
    "const { db, specimenObjectId, boxId } = buildAutoAllocationDb({ accessType: 1 });",
    "const { db, canonicalSpecimenId, boxId } = buildAutoAllocationDb({ accessType: 1 });",
    label="RBAC fixture identity",
)
storage = replace_exact(
    storage,
    ".send({ specimenId: String(specimenObjectId), boxId: String(boxId) });",
    ".send({ specimenId: canonicalSpecimenId, boxId: String(boxId) });",
    expected=4,
    label="canonical auto-allocation request identity",
)
storage = replace_exact(
    storage,
    "const { db, specimenObjectId, boxId } = buildAutoAllocationDb({ specimenMissing: true });",
    "const { db, canonicalSpecimenId, boxId } = buildAutoAllocationDb({ specimenMissing: true });",
    label="missing specimen fixture identity",
)
storage = replace_exact(
    storage,
    "const { db, specimenObjectId, boxId } = buildAutoAllocationDb({ boxFull: true });",
    "const { db, canonicalSpecimenId, boxId } = buildAutoAllocationDb({ boxFull: true });",
    label="full box fixture identity",
)
storage = replace_exact(
    storage,
    "const { db, specimenObjectId, boxId, collections } = buildAutoAllocationDb();",
    "const { db, canonicalSpecimenId, boxId, collections } = buildAutoAllocationDb();",
    label="successful allocation fixture identity",
)
storage = replace_exact(
    storage,
    "      specimenId: String(specimenObjectId),\n      positionCode: 'A1'",
    "      specimenId: canonicalSpecimenId,\n      positionCode: 'A1'",
    label="canonical placement assertion",
)

storage_path.write_text(storage)


# 2) Consent v2 no longer exposes a legacy Mongo _id for a newly created
# Consent. ConsentTemplate creation still returns its Mongo _id, while a
# normalized Consent is identified by immutable consentId. Align only the four
# stale assertions; production persistence already follows the v2 model.
consent_path = Path("api/backend/tests/unit/consent.service.unit.test.js")
consent = consent_path.read_text()

consent = replace_exact(
    consent,
    "    expect(result.consentId).toBeTruthy();\n    expect(result.title).toBe('My Template');",
    "    expect(result._id).toBeTruthy();\n    expect(result.title).toBe('My Template');",
    label="template canonical Mongo identity assertion",
)
consent = replace_exact(
    consent,
    "    expect(result.consentId).toBeTruthy();\n    expect(templates.insertOne).toHaveBeenCalled();",
    "    expect(result._id).toBeTruthy();\n    expect(templates.insertOne).toHaveBeenCalled();",
    label="template without CAAE canonical identity assertion",
)

required_title = "  it('accepts a submitted boolean response for a required permission (#63)', async () => {"
required_start = consent.find(required_title)
if required_start < 0:
    raise SystemExit("required permission regression test not found")
required_end = consent.find("\n  it(", required_start + len(required_title))
if required_end < 0:
    raise SystemExit("required permission regression test end not found")
required_block = consent[required_start:required_end]
required_block = replace_exact(
    required_block,
    "    expect(result._id).toBeDefined();",
    "    expect(result.consentId).toMatch(/^consent:/);",
    label="required permission consentId assertion",
)
consent = consent[:required_start] + required_block + consent[required_end:]

alias_title = "  it('accepts signatureBase64 as an alias for signatureImageBase64 from the frontend', async () => {"
alias_start = consent.find(alias_title)
if alias_start < 0:
    raise SystemExit("signature alias regression test not found")
alias_end = consent.find("\n  it(", alias_start + len(alias_title))
if alias_end < 0:
    raise SystemExit("signature alias regression test end not found")
alias_block = consent[alias_start:alias_end]
alias_block = replace_exact(
    alias_block,
    "    expect(result._id).toBeDefined();",
    "    expect(result.consentId).toMatch(/^consent:/);",
    label="signature alias consentId assertion",
)
consent = consent[:alias_start] + alias_block + consent[alias_end:]

consent_path.write_text(consent)
