/**
 * What makes an email and a password worth sending.
 *
 * Checked here so a person is told before a round trip, not because it is the protection:
 * Supabase enforces its own rules server-side and this cannot be trusted to have run.
 */

/** Long enough to matter. Length beats punctuation, so nothing here demands a symbol. */
const MIN_LENGTH = 12;
const MAX_LENGTH = 72;
const MAX_EMAIL = 254;

export function passwordError(password: string): string | null {
  if (password.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`;
  // bcrypt stops reading past 72 bytes, so a longer one is not the password it looks like.
  if (password.length > MAX_LENGTH) return `Use at most ${MAX_LENGTH} characters.`;
  if (!/[a-z]/i.test(password)) return "Include at least one letter.";
  if (!/[0-9]/.test(password)) return "Include at least one number.";
  return null;
}

export function emailError(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return "Enter your email address.";
  if (trimmed.length > MAX_EMAIL) return "That email address is too long.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "That does not look like an email address.";
  return null;
}

/**
 * What to show when a sign-in fails. Deliberately the same words whether the address is
 * unknown or the password is wrong, so the form cannot be used to find out who has an
 * account.
 */
export function signInMessage(raw: string): string {
  if (/rate|too many/i.test(raw)) return "Too many attempts. Wait a minute and try again.";
  if (/confirm/i.test(raw)) return "Check your email to confirm the account first.";
  return "That email and password did not match.";
}
