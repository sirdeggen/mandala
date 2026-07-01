/**
 * Props that stop browsers AND password-manager extensions from treating a text
 * field as a username/login input and overriding it with autofill.
 *
 * `autoComplete="off"` alone is widely ignored by 1Password / LastPass /
 * Dashlane / Bitwarden and by Chrome's username heuristic, so we also set the
 * per-manager opt-out data attributes and disable correction/capitalisation.
 * Spread onto an <input>, and give it a NON-credential `name`.
 */
export const noAutofill = {
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'off',
  spellCheck: false,
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': true,
  'data-form-type': 'other',
} as const
