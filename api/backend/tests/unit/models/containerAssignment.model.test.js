// RF016 AC1/AC3, RF017 AC2-AC4, RULE-030/031/032/035: the Container and the
// three temporal assignments of the normalized physical chain.
const ContainerModel = require('../../../src/models/Container');
const SpecimenContainerAssignmentModel = require('../../../src/models/SpecimenContainerAssignment');
const ContainerPositionAssignmentModel = require('../../../src/models/ContainerPositionAssignment');
const RackLocationAssignmentModel = require('../../../src/models/RackLocationAssignment');

describe('ContainerModel', () => {
  it('creates an empty, active container of a governed type', () => {
    const container = ContainerModel.create({ containerType: 'cryogenic_vial' });
    expect(container).toMatchObject({ containerType: 'cryogenic_vial', emptyStatus: 'empty', status: 'active' });
    expect(container.containerId).toMatch(/^[0-9a-f-]{36}$/);
    expect(container.createdAt).toBeInstanceOf(Date);
  });

  it('refuses a container with no type, or an unknown emptyStatus or status', () => {
    expect(() => ContainerModel.create({})).toThrow('containerType');
    expect(() => ContainerModel.create({ containerType: 'cryogenic_vial', emptyStatus: 'full' })).toThrow('emptyStatus');
    expect(() => ContainerModel.create({ containerType: 'cryogenic_vial', status: 'lost' })).toThrow('status');
  });

  it('reads occupied with active content and empty without (RULE-031, RULE-032)', () => {
    const container = ContainerModel.create({ containerType: 'cryogenic_vial' });
    expect(ContainerModel.withContent(container, true).emptyStatus).toBe('occupied');
    expect(ContainerModel.withContent(container, false).emptyStatus).toBe('empty');
  });
});

describe('SpecimenContainerAssignmentModel', () => {
  const base = { specimenId: 'spec-1', containerId: 'cont-1', sourceEventId: 'evt-1' };
  const at = (hour) => new Date(Date.UTC(2026, 9, 9, hour));

  it('creates an active assignment, requiring its specimen, container and source event', () => {
    const assignment = SpecimenContainerAssignmentModel.create({ ...base, loadedAt: at(10) });
    expect(assignment).toMatchObject({ ...base, assignmentStatus: 'active', unloadedAt: null });
    expect(assignment.loadedAt).toEqual(at(10));
    for (const field of ['specimenId', 'containerId', 'sourceEventId']) {
      expect(() => SpecimenContainerAssignmentModel.create({ ...base, [field]: undefined })).toThrow(field);
    }
  });

  it('closes an interval at its exclusive end, never before it starts', () => {
    const assignment = SpecimenContainerAssignmentModel.create({ ...base, loadedAt: at(10) });
    const closed = SpecimenContainerAssignmentModel.unload(assignment, at(12));
    expect(closed).toMatchObject({ assignmentStatus: 'ended', unloadedAt: at(12) });
    expect(() => SpecimenContainerAssignmentModel.unload(assignment, at(10))).toThrow('posterior');
    expect(() => SpecimenContainerAssignmentModel.create({ ...base, loadedAt: at(10), unloadedAt: at(9) })).toThrow('posterior');
  });

  it('treats intervals as half-open: [10,12) and [12,14) do not overlap, an open one runs on', () => {
    // RNF025 C4: a SpecimenContainerAssignment runs over [from,to).
    const overlaps = (a, b) => SpecimenContainerAssignmentModel.overlaps(a, b);
    const interval = (from, to) => ({ loadedAt: at(from), unloadedAt: to === null ? null : at(to) });
    expect(overlaps(interval(10, 12), interval(12, 14))).toBe(false);
    expect(overlaps(interval(10, 12), interval(11, 14))).toBe(true);
    expect(overlaps(interval(10, null), interval(20, 22))).toBe(true);
    expect(overlaps(interval(10, 12), interval(8, null))).toBe(true);
    expect(overlaps(interval(10, 12), interval(13, null))).toBe(false);
  });

  it('refuses a second overlapping container for one specimen, and allows the next one after unloading (RF017 AC4)', () => {
    const first = SpecimenContainerAssignmentModel.create({ ...base, loadedAt: at(10) });
    const overlapping = SpecimenContainerAssignmentModel.create({ ...base, containerId: 'cont-2', loadedAt: at(11) });
    expect(() => SpecimenContainerAssignmentModel.assertNoOverlap(overlapping, [first])).toThrow('cont-1');

    const closed = SpecimenContainerAssignmentModel.unload(first, at(11));
    expect(() => SpecimenContainerAssignmentModel.assertNoOverlap(overlapping, [closed])).not.toThrow();
  });

  it('does not compare a specimen against another specimen, nor an assignment against itself', () => {
    const first = SpecimenContainerAssignmentModel.create({ ...base, loadedAt: at(10) });
    const other = SpecimenContainerAssignmentModel.create({ ...base, specimenId: 'spec-2', loadedAt: at(10) });
    expect(() => SpecimenContainerAssignmentModel.assertNoOverlap(other, [first])).not.toThrow();
    expect(() => SpecimenContainerAssignmentModel.assertNoOverlap(first, [first])).not.toThrow();
  });
});

describe('ContainerPositionAssignmentModel', () => {
  const at = (hour) => new Date(Date.UTC(2026, 9, 9, hour));
  const place = (containerId, storagePositionId, hour) => ContainerPositionAssignmentModel.create({
    containerId, storagePositionId, placedAt: at(hour),
  });

  it('creates an active placement, requiring its container and position, the scan event optional', () => {
    const placement = place('cont-1', 'pos-A01', 10);
    expect(placement).toMatchObject({ assignmentStatus: 'active', removedAt: null, sourceScanEventId: null });
    expect(() => ContainerPositionAssignmentModel.create({ storagePositionId: 'pos-A01' })).toThrow('containerId');
    expect(() => ContainerPositionAssignmentModel.create({ containerId: 'cont-1' })).toThrow('storagePositionId');
  });

  it('refuses a second container in an occupied position, and a container in two positions (RULE-030)', () => {
    const occupied = place('cont-1', 'pos-A01', 10);
    expect(() => ContainerPositionAssignmentModel.assertNoOverlap(place('cont-2', 'pos-A01', 11), [occupied])).toThrow('storagePositionId');
    expect(() => ContainerPositionAssignmentModel.assertNoOverlap(place('cont-1', 'pos-B02', 11), [occupied])).toThrow('containerId');
  });

  it('frees the position at the removal instant, never before the placement', () => {
    // RNF025 C4: a ContainerPositionAssignment runs over [from,to).
    const occupied = place('cont-1', 'pos-A01', 10);
    const removed = ContainerPositionAssignmentModel.remove(occupied, at(11));
    expect(removed).toMatchObject({ assignmentStatus: 'ended', removedAt: at(11) });
    expect(() => ContainerPositionAssignmentModel.assertNoOverlap(place('cont-2', 'pos-A01', 11), [removed])).not.toThrow();
    expect(() => ContainerPositionAssignmentModel.remove(occupied, at(9))).toThrow('posterior');
  });
});

describe('RackLocationAssignmentModel', () => {
  const at = (hour) => new Date(Date.UTC(2026, 9, 9, hour));
  const locate = (storageRackId, storageLocationId, hour) => RackLocationAssignmentModel.create({
    storageRackId, storageLocationId, placedAt: at(hour), sourceEventId: 'evt-1',
  });

  it('requires its rack, location and source event', () => {
    for (const field of ['storageRackId', 'storageLocationId', 'sourceEventId']) {
      expect(() => RackLocationAssignmentModel.create({
        storageRackId: 'rack-1', storageLocationId: 'loc-1', sourceEventId: 'evt-1', [field]: undefined,
      })).toThrow(field);
    }
  });

  it('refuses a rack in two locations at once, and lets two racks share a location (RULE-035)', () => {
    // RNF025 C4: a RackLocationAssignment runs over [from,to); a move ends one where the next starts.
    const current = locate('rack-1', 'loc-1', 10);
    expect(() => RackLocationAssignmentModel.assertNoOverlap(locate('rack-1', 'loc-2', 11), [current])).toThrow('loc-1');
    expect(() => RackLocationAssignmentModel.assertNoOverlap(locate('rack-2', 'loc-1', 11), [current])).not.toThrow();
    const moved = RackLocationAssignmentModel.remove(current, at(11));
    expect(() => RackLocationAssignmentModel.assertNoOverlap(locate('rack-1', 'loc-2', 11), [moved])).not.toThrow();
  });
});
