import { type ImportBatchPayload } from '@household-budget/core';
import UploadFileRounded from '@mui/icons-material/UploadFileRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { listImports, restoreImport, undoImport } from '../api/client';
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
 *
 * An upload can be removed — the way out of a file imported into the wrong account. Like
 * every destructive action it happens at once and offers „Rückgängig“ for six seconds; a
 * removed upload stays listed, dimmed and marked, so the history still answers what came in.
 */
export function ImportsPage() {
  const { t } = useTranslation();
  const { accounts, transactions, reload } = useHousehold();
  const [batches, setBatches] = useState<readonly ImportBatchPayload[] | undefined>(undefined);
  const [error, setError] = useState<{ readonly cause: unknown } | undefined>(undefined);
  // `key` is new for every removal, so a second one remounts the snackbar with its own six
  // seconds rather than what was left of the first's.
  const [undoable, setUndoable] = useState<
    { readonly key: number; readonly batch: ImportBatchPayload } | undefined
  >(undefined);
  const undoSeq = useRef(0);

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

  // Every page shows the rows, so the household reloads — and this list with it.
  function remove(batch: ImportBatchPayload): void {
    setError(undefined);
    undoImport(batch.id)
      .then(() => {
        undoSeq.current += 1;
        setUndoable({ key: undoSeq.current, batch });
        reload();
      })
      .catch((cause: unknown) => {
        setError({ cause });
      });
  }

  function restore(batch: ImportBatchPayload): void {
    restoreImport(batch.id)
      .then(reload)
      .catch((cause: unknown) => {
        setError({ cause });
      });
  }

  return (
    <>
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
                    opacity: batch.undoneAt === null ? 1 : 0.6,
                  }}
                >
                  <UploadFileRounded aria-hidden sx={{ color: 'text.secondary' }} />
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="body1" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
                      {batch.fileName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {WHEN.format(new Date(batch.importedAt))} · {accountName(batch.accountId)}
                      {batch.undoneAt !== null && ` · ${t('imports.removedMark')}`}
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
                  {batch.undoneAt === null && (
                    <Button
                      size="small"
                      aria-label={t('imports.removeLabel', { file: batch.fileName })}
                      onClick={() => {
                        remove(batch);
                      }}
                      sx={{ color: 'status.over.main', flexShrink: 0 }}
                    >
                      {t('imports.remove')}
                    </Button>
                  )}
                </Stack>
              ))}
            </Box>
          </Card>
        )}
      </Stack>
      {undoable !== undefined && (
        <Snackbar
          key={undoable.key}
          open
          autoHideDuration={6000}
          message={t('imports.removed', { file: undoable.batch.fileName })}
          onClose={(_event, reason) => {
            // A click anywhere else on the page is not a decision about the undo.
            if (reason !== 'clickaway') {
              setUndoable(undefined);
            }
          }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                setUndoable(undefined);
                restore(undoable.batch);
              }}
            >
              {t('imports.undo')}
            </Button>
          }
        />
      )}
    </>
  );
}
