import { createContext, useContext } from 'react';

export interface ImportRequest {
  /** A file already chosen — dropped on the window — to upload as soon as the dialog opens. */
  readonly file?: File;
  /** Open on the account form, to add an account rather than import into one. */
  readonly newAccount?: boolean;
}

export interface ImportControl {
  /** Opens the import dialog, from anywhere. */
  readonly openImport: (request?: ImportRequest) => void;
}

/** What a page sees outside the shell — a unit test — where there is no dialog to open. */
export const ImportContext = createContext<ImportControl>({ openImport: () => undefined });

export function useImport(): ImportControl {
  return useContext(ImportContext);
}
