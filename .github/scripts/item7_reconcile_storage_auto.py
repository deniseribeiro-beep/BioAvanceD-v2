from pathlib import Path

p = Path('api/backend/tests/integration/storage-auto-allocation.api.test.js')
text = p.read_text(encoding='utf-8')

anchor = '''function ledgerCollections() {
'''
helper = '''function matchesDocument(doc, filter = {}) {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = doc?.[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof ObjectId)) {
      if ('$in' in expected) return expected.$in.some((value) => String(value) === String(actual));
      return false;
    }
    return String(actual) === String(expected);
  });
}

function statefulCollection(initialDocs = []) {
  const docs = initialDocs.map((doc) => ({ ...doc }));
  const collection = createCollectionMock();

  collection.findOne = vi.fn(async (filter = {}) => docs.find((doc) => matchesDocument(doc, filter)) || null);
  collection.insertOne = vi.fn(async (doc) => {
    docs.push(doc);
    return {
      insertedId: doc?._id || doc?.specimenContainerAssignmentId ||
        doc?.containerPositionAssignmentId || doc?.rackLocationAssignmentId || new ObjectId()
    };
  });
  collection.updateOne = vi.fn(async (filter = {}, update = {}, options = {}) => {
    let doc = docs.find((candidate) => matchesDocument(candidate, filter));
    if (!doc && options?.upsert) {
      doc = { ...filter, ...(update.$setOnInsert || {}) };
      docs.push(doc);
    }
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    if (update.$set) Object.assign(doc, update.$set);
    return { matchedCount: 1, modifiedCount: 1 };
  });
  collection.find = vi.fn((filter = {}) => cursorOf(docs.filter((doc) => matchesDocument(doc, filter))));
  collection.__docs = docs;
  return collection;
}

function ledgerCollections() {
'''
if helper not in text:
    if anchor not in text:
        raise SystemExit('ledgerCollections anchor not found')
    text = text.replace(anchor, helper, 1)

old = '''  const containers = createCollectionMock();
  const storageRacks = createCollectionMock();
  const storagePositions = createCollectionMock();
  const specimenContainerAssignments = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
  const containerPositionAssignments = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
  const rackLocationAssignments = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
'''
new = '''  const containers = statefulCollection();
  const storageRacks = statefulCollection();
  const storagePositions = statefulCollection();
  const specimenContainerAssignments = statefulCollection();
  const containerPositionAssignments = statefulCollection();
  const rackLocationAssignments = statefulCollection();
'''
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit('normalized collection fixture block not found')

old = '''    expect(res.body.success).toBe(true);
    expect(res.body.projectionQueued).toBe(true);
'''
new = '''    expect(res.body.success).toBe(true);
    expect(res.body.currentStoragePlacement).toEqual(expect.objectContaining({
      specimenId: String(specimenObjectId),
      positionCode: 'A1'
    }));
    expect(res.body.projectionQueued).toBe(true);
'''
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit('auto-allocation success assertion block not found')

p.write_text(text, encoding='utf-8')
