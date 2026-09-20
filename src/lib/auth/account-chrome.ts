/**
 * Header copy for the Sign in / account control that sits next to Upload.
 *
 * Compact label is for tight mobile chrome. The full email stays on larger
 * screens, and always in the title so it still leads to /sign-in for sign-out.
 */

export type AccountChromeCopy = {
  signedIn: boolean;
  label: string;
  compactLabel: string;
  title: string;
};

export function accountChromeCopy(session: { email: string } | null): AccountChromeCopy {
  if (!session) {
    return {
      signedIn: false,
      label: "Sign in",
      compactLabel: "Sign in",
      title: "Sign in to back up your ledger",
    };
  }

  const email = session.email.trim();
  return {
    signedIn: true,
    label: email || "Signed in",
    compactLabel: "Backed up",
    title: email ? `Signed in as ${email}` : "Signed in",
  };
}
