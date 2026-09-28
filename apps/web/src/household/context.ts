import {
  type AccountPayload,
  type CategoryPayload,
  type RulePayload,
  type TransactionPayload,
} from '@household-budget/core';
import { createContext, useContext } from 'react';

type Update<T> = (update: (current: readonly T[]) => readonly T[]) => void;

export interface Household {
  /** `undefined` until the first answer; `[]` means there is no account yet. */
  readonly accounts: readonly AccountPayload[] | undefined;
  /** Each account's rows, present once that account's load has answered. */
  readonly rowsByAccount: ReadonlyMap<string, readonly TransactionPayload[]>;
  /** Every account's rows, or `undefined` until every account has answered. */
  readonly transactions: readonly TransactionPayload[] | undefined;
  readonly categories: readonly CategoryPayload[];
  /** In the order the engine walks them. */
  readonly rules: readonly RulePayload[];
  /** A failed load, worded by the page that shows it. */
  readonly error: { readonly cause: unknown } | undefined;
  /** Loads everything again — after an import, a rules run, anything the server derived. */
  readonly reload: () => void;
  /** One row as the server answered it, replacing the one on screen. */
  readonly replaceTransaction: (row: TransactionPayload) => void;
  readonly addAccount: (account: AccountPayload) => void;
  readonly setCategories: Update<CategoryPayload>;
  readonly setRules: Update<RulePayload>;
  /** Reports a failure through `error`, for writes a page makes on the household's behalf. */
  readonly fail: (cause: unknown) => void;
}

const noop = () => undefined;

/**
 * What a component sees outside a `HouseholdProvider` — a unit test rendering the shell
 * alone: nothing loaded, and writes that go nowhere.
 */
const EMPTY: Household = {
  accounts: undefined,
  rowsByAccount: new Map(),
  transactions: undefined,
  categories: [],
  rules: [],
  error: undefined,
  reload: noop,
  replaceTransaction: noop,
  addAccount: noop,
  setCategories: noop,
  setRules: noop,
  fail: noop,
};

export const HouseholdContext = createContext<Household>(EMPTY);

export function useHousehold(): Household {
  return useContext(HouseholdContext);
}
