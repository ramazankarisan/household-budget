import { useEffect, useRef } from 'react';

/**
 * Key → handler. Keys are `KeyboardEvent.key` values (`'['`, `'j'`, `'2'`, `'Escape'`), or
 * `'Alt+<key>'` for the few bindings that need a modifier (`'Alt+ArrowUp'`).
 */
export type ShortcutMap = Readonly<Record<string, (event: KeyboardEvent) => void>>;

/** Typing into a field is never a shortcut. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** The binding a keydown event asks for, or `undefined` when it must be left alone. */
export function shortcutKeyOf(event: KeyboardEvent): string | undefined {
  if (event.ctrlKey || event.metaKey || event.defaultPrevented) {
    return undefined;
  }
  if (event.altKey) {
    return `Alt+${event.key}`;
  }
  if (isEditable(event.target)) {
    return undefined;
  }
  // `J` with Shift is still `j`: a shortcut is a key, not a character.
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

/**
 * Window-level keyboard shortcuts for the page that is mounted (plan 08, decision 16).
 * Every binding here is also a visible control — a shortcut is never the only way.
 *
 * `Alt+…` bindings fire even with focus inside a field, because they are how a focused
 * rule row is moved; plain keys never do.
 */
export function useShortcuts(map: ShortcutMap, enabled = true): void {
  // The latest map, read at event time: a page passing an inline object must not
  // re-subscribe on every render.
  const current = useRef(map);
  useEffect(() => {
    current.current = map;
  });

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    function onKeyDown(event: KeyboardEvent): void {
      const key = shortcutKeyOf(event);
      if (key === undefined) {
        return;
      }
      const handler = current.current[key];
      if (handler !== undefined) {
        event.preventDefault();
        handler(event);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled]);
}
