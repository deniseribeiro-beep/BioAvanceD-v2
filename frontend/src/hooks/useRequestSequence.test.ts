import { describe, expect, it } from 'vitest';
import { createRequestSequence } from './useRequestSequence';

// #901: unit coverage for the pure factory behind useRequestSequence. No
// React needed here -- the hook itself is a one-line useRef wrapper, so the
// interesting behavior (monotonicity, isCurrent semantics, independence of
// separate instances) is fully exercised through createRequestSequence().
describe('createRequestSequence (#901)', () => {
  it('next() returns a monotonically increasing sequence starting at 1', () => {
    const seq = createRequestSequence();
    expect(seq.next()).toBe(1);
    expect(seq.next()).toBe(2);
    expect(seq.next()).toBe(3);
  });

  it('isCurrent is true for the most recently issued value and false for any earlier one', () => {
    const seq = createRequestSequence();
    const first = seq.next();
    expect(seq.isCurrent(first)).toBe(true);

    const second = seq.next();
    expect(seq.isCurrent(first)).toBe(false);
    expect(seq.isCurrent(second)).toBe(true);

    const third = seq.next();
    expect(seq.isCurrent(first)).toBe(false);
    expect(seq.isCurrent(second)).toBe(false);
    expect(seq.isCurrent(third)).toBe(true);
  });

  it('isCurrent is false for a value that was never issued', () => {
    const seq = createRequestSequence();
    seq.next();
    expect(seq.isCurrent(999)).toBe(false);
  });

  it('two instances track independent counters', () => {
    const seqA = createRequestSequence();
    const seqB = createRequestSequence();

    const a1 = seqA.next();
    const b1 = seqB.next();
    const a2 = seqA.next();

    expect(a1).toBe(1);
    expect(b1).toBe(1);
    expect(a2).toBe(2);

    // A newer call on A must not invalidate B's still-current value, and
    // vice versa -- the two sequences never observe each other.
    expect(seqA.isCurrent(a1)).toBe(false);
    expect(seqA.isCurrent(a2)).toBe(true);
    expect(seqB.isCurrent(b1)).toBe(true);
  });
});
