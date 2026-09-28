import AccountBalanceWalletRounded from '@mui/icons-material/AccountBalanceWalletRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { useHousehold } from '../household/context';
import { useImport } from './importContext';

/** The accounts the household has, by name and the last four digits of the IBAN. */
export function AccountsList() {
  const { t } = useTranslation();
  const { accounts } = useHousehold();
  const { openImport } = useImport();
  if (accounts === undefined) {
    return null;
  }

  return (
    <Stack spacing={1} sx={{ px: 1.25, py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
      <Typography variant="caption" color="text.secondary">
        {t('common.accounts.title')}
      </Typography>
      {accounts.map((account) => (
        <Stack key={account.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <AccountBalanceWalletRounded
            aria-hidden
            fontSize="small"
            sx={{ color: 'text.secondary' }}
          />
          <Typography
            variant="body2"
            sx={{ flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {account.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            …{account.iban.slice(-4)}
          </Typography>
        </Stack>
      ))}
      <Button
        size="small"
        startIcon={<AddRounded />}
        onClick={() => {
          openImport({ newAccount: true });
        }}
        sx={{ alignSelf: 'flex-start', ml: -0.75 }}
      >
        {t('common.accounts.add')}
      </Button>
    </Stack>
  );
}
