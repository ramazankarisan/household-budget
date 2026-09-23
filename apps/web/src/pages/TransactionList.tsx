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
      <Table size="small">
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
              <TableCell>
                {transaction.counterpartyName ?? '—'}
                {transaction.status === 'pending' && (
                  // Pending rows are shown, never hidden, but they are labelled: they are
                  // a snapshot the next import replaces, not a settled entry.
                  <Box component="span" aria-label="vorgemerkt" title="vorgemerkt" sx={{ ml: 1 }}>
                    ⏳
                  </Box>
                )}
              </TableCell>
              <TableCell sx={{ whiteSpace: 'pre-line' }}>{transaction.purpose ?? '—'}</TableCell>
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
