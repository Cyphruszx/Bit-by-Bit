const MIN_LENGTH = 12;

export function passwordError(password: string): string | null {
  if (password.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(password)) return "Include at least one letter.";
  if (!/[0-9]/.test(password)) return "Include at least one number.";
  return null;
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}
