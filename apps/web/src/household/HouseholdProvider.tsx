import {
  type AccountPayload,
  type CategoryPayload,
  type RulePayload,
  type TransactionPayload,
} from '@household-budget/core';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { listAccounts, listCategories, listRules, listTransactions } from '../api/client';
import { type Household, HouseholdContext } from './context';

/**
 * Everything the pages show, loaded once and shared (plan 08, decision 4).
 *
 * Before this each page loaded what it needed on mount, and a change on one page — an
 * import, a category set by hand, a rules run — was invisible on another until it
 * reloaded. Now there is one copy: pages read it, and every write either replaces the
 * row the server answered with or asks for a `reload()`.
 *
 * Each account's rows are set the moment they arrive rather than after all of them, so
 * the list shows the account it is on without waiting for the others. A reload keeps the
 * rows on screen until their replacements land, and aborts whatever the previous one
 * still had in flight: two quick reloads cannot land the older answer last.
 */
export function HouseholdProvider({ children }: { readonly children: ReactNode }) {
  const [accounts, setAccounts] = useState<readonly AccountPayload[] | undefined>(undefined);
  const [rowsByAccount, setRowsByAccount] = useState<
    ReadonlyMap<string, readonly TransactionPayload[]>
  >(() => new Map());
  const [categories, setCategories] = useState<readonly CategoryPayload[]>([]);
  const [rules, setRules] = useState<readonly RulePayload[]>([]);
  // The cause, not its sentence: worded at render so it follows a language switch.
  const [error, setError] = useState<{ readonly cause: unknown } | undefined>(undefined);
  const inFlight = useRef<AbortController | undefined>(undefined);

  const reload = useCallback(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const { signal } = controller;
    // Whether a request of *this* load has failed: the accounts answering must not wipe
    // out a categories or rules failure that landed first.
    let failed = false;
    const fail = (cause: unknown) => {
      if (!signal.aborted) {
        failed = true;
        setError({ cause });
      }
    };

    listCategories(signal)
      .then((loaded) => {
        if (!signal.aborted) {
          setCategories(loaded);
        }
      })
      .catch(fail);
    listRules(signal)
      .then((loaded) => {
        if (!signal.aborted) {
          setRules(loaded);
        }
      })
      .catch(fail);
    listAccounts(signal)
      .then((loaded) => {
        if (signal.aborted) {
          return;
        }
        // A load that got this far clears whatever the last one failed with — not what
        // this one already did.
        if (!failed) {
          setError(undefined);
        }
        setAccounts(loaded);
        // An account that is gone takes its rows with it; the others keep theirs on screen.
        const ids = new Set(loaded.map((account) => account.id));
        setRowsByAccount(
          (current) => new Map([...current].filter(([accountId]) => ids.has(accountId))),
        );
        for (const account of loaded) {
          listTransactions(account.id, signal)
            .then((rows) => {
              if (!signal.aborted) {
                setRowsByAccount((current) => new Map(current).set(account.id, rows));
              }
            })
            .catch(fail);
        }
      })
      .catch(fail);
  }, []);

  useEffect(() => {
    reload();
    return () => {
      inFlight.current?.abort();
    };
  }, [reload]);

  const replaceTransaction = useCallback((updated: TransactionPayload) => {
    setRowsByAccount((current) => {
      for (const [accountId, rows] of current) {
        if (rows.some((row) => row.id === updated.id)) {
          return new Map(current).set(
            accountId,
            rows.map((row) => (row.id === updated.id ? updated : row)),
          );
        }
      }
      return current;
    });
  }, []);

  const addAccount = useCallback((account: AccountPayload) => {
    setAccounts((current) => [...(current ?? []), account]);
    setRowsByAccount((current) => new Map(current).set(account.id, []));
  }, []);

  const fail = useCallback((cause: unknown) => {
    setError({ cause });
  }, []);

  // Every row of every account, once each has answered. `undefined` until then: a total
  // over some of the accounts is a wrong number, not a partial one.
  const transactions = useMemo(() => {
    if (accounts === undefined || accounts.some((account) => !rowsByAccount.has(account.id))) {
      return undefined;
    }
    return accounts.flatMap((account) => rowsByAccount.get(account.id) ?? []);
  }, [accounts, rowsByAccount]);

  const value = useMemo<Household>(
    () => ({
      accounts,
      rowsByAccount,
      transactions,
      categories,
      rules,
      error,
      reload,
      replaceTransaction,
      addAccount,
      setCategories,
      setRules,
      fail,
    }),
    [
      accounts,
      rowsByAccount,
      transactions,
      categories,
      rules,
      error,
      reload,
      replaceTransaction,
      addAccount,
      fail,
    ],
  );

  return <HouseholdContext value={value}>{children}</HouseholdContext>;
}
