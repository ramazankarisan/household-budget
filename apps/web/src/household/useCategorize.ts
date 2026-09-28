import { useCallback, useRef, useState } from 'react';

import { setTransactionCategory } from '../api/client';
import { useHousehold } from './context';

export interface Categorize {
  /** `null` clears the category and its lock. */
  readonly changeCategory: (transactionId: string, categoryId: string | null) => Promise<void>;
  /** Rows whose own change is in flight. */
  readonly savingIds: ReadonlySet<string>;
}

/**
 * Setting a category by hand, from wherever it is set — the list.
 *
 * Written through the API and then replaced in place rather than reloading: the server
 * decides the lock timestamp, and re-fetching every row to learn one row's new state
 * would scroll the list out from under the click.
 *
 * The set disables a row's control so a second pick cannot be made while the first is
 * unanswered; the counter is what makes that safe rather than merely likely — a response
 * the user has already superseded is dropped instead of overwriting the newer one.
 *
 * @param onError where a refusal is reported; the household's own error by default
 */
export function useCategorize(onError?: (cause: unknown) => void): Categorize {
  const { replaceTransaction, fail } = useHousehold();
  const report = onError ?? fail;
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(() => new Set());
  const changeSeq = useRef(new Map<string, number>());

  const changeCategory = useCallback(
    (transactionId: string, categoryId: string | null): Promise<void> => {
      const seq = (changeSeq.current.get(transactionId) ?? 0) + 1;
      changeSeq.current.set(transactionId, seq);
      setSavingIds((current) => new Set(current).add(transactionId));

      const current = () => changeSeq.current.get(transactionId) === seq;

      return setTransactionCategory(transactionId, categoryId)
        .then((updated) => {
          if (current()) {
            replaceTransaction(updated);
          }
        })
        .catch((cause: unknown) => {
          if (current()) {
            report(cause);
          }
        })
        .finally(() => {
          if (!current()) {
            return;
          }
          setSavingIds((ids) => {
            const next = new Set(ids);
            next.delete(transactionId);
            return next;
          });
        });
    },
    [replaceTransaction, report],
  );

  return { changeCategory, savingIds };
}
