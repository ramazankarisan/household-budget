import { type ImportSummary } from '@household-budget/core';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { uploadImport } from '../api/client';
import { describeImportFailure, describeRowError } from '../locales/sentences';

interface ImportPanelProps {
  readonly accountId: string;
  readonly onImported: () => void;
}

type PanelState =
  | { readonly status: 'idle' }
  | { readonly status: 'uploading' }
  | { readonly status: 'done'; readonly summary: ImportSummary }
  // The cause, not its sentence: worded at render, so it follows a language switch.
  | { readonly status: 'error'; readonly cause: unknown };

export function ImportPanel({ accountId, onImported }: ImportPanelProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<PanelState>({ status: 'idle' });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const uploading = state.status === 'uploading';

  function upload(file: File | undefined): void {
    if (file === undefined || uploading) {
      return;
    }
    setState({ status: 'uploading' });

    uploadImport(accountId, file)
      .then((summary) => {
        setState({ status: 'done', summary });
        onImported();
      })
      .catch((error: unknown) => {
        setState({ status: 'error', cause: error });
      });
  }

  return (
    <Stack spacing={2}>
      <Box
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          upload(event.dataTransfer.files[0]);
        }}
        onClick={() => inputRef.current?.click()}
        sx={{
          border: '1px dashed',
          borderColor: dragging ? 'primary.main' : 'divider',
          backgroundColor: dragging ? 'action.hover' : 'transparent',
          borderRadius: 2,
          p: 4,
          textAlign: 'center',
          cursor: uploading ? 'progress' : 'pointer',
          opacity: uploading ? 0.6 : 1,
        }}
      >
        {uploading ? (
          <Stack direction="row" spacing={2} sx={{ justifyContent: 'center' }}>
            <CircularProgress size={20} />
            <Typography>{t('common.import.uploading')}</Typography>
          </Stack>
        ) : (
          <Typography color="text.secondary">{t('common.import.dropHint')}</Typography>
        )}
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,application/vnd.ms-excel"
          aria-label={t('common.import.chooseFile')}
          hidden
          disabled={uploading}
          onChange={(event) => {
            upload(event.target.files?.[0]);
            // Same file twice in a row must still fire a change event.
            event.target.value = '';
          }}
        />
      </Box>

      {state.status === 'error' && (
        <Alert severity="error">
          <AlertTitle>{t('common.import.failed')}</AlertTitle>
          {describeImportFailure(t, state.cause)}
        </Alert>
      )}

      {state.status === 'done' && <ImportResult summary={state.summary} />}
    </Stack>
  );
}

export function ImportResult({ summary }: { readonly summary: ImportSummary }) {
  const { t } = useTranslation();
  // `failed` is capped by the API; `failedCount` is how many rows really failed.
  const failed = summary.failed;
  const notListed = summary.failedCount - failed.length;

  return (
    <Stack spacing={1}>
      <Alert severity={summary.failedCount > 0 ? 'warning' : 'success'}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ flexWrap: 'wrap', alignItems: 'center' }}
        >
          <Typography variant="body2">
            {t('common.import.summary', {
              imported: summary.imported,
              skipped: summary.skipped,
              restored: summary.restored,
              failed: summary.failedCount,
            })}
          </Typography>
          {/* A surprise utf-8 here means the bank changed its export format. */}
          <Chip label={summary.encoding} size="small" variant="outlined" />
        </Stack>
      </Alert>

      {summary.duplicateOfBatchId !== undefined && (
        <Alert severity="info">{t('common.import.alreadyUploaded')}</Alert>
      )}

      {failed.length > 0 && (
        // Listed, not hidden behind a toggle: a row that did not import is the one
        // thing the user has to see.
        <Alert severity="warning" variant="outlined">
          <AlertTitle>{t('common.import.notImported')}</AlertTitle>
          <Stack component="ul" spacing={0.5} sx={{ pl: 2, m: 0 }}>
            {failed.map((error) => (
              <Typography component="li" variant="body2" key={`${error.code}-${error.line}`}>
                {describeRowError(t, error)}
              </Typography>
            ))}
          </Stack>
          {notListed > 0 && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {t('common.import.notListed', { notListed })}
            </Typography>
          )}
        </Alert>
      )}
    </Stack>
  );
}
