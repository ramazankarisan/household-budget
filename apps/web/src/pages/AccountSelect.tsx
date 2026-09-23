import { type AccountPayload } from '@household-budget/core';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';

interface AccountSelectProps {
  readonly accounts: readonly AccountPayload[];
  readonly value: string;
  /**
   * The page owns what a switch resets. Both pages clear their rows before the new
   * account's arrive — showing the previous account's numbers under the new account's
   * name is worse than showing none for a moment — but what else goes with them differs.
   */
  readonly onChange: (accountId: string) => void;
}

/** How an account is chosen, once, so the two pages that choose one cannot drift apart. */
export function AccountSelect({ accounts, value, onChange }: AccountSelectProps) {
  return (
    <TextField
      select
      size="small"
      label="Konto"
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      sx={{ minWidth: 260 }}
    >
      {accounts.map((account) => (
        <MenuItem key={account.id} value={account.id}>
          {account.name} · {account.iban}
        </MenuItem>
      ))}
    </TextField>
  );
}
