/**
 * Every string the UI shows, in German — the source shape `en.ts` is typed against.
 *
 * Core returns machine codes; the wording lives here. That split is what lets the same
 * import report read in German or English without the parser knowing either language.
 *
 * Amounts are formatted by `formatAmount` before they are interpolated, never by i18next:
 * they read `-832,90 €` in both languages (plan 07, decision 1).
 */
export const de = {
  common: {
    appTitle: 'Household Budget',
    nav: {
      transactions: 'Umsätze',
      rules: 'Regeln',
      budgets: 'Budgets',
    },
    theme: {
      toDark: 'Dunkles Design',
      toLight: 'Helles Design',
    },
    language: {
      label: 'Sprache',
      de: 'DE',
      en: 'EN',
    },
    account: {
      select: 'Konto',
      create: 'Konto anlegen',
      createHint:
        'Ein Import gehört immer zu einem Konto, das Sie vorher auswählen — nie zu einem, das aus der Datei erraten wurde.',
      iban: 'IBAN',
      name: 'Bezeichnung',
      submit: 'Anlegen',
    },
    import: {
      title: 'CSV importieren',
      uploading: 'Import läuft…',
      dropHint: 'Sparkasse-Export hierher ziehen oder klicken zum Auswählen',
      chooseFile: 'CSV-Datei auswählen',
      failed: 'Import fehlgeschlagen',
      alreadyUploaded: 'Diese Datei wurde bereits einmal hochgeladen.',
      notImported: 'Nicht importierte Zeilen',
      summary:
        '{{imported}} importiert · {{skipped}} Duplikate übersprungen · {{restored}} wiederhergestellt · {{failed}} fehlerhaft',
      notListed: '… und {{notListed}} weitere',
    },
  },
  transactions: {
    month: 'Monat',
    allMonths: 'Alle Monate',
    /** The filter select's accessible name — deliberately not `columns.category`. */
    filterCategory: 'Kategorie filtern',
    allCategories: 'Alle Kategorien',
    uncategorized: 'Ohne Kategorie',
    /** The count chip's accessible name: what clicking it does, not what it says. */
    showUncategorized: 'Nur Umsätze ohne Kategorie zeigen',
    search: 'Suche',
    clearSearch: 'Suche löschen',
    resetFilters: 'Filter zurücksetzen',
    noTransactions: 'Noch keine Umsätze. Importieren Sie einen CSV-Export.',
    noMatches: 'Keine Umsätze für diese Auswahl.',
    uncategorizedCount: '{{uncategorized}} ohne Kategorie',
    allCategorized: 'Alle kategorisiert',
    /** The ⏳ marker's accessible name — the same word `budgets.pendingHint` uses. */
    pendingHint: 'vorgemerkt',
    columns: {
      date: 'Datum',
      counterparty: 'Empfänger',
      purpose: 'Zweck',
      category: 'Kategorie',
      amount: 'Betrag',
    },
  },
  rules: {
    categoriesTitle: 'Kategorien',
    categoryName: 'Name',
    addCategory: 'Kategorie anlegen',
    deleteCategory: 'Kategorie löschen',
    undo: 'Rückgängig',
    noCategories: 'Noch keine Kategorien. Legen Sie eine an, bevor Sie eine Regel schreiben.',
    rulesTitle: 'Regeln',
    applyRules: 'Regeln anwenden',
    applying: 'Regeln laufen…',
    addRule: 'Regel anlegen',
    editRule: 'Regel bearbeiten',
    saveRule: 'Speichern',
    cancel: 'Abbrechen',
    deleteRule: 'Regel löschen',
    noRules: 'Noch keine Regeln.',
    priority: 'Priorität',
    field: 'Feld',
    operator: 'Operator',
    value: 'Suchbegriff',
    category: 'Kategorie',
    active: 'aktiv',
    uncategorized: 'Ohne Kategorie',
    clearCategory: 'Kategorie entfernen',
    lockedHint: 'von Hand gesetzt — Regeln ändern das nicht',
    pendingHint:
      'Vorgemerkt — der nächste Import ersetzt diese Zeile, eine Kategorie ließe sich nicht übernehmen.',
    fields: {
      counterpartyName: 'Empfänger',
      purpose: 'Zweck',
      counterpartyIban: 'IBAN',
    },
    operators: {
      contains: 'enthält',
      startsWith: 'beginnt mit',
      endsWith: 'endet mit',
      equals: 'ist',
    },
    categoryInUse:
      'Wird noch verwendet: {{rules}} Regeln, {{transactions}} Umsätze, {{budgets}} Budgets.',
    categoryDeleted: '„{{name}}“ gelöscht',
    ruleDeleted: 'Regel „{{label}}“ gelöscht',
    applySummary:
      '{{evaluated}} geprüft · {{assigned}} zugeordnet · {{cleared}} gelöscht · {{locked}} manuell',
  },
  budgets: {
    columns: {
      category: 'Kategorie',
      booked: 'Gebucht',
      pending: 'Vorgemerkt',
      budget: 'Budget',
      remaining: 'Rest',
    },
    /** The empty field's placeholder: what typing into it does. */
    setBudget: 'Budget setzen',
    clearBudget: 'Budget entfernen',
    over: 'über',
    left: 'übrig',
    /** The month total when nothing in the month is budgeted. */
    noBudgets: 'kein Budget gesetzt',
    /** The ⏳ marker's accessible name — the same word the transactions table uses. */
    pendingHint: 'vorgemerkt',
    /** What the uncategorized row's button does, for its title. */
    showUncategorized: 'Umsätze ohne Kategorie in diesem Monat zeigen',
    toTransactions: 'Zu den Umsätzen',
    /** The chart's caption, and its accessible name. */
    chartTitle: 'Ausgaben nach Kategorie',
    /** The `…` in a Budget or Rest cell while the month's limits are still on their way. */
    loadingLimits: 'Budgets werden geladen',
    monthTotal: {
      of: 'von',
      pending: 'vorgemerkt',
      spent: 'ausgegeben',
    },
  },
  errors: {
    lineLabel: 'Zeile',
    row: {
      AMOUNT_UNPARSEABLE: 'Betrag nicht lesbar',
      DATE_UNPARSEABLE: 'Datum nicht lesbar',
      STATUS_UNKNOWN: 'Unbekannter Umsatzstatus',
      REQUIRED_FIELD_MISSING: 'Pflichtfeld fehlt',
      FIELD_COUNT_MISMATCH: 'Zeile hat die falsche Spaltenzahl',
    },
    file: {
      UNSUPPORTED_CONTENT_TYPE:
        'Dateityp nicht unterstützt — bitte den CSV-Export der Sparkasse hochladen',
      HEADER_NOT_FOUND: 'Keine Kopfzeile gefunden — ist das ein CSV-CAMT-Export der Sparkasse?',
      REQUIRED_COLUMN_MISSING: 'Pflichtspalte fehlt',
      CSV_QUOTE_NOT_CLOSED: 'Ein Anführungszeichen in der Datei wird nie geschlossen',
      CSV_INVALID_CLOSING_QUOTE: 'Ungültiges schließendes Anführungszeichen',
      CSV_RECORD_INCONSISTENT_FIELDS_LENGTH: 'Eine Zeile hat die falsche Spaltenzahl',
    },
    unknownFile: 'Datei nicht lesbar ({{code}})',
    rule: {
      FIELD_UNKNOWN: 'Unbekanntes Feld',
      OPERATOR_UNKNOWN: 'Unbekannter Operator',
      OPERATOR_NOT_ALLOWED_FOR_FIELD: 'Dieser Operator passt nicht zu diesem Feld',
      VALUE_EMPTY: 'Suchbegriff fehlt',
      VALUE_TOO_LONG: 'Suchbegriff ist zu lang',
      PRIORITY_NOT_AN_INTEGER: 'Priorität muss eine ganze Zahl sein',
      CATEGORY_REQUIRED: 'Kategorie fehlt',
    },
    budget: {
      MONTH_INVALID: 'Ungültiger Monat',
      CATEGORY_REQUIRED: 'Kategorie fehlt',
      AMOUNT_NOT_AN_INTEGER: 'Betrag in Euro, z. B. 700 oder 700,50',
      AMOUNT_NEGATIVE: 'Ein Budget kann nicht negativ sein',
      AMOUNT_TOO_LARGE: 'Budget ist zu groß',
    },
  },
};
