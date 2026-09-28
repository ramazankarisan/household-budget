import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { importFixture } from './support';

/**
 * Accessibility, as the browser actually rendered it. eslint-plugin-jsx-a11y reads JSX and
 * cannot see what MUI turns a <TextField> into; axe runs against the real DOM with the real
 * theme, so it also catches contrast — which is why every page runs in both schemes.
 *
 * WCAG 2.1 A and AA only: those are the rules with a definite answer. docs/plans/09.
 *
 * Named wcag, not a11y, for the run order: specs run alphabetically against one database,
 * and import.spec.ts has to be the first to meet it empty.
 */
const PAGES = [
  { path: '/', heading: 'Überblick' },
  { path: '/transactions', heading: 'Umsätze' },
  { path: '/rules', heading: 'Regeln' },
  { path: '/imports', heading: 'Importe' },
] as const;

test.beforeAll(async ({ browser }) => {
  // Pages with rows on them, not empty states: a ledger row is where a missing label hides.
  const page = await browser.newPage();
  await page.goto('/transactions');
  await importFixture(page);
  await page.close();
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} scheme`, () => {
    test.use({ colorScheme: scheme });

    for (const { path, heading } of PAGES) {
      test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
        /*
         * Transitions off, so contrast is measured on the colours the page settles on. On
         * /rules the add button fades from disabled to enabled once the categories load,
         * and axe caught it halfway: #81a39d, a mix that is never on screen for long.
         */
        await page.addStyleTag({
          content:
            '*, *::before, *::after { transition: none !important; animation: none !important; }',
        });

        const { violations } = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();

        // Mapped to id and targets so a failure reads as a list, not a 2 000-line JSON dump.
        expect(
          violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(' ')) })),
        ).toEqual([]);
      });
    }
  });
}
