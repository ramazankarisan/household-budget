import { type ImportBatchPayload } from '@household-budget/core';
import UploadFileRounded from '@mui/icons-material/UploadFileRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { listImports } from '../api/client';
import { useHousehold } from '../household/context';
import { describeFailure } from '../locales/sentences';
import { TopBar } from '../shell/TopBar';
import { DelayedSkeleton } from '../ui/DelayedSkeleton';
import { EmptyState } from '../ui/EmptyState';

const WHEN = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * `/imports` — every upload, newest first (plan 08, decision 9): the answer to "did I
 * import August already?". An upload that brought nothing new is listed like any other —
 * that is exactly the one worth seeing. Reloaded whenever the household is, so an import
 * made in the dialog appears here at once.
 */
export function ImportsPage() {
  const { t } = useTranslation();
  const { accounts, transactions } = useHousehold();
  const [batches, setBatches] = useState<readonly ImportBatchPayload[] | undefined>(undefined);
  const [error, setError] = useState<{ readonly cause: unknown } | undefined>(undefined);

  // Keyed on the household's rows: an import reloads them, and then this list too.
  useEffect(() => {
    const controller = new AbortController();
    listImports(controller.signal)
      .then((loaded) => {
        if (!controller.signal.aborted) {
          setBatches(loaded);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError({ cause });
        }
      });
    return () => {
      controller.abort();
    };
  }, [transactions]);

  const accountName = (id: string) => accounts?.find((account) => account.id === id)?.name ?? '';

  return (
    <Stack spacing={3}>
      <TopBar title={t('common.pages.imports')} />
      {error !== undefined && <Alert severity="error">{describeFailure(t, error.cause)}</Alert>}
      {batches === undefined ? (
        <DelayedSkeleton rows={4} label={t('common.loading')} />
      ) : batches.length === 0 ? (
        <EmptyState message={t('imports.empty')} />
      ) : (
        <Card>
          <Box
            component="ul"
            aria-label={t('imports.listLabel')}
            sx={{ listStyle: 'none', m: 0, p: 0 }}
          >
            {batches.map((batch, index) => (
              <Stack
                component="li"
                key={batch.id}
                direction="row"
                spacing={2}
                sx={{
                  alignItems: 'center',
                  px: { xs: 2, md: 3 },
                  py: 1.5,
                  borderTop: index === 0 ? 'none' : '1px solid',
                  borderColor: 'divider',
                }}
              >
                <UploadFileRounded aria-hidden sx={{ color: 'text.secondary' }} />
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body1" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
                    {batch.fileName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" component="div">
                    {WHEN.format(new Date(batch.importedAt))} · {accountName(batch.accountId)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('imports.counts', {
                      imported: batch.rowsImported,
                      skipped: batch.rowsSkipped,
                      restored: batch.rowsRestored,
                      failed: batch.rowsFailed,
                    })}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  variant="outlined"
                  label={t(`common.import.dialect.${batch.dialect}`)}
                />
                {/* A surprise encoding here means the bank changed its export format. */}
                <Chip size="small" variant="outlined" label={batch.encoding} />
              </Stack>
            ))}
          </Box>
        </Card>
      )}
    </Stack>
  );
}
