import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createAccount } from '../../api/client';
import { useHousehold } from '../../household/context';
import { describeFailure } from '../../locales/sentences';
import { ImportPanel } from '../ImportPanel';
import { NewAccountForm } from './NewAccountForm';

interface ImportDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** A file dropped on the window, uploaded as soon as there is an account for it. */
  readonly file?: File | undefined;
  /** Opened to add an account, not to import. */
  readonly newAccount?: boolean;
}

/**
 * Importing, from anywhere (plan 08, decision 9): the account first — asked for only when
 * there is more than one, created here when there is none — then the drop zone, and the
 * result, which stays until the dialog is closed. Every page sees the new rows at once:
 * the household reloads when an import lands.
 */
export function ImportDialog({ open, onClose, file, newAccount = false }: ImportDialogProps) {
  const { t } = useTranslation();
  const { accounts, addAccount, reload } = useHousehold();
  const [chosen, setChosen] = useState('');
  const [adding, setAdding] = useState(newAccount);
  const [error, setError] = useState<{ readonly cause: unknown } | undefined>(undefined);
  const accountId = accounts?.some((account) => account.id === chosen)
    ? chosen
    : (accounts?.[0]?.id ?? '');
  const showForm = adding || accounts?.length === 0;

  async function create(iban: string, name: string): Promise<void> {
    const created = await createAccount(iban, name);
    addAccount(created);
    setChosen(created.id);
    setAdding(false);
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('common.import.dialogTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {error !== undefined && <Alert severity="error">{describeFailure(t, error.cause)}</Alert>}
          {showForm ? (
            <NewAccountForm
              onCreate={create}
              onError={(cause) => {
                setError({ cause });
              }}
            />
          ) : (
            <>
              {accounts !== undefined && accounts.length > 1 && (
                <TextField
                  select
                  size="small"
                  label={t('common.import.account')}
                  value={accountId}
                  onChange={(event) => {
                    setChosen(event.target.value);
                  }}
                >
                  {accounts.map((account) => (
                    <MenuItem key={account.id} value={account.id}>
                      {account.name} · …{account.iban.slice(-4)}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              {accountId !== '' && (
                // Keyed by the account: a result belongs to the account it was imported into.
                <ImportPanel
                  key={accountId}
                  accountId={accountId}
                  onImported={reload}
                  initialFile={file}
                />
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {!showForm && (
          <Button
            onClick={() => {
              setAdding(true);
            }}
          >
            {t('common.accounts.add')}
          </Button>
        )}
        <Button onClick={onClose}>{t('common.import.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
