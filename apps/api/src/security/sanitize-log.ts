/**
 * C0 controls, DEL, C1 controls and the two Unicode line separators. A raw CR or LF in a
 * log line forges the next line; ESC drives the terminal the log is read in.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu;

/**
 * Makes a user-controlled string safe to interpolate into one log line: every control
 * character becomes a visible `\uXXXX`, and the result is capped at `maxLength` plus `…`.
 * Everything else — umlauts, `€` — passes through untouched.
 */
export function sanitizeForLog(value: string, maxLength = 200): string {
  const escaped = value.replace(
    CONTROL_CHARACTERS,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return escaped.length > maxLength ? `${escaped.slice(0, maxLength)}…` : escaped;
}
