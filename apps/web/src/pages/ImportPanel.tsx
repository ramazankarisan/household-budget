import { type ImportSummary } from '@household-budget/core';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useId, useRef, useState } from 'react';

import { ApiError, uploadImport } from '../api/client';
import { describeFileError, describeRowError } from '../i18n/importErrors';

interface ImportPanelProps {
  readonly accountId: string;
  readonly onImported: () => void;
}

type PanelState =
  | { readonly status: 'idle' }
  | { readonly status: 'uploading' }
  | { readonly status: 'done'; readonly summary: ImportSummary }
  | { readonly status: 'error'; readonly message: string };

/** A rejected file states a code; the wording for it lives in `src/i18n`. */
function describeFailure(error: unknown): string {
  if (error instanceof ApiError) {
    return describeFileError(error.code, error.columns);
  }
  return error instanceof Error ? error.message : String(error);
}

export function ImportPanel({ accountId, onImported }: ImportPanelProps) {
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
        setState({ status: 'error', message: describeFailure(error) });
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
            <Typography>Import läuft…</Typography>
          </Stack>
        ) : (
          <Typography color="text.secondary">
            Sparkasse-Export hierher ziehen oder klicken zum Auswählen
          </Typography>
        )}
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,application/vnd.ms-excel"
          aria-label="CSV-Datei auswählen"
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
          <AlertTitle>Import fehlgeschlagen</AlertTitle>
          {state.message}
        </Alert>
      )}

      {state.status === 'done' && <ImportResult summary={state.summary} />}
    </Stack>
  );
}

function ImportResult({ summary }: { readonly summary: ImportSummary }) {
  const failed = summary.failed;

  return (
    <Stack spacing={1}>
      <Alert severity={failed.length > 0 ? 'warning' : 'success'}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ flexWrap: 'wrap', alignItems: 'center' }}
        >
          <Typography variant="body2">
            {summary.imported} importiert · {summary.skipped} Duplikate übersprungen ·{' '}
            {summary.restored} wiederhergestellt · {failed.length} fehlerhaft
          </Typography>
          {/* A surprise utf-8 here means the bank changed its export format. */}
          <Chip label={summary.encoding} size="small" variant="outlined" />
        </Stack>
      </Alert>

      {summary.duplicateOfBatchId !== undefined && (
        <Alert severity="info">Diese Datei wurde bereits einmal hochgeladen.</Alert>
      )}

      {failed.length > 0 && (
        // Listed, not hidden behind a toggle: a row that did not import is the one
        // thing the user has to see.
        <Alert severity="warning" variant="outlined">
          <AlertTitle>Nicht importierte Zeilen</AlertTitle>
          <Stack component="ul" spacing={0.5} sx={{ pl: 2, m: 0 }}>
            {failed.map((error) => (
              <Typography component="li" variant="body2" key={`${error.code}-${error.line}`}>
                {describeRowError(error)}
              </Typography>
            ))}
          </Stack>
        </Alert>
      )}
    </Stack>
  );
}
