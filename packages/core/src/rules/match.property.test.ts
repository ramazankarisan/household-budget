/**
 * The two promises the rules engine makes that a single example cannot pin down: matching
 * ignores case and spacing the way `normalize` defines them, and the order rules are tried
 * in is a total order, so no input order can change which rule wins.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { categorize, compareRules, matchRule, orderRules } from './match.js';
import { normalize } from './normalize.js';
import { RULE_FIELDS, type Rule } from './rule.js';

/**
 * Payee-like text. `ß` is left out on purpose: `'ß'.toUpperCase()` is `'SS'`, which folds
 * back to `ss`, so an uppercased payee genuinely is different text.
 */
const payee = fc.stringMatching(/^[a-zäöüA-ZÄÖÜ0-9 .,&-]{1,30}$/u);

describe('normalize (properties)', () => {
  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (value) => {
        expect(normalize(normalize(value))).toBe(normalize(value));
      }),
    );
  });
});

describe('matchRule (properties)', () => {
  it('finds any piece of a payee however the export capitalizes or pads it', () => {
    fc.assert(
      fc.property(payee, fc.nat(), fc.nat(), (name, a, b) => {
        const [from, to] = [a % (name.length + 1), b % (name.length + 1)].sort((x, y) => x - y);
        const needle = name.slice(from, to);
        fc.pre(normalize(needle) !== '');

        const exported = `  ${name.toUpperCase().replaceAll(' ', '  ')} `;
        expect(
          matchRule(
            { field: 'counterpartyName', operator: 'contains', value: needle },
            {
              counterpartyName: exported,
            },
          ),
        ).toBe(true);
      }),
    );
  });
});

const rule: fc.Arbitrary<Rule> = fc.record({
  id: fc.uuid(),
  field: fc.constantFrom(...RULE_FIELDS),
  operator: fc.constantFrom(
    'contains' as const,
    'startsWith' as const,
    'endsWith' as const,
    'equals' as const,
  ),
  value: fc.constantFrom('rewe', 'miete', 'de89'),
  priority: fc.integer({ min: 0, max: 5 }),
  categoryId: fc.constantFrom('food', 'rent', 'fun'),
  active: fc.boolean(),
  createdAt: fc.constantFrom('2025-01-01T00:00:00.000Z', '2025-06-01T00:00:00.000Z'),
});

describe('rule order (properties)', () => {
  it('compareRules is a total order: antisymmetric, and zero only for the same id', () => {
    fc.assert(
      fc.property(rule, rule, (left, right) => {
        expect(Math.sign(compareRules(left, right))).toBe(-Math.sign(compareRules(right, left)));
        if (compareRules(left, right) === 0) {
          expect(left.id).toBe(right.id);
        }
      }),
    );
  });

  it('picks the same category whatever order the rules were loaded in', () => {
    const rules = fc.uniqueArray(rule, { selector: (r) => r.id, maxLength: 12 });
    fc.assert(
      fc.property(
        rules.chain((rs) =>
          fc.tuple(fc.constant(rs), fc.shuffledSubarray(rs, { minLength: rs.length })),
        ),
        fc.record({
          counterpartyName: fc.constantFrom('REWE Markt', 'Hausverwaltung Miete'),
          purpose: fc.constant(''),
        }),
        ([rs, shuffled], transaction) => {
          expect(categorize(orderRules(shuffled), transaction)).toBe(
            categorize(orderRules(rs), transaction),
          );
        },
      ),
    );
  });
});
