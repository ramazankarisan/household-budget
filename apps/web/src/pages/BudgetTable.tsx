import {
  type CategoryPayload,
  type CategoryReport,
  type MonthlyReport,
} from '@household-budget/core';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

import { formatAmount } from '../format';
import { budgetsText, describeRemaining } from '../i18n/budgets';
import { transactionsText } from '../i18n/transactions';
import { BudgetField } from './BudgetField';

interface BudgetTableProps {
  readonly report: MonthlyReport;
  /** For the names. The report carries ids only, in this list's order. */
  readonly categories: readonly CategoryPayload[];
  /** Category ids whose own write for this month is in flight. */
  readonly savingIds: ReadonlySet<string>;
  /**
   * Per category id: bumped by the page when that cell's write was refused, so that one
   * field remounts with the stored number. The others keep whatever is being typed.
   */
  readonly revisions: ReadonlyMap<string, number>;
  readonly onSave: (categoryId: string, amountCents: number) => void;
  readonly onClear: (categoryId: string) => void;
  readonly onShowUncategorized: () => void;
}

/** The amount columns: right-aligned, tabular figures, never wrapped mid-number. */
const AMOUNT = { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' } as const;

/**
 * One month, one row per category: what was booked, what is still vorgemerkt, the limit,
 * and what is left.
 *
 * Presentational — the numbers arrive computed, from the same `MonthlyReport` the chart
 * reads, and the writes go back up. Over budget is a word as well as a colour: the
 * amount and `über` in `error.main`, and the same wording in the row's accessible name,
 * so the state reaches someone who cannot see the red and survives the dark scheme.
 */
export function BudgetTable({
  report,
  categories,
  savingIds,
  revisions,
  onSave,
  onClear,
  onShowUncategorized,
}: BudgetTableProps) {
  const text = budgetsText();
  const names = new Map(categories.map((category) => [category.id, category.name]));

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{text.columns.category}</TableCell>
            <TableCell align="right">{text.columns.booked}</TableCell>
            <TableCell align="right">{text.columns.pending}</TableCell>
            <TableCell align="right">{text.columns.budget}</TableCell>
            <TableCell align="right">{text.columns.remaining}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {report.categories.map((entry) =>
            entry.categoryId === null ? (
              <UncategorizedRow
                key="uncategorized"
                entry={entry}
                onShowUncategorized={onShowUncategorized}
              />
            ) : (
              <CategoryRow
                key={entry.categoryId}
                entry={entry}
                categoryId={entry.categoryId}
                name={names.get(entry.categoryId) ?? entry.categoryId}
                month={report.month}
                saving={savingIds.has(entry.categoryId)}
                revision={revisions.get(entry.categoryId) ?? 0}
                onSave={onSave}
                onClear={onClear}
              />
            ),
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/** A dash for nothing vorgemerkt; otherwise the amount with the list's ⏳ marker. */
function PendingCell({ cents }: { readonly cents: number }) {
  const text = budgetsText();

  return (
    <TableCell align="right" sx={AMOUNT}>
      {cents === 0 ? (
        '—'
      ) : (
        <>
          {formatAmount(cents)}
          <Box
            component="span"
            aria-label={text.pendingHint}
            title={text.pendingHint}
            sx={{ ml: 1 }}
          >
            ⏳
          </Box>
        </>
      )}
    </TableCell>
  );
}

interface CategoryRowProps {
  readonly entry: CategoryReport;
  readonly categoryId: string;
  readonly name: string;
  readonly month: string;
  readonly saving: boolean;
  readonly revision: number;
  readonly onSave: (categoryId: string, amountCents: number) => void;
  readonly onClear: (categoryId: string) => void;
}

function CategoryRow({
  entry,
  categoryId,
  name,
  month,
  saving,
  revision,
  onSave,
  onClear,
}: CategoryRowProps) {
  const remaining = describeRemaining(entry.remainingCents);

  return (
    <TableRow
      hover
      // The accessible name carries the state only when there is a state to carry: the
      // cells already read "Wohnen, 875,07 €…" and a label replaces them rather than adds.
      aria-label={entry.isOver ? `${name}: ${remaining}` : undefined}
    >
      <TableCell>{name}</TableCell>
      <TableCell align="right" sx={AMOUNT}>
        {formatAmount(entry.bookedCents)}
      </TableCell>
      <PendingCell cents={entry.pendingCents} />
      <TableCell align="right">
        <BudgetField
          // Remounted when the stored number changes or a refused write is discarded, so
          // the field shows what is stored rather than what was last typed.
          key={`${month}:${String(entry.budgetCents)}:${String(revision)}`}
          budgetCents={entry.budgetCents}
          categoryName={name}
          month={month}
          categoryId={categoryId}
          disabled={saving}
          onSave={(amountCents) => {
            onSave(categoryId, amountCents);
          }}
          onClear={() => {
            onClear(categoryId);
          }}
        />
      </TableCell>
      <TableCell
        align="right"
        sx={{
          ...AMOUNT,
          color: entry.isOver ? 'error.main' : 'text.primary',
          fontWeight: entry.isOver ? 600 : 400,
        }}
      >
        {remaining}
        {entry.isOver && (
          // Decoration: the word already said it, so this is hidden from the name.
          <Box component="span" aria-hidden="true" sx={{ ml: 1 }}>
            ⚠
          </Box>
        )}
      </TableCell>
    </TableRow>
  );
}

interface UncategorizedRowProps {
  readonly entry: CategoryReport;
  readonly onShowUncategorized: () => void;
}

/**
 * The `null` bucket. It has spending and never a limit — there is nothing to budget until
 * the rows have a category — so instead of a field it has the way to go and give them one.
 */
function UncategorizedRow({ entry, onShowUncategorized }: UncategorizedRowProps) {
  const text = budgetsText();

  return (
    <TableRow hover>
      <TableCell>
        <Button
          size="small"
          title={text.showUncategorized}
          onClick={onShowUncategorized}
          sx={{ ml: -1, textTransform: 'none' }}
        >
          {transactionsText().uncategorized}
        </Button>
      </TableCell>
      <TableCell align="right" sx={AMOUNT}>
        {formatAmount(entry.bookedCents)}
      </TableCell>
      <PendingCell cents={entry.pendingCents} />
      <TableCell align="right">—</TableCell>
      <TableCell align="right">—</TableCell>
    </TableRow>
  );
}
