import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface NewAccountFormProps {
  readonly onCreate: (iban: string, name: string) => Promise<void>;
  readonly onError: (cause: unknown) => void;
}

/** An import has to land in an account chosen first — never one guessed from the file. */
export function NewAccountForm({ onCreate, onError }: NewAccountFormProps) {
  const { t } = useTranslation();
  const [iban, setIban] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  return (
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
      <Typography variant="h2" component="h3">
        {t('common.account.create')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('common.account.createHint')}
      </Typography>
      <TextField
        label={t('common.account.iban')}
        value={iban}
        required
        onChange={(event) => {
          setIban(event.target.value);
        }}
      />
      <TextField
        label={t('common.account.name')}
        value={name}
        required
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <Button type="submit" variant="contained" disabled={saving} sx={{ alignSelf: 'start' }}>
        {t('common.account.submit')}
      </Button>
    </Stack>
  );
}
