// Lightweight CODE strength heuristic — advisory only, never enforced.
// No password-strength dependency.

export type CodeStrength = 'weak' | 'fair' | 'strong';

export function codeStrength(code: string): CodeStrength {
  const len = code.length;
  const classes = {
    lower: /[a-z]/.test(code),
    upper: /[A-Z]/.test(code),
    digit: /\d/.test(code),
    other: /[^\p{L}\p{N}\s]/u.test(code) || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Tibetan}]/u.test(code),
  };
  const variety = Object.values(classes).filter(Boolean).length;

  if (len >= 16 && variety >= 3) return 'strong';
  if (len >= 12 && variety >= 2) return 'strong';
  if (len >= 8) return 'fair';
  return 'weak';
}

/** Does the code start or end with whitespace? (Warn, never auto-fix.) */
export function hasEdgeWhitespace(code: string): boolean {
  return /^\s|\s$/.test(code);
}

export const STRENGTH_LABEL: Record<CodeStrength, string> = {
  weak: 'Weak',
  fair: 'Fair',
  strong: 'Strong',
};
