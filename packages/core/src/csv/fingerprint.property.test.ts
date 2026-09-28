/**
 * The dedup key is fingerprint plus occurrence. These properties are what make an
 * overlapping export import only what is new: occurrences number each fingerprint 0, 1,
 * 2, …, and every (fingerprint, occurrence) pair in one file is distinct.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { assignOccurrences, dedupKeyInput } from './fingerprint.js';

const fingerprints = fc.array(fc.constantFrom('a', 'b', 'c', 'd'), { maxLength: 40 });

describe('assignOccurrences (properties)', () => {
  it('numbers each fingerprint 0, 1, 2, … in file order', () => {
    fc.assert(
      fc.property(fingerprints, (fps) => {
        const occurrences = assignOccurrences(fps);
        fps.forEach((fp, i) => {
          expect(occurrences[i]).toBe(fps.slice(0, i).filter((other) => other === fp).length);
        });
      }),
    );
  });

  it('gives every row of one file a distinct dedup key', () => {
    fc.assert(
      fc.property(fingerprints, (fps) => {
        const occurrences = assignOccurrences(fps);
        const keys = fps.map((fp, i) => dedupKeyInput(fp, occurrences[i] ?? -1));
        expect(new Set(keys).size).toBe(fps.length);
      }),
    );
  });

  it('keeps the rows an earlier export already had: a later file that extends it re-derives their keys', () => {
    fc.assert(
      fc.property(fingerprints, fingerprints, (earlier, appended) => {
        const keysOf = (fps: readonly string[]) => {
          const occ = assignOccurrences(fps);
          return fps.map((fp, i) => dedupKeyInput(fp, occ[i] ?? -1));
        };
        expect(keysOf([...earlier, ...appended]).slice(0, earlier.length)).toEqual(keysOf(earlier));
      }),
    );
  });
});
