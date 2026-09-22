import { describeHello, type HelloPayload } from '@household-budget/core';
import Alert from '@mui/material/Alert';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';

import { fetchHello } from '../api/client';

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; payload: HelloPayload };

export function HelloPage() {
  const [state, setState] = useState<PageState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    fetchHello(controller.signal)
      .then((payload) => {
        setState({ status: 'ready', payload });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      controller.abort();
    };
  }, []);

  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Stack spacing={3}>
        <Stack spacing={1}>
          <Typography variant="h4" component="h1">
            Household Budget
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Skeleton check — this page renders whatever the API returns from{' '}
            <code>GET /api/hello</code>.
          </Typography>
        </Stack>

        <Card variant="outlined">
          <CardContent>
            {state.status === 'loading' && (
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <CircularProgress size={20} />
                <Typography>Contacting the API…</Typography>
              </Stack>
            )}

            {state.status === 'error' && (
              <Alert severity="error">
                Could not reach the API. Is it running on port 3000? ({state.message})
              </Alert>
            )}

            {state.status === 'ready' && (
              <Stack spacing={2}>
                <Typography variant="h6" component="p">
                  {describeHello(state.payload)}
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                  <Chip
                    label={`db: ${state.payload.db}`}
                    color={state.payload.db === 'ok' ? 'success' : 'warning'}
                    size="small"
                  />
                  <Chip label={state.payload.timestamp} variant="outlined" size="small" />
                </Stack>
              </Stack>
            )}
          </CardContent>
        </Card>
      </Stack>
    </Container>
  );
}
