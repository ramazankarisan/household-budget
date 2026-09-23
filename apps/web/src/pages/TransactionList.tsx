import { type CategoryPayload, type TransactionPayload } from '@household-budget/core';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';

import { formatAmount, formatBookingDate } from '../format';
import { CategoryCell } from './CategoryCell';

interface TransactionListProps {
  readonly transactions: readonly TransactionPayload[];
  readonly categories: readonly CategoryPayload[];
  /** `null` clears the category and its lock. The page owns the reload. */
  readonly onCategoryChange: (transactionId: string, categoryId: string | null) => void;
}

export function TransactionList({
  transactions,
  categories,
  onCategoryChange,
}: TransactionListProps) {
  if (transactions.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Noch keine Umsätze. Importieren Sie einen CSV-Export.
      </Typography>
    );
  }

  return (
    <TableContainer component={Paper} variant="outlined">
      {/*
        Fixed layout, not the browser's content-driven one. A Verwendungszweck can run to
        several lines of address, and under `table-layout: auto` that column takes the
        width it wants and pushes Betrag — the number the user came for — off the right
        edge behind a horizontal scrollbar. Fixed means the four sized columns are
        guaranteed and long text wraps instead.
      */}
      <Table size="small" sx={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '6.5rem' }} />
          {/* Empfänger and Zweck split whatever is left, evenly. */}
          <col />
          <col />
          <col style={{ width: '11rem' }} />
          <col style={{ width: '7rem' }} />
        </colgroup>
        <TableHead>
          <TableRow>
            <TableCell>Datum</TableCell>
            <TableCell>Empfänger</TableCell>
            <TableCell>Zweck</TableCell>
            <TableCell>Kategorie</TableCell>
            <TableCell align="right">Betrag</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {transactions.map((transaction) => (
            <TableRow key={transaction.id} hover>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {formatBookingDate(transaction.bookingDate)}
              </TableCell>
              <TableCell sx={{ overflowWrap: 'anywhere' }}>
                {transaction.counterpartyName ?? '—'}
                {transaction.status === 'pending' && (
                  // Pending rows are shown, never hidden, but they are labelled: they are
                  // a snapshot the next import replaces, not a settled entry.
                  <Box component="span" aria-label="vorgemerkt" title="vorgemerkt" sx={{ ml: 1 }}>
                    ⏳
                  </Box>
                )}
              </TableCell>
              {/* `anywhere` as well as pre-line: a SEPA reference is one unbroken token
                  long enough to widen the column on its own. */}
              <TableCell sx={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
                {transaction.purpose ?? '—'}
              </TableCell>
              <TableCell>
                <CategoryCell
                  transaction={transaction}
                  categories={categories}
                  onChange={onCategoryChange}
                />
              </TableCell>
              <TableCell
                align="right"
                sx={{
                  whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums',
                  color: transaction.amountCents < 0 ? 'text.primary' : 'success.main',
                }}
              >
                {formatAmount(transaction.amountCents)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
