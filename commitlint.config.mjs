/**
 * Conventional Commits, as the history already writes them (`feat(web): …`, `docs: …`).
 * Checked by lefthook's commit-msg hook. Merge commits are skipped by the preset.
 * docs/plans/09.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Subjects here name German UI terms (`Umsätze`, `Überblick`) and product words with
    // their own casing; the preset's lower-case rule would reject `feat: Regeln as …`.
    'subject-case': [0],
    // Bodies explain the why in full sentences and link docs; 100 columns cuts URLs.
    'body-max-line-length': [0],
  },
};
