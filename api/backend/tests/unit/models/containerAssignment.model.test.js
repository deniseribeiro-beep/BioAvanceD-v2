// RF016 AC1/AC3, RF017 AC4, RULE-031/RULE-032: the Container and the
// specimen's content assignment over [loadedAt, unloadedAt).
const ContainerModel = require('../../../src/models/Container');
const SpecimenContainerAssignmentModel = require('../../../src/models/SpecimenContainerAssignment');

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
