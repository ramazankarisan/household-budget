import { describe, expect, it } from 'vitest';

import {
  categorize,
  type MatchableTransaction,
  matchingRule,
  matchRule,
  orderRules,
  type RuleCondition,
} from './match.js';
import type { Rule } from './rule.js';

/**
 * The strings are the fixture's own, verbatim. `sparkasse-camt-18.csv` is the only place
 * this feature's hard cases exist, and copying them here is what keeps the unit test and
 * the end-to-end run arguing about the same bytes.
 */
const MUELLER_COMPOSED = 'Müller GmbH';
const MUELLER_UPPERCASE = 'MÜLLER GmbH';
/** Same name, decomposed: `u` followed by the combining diaeresis U+0308. */
const MUELLER_DECOMPOSED = 'Müller GmbH';
const RENT_PURPOSE = 'Miete Oktober\r\nHauptstraße 12';

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'r1',
    field: 'counterpartyName',
    operator: 'contains',
    value: 'müller',
    priority: 100,
    categoryId: 'cat-wohnen',
    active: true,
    createdAt: '2026-09-23T08:00:00.000Z',
    ...overrides,
  };
}

describe('matchRule', () => {
  const needle: RuleCondition = {
    field: 'counterpartyName',
    operator: 'contains',
    value: 'müller',
  };

  it('finds the same payee however the export spelled it', () => {
    // The case SQLite cannot do: its lower() and NOCASE fold ASCII only, so
    // `LIKE '%müller%'` misses MÜLLER GmbH. All three spellings are different byte
    // sequences and one merchant.
    expect(MUELLER_COMPOSED).not.toBe(MUELLER_DECOMPOSED);

    for (const counterpartyName of [MUELLER_COMPOSED, MUELLER_UPPERCASE, MUELLER_DECOMPOSED]) {
      expect(matchRule(needle, { counterpartyName })).toBe(true);
    }
  });

  it('sees through the CRLF the bank put inside a Verwendungszweck', () => {
    expect(
      matchRule(
        { field: 'purpose', operator: 'contains', value: 'Miete Oktober Hauptstraße' },
        { purpose: RENT_PURPOSE },
      ),
    ).toBe(true);
  });

  it('neither matches nor throws on a field the bank left empty', () => {
    // The rent row has no payee at all. A rule on that field has to be a quiet no.
    expect(matchRule(needle, { counterpartyName: null })).toBe(false);
    expect(matchRule(needle, {})).toBe(false);
  });

  it('matches an IBAN whether it was typed in groups or not', () => {
    const stored = { counterpartyIban: 'DE89370400440532013000' };

    expect(
      matchRule(
        { field: 'counterpartyIban', operator: 'equals', value: 'DE89 3704 0044 0532 0130 00' },
        stored,
      ),
    ).toBe(true);
    expect(
      matchRule(
        { field: 'counterpartyIban', operator: 'equals', value: 'DE89370400440532013000' },
        stored,
      ),
    ).toBe(true);
  });

  it('applies each operator to the normalized text', () => {
    const rewe: MatchableTransaction = { counterpartyName: 'REWE SAGT DANKE; FILIALE 42' };

    expect(
      matchRule({ field: 'counterpartyName', operator: 'startsWith', value: 'rewe' }, rewe),
    ).toBe(true);
    expect(
      matchRule({ field: 'counterpartyName', operator: 'endsWith', value: 'filiale 42' }, rewe),
    ).toBe(true);
    expect(
      matchRule(
        { field: 'counterpartyName', operator: 'equals', value: 'REWE SAGT DANKE; FILIALE 42' },
        rewe,
      ),
    ).toBe(true);
    expect(matchRule({ field: 'counterpartyName', operator: 'equals', value: 'rewe' }, rewe)).toBe(
      false,
    );
  });

  it('reads the field the rule names and no other', () => {
    // A payee rule must not quietly match because the keyword appears in the purpose.
    expect(matchRule(needle, { counterpartyName: 'Ärzte GmbH', purpose: 'Müller GmbH' })).toBe(
      false,
    );
  });
});

describe('orderRules', () => {
  it('orders by priority, then createdAt, then id', () => {
    const rules = [
      rule({ id: 'c', priority: 20, createdAt: '2026-01-01T00:00:00.000Z' }),
      rule({ id: 'a', priority: 10, createdAt: '2026-02-01T00:00:00.000Z' }),
      rule({ id: 'b', priority: 20, createdAt: '2026-01-01T00:00:00.000Z' }),
    ];

    expect(orderRules(rules).map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns the same order however the input was shuffled', () => {
    // Two rules can carry the same integer priority, and a re-apply that resolved them
    // differently between runs would rewrite categories for no reason the user can see.
    const rules = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      rule({ id, priority: 50, createdAt: '2026-03-01T00:00:00.000Z' }),
    );
    const expected = orderRules(rules).map((entry) => entry.id);

    for (let run = 0; run < 100; run += 1) {
      const shuffled = rules.slice().sort(() => Math.random() - 0.5);
      expect(orderRules(shuffled).map((entry) => entry.id)).toEqual(expected);
    }
  });

  it('breaks a priority tie on createdAt before it reaches the id', () => {
    /*
     * The case the test above cannot make: there, the two tied rules share a `createdAt`
     * as well as a priority, so only the `id` leg of the comparator is ever exercised and
     * swapping the two legs keeps it green. Here the older rule has the later id, so an
     * order decided by id alone comes out reversed — the rule the user wrote first has to
     * win, because that is the sequence the list on screen shows.
     */
    const rules = [
      rule({ id: 'aa-newer', priority: 50, createdAt: '2026-02-01T00:00:00.000Z' }),
      rule({ id: 'zz-older', priority: 50, createdAt: '2026-01-01T00:00:00.000Z' }),
    ];

    // By id alone this would be ['aa-newer', 'zz-older'].
    expect(orderRules(rules).map((entry) => entry.id)).toEqual(['zz-older', 'aa-newer']);
  });

  it('drops rules the user switched off', () => {
    expect(orderRules([rule({ id: 'off', active: false })])).toEqual([]);
  });

  it('does not mutate the array it was given', () => {
    const rules = [rule({ id: 'b', priority: 20 }), rule({ id: 'a', priority: 10 })];
    orderRules(rules);

    expect(rules.map((entry) => entry.id)).toEqual(['b', 'a']);
  });
});

describe('categorize', () => {
  it('lets the lower priority win when two rules match', () => {
    const ordered = orderRules([
      rule({ id: 'broad', priority: 20, value: 'gmbh', categoryId: 'cat-sonstiges' }),
      rule({ id: 'exact', priority: 10, value: 'müller', categoryId: 'cat-wohnen' }),
    ]);

    expect(categorize(ordered, { counterpartyName: MUELLER_COMPOSED })).toBe('cat-wohnen');
  });

  it('returns undefined when no rule claims the row', () => {
    expect(categorize(orderRules([rule()]), { counterpartyName: 'Ärzte GmbH' })).toBeUndefined();
  });

  it('ignores a switched-off rule that would otherwise have matched', () => {
    const ordered = orderRules([rule({ active: false })]);

    expect(categorize(ordered, { counterpartyName: MUELLER_COMPOSED })).toBeUndefined();
  });
});

describe('matchingRule', () => {
  it('names the rule that decided, not only the category it assigned', () => {
    // What an apply logs per rule. Two rules pointing at the *same* category is exactly
    // the case `categorize` cannot tell apart, and the case where "which rule did this"
    // is the only useful question.
    const ordered = orderRules([
      rule({ id: 'broad', priority: 20, value: 'gmbh', categoryId: 'cat-wohnen' }),
      rule({ id: 'exact', priority: 10, value: 'müller', categoryId: 'cat-wohnen' }),
    ]);

    expect(matchingRule(ordered, { counterpartyName: MUELLER_COMPOSED })?.id).toBe('exact');
  });

  it('returns undefined when no rule claims the row', () => {
    expect(matchingRule(orderRules([rule()]), { counterpartyName: 'Ärzte GmbH' })).toBeUndefined();
  });
});
