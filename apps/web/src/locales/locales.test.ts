import { describe, expect, it } from 'vitest';

import { de } from './de';
import { en } from './en';
import i18n from './i18n';
import { type Messages } from './messages';

/** Every leaf of a message tree, as `path → value`. */
function leaves(value: unknown, path = ''): { path: string; value: unknown }[] {
  if (typeof value !== 'object' || value === null) {
    return [{ path, value }];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, path === '' ? key : `${path}.${key}`),
  );
}

describe('locales', () => {
  it('has the same keys in both languages', () => {
    // The type already insists; this is the runtime half, for anything a cast slips past.
    const paths = (tree: unknown) => leaves(tree).map(({ path }) => path);
    expect(paths(en)).toEqual(paths(de));
  });

  it('has a non-empty string at every leaf', () => {
    for (const [locale, tree] of Object.entries({ de, en })) {
      for (const { path, value } of leaves(tree)) {
        expect(typeof value, `${locale}.${path}`).toBe('string');
        expect(value, `${locale}.${path}`).not.toBe('');
      }
    }
  });

  it('names the category filter something the row selects are not called', () => {
    // `CategoryCell` puts a combobox named "Kategorie" on every row. A second control by
    // that name is a strict-mode locator failure in the e2e specs.
    for (const tree of [de, en]) {
      expect(tree.transactions.filterCategory).not.toBe(tree.rules.category);
      expect(tree.transactions.filterCategory).not.toBe(tree.transactions.columns.category);
    }
  });
});

// Compile-time cases, enforced by `pnpm typecheck`: an unused `@ts-expect-error` is itself
// an error, so each of these lines must keep failing to compile.
export function typeChecks(): void {
  // @ts-expect-error — a translation missing a key is not a Messages<typeof de>
  const partial: Messages<typeof de> = { ...en, common: { appTitle: 'x' } };
  // @ts-expect-error — keys are checked
  i18n.t('no.such.key');
  void partial;
}
