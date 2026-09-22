import { type AccountPayload, type TransactionPayload } from '@household-budget/core';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';

import { createAccount, listAccounts, listTransactions } from '../api/client';
import { ImportPanel } from './ImportPanel';
import { TransactionList } from './TransactionList';

export function AccountPage() {
  const [accounts, setAccounts] = useState<AccountPayload[] | undefined>(undefined);
  const [accountId, setAccountId] = useState<string>('');
  const [transactions, setTransactions] = useState<readonly TransactionPayload[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);

  const fail = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    listAccounts(controller.signal)
      .then((loaded) => {
        setAccounts(loaded);
        setAccountId((current) => (current === '' ? (loaded[0]?.id ?? '') : current));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          fail(cause);
        }
      });

    return () => {
      controller.abort();
    };
  }, [fail]);

  const refreshTransactions = useCallback(() => {
    if (accountId === '') {
      return;
    }
    listTransactions(accountId).then(setTransactions).catch(fail);
  }, [accountId, fail]);

  useEffect(refreshTransactions, [refreshTransactions]);

  async function addAccount(iban: string, name: string): Promise<void> {
    const created = await createAccount(iban, name);
    setAccounts((current) => [...(current ?? []), created]);
    setAccountId(created.id);
  }

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <Stack
          direction="row"
          spacing={2}
          sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
        >
          <Typography variant="h4" component="h1">
            Household Budget
          </Typography>
          {accounts !== undefined && accounts.length > 0 && (
            <TextField
              select
              size="small"
              label="Konto"
              value={accountId}
              onChange={(event) => {
                // Cleared here rather than in the effect that reloads them: showing the
                // previous account's rows under the new account's name is worse than
                // showing none for a moment.
                setTransactions([]);
                setAccountId(event.target.value);
              }}
              sx={{ minWidth: 260 }}
            >
              {accounts.map((account) => (
                <MenuItem key={account.id} value={account.id}>
                  {account.name} · {account.iban}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Stack>

        {error !== undefined && <Alert severity="error">{error}</Alert>}

        {accounts === undefined && <CircularProgress size={24} />}

        {accounts?.length === 0 && <NewAccountForm onCreate={addAccount} onError={fail} />}

        {accountId !== '' && (
          <Card variant="outlined">
            <CardContent>
              <Stack spacing={3}>
                <Typography variant="h6" component="h2">
                  CSV importieren
                </Typography>
                <ImportPanel accountId={accountId} onImported={refreshTransactions} />
                <Divider />
                <TransactionList transactions={transactions} />
              </Stack>
            </CardContent>
          </Card>
        )}
      </Stack>
    </Container>
  );
}

interface NewAccountFormProps {
  readonly onCreate: (iban: string, name: string) => Promise<void>;
  readonly onError: (cause: unknown) => void;
}

/** Shown only when there is no account yet: an import has to land somewhere. */
function NewAccountForm({ onCreate, onError }: NewAccountFormProps) {
  const [iban, setIban] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack
          component="form"
          spacing={2}
          onSubmit={(event) => {
            event.preventDefault();
            setSaving(true);
            onCreate(iban, name)
              .catch(onError)
              .finally(() => {
                setSaving(false);
              });
          }}
        >
          <Typography variant="h6" component="h2">
            Konto anlegen
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Ein Import gehört immer zu einem Konto, das Sie vorher auswählen — nie zu einem, das aus
            der Datei erraten wurde.
          </Typography>
          <TextField
            label="IBAN"
            value={iban}
            required
            onChange={(event) => {
              setIban(event.target.value);
            }}
          />
          <TextField
            label="Bezeichnung"
            value={name}
            required
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <Button type="submit" variant="contained" disabled={saving} sx={{ alignSelf: 'start' }}>
            Anlegen
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
